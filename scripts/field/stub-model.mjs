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
 *   POST /__script  { steps: [...], observers: [...] }
 *                                      set the script and the observer replies;
 *                                      resets both cursors
 *   POST /__reset                      clear the script and the log
 *   GET  /__log                        the request log as JSON
 *
 * D49cg follow-on (M3b checkpoint 2): an observer turn also carries no tools.
 * It used to share the auxiliary path and always received the title placeholder,
 * which is not JSON, so no observer could ever be scripted into an action. The
 * observer has its OWN script now, consumed independently: `observers` is a list
 * of actions such as `{"action":"guidance","message":"..."}`, a bare string, or
 * `{"action":"noop"}`. An empty list answers noop. The agent's `steps` cursor is
 * untouched, so rule 1 still holds for both.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env['PLATO_STUB_PORT'] ?? 4599);

/**
 * The model list `/models` returns. The default is the single model every
 * existing case assumes. A caller that needs a different list — the M3a
 * settings run needs a reasoning-capable name — sets PLATO_STUB_MODELS.
 */
const MODELS = (process.env['PLATO_STUB_MODELS'] ?? 'stub-model')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

/**
 * The context window `/models` advertises, in tokens. Off by default: with no
 * number Plato falls back to its own default, which is what every existing case
 * was written against. A test that needs the fold to measure against a real
 * window sets it — the window decides when the fold runs, so a fixture without
 * one could only ever test the fallback.
 */
const CONTEXT = Number(process.env['PLATO_STUB_CONTEXT'] ?? '0');

/** Cursor into the current script, plus the log of what we were asked. */
let steps = [];
let cursor = 0;
/**
 * D49cq: which steps have been played. Two chat tabs share this stub, and one
 * sequential cursor cannot tell them apart — tab A's second turn would take the
 * step a run in tab B had just started for. A step carrying `match` is played
 * when the last user message contains that text; steps without one keep the
 * strict order every other case relies on.
 */
let played = new Set();
/** D49cg follow-on: the observer's own script, consumed by its own cursor. */
let observerSteps = [];
let observerCursor = 0;
let log = [];
/** D49bo: how long `/models` is held before it answers. See `/__script`. */
let modelsDelayMs = 0;
/** 'prompt' derives the title from the request; 'fixed' answers "Field test run". */
let titleMode = 'fixed';

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
  // D49bp: a step may SIMULATE A CUT. The response ends here — no
  // `finish_reason` and no `[DONE]` sentinel — which is the shape a proxy
  // timeout or a mid-stream 502 leaves behind. Plato must report the half answer
  // as a FAILED attempt and retry, not return it as a turn the model chose to
  // end. The next scripted step is what the retry consumes.
  if (step.cut === true) {
    res.end();
    return;
  }
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
    observerSteps = Array.isArray(body.observers) ? body.observers : [];
    titleMode = body.titleMode === 'prompt' ? 'prompt' : 'fixed';
    observerCursor = 0;
    // D49bo: how long to hold the model-discovery response. The host asks for
    // this while PREPARING a run — before it is `running` — so stalling it widens
    // the window in which a control press can arrive before the run has started.
    // Milliseconds wide by default, which makes a race inside it unhittable by
    // anything but luck.
    modelsDelayMs = Number(body.modelsDelayMs) || 0;
    cursor = 0;
    played = new Set();
    log = [];
    return json(res, 200, { ok: true, steps: steps.length });
  }
  if (url === '/__reset' && req.method === 'POST') {
    steps = [];
    cursor = 0;
    played = new Set();
    observerSteps = [];
    observerCursor = 0;
    log = [];
    return json(res, 200, { ok: true });
  }
  if (url === '/__log') {
    return json(res, 200, { cursor, total: steps.length, log });
  }

  // The model list a human would see in Settings → Providers. Not used by the
  // runs, but its absence makes the panel look broken if anyone opens it.
  if (url.endsWith('/models')) {
    // D49bo: the host asks for this while preparing a run, so a stall here is a
    // stall BEFORE the run is `running`. That is the window a control press can
    // arrive in, and the only way to enter it on purpose.
    if (modelsDelayMs > 0) {
      await new Promise((r) => setTimeout(r, modelsDelayMs));
      if (res.writableEnded || res.destroyed) return;
    }
    return json(res, 200, {
      data: MODELS.map((id) => ({
        id,
        object: 'model',
        ...(CONTEXT > 0 ? { context_length: CONTEXT } : {}),
      })),
    });
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
  const systemText =
    typeof messages[0]?.content === 'string' && messages[0].role === 'system'
      ? messages[0].content
      : '';
  // M4a: an image rides the opening user turn as a parts array (D49n). The log
  // records whether one arrived and its sniffed MIME, because a test that only
  // sees the attach-result has proved the PICKER, not that the model was sent
  // the bytes. Additive fields: a caller that does not read them is unaffected.
  const partsOf = (m) =>
    Array.isArray(m?.content) ? m.content : [];
  const imageUrls = messages
    .flatMap((m) => partsOf(m))
    .filter((p) => p && (p.type === 'image_url' || p.type === 'image'))
    .map((p) => String(p.image_url?.url ?? p.source?.data ?? ''));
  const imageMimes = imageUrls
    .map((url) => {
      const match = /^data:([^;]+);base64,/.exec(url);
      return match ? match[1] : 'unknown';
    });
  const userTexts = messages
    .filter((m) => m && m.role === 'user')
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      return partsOf(m)
        .filter((p) => p && p.type === 'text')
        .map((p) => String(p.text ?? ''))
        .join('\n');
    });
  log.push({
    at: new Date().toISOString(),
    model: body.model,
    // D49cd: the assembled system prompt, only when a test asks for it. It can
    // carry a project's own instruction files, so it is off by default and the
    // same switch is what keeps it out of every other suite's log.
    ...(process.env['PLATO_STUB_LOG_SYSTEM'] === '1' ? { systemText } : {}),
    toolsOffered: offered,
    toolNames: offered > 0 ? body.tools.map((t) => t?.function?.name) : [],
    messages: messages.length,
    toolResults,
    // M4a: what the opening user turn actually carried.
    userTexts,
    imageParts: imageUrls.length,
    imageMimes,
    systemChars: systemText.length,
    streaming: body.stream === true,
    consumedStep: null,
  });

  // Observer call (no tools): played from its own script so a case can make a
  // philosopher steer the run. Its cursor is separate from the agent's — see
  // rule 1 at the top of this file.
  if (offered === 0 && systemText.startsWith('You are the observer')) {
    log[log.length - 1].consumedStep = 'observer';
    const step =
      observerCursor < observerSteps.length
        ? observerSteps[observerCursor]
        : { action: 'noop' };
    observerCursor += 1;
    const text = typeof step === 'string' ? step : JSON.stringify(step);
    if (body.stream === true) return textFrames(res, text, 'stop');
    return json(res, 200, {
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
  }

  // Auxiliary call (no tools): the title/idle path. Answer and do not touch the
  // script — see rule 1 at the top of this file.
  if (offered === 0) {
    log[log.length - 1].consumedStep = 'auxiliary';
    // Tabs need distinguishable labels. A fixed title made every conversation
    // "Field test run", which is fine for the header but makes two open chat
    // tabs indistinguishable in the workbench. The field harness asks for the
    // derived title with `titleMode: 'prompt'`; every other suite keeps the
    // fixed one its assertions are written against.
    const seedText = String(userTexts[userTexts.length - 1] ?? '')
      .replace(/^User:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const title =
      titleMode === 'prompt' && seedText.length > 0
        ? seedText.slice(0, 30)
        : 'Field test run';
    if (body.stream === true) return textFrames(res, title, 'stop');
    return json(res, 200, {
      choices: [{ index: 0, message: { role: 'assistant', content: title }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });
  }

  // D49cq: a step that names its prompt wins over the order; without one, the
  // strict script order stands exactly as before.
  const lastUser = String(userTexts[userTexts.length - 1] ?? '');
  const pickStep = () => {
    for (let i = 0; i < steps.length; i += 1) {
      if (played.has(i)) continue;
      const match = steps[i] && typeof steps[i].match === 'string' ? steps[i].match : '';
      if (match.length > 0 && lastUser.includes(match)) return i;
    }
    while (cursor < steps.length && played.has(cursor)) cursor += 1;
    return cursor < steps.length ? cursor : -1;
  };

  const chosen = pickStep();
  if (chosen < 0) {
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
  const step = steps[chosen];
  // D49bm: a step may hold its answer for a moment before it is sent. Without
  // this the stub replies in microseconds and a whole run is over before a
  // driver has clicked anything, so no test could catch a run mid-flight — and
  // "mid-flight" is exactly where the pause control has to be tested. A model
  // that is thinking is also when a user reaches for Pause.
  const wait = Number(step.delayMs) || 0;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
    // A cancel during the wait destroys the request; writing to it would throw
    // and look like a stub crash rather than the stop the user asked for.
    if (res.writableEnded || res.destroyed) return;
  }
  // D49cq: a step is marked used only when it is SENT, not when its request
  // arrives. That is the stub's old rule and case 37 depends on it: two slow
  // runs started while the first is held both take the one slow step, so each
  // is still in flight when its tab is closed. Marking at arrival made the
  // second run fall past the end of the script and finish instantly.
  if (chosen === cursor) cursor += 1;
  played.add(chosen);
  log[log.length - 1].consumedStep = chosen;
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
                  id: `call_${chosen}_${i}`,
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
