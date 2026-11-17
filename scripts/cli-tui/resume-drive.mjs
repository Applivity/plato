/**
 * Drives the built CLI through `/resume`.
 *
 *   node scripts/cli-tui/resume-drive.mjs [--cli path/to/cli.js]
 *
 * Two saved conversations are written into this workspace's store. The picker
 * lists both; Esc changes nothing; Enter saves the current view first and loads
 * the chosen one (rows, header title, model, mode, team, known window) without
 * a chat request. `/sessions` names the same list. A file deleted while the
 * picker is open leaves the current conversation intact.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

async function waitFor(test, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const lastFrame = (output) => {
  const start = output.lastIndexOf('\x1b[?2026h');
  if (start < 0) return plain(output);
  const end = output.lastIndexOf('\x1b[?2026l');
  return plain(output.slice(start, end > start ? end : undefined));
};
const linesOf = (text) => text.split('\n').map((line) => line.replace(/\r$/, ''));
const lastLine = (output, prefix) =>
  linesOf(lastFrame(output)).filter((line) => line.startsWith(prefix)).at(-1) ?? '';
const lastStatus = (output) => lastLine(output, 'mode: ');
const lastHeader = (output) =>
  linesOf(lastFrame(output)).filter((line) => line.trimStart().startsWith('Plato · terminal')).at(-1) ?? '';
const headerText = (line) => {
  const at = line.indexOf('  ');
  return at < 0 ? '' : line.slice(at).trim();
};
// The card is drawn inside a border, so its row starts with the border glyph.
const selected = (output) => {
  const line = linesOf(lastFrame(output)).find((candidate) => candidate.includes('❯ '));
  return line === undefined ? '' : line.slice(line.indexOf('❯ '));
};
const pickerOpen = (output) => lastFrame(output).includes('Enter switches');

const provider = await startProvider({
  context: 131_072,
  models: ['first-model', 'second-model'],
  model: 'first-model',
});
const root = mkdtempSync(join(tmpdir(), 'plato-cli-resume-'));
const config = join(root, 'config');
const data = join(root, 'data');
const home = join(root, 'home');
const project = join(root, 'project');
for (const dir of [config, data, home, project]) mkdirSync(dir, { recursive: true });
writeFileSync(
  join(config, 'config.json'),
  `${JSON.stringify(
    {
      connections: [
        { id: 'fake', kind: 'openai', baseUrl: `http://127.0.0.1:${provider.port}/v1` },
      ],
      model: 'fake:first-model',
      team: 'solo',
      mode: 'edit',
      reasoning: 'off',
      compactionThreshold: 0.8,
      respectGitignore: false,
    },
    null,
    2,
  )}\n`,
);

// This workspace's session store, keyed the way the CLI keys it.
const key = createHash('sha1').update(realpathSync(project)).digest('hex').slice(0, 8);
const sessionsDir = join(home, 'sessions', key);
mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
const now = Date.now();
function writeSession(id, title, model, mode, team, question, answer, minutesAgo) {
  const at = new Date(now - minutesAgo * 60_000).toISOString();
  const stored = {
    id,
    title,
    createdAt: at,
    updatedAt: at,
    model,
    mode,
    team,
    history: [
      { role: 'user', text: question },
      { role: 'assistant', text: answer },
    ],
  };
  writeFileSync(join(sessionsDir, `${id}.json`), `${JSON.stringify(stored, null, 2)}\n`, {
    mode: 0o600,
  });
  return join(sessionsDir, `${id}.json`);
}
const firstPath = writeSession(
  '20261117090000-aaaa',
  'first conversation question',
  'fake:first-model',
  'plan',
  'duo',
  'first conversation question',
  'answer from the first',
  5,
);
writeSession(
  '20261117080000-bbbb',
  'second conversation question',
  'fake:second-model',
  'auto',
  'academy',
  'second conversation question',
  'answer from the second',
  10,
);
const sessionFiles = () => readdirSync(sessionsDir).filter((file) => file.endsWith('.json'));

const env = {
  ...process.env,
  TERM: 'xterm-256color',
  PLATO_CONFIG_DIR: config,
  PLATO_DATA_DIR: data,
  PLATO_HOME: home,
};

function pty(cols = 110) {
  const state = { output: '', exited: false };
  const inner = `stty cols ${cols}; exec node ${JSON.stringify(cli)}`;
  const child = spawn(
    'sh',
    ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`],
    { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true },
  );
  child.stdout.on('data', (chunk) => {
    state.output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    state.output += chunk.toString();
  });
  child.on('close', () => {
    state.exited = true;
  });
  state.send = (text) => child.stdin.write(text);
  state.submit = async (text) => {
    const mark = state.output.length;
    state.send(text);
    const probe = text.slice(0, 20);
    await waitFor(
      () => plain(state.output.slice(mark)).includes(probe),
      5000,
      `the text '${probe}' on screen`,
    );
    state.send('\r');
  };
  state.quit = async () => {
    state.send('\x03');
    await sleep(400);
    state.send('\x03');
    await sleep(700);
    try {
      child.stdin.end();
    } catch {
      // Already gone.
    }
    await waitFor(() => state.exited, 8000, 'the process to exit');
  };
  state.kill = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  };
  return state;
}

const results = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
let output = '';
let exited = false;
const ui = pty();

try {
  await waitFor(() => plain(ui.output).includes('Type / for commands'), 8000, 'the session');
  // The startup window is resolved from the connection before any picker.
  await waitFor(() => lastStatus(ui.output).includes('0/131k'), 8000, 'the startup window');
  record(headerText(lastHeader(ui.output)) === '', 'the session starts empty');

  // 1. The picker lists both saved conversations with facts.
  await ui.submit('/resume');
  await waitFor(() => pickerOpen(ui.output), 5000, 'the picker');
  record(
    lastFrame(ui.output).includes('first conversation question') &&
      lastFrame(ui.output).includes('second conversation question'),
    'the picker lists both saved conversations',
  );
  record(
    lastFrame(ui.output).includes('5m ago') && lastFrame(ui.output).includes('1 turn'),
    'each conversation carries when it was used and its turns',
  );
  const firstChoice = selected(ui.output);
  ui.send('\x1b[B');
  await waitFor(() => selected(ui.output) !== firstChoice, 5000, 'the selection to move');
  record(true, 'Down moves the selection');
  ui.send('\x1b[A');
  await waitFor(() => selected(ui.output) === firstChoice, 5000, 'the selection to move back');
  record(true, 'Up moves it back');

  // 2. Esc changes nothing.
  const beforeEsc = lastStatus(ui.output);
  ui.send('\x1b');
  await waitFor(() => !pickerOpen(ui.output), 5000, 'the picker to close');
  record(
    headerText(lastHeader(ui.output)) === '' &&
      lastStatus(ui.output) === beforeEsc &&
      sessionFiles().length === 2,
    'Esc closes the picker and changes nothing',
  );

  // 3. Enter saves the current view, then loads the chosen conversation.
  await ui.submit('/resume');
  await waitFor(() => pickerOpen(ui.output), 5000, 'the picker again');
  ui.send('\r');
  await waitFor(
    () => headerText(lastHeader(ui.output)) === 'first conversation question',
    8000,
    'the loaded title',
  );
  record(true, 'the header shows the loaded conversation’s title');
  await waitFor(
    () => lastStatus(ui.output).includes('mode: plan'),
    5000,
    'the loaded mode',
  );
  record(
    lastStatus(ui.output).includes('team: duo') &&
      lastStatus(ui.output).includes('fake:first-model'),
    'the loaded mode, team and model are in the status line',
  );
  record(
    /[1-9]\d*\/131k/.test(lastStatus(ui.output)),
    'a known window survives the switch, with the loaded conversation’s share',
  );
  record(
    plain(ui.output).includes('answer from the first'),
    'the loaded conversation’s rows are on screen',
  );
  record(provider.requests.length === 0, 'loading a conversation makes no chat request');
  record(sessionFiles().length === 3, 'the current conversation was saved before the switch');

  // 4. /sessions says it is the same list.
  const listMark = ui.output.length;
  await ui.submit('/sessions');
  await waitFor(
    () => plain(ui.output.slice(listMark)).includes('/resume opens this same list'),
    5000,
    'the sessions sentence',
  );
  record(
    plain(ui.output.slice(listMark)).includes('first conversation question') &&
      plain(ui.output.slice(listMark)).includes('second conversation question'),
    '/sessions lists the same conversations and says so',
  );

  // 5. Switching away saves the loaded conversation again.
  const firstBefore = JSON.parse(readFileSync(firstPath, 'utf8')).updatedAt;
  await ui.submit('/resume');
  await waitFor(() => pickerOpen(ui.output), 5000, 'the picker for the second switch');
  // The empty conversation saved on the first switch is newest; A follows, and
  // B is third.
  ui.send('\x1b[B');
  await sleep(150);
  ui.send('\x1b[B');
  await waitFor(
    () => selected(ui.output).includes('second conversation question'),
    5000,
    'the second conversation selected',
  );
  ui.send('\r');
  await waitFor(
    () => headerText(lastHeader(ui.output)) === 'second conversation question',
    8000,
    'the second title',
  );
  await waitFor(() => lastStatus(ui.output).includes('mode: auto'), 5000, 'the second mode');
  record(
    lastStatus(ui.output).includes('team: academy') &&
      lastStatus(ui.output).includes('fake:second-model'),
    'the second conversation loads its mode, team and model',
  );
  record(
    plain(ui.output).includes('answer from the second'),
    'the second conversation’s rows are drawn, not just its title',
  );
  record(!lastStatus(ui.output).includes('/'), 'an unknown window is not invented');
  const firstAfter = JSON.parse(readFileSync(firstPath, 'utf8')).updatedAt;
  record(firstAfter > firstBefore, 'the conversation left behind was saved first');
  record(provider.requests.length === 0, 'the second switch makes no chat request');

  // 6. A file deleted while the picker is open: one sentence, nothing changes.
  await ui.submit('/resume');
  await waitFor(() => pickerOpen(ui.output), 5000, 'the picker for the failed load');
  const beforeTitle = headerText(lastHeader(ui.output));
  const beforeStatus = lastStatus(ui.output);
  rmSync(firstPath);
  ui.send('\r');
  await waitFor(
    () => plain(ui.output).includes('Could not load that conversation'),
    5000,
    'the load failure',
  );
  record(true, 'a failed load says so in one sentence');
  record(
    headerText(lastHeader(ui.output)) === beforeTitle &&
      lastStatus(ui.output) === beforeStatus,
    'a failed load leaves the current conversation intact',
  );
  record(provider.requests.length === 0, 'a failed load makes no chat request');
} catch (error) {
  record(false, error.message);
} finally {
  output = ui.output;
  if (!ui.exited) ui.quit().catch(() => ui.kill());
  await provider.close();
  writeFileSync(
    join(here, 'resume-capture.txt'),
    [
      'Plato CLI — /resume',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      output,
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
console.log(`capture: ${join(here, 'resume-capture.txt')}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
