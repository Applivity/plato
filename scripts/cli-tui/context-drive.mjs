/**
 * Drives the built CLI in a real terminal and proves the status line says how
 * full the conversation is.
 *
 *   node scripts/cli-tui/context-drive.mjs [--cols 80] [--context 1000|none]
 *
 * With a small advertised window: the share appears, grows after a longer run,
 * says "summary due next run" while the history is at the threshold, and drops
 * after the fold that follows. With no advertised window the share reads the
 * same default the fold uses. The status line never wraps at the given width.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const cols = Number(arg('cols', '80'));
const rawContext = arg('context', '8000');
const context = rawContext === 'none' ? undefined : Number(rawContext);
const cli = resolve(arg('cli', join(here, '../../packages/cli/dist/cli.js')));
const capturePath = join(here, `context-capture-${cols}${context === undefined ? '-default' : ''}.txt`);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const display = (text) => text.length;

async function waitFor(test, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function attempt(run) {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}

const tokens = (text) => (text.endsWith('k') ? Math.round(Number.parseFloat(text) * 1000) : Number(text));
const SHARE = /(\d+(?:\.\d+)?k?) of (\d+(?:\.\d+)?k?)/;
function statusLines() {
  return plain(output)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => /^(plan|edit|auto) · /.test(line));
}
function lastShare() {
  for (const line of statusLines().reverse()) {
    const match = line.match(SHARE);
    if (match !== null) {
      return { line, used: tokens(match[1] ?? '0'), window: match[2] ?? '' };
    }
  }
  return null;
}

const provider = await startProvider(context === undefined ? {} : { context });
const root = mkdtempSync(join(tmpdir(), 'plato-cli-context-'));
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
      model: 'fake:paste-model',
      team: 'solo',
      mode: 'auto',
      reasoning: 'off',
      compactionThreshold: 0.8,
      respectGitignore: false,
    },
    null,
    2,
  )}\n`,
);

let output = '';
const inner = `stty cols ${cols}; exec node ${JSON.stringify(cli)}`;
const child = spawn('sh', ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`], {
  cwd: project,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    PLATO_CONFIG_DIR: config,
    PLATO_DATA_DIR: data,
    PLATO_HOME: home,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
});
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const results = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
const notes = [];
const send = (text) => child.stdin.write(text);
const submit = async (text) => {
  send(text);
  await sleep(150);
  send('\r');
};
async function waitRunEnd(mark) {
  await waitFor(() => /\b\d+ turns?\b/.test(plain(output.slice(mark))), 20000, 'the run summary');
  await sleep(300);
}

try {
  await waitFor(() => output.includes('Type / for commands'), 8000, 'the start screen');
  const windowKnown = await attempt(() =>
    waitFor(() => lastShare() !== null, 8000, 'the conversation share'),
  );
  record(windowKnown, 'the status line shows used against the window');
  const expectedWindow = context === undefined ? '131k' : '8k';
  record(lastShare()?.window === expectedWindow, `the window is the one the fold uses (${expectedWindow})`);

  const steps = [
    { text: 'a'.repeat(4000), chunks: 4, chunkMs: 40 },
    { text: 'b'.repeat(12000), chunks: 6, chunkMs: 40 },
    { text: 'c'.repeat(24000), chunks: 12, chunkMs: 150 },
  ];
  provider.setScript(steps);

  // A. After a run the share is a real number.
  let mark = output.length;
  await submit('first task');
  await waitRunEnd(mark);
  const afterFirst = lastShare();
  record(afterFirst !== null && afterFirst.used > 0, 'the share has a used number after a run');

  // B. A longer run moves it up.
  mark = output.length;
  await submit('second task');
  await waitRunEnd(mark);
  const afterSecond = lastShare();
  notes.push(`share: ${afterFirst?.used} then ${afterSecond?.used}`);
  record(
    afterFirst !== null && afterSecond !== null && afterSecond.used > afterFirst.used,
    'a longer run makes the share larger',
  );

  if (context !== undefined) {
    // C. While a long answer streams the line says the summary is due; after
    // the fold that follows, the number drops.
    mark = output.length;
    await submit('third task');
    const due = await attempt(() =>
      waitFor(
        () => statusLines().some((line) => line.includes('summary due next run')),
        15000,
        'the summary-due line',
      ),
    );
    const dueUsed = lastShare()?.used ?? 0;
    record(due, 'the line says a summary is due at the threshold');
    await waitRunEnd(mark);
    const afterFold = lastShare();
    notes.push(`due at ${dueUsed}, after the fold ${afterFold?.used}`);
    record(
      afterFold !== null && dueUsed > 0 && afterFold.used < dueUsed,
      'the share drops after the summary',
    );
  }

  // Fit: no status line may be wider than the terminal, whatever it carries.
  const widest = Math.max(0, ...statusLines().map((line) => display(line)));
  notes.push(`widest status line at ${cols} columns: ${widest}`);
  record(
    statusLines().some((line) => SHARE.test(line)) && widest <= cols,
    `no status line wraps at ${cols} columns`,
  );
} catch (error) {
  record(false, error.message);
} finally {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await provider.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — conversation share proof',
      `cli: ${cli}`,
      `cols: ${cols}, advertised window: ${context === undefined ? 'none' : context}`,
      '',
      ...results,
      '',
      ...notes,
      '',
      '--- terminal capture ---',
      output,
      '',
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
for (const line of notes) console.log(line);
console.log(`capture: ${capturePath}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
