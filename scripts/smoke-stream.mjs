/**
 * Real-SDK smoke test for D49j. The unit tests MOCK @anthropic-ai/sdk, so they
 * prove the adapter's wiring but not that the installed SDK's `messages.stream()`
 * actually behaves as assumed. This points the REAL SDK at a local SSE stub and
 * checks the two claims the design rests on:
 *   1. `stream.on('text')` delivers text deltas as they arrive.
 *   2. `finalMessage()` resolves with the assembled message — identical to create.
 * Plus the OpenAI-compatible path over real undici fetch, and abort.
 */
import http from 'node:http';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, '..', 'packages', 'core', 'dist', 'src', 'providers');
const { AnthropicNativeProvider } = await import(CORE + '/anthropic-native.js');
const { OpenAICompatProvider } = await import(CORE + '/openai-compat.js');

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('OK   ' + name); } else { failures++; console.log('FAIL ' + name, JSON.stringify(detail)); }
};

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};

const ANTHROPIC_EVENTS = (pieces) => [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...pieces.map((p) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
  { type: 'message_stop' },
];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.startsWith('/v1/messages')) {
      const streaming = JSON.parse(body).stream === true;
      if (!streaming) {
        // The blocking path, so the two can be compared.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'Hello world' }],
          stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }));
        return;
      }
      if (req.headers['x-test-mode'] === 'abort') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`event: message_start\ndata: ${JSON.stringify(ANTHROPIC_EVENTS([])[0])}\n\n`);
        res.write(`event: content_block_start\ndata: ${JSON.stringify(ANTHROPIC_EVENTS([])[1])}\n\n`);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } })}\n\n`);
        return; // never end — the client must abort
      }
      sse(res, ANTHROPIC_EVENTS(['Hel', 'lo', ' world']));
      return;
    }
    if (req.url.startsWith('/v1/chat/completions')) {
      const b = JSON.parse(body);
      if (b.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hello world' } }], usage: { prompt_tokens: 11, completion_tokens: 3 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ choices: [{ delta: { content: 'Hel' } }] });
      chunk({ choices: [{ delta: { content: 'lo' } }] });
      chunk({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] });
      chunk({ choices: [{ delta: {} }], usage: { prompt_tokens: 11, completion_tokens: 3 } });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
process.env['ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${port}`;

const turn = (over = {}) => ({
  model: 'anthropic:claude-sonnet-4-5',
  system: 'SYS',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
  tools: [],
  maxTokens: 100,
  ...over,
});

// --- Anthropic, real SDK ---------------------------------------------------
const p = new AnthropicNativeProvider('sk-test');

const deltas = [];
const streamed = await p.completeTurn(turn({ onDelta: (t) => deltas.push(t) }));
check('real SDK: deltas arrive through stream.on("text")',
  deltas.join('') === 'Hello world', deltas);
check('real SDK: deltas arrive as separate fragments, not one block',
  deltas.length === 3, deltas);
check('real SDK: finalMessage() assembles the same text',
  streamed.content[0]?.text === 'Hello world', streamed.content);
check('real SDK: usage is mapped', streamed.usage.inputTokens === 11 && streamed.usage.outputTokens === 3, streamed.usage);
check('real SDK: stop reason is mapped', streamed.stopReason === 'stop', streamed.stopReason);

const blocking = await p.completeTurn(turn());
check('real SDK: streamed and blocking responses are identical',
  JSON.stringify(streamed) === JSON.stringify(blocking),
  { streamed, blocking });

// --- Anthropic, abort ------------------------------------------------------
const ctrl = new AbortController();
const aborting = p.completeTurn(turn({ onDelta: () => ctrl.abort(), signal: ctrl.signal }));
let aborted = false;
try { await aborting; } catch { aborted = true; }
check('real SDK: an aborted stream rejects instead of hanging', aborted, aborted);

// --- OpenAI-compatible, real undici fetch ---------------------------------
const o = new OpenAICompatProvider('sk-test', `http://127.0.0.1:${port}/v1`);
const odeltas = [];
const ostreamed = await o.completeTurn(turn({ model: 'openai:gpt-4o', onDelta: (t) => odeltas.push(t) }));
check('real fetch: SSE fragments are reassembled',
  odeltas.join('') === 'Hello world' && ostreamed.content[0]?.text === 'Hello world',
  { odeltas, content: ostreamed.content });
check('real fetch: usage from the final chunk is mapped',
  ostreamed.usage.inputTokens === 11 && ostreamed.usage.outputTokens === 3, ostreamed.usage);

const oblocking = await o.completeTurn(turn({ model: 'openai:gpt-4o' }));
check('real fetch: streamed and blocking responses are identical',
  JSON.stringify(ostreamed) === JSON.stringify(oblocking), { ostreamed, oblocking });

server.close();
console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
