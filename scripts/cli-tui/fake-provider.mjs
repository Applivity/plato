/**
 * A local OpenAI-compatible endpoint for the CLI terminal checks.
 *
 * It answers `/models` and `/chat/completions` and records every request body,
 * so a check can prove what Plato actually sent, not only what the screen
 * showed. Nothing leaves this machine and no key is used.
 */
import { createServer } from 'node:http';

export function startProvider(options = {}) {
  /** The context window `/models` advertises; absent, Plato falls back. */
  const context = options.context;
  /** The field carrying it. DeepSeek spells the same number `context_window`. */
  const windowField = options.windowField ?? 'context_length';
  const port = options.port;
  const modelId = options.model ?? 'paste-model';
  const modelIds = Array.isArray(options.models) ? options.models : [modelId];
  const modelsStatus = options.modelsStatus;
  /** A slow model list, for the cold-start check. */
  const modelsDelayMs = options.modelsDelayMs ?? 0;
  /** Every chat request, in arrival order. */
  const requests = [];
  /**
   * The answers to play, one per agent turn. A step is
   * `{ text, chunks, chunkMs }` for text, or `{ tool, args }` for a call.
   * `delayMs` holds the answer back so a check can press Esc while the call
   * is still out. No script, or a script that has run out, answers with a
   * fixed sentence.
   */
  let script = [];
  let cursor = 0;

  const finish = (res, finishReason, usage) => {
    const chunk = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
    chunk({
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      usage,
    });
    res.write('data: [DONE]\n\n');
    res.end();
  };

  const play = async (res, step) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    if (step.tool !== undefined) {
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_0',
                  type: 'function',
                  function: {
                    name: step.tool,
                    arguments: JSON.stringify(step.args ?? {}),
                  },
                },
              ],
            },
          },
        ],
      });
      finish(res, 'tool_calls', { prompt_tokens: 100, completion_tokens: 20 });
      return;
    }
    const text = typeof step.text === 'string' ? step.text : 'Paste received.';
    const pieces = Math.max(1, step.chunks ?? 1);
    const size = Math.ceil(text.length / pieces);
    for (let index = 0; index < text.length; index += size) {
      if (res.destroyed) return;
      chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: text.slice(index, index + size) } }] });
      if (step.chunkMs !== undefined && index + size < text.length) {
        await new Promise((done) => setTimeout(done, step.chunkMs));
      }
    }
    // A hold lets a check read the last streaming frame before the answer lands.
    if (step.holdMs !== undefined) {
      await new Promise((done) => setTimeout(done, step.holdMs));
    }
    finish(res, 'stop', { prompt_tokens: 100, completion_tokens: Math.max(1, text.length >> 2) });
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        const answer = () => {
          if (res.destroyed || res.writableEnded) return;
          if (modelsStatus !== undefined) {
            res.writeHead(modelsStatus, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'the key is not accepted' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              data: modelIds.map((id) => ({
                id,
                ...(context === undefined ? {} : { [windowField]: context }),
              })),
            }),
          );
        };
        if (modelsDelayMs > 0) {
          setTimeout(answer, modelsDelayMs);
        } else {
          answer();
        }
        return;
      }
      if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        requests.push(parsed);
        // A compaction call is the engine's own summary request, not a turn
        // of the script: answer it at once so the script stays aligned.
        const system = (parsed?.messages ?? []).find((message) => message?.role === 'system');
        const systemText =
          typeof system?.content === 'string'
            ? system.content
            : Array.isArray(system?.content)
              ? system.content.map((block) => block?.text ?? '').join('')
              : '';
        // A compaction call is not streamed: the adapter reads a plain JSON
        // body when no one is watching the deltas.
        if (parsed?.stream !== true) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'chatcmpl-local',
              object: 'chat.completion',
              created: 0,
              model: parsed?.model ?? modelId,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Short summary.' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
            }),
          );
          return;
        }
        const step = script[cursor] ?? { text: 'Paste received.' };
        cursor += 1;
        // `delayMs` holds the answer back. A check uses it to press Esc while
        // the model call is still out, before any card or tool can appear.
        if (typeof step.delayMs === 'number' && step.delayMs > 0) {
          setTimeout(() => void play(res, step), step.delayMs);
        } else {
          void play(res, step);
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    // A fixed port can be taken (a real local model server); fail the check
    // with a sentence instead of an unhandled 'error' event.
    server.once('error', reject);
    server.listen(port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      const { port } = server.address();
      resolve({
        port,
        requests,
        /** The answers to play, one per agent turn, from this point on. */
        setScript: (steps) => {
          script = steps;
          cursor = 0;
        },
        close: () =>
          new Promise((done) => {
            // Keep-alive sockets would hold the close open after the CLI stops.
            server.closeAllConnections();
            server.close(done);
          }),
      });
    });
  });
}
