/**
 * Drives the built CLI in a real terminal and proves how pause behaves.
 *
 *   node scripts/cli-tui/pause-drive.mjs [--cli path/to/cli.js]
 *
 * A local fake provider records what Plato actually sent. The checks:
 *   A. Esc during a streaming answer holds the screen, the hint changes, and
 *      Enter lets the same answer finish.
 *   B. A second Esc stops the run, and the conversation survives the stop.
 *   C. A pause asked for while a tool runs lands after it: the file is whole,
 *      and text typed at the park becomes direction the model actually reads.
 *   D. A pause asked for while the model call is out does not swallow the
 *      approval card; the pause lands after the card is answered.
 *   E. Ctrl+C while parked stops the run.
 *   F. The parked hint is one line at 80 and 120 columns.
 *   G. /help says what the keys do and that a paused run does not survive exit.
 *
 * C's guidance assertions are the one behaviour the founder has not settled.
 * They are labelled PROVISIONAL so no one reads them as decided.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProvider } from './fake-provider.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const cliIndex = args.indexOf('--cli');
const cli = resolve(cliIndex >= 0 ? args[cliIndex + 1] : join(here, '../../packages/cli/dist/cli.js'));
const capturePath = join(here, 'pause-capture.txt');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** The last frame Ink drew, which is the screen the user is looking at. */
const lastFrame = (text) => {
  const start = text.lastIndexOf('\x1b[?2026h');
  if (start < 0) return plain(text);
  const end = text.lastIndexOf('\x1b[?2026l');
  return plain(text.slice(start, end > start ? end : undefined));
};

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

const provider = await startProvider();
const roots = [];
function newRoot() {
  const root = mkdtempSync(join(tmpdir(), 'plato-cli-pause-'));
  roots.push(root);
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
        model: 'fake:pause-model',
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
  return { root, config, data, home, project };
}

/**
 * A real terminal. `cat | script` gives the CLI a pty; the fixed width keeps
 * the hint and card wording on one line where it can be compared exactly.
 */
function launch({ cols = 100 } = {}) {
  const dirs = newRoot();
  const inner = `stty cols ${cols}; exec node ${JSON.stringify(cli)}`;
  const child = spawn(
    'sh',
    ['-c', `cat | script -q /dev/null sh -c ${JSON.stringify(inner)}`],
    {
      cwd: dirs.project,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PLATO_CONFIG_DIR: dirs.config,
        PLATO_DATA_DIR: dirs.data,
        PLATO_HOME: dirs.home,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    },
  );
  const proc = {
    child,
    dirs,
    cols,
    output: '',
    send: (text) => child.stdin.write(text),
    submit: async (text) => {
      child.stdin.write(text);
      await sleep(150);
      child.stdin.write('\r');
    },
    wait: (test, ms, what) => waitFor(() => test(proc.output), ms, what),
    frame: () => lastFrame(proc.output),
    page: () => plain(proc.output),
    kill: () => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    },
  };
  child.stdout.on('data', (chunk) => {
    proc.output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    proc.output += chunk.toString();
  });
  return proc;
}

const results = [];
const record = (ok, what) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
const notes = [];
const provisional = [];
const recordProvisional = (ok, what) => {
  provisional.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  record(ok, `PROVISIONAL  ${what}`);
};

const main = launch();
const PAUSING = 'pausing — esc stops';
const PAUSED = 'paused — enter continues · esc stops';
const RUNNING = 'enter queues · esc pauses · ctrl+c stops';

try {
  await main.wait((out) => out.includes('Type / for commands'), 20000, 'the start screen');
  {
    // Before any run: Esc has nothing to stop, so the hint must not say it does.
    const idleLine =
      main.frame()
        .split('\n')
        .find((line) => line.startsWith('Shift+Tab mode')) ?? '';
    record(!/esc stops/i.test(idleLine), 'the idle hint does not advertise a stop');
    record(
      idleLine.includes('@ files') && idleLine.includes('/help'),
      'the idle hint names the keys that work when idle',
    );
  }

  // A. A long answer pauses where it is; Enter lets it finish.
  {
    const long = Array.from({ length: 40 }, (_, i) => `A${String(i).padStart(2, '0')}`).join(' ');
    provider.setScript([{ text: long, chunks: 40, chunkMs: 80 }]);
    const before = provider.requests.length;
    await main.submit('stream the long answer');
    await main.wait((out) => out.includes('A05'), 20000, 'the answer to start streaming');
    main.send('\x1b');
    record(
      await attempt(() => main.wait((out) => lastFrame(out).includes(PAUSING), 5000, 'the pausing hint')),
      'Esc during a stream says "pausing — esc stops"',
    );
    const pendingFrame = main.frame();
    record(!pendingFrame.includes(PAUSED), 'the parked hint is not claimed before the run really parks');
    await sleep(700);
    record(!main.frame().includes('A20'), 'the stream stops advancing while the pause is pending');
    record(
      await attempt(() => main.wait((out) => lastFrame(out).includes(PAUSED), 15000, 'the paused hint')),
      'the hint says "paused — enter continues · esc stops" once the run parks',
    );
    main.send('\r');
    record(
      await attempt(() =>
        main.wait(
          (out) => out.includes('A39') && /\b1 turn\b/.test(plain(out)),
          20000,
          'the answer to finish',
        ),
      ),
      'Enter continues the same run and the answer completes',
    );
    record(provider.requests.length === before + 1, 'resuming asked the model nothing new');
  }

  // B. A second Esc stops; the conversation survives.
  {
    const long = Array.from({ length: 60 }, (_, i) => `B${String(i).padStart(2, '0')}`).join(' ');
    provider.setScript([{ text: long, chunks: 60, chunkMs: 100 }]);
    await main.submit('stream the second answer');
    await main.wait((out) => out.includes('B05'), 20000, 'the second stream to start');
    main.send('\x1b');
    await sleep(120);
    main.send('\x1b');
    record(
      await attempt(() => main.wait((out) => out.includes('Run ended: cancelled.'), 15000, 'the stopped run')),
      'a second Esc stops the run',
    );
    main.wait((out) => /\b\d+ turns?\b/.test(plain(out)), 15000, 'the run summary').catch(() => {});
    const before = provider.requests.length;
    provider.setScript([{ text: 'still here' }]);
    await main.submit('is the conversation still here');
    await main.wait(() => provider.requests.length >= before + 1, 20000, 'the next request');
    const body = JSON.stringify(provider.requests[before].messages);
    record(
      body.includes('stream the second answer') && body.includes('is the conversation still here'),
      'the conversation survives the stop and the next run carries it',
    );
    await main.wait((out) => out.includes('still here'), 15000, 'the next answer');
  }

  // C. Pause during a slow tool: it finishes whole; guidance at the park lands.
  {
    provider.setScript([
      { tool: 'shell', args: { command: "sleep 2; printf 'whole-file' > slow.txt" } },
      { text: 'after guidance' },
    ]);
    const before = provider.requests.length;
    await main.submit('run the slow command');
    await main.wait((out) => out.includes('Allow shell?'), 20000, 'the shell card');
    main.send('2');
    await sleep(150);
    main.send('\r');
    await main.wait((out) => out.includes('Approved — running a command.'), 10000, 'the approval row');
    main.send('\x1b');
    record(
      await attempt(() => main.wait((out) => lastFrame(out).includes(PAUSING), 5000, 'the pausing hint during the tool')),
      'a pause asked for while a tool runs says pausing',
    );
    const slow = join(main.dirs.project, 'slow.txt');
    await main.wait(() => existsSync(slow), 15000, 'the tool to finish');
    record(readFileSync(slow, 'utf8') === 'whole-file', 'the tool finished whole — no partial file');
    record(
      await attempt(() => main.wait((out) => lastFrame(out).includes(PAUSED), 15000, 'the pause after the tool')),
      'the pause lands after the tool, not inside it',
    );
    main.send('use the green one');
    await sleep(250);
    main.send('\r');
    // `before` is the slow command's request; the guided answer is the next.
    await main.wait(() => provider.requests.length >= before + 2, 20000, 'the guided request');
    const body = JSON.stringify(provider.requests[before + 1].messages);
    recordProvisional(
      body.includes('[observer guidance] use the green one'),
      'text typed while paused reaches the model as guidance',
    );
    recordProvisional(
      plain(main.output).includes('› use the green one'),
      'the guidance typed while paused is visible in the run',
    );
    record(
      await attempt(() => main.wait((out) => out.includes('after guidance'), 20000, 'the run to continue')),
      'the run continues in the same process after the guidance',
    );
  }

  // D. A pause asked for while the model call is out waits for the card.
  // The gate that decides this sits in core, so the check states what it sees
  // rather than crashing on through a card that was held back.
  {
    provider.setScript([
      { tool: 'write_file', args: { path: 'card.txt', content: 'card' }, delayMs: 1500 },
      { text: 'after the card' },
    ]);
    const before = provider.requests.length;
    await main.submit('write card.txt');
    await main.wait(() => provider.requests.length >= before + 1, 20000, 'the delayed model call');
    main.send('\x1b');
    record(
      await attempt(() => main.wait((out) => lastFrame(out).includes(PAUSING), 5000, 'the pending pause')),
      'a pause can be pending while the model call is out',
    );
    await sleep(2500);
    const cardUp = main.frame().includes('Allow write_file?');
    record(cardUp, 'the approval card still appears while a pause is pending');
    if (cardUp) {
      record(!main.frame().includes(PAUSED), 'the card is not turned into a paused run');
      main.send('2');
      await sleep(150);
      main.send('\r');
      record(
        await attempt(() => main.wait((out) => out.includes('Approved — writing a file.'), 10000, 'the approval row')),
        'the card is answered normally while the pause waits',
      );
      record(
        await attempt(() => main.wait((out) => lastFrame(out).includes(PAUSED), 15000, 'the pause after the card')),
        'the pause lands after the card is answered',
      );
    } else {
      record(
        main.frame().includes(PAUSED),
        'OBSERVED: the pause parks at the tool gate before the card and holds it back',
      );
      main.send('\r'); // resume so the card can appear at all
      record(
        await attempt(() => main.wait((out) => out.includes('Allow write_file?'), 10000, 'the card after resume')),
        'OBSERVED: the card appears only after the resume, not while the pause waits',
      );
      main.send('2');
      await sleep(150);
      main.send('\r');
      await attempt(() =>
        main.wait((out) => out.includes('Approved — writing a file.'), 10000, 'the approval row'),
      );
      await attempt(() =>
        main.wait((out) => out.includes('after the card'), 15000, 'the card run to finish'),
      );
    }
  }

  // E. Ctrl+C while parked stops.
  {
    const long = Array.from({ length: 30 }, (_, i) => `C${String(i).padStart(2, '0')}`).join(' ');
    provider.setScript([{ text: long, chunks: 30, chunkMs: 90 }]);
    await main.submit('stream for the stop key');
    await main.wait((out) => out.includes('C03'), 20000, 'the stream before the stop key');
    main.send('\x1b');
    await main.wait((out) => lastFrame(out).includes(PAUSED), 15000, 'the parked run');
    const mark = main.output.length;
    main.send('\x03');
    record(
      await attempt(() =>
        main.wait(
          (out) => plain(out.slice(mark)).includes('Run ended: cancelled.'),
          15000,
          'the stopped parked run',
        ),
      ),
      'Ctrl+C while parked stops the run',
    );
  }

  // G. /help names the keys and the one limit.
  {
    await sleep(500);
    const mark = main.output.length;
    await main.submit('/help');
    await main.wait((out) => out.slice(mark).includes('Keys'), 10000, '/help');
    const help = plain(main.output.slice(mark));
    record(
      help.includes('pause the run; press Esc again to stop it') &&
        help.includes('while paused, continue; with text, send it and continue') &&
        help.includes('stop the run'),
      '/help says what Esc, Enter and Ctrl+C do',
    );
    record(
      help.includes('A paused run does not survive Plato exiting.'),
      '/help says a paused run does not survive the process exiting',
    );
    record(help.includes('esc pauses') === false, '/help does not repeat a stale "esc stops" line for a running run');
  }

  main.kill();
  await sleep(300);

  // F. The parked hint is one line at both widths.
  async function widthCheck(cols) {
    const proc = launch({ cols });
    try {
      await proc.wait((out) => out.includes('Type / for commands'), 20000, 'the start screen');
      const text = Array.from({ length: 30 }, (_, i) => `W${String(i).padStart(2, '0')}`).join(' ');
      provider.setScript([{ text, chunks: 30, chunkMs: 60 }]);
      await proc.submit('stream for the width check');
      await proc.wait((out) => out.includes('W03'), 20000, 'the stream');
      proc.send('\x1b');
      await proc.wait((out) => lastFrame(out).includes(PAUSED), 15000, 'the parked hint');
      const frame = proc.frame();
      const line = frame.split('\n').find((entry) => entry.includes('paused — enter continues'));
      record(line !== undefined && line.includes(PAUSED), `the parked hint is whole at ${cols} columns`);
      record(!/…\s*$/.test(line ?? '…'), `the parked hint is not truncated at ${cols} columns`);
    } finally {
      proc.kill();
      await sleep(200);
    }
  }
  await widthCheck(80);
  await widthCheck(120);
} catch (error) {
  record(false, error.message);
} finally {
  try {
    main.kill();
  } catch {
    // Already gone.
  }
  await provider.close();
  writeFileSync(
    capturePath,
    [
      'Plato CLI — pause proof',
      `cli: ${cli}`,
      '',
      ...results,
      '',
      ...notes,
      '',
      'PROVISIONAL checks are the typed-while-paused behaviour the founder has not settled.',
      '',
      '--- terminal capture ---',
      main.output,
      '',
    ].join('\n'),
  );
}

for (const line of results) console.log(line);
for (const line of notes) console.log(line);
console.log(`capture: ${capturePath}`);
if (results.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;
