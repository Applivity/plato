/**
 * Evaluate one expression in the Plato WebView2 page.
 *
 * The Visual Studio process must be started with
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
 * Usage: node cdp.mjs "document.title"
 */
const expression = process.argv[2] ?? 'document.title';
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page =
  targets.find((target) => target.type === 'page' && target.title === 'Plato') ??
  targets.find((target) => target.type === 'page');
if (page === undefined) {
  console.error('no WebView2 page target');
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function call(method, params) {
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const response = await call('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
});
if (response.error !== undefined) {
  console.error(JSON.stringify(response.error, null, 2));
  process.exit(1);
}

const result = response.result?.result;
console.log(JSON.stringify(result?.value ?? result, null, 2));
socket.close();
