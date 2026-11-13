/**
 * A local OpenAI-compatible endpoint for the CLI terminal checks.
 *
 * It answers `/models` and `/chat/completions` and records every request body,
 * so a check can prove what Plato actually sent, not only what the screen
 * showed. Nothing leaves this machine and no key is used.
 */
import { createServer } from 'node:http';

export function startProvider() {
  /** Every chat request, in arrival order. */
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [{ id: 'paste-model', context_length: 131072 }],
          }),
        );
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
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
        chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Paste received.' } }] });
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        chunk({
          choices: [{ index: 0, delta: {}, finish_reason: null }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        requests,
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
