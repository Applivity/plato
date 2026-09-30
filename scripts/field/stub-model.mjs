/**
 * The scripted model — the piece that makes these field tests deterministic.
 *
 * Plato talks to any OpenAI-compatible endpoint, so this stands up one on
 * localhost and plays a CANNED script of turns. That is the whole trick: the
 * nine field tests ask whether Plato gates, refuses, remembers and reports
 * correctly, not whether a model writes good Java. Pinning the model's replies
 * removes the only nondeterministic actor, needs no API key, costs nothing, and
 * makes a failure reproducible.
 *
 * Two rules keep it honest:
 *
 *   1. A call that carries `tools` is a real agent turn and consumes the next
 *      script step. A call WITHOUT tools is an auxiliary one — the D40
 *      conversation-title call is the common case — and gets a throwaway
 *      answer, so it cannot shift the script and silently misalign every later
 *      assertion. That is the bug this rule exists to prevent.
 *   2. Every request is logged with what the model was actually shown (system
 *      prompt length, message count, whether tools were offered). A failed case
 *      then has two independent records: what Plato sent, and what the
 *      transcript says Plato did.
 *
 * Control endpoints (used by the runner, never by Plato):
 *   POST /__script  { steps: [...] }   set the script; resets the cursor
 *   POST /__reset                      clear the script and the log
 *   GET  /__log                        the request log as JSON
 */
import { createServer } from 'node:http';

const PORT = Number(process.env['PLATO_STUB_PORT'] ?? 4599);

/** Cursor into the current script, plus the log of what we were asked. */
let steps = [];
let cursor = 0;
let log = [];

const textFrames = (res, text, finish) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: text } }] });
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }] });
  chunk({
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    usage: { prompt_tokens: 100, completion_tokens: Math.max(1, text.length >> 2) },
  });
  res.write('data: [DONE]\n\n');
  res.end();
};

/**
 * One scripted step becomes one wire turn. A step may carry `text` and/or
 * `calls` (an array of `{ tool, args }`); a step with calls ends with
 * finish_reason 'tool_calls', exactly as a real model's tool turn does.
 */
const playStep = (res, step) => {
  const calls = Array.isArray(step.calls) ? step.calls : step.tool ? [{ tool: step.tool, args: step.args ?? {} }] : [];
  const text = typeof step.text === 'string' ? step.text : '';
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  chunk({ choices: [{ index: 0, delta: { role: 'assistant', ...(text ? { content: text } : {}) } }] });
  calls.forEach((c, i) => {
    chunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: i, id: `call_${cursor}_${i}`, function: { name: c.tool, arguments: JSON.stringify(c.args ?? {}) } },
            ],
          },
        },
      ],
    });
  });
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: calls.length > 0 ? 'tool_calls' : 'stop' }] });
  chunk({
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
  res.write('data: [DONE]\n\n');
  res.end();
};

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(b));
      } catch {
        resolve({});
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = req.url ?? '';

  if (url === '/__script' && req.method === 'POST') {
    const body = await readBody(req);
    steps = Array.isArray(body.steps) ? body.steps : [];
    cursor = 0;
    log = [];
    return json(res, 200, { ok: true, steps: steps.length });
  }
  if (url === '/__reset' && req.method === 'POST') {
    steps = [];
    cursor = 0;
    log = [];
    return json(res, 200, { ok: true });
  }
  if (url === '/__log') {
    return json(res, 200, { cursor, total: steps.length, log });
  }

  // The model list a human would see in Settings → Providers. Not used by the
  // runs, but its absence makes the panel look broken if anyone opens it.
  if (url.endsWith('/models')) {
    return json(res, 200, { data: [{ id: 'stub-model', object: 'model' }] });
  }

  if (!url.endsWith('/chat/completions') || req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }

  const body = await readBody(req);
  const offered = Array.isArray(body.tools) ? body.tools.length : 0;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  // Tool results are the model's view of what Plato DID — for a refusal, the
  // only witness there is (the loop emits no bus event for a pre-flight
  // refusal, so the transcript stays silent).
  //
  // D49bb: a protected file's contents DO reach a tool result now — masked — so
  // the old 120-char truncation was too short to witness anything. Two changes,
  // both driven by a check that actually failed:
  //
  // * the head is 4,000 chars, enough for a config file end to end. It was 400,
  //   and case 1 read `local.properties`, whose placeholder sits on line 12
  //   after ten comment lines — so a MASKED read looked identical to an
  //   unmasked one from the head alone.
  // * `masked` says whether a placeholder appears ANYWHERE in the result, which
  //   does not depend on where in the file it falls. A large file still has its
  //   placeholder beyond the window; the boolean does not.
  const toolResults = messages
    .filter((m) => m && m.role === 'tool')
    .map((m) => {
      const text = String(m.content ?? '');
      return { len: text.length, head: text.slice(0, 4000), masked: text.includes('«masked:') };
    });
  log.push({
    at: new Date().toISOString(),
    model: body.model,
    toolsOffered: offered,
    toolNames: offered > 0 ? body.tools.map((t) => t?.function?.name) : [],
    messages: messages.length,
    toolResults,
    systemChars: typeof messages[0]?.content === 'string' && messages[0].role === 'system' ? messages[0].content.length : 0,
    streaming: body.stream === true,
    consumedStep: null,
  });

  // Auxiliary call (no tools): the title/idle path. Answer and do not touch the
  // script — see rule 1 at the top of this file.
  if (offered === 0) {
    log[log.length - 1].consumedStep = 'auxiliary';
    const title = 'Field test run';
    if (body.stream === true) return textFrames(res, title, 'stop');
    return json(res, 200, {
      choices: [{ index: 0, message: { role: 'assistant', content: title }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });
  }

  if (cursor >= steps.length) {
    // Running past the script is a test-authoring error, and it must be loud:
    // returning a silent empty answer here would look like Plato misbehaving.
    log[log.length - 1].consumedStep = 'PAST_END';
    const msg = `stub: script exhausted (step ${cursor + 1} requested, ${steps.length} scripted)`;
    if (body.stream === true) return textFrames(res, msg, 'stop');
    return json(res, 200, {
      choices: [{ index: 0, message: { role: 'assistant', content: msg }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
  }

  const step = steps[cursor];
  log[log.length - 1].consumedStep = cursor;
  cursor += 1;
  if (body.stream === true) return playStep(res, step);
  const calls = Array.isArray(step.calls) ? step.calls : step.tool ? [{ tool: step.tool, args: step.args ?? {} }] : [];
  return json(res, 200, {
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: typeof step.text === 'string' && step.text.length > 0 ? step.text : null,
          ...(calls.length > 0
            ? {
                tool_calls: calls.map((c, i) => ({
                  id: `call_${cursor - 1}_${i}`,
                  type: 'function',
                  function: { name: c.tool, arguments: JSON.stringify(c.args ?? {}) },
                })),
              }
            : {}),
        },
        finish_reason: calls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub model listening on http://127.0.0.1:${PORT}/v1`);
});
