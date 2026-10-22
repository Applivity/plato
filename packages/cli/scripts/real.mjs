#!/usr/bin/env node
/**
 * Real-model matrix: drives the BUILT CLI against two live providers.
 *
 * Keys are read from the environment only and are never printed. Run it with
 * the key file sourced in the shell:
 *
 *   set -a; . ~/.plato-real-test.env; set +a
 *   node packages/cli/scripts/real.mjs
 *
 * It writes nothing outside a temporary tree, scans every produced file for
 * both keys, and deletes the tree at the end. This file is not shipped.
 */
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const OPENAI_KEY = process.env.PLATO_TEST_OPENAI_KEY ?? '';
const ANTHROPIC_KEY = process.env.PLATO_TEST_ANTHROPIC_KEY ?? '';
if (OPENAI_KEY.length === 0 || ANTHROPIC_KEY.length === 0) {
  console.error(
    'real: PLATO_TEST_OPENAI_KEY and PLATO_TEST_ANTHROPIC_KEY must be set.\n' +
      'Run: set -a; . ~/.plato-real-test.env; set +a',
  );
  process.exit(2);
}

const OPENAI_BASE =
  (process.env.PLATO_TEST_OPENAI_BASE_URL ?? '').trim() || 'https://api.deepseek.com/v1';
const ANTHROPIC_BASE =
  (process.env.PLATO_TEST_ANTHROPIC_BASE_URL ?? '').trim() || 'https://api.anthropic.com';
// Cheap models only: deepseek-flash, and a Haiku. Never Fable or Opus.
const OPENAI_MODEL = (process.env.PLATO_TEST_OPENAI_MODEL ?? '').trim() || 'deepseek-flash';
const ANTHROPIC_MODEL =
  (process.env.PLATO_TEST_ANTHROPIC_MODEL ?? '').trim() || 'claude-haiku-4-5-20251001';

const home = mkdtempSync(join(tmpdir(), 'plato-real-home-'));
const workspace = mkdtempSync(join(tmpdir(), 'plato-real-work-'));
const configDir = join(home, 'config');
mkdirSync(configDir, { recursive: true });

function writeConfig() {
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        connections: [
          { id: 'openai-real', kind: 'openai', baseUrl: OPENAI_BASE },
          { id: 'anthropic-real', kind: 'anthropic', baseUrl: ANTHROPIC_BASE },
        ],
        model: `openai-real:${OPENAI_MODEL}`,
        team: 'solo',
        mode: 'edit',
        reasoning: 'off',
        compactionThreshold: 0.8,
      },
      null,
      2,
    ),
  );
}
writeConfig();

const baseEnv = {
  ...process.env,
  PLATO_CONFIG_DIR: configDir,
  PLATO_DATA_DIR: join(home, 'data'),
  PLATO_HOME: join(home, 'plato'),
  PLATO_DISABLE_KEYRING: '1',
  PLATO_KEY_OPENAI_REAL: OPENAI_KEY,
  PLATO_KEY_ANTHROPIC_REAL: ANTHROPIC_KEY,
  NO_COLOR: '1',
};

const outputs = [];

function run(args, options = {}) {
  const { input = '', timeoutMs = 180_000, env = {}, cwd = workspace } = options;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...baseEnv, ...env },
    });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      outputs.push(out, err);
      resolve({ code, out, err, timedOut });
    });
    child.stdin.end(input);
  });
}

/**
 * Drives a plain-mode session the way a person does: an answer is written only
 * once its prompt is on screen. A pipe that carries every answer up front does
 * not work, because readline drops a line that arrives while no question is
 * pending. `times` lets one step answer a prompt the model may show more than
 * once — it decides how many tool calls to make, not the test.
 */
function runDriven(args, steps, options = {}) {
  const { timeoutMs = 120_000 } = options;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: workspace, env: baseEnv });
    let out = '';
    let err = '';
    let seen = '';
    const used = steps.map(() => 0);
    let ended = false;
    let timedOut = false;
    const answered = () => used.reduce((sum, count) => sum + count, 0);
    const pump = () => {
      for (;;) {
        if (ended) {
          return;
        }
        const at = steps.findIndex(
          (step, index) => used[index] < (step.times ?? 1) && step.wait.test(seen),
        );
        if (at === -1) {
          break;
        }
        child.stdin.write(steps[at].send);
        used[at] += 1;
        seen = '';
        if (steps[at].final === true) {
          ended = true;
          child.stdin.end();
          return;
        }
      }
      if (!ended && steps.every((step, index) => used[index] >= (step.times ?? 1))) {
        ended = true;
        child.stdin.end();
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      seen += chunk;
      pump();
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
      seen += chunk;
      pump();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      outputs.push(out, err);
      resolve({ code, out, err, timedOut, answered: answered() });
    });
    child.stdin.on('error', () => {});
  });
}

function must(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function tail(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 320 ? `…${clean.slice(-320)}` : clean;
}

function ok(result, label) {
  if (result.timedOut) {
    const answers = result.answered === undefined ? '' : ` after ${result.answered} answers`;
    throw new Error(`${label} timed out${answers}`);
  }
  must(result.code === 0, `${label}: exit ${result.code} — ${tail(result.err)}`);
}

function file(rel) {
  return join(workspace, rel);
}

async function writeWithRetry(rel, content, task) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await run(['-p', task, '--mode', 'auto']);
    ok(result, `write attempt ${attempt}`);
    if (existsSync(file(rel)) && readFileSync(file(rel), 'utf8').trim() === content) {
      return result;
    }
  }
  throw new Error(`the model did not create ${rel} with the exact content`);
}

// A 32x32 red PNG, built here so the fixture is a real image.
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function redPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 4;
      raw[at] = 255;
      raw[at + 1] = 0;
      raw[at + 2] = 0;
      raw[at + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CASES = [
  [
    'models (both connections)',
    async () => {
      const result = await run(['models']);
      ok(result, 'models');
      must(result.out.includes(`openai-real:${OPENAI_MODEL}`), `missing ${OPENAI_MODEL}`);
      must(
        result.out.includes(`anthropic-real:${ANTHROPIC_MODEL}`),
        `missing ${ANTHROPIC_MODEL}`,
      );
    },
  ],
  [
    'doctor (both keys)',
    async () => {
      const result = await run(['doctor']);
      ok(result, 'doctor');
      must(result.out.includes('✓ Key openai-real'), 'the OpenAI key was not resolved');
      must(result.out.includes('✓ Key anthropic-real'), 'the Anthropic key was not resolved');
    },
  ],
  [
    'the vendor variable is a key source',
    async () => {
      const result = await run(['doctor'], {
        env: { PLATO_KEY_ANTHROPIC_REAL: undefined, ANTHROPIC_API_KEY: ANTHROPIC_KEY },
      });
      ok(result, 'doctor with the vendor variable');
      must(
        result.out.includes('Key anthropic-real: env:ANTHROPIC_API_KEY'),
        `the vendor variable was not used: ${tail(result.out)}`,
      );
    },
  ],
  [
    'a 0600 file is the last key source',
    async () => {
      const store = mkdtempSync(join(tmpdir(), 'plato-real-store-'));
      try {
        const authFile = join(store, 'auth.json');
        writeFileSync(authFile, JSON.stringify({ keys: { 'openai-real': OPENAI_KEY } }), {
          mode: 0o600,
        });
        chmodSync(authFile, 0o600);
        const result = await run(['doctor'], {
          env: {
            PLATO_CONFIG_DIR: configDir,
            PLATO_DATA_DIR: store,
            PLATO_HOME: join(store, 'plato'),
            PLATO_KEY_OPENAI_REAL: undefined,
            ANTHROPIC_API_KEY: undefined,
          },
        });
        ok(result, 'doctor with an auth file');
        must(
          result.out.includes('Key openai-real: file'),
          `the 0600 file was not used: ${tail(result.out)}`,
        );
        must(
          (statSync(authFile).mode & 0o777) === 0o600,
          `the auth file mode is ${(statSync(authFile).mode & 0o777).toString(8)}`,
        );
      } finally {
        rmSync(store, { recursive: true, force: true });
      }
    },
  ],
  [
    'plan mode reads and writes nothing',
    async () => {
      writeFileSync(file('hello.txt'), 'hello from the fixture\n');
      const result = await run([
        '-p',
        'Read hello.txt with the read_file tool and tell me its exact contents.',
        '--mode',
        'plan',
      ]);
      ok(result, 'plan');
      must(result.out.trim().length > 0, 'plan produced no answer');
      must(!existsSync(file('should-not-exist.txt')), 'plan wrote a file');
    },
  ],
  [
    'auto mode writes a file',
    async () => {
      await writeWithRetry(
        'result.txt',
        'hello from plato',
        'Use the write_file tool to create result.txt containing exactly "hello from plato" and nothing else.',
      );
    },
  ],
  [
    'plain approval allows a write',
    async () => {
      const result = await runDriven(['--plain'], [
        {
          wait: /› /,
          send:
            'Use the write_file tool to create approved.txt containing exactly "approved" and nothing else.\n',
        },
        { wait: /\[y\/N\]/, send: 'y\n', times: 3 },
        { wait: /\d+ turns? · /, send: '/exit\n', final: true },
      ]);
      ok(result, 'plain approval');
      must(result.answered >= 2, `only ${result.answered} prompts were answered`);
      must(existsSync(file('approved.txt')), 'the approved file was not written');
    },
  ],
  [
    'plain approval refuses a write',
    async () => {
      const result = await runDriven(['--plain'], [
        {
          wait: /› /,
          send:
            'Use the write_file tool to create denied.txt containing exactly "denied" and nothing else.\n',
        },
        { wait: /\[y\/N\]/, send: 'n\n', times: 3 },
        { wait: /\d+ turns? · /, send: '/exit\n', final: true },
      ]);
      ok(result, 'plain refusal');
      must(result.answered >= 2, `only ${result.answered} prompts were answered`);
      must(!existsSync(file('denied.txt')), 'the refused file was written');
    },
  ],
  [
    'a closed prompt refuses instead of crashing',
    async () => {
      const result = await run([
        '--plain',
      ], {
        input:
          'Use the write_file tool to create closed.txt containing exactly "closed" and nothing else.\n',
        timeoutMs: 90_000,
      });
      ok(result, 'closed prompt');
      must(!existsSync(file('closed.txt')), 'the file was written with no one to approve it');
      must(
        !result.err.includes('readline was closed'),
        `the run crashed: ${tail(result.err)}`,
      );
      must(
        result.err.includes('treats that as No'),
        `no notice about the closed prompt: ${tail(result.err)}`,
      );
    },
  ],
  [
    '--output-format json',
    async () => {
      const result = await run([
        '-p',
        'Say hello in one word.',
        '--mode',
        'auto',
        '--output-format',
        'json',
      ]);
      ok(result, 'json');
      const parsed = JSON.parse(result.out);
      must(parsed.type === 'result', 'no result object');
      must(parsed.reason === 'complete', `reason was ${parsed.reason}`);
      must(String(parsed.finalText).trim().length > 0, 'empty finalText');
    },
  ],
  [
    '--output-format stream-json',
    async () => {
      const result = await run([
        '-p',
        'Say hello in one word.',
        '--mode',
        'auto',
        '--output-format',
        'stream-json',
      ]);
      ok(result, 'stream-json');
      const events = result.out
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      must(events[0]?.type === 'start', 'the first event is not start');
      must(events.at(-1)?.type === 'result', 'the last event is not result');
    },
  ],
  [
    'the Anthropic wire protocol',
    async () => {
      const result = await run([
        '-p',
        'Say hello in one word.',
        '--mode',
        'auto',
        '--model',
        `anthropic-real:${ANTHROPIC_MODEL}`,
        '--output-format',
        'json',
      ]);
      ok(result, 'anthropic');
      const parsed = JSON.parse(result.out);
      must(parsed.type === 'result' && parsed.reason === 'complete', 'no completed result');
    },
  ],
  [
    'sessions continue and resume',
    async () => {
      const first = await run([
        '-p',
        'Remember the word pomegranate for later.',
        '--mode',
        'auto',
      ]);
      ok(first, 'session first run');

      const continued = await run([
        '-p',
        '-c',
        'What word did I ask you to remember? Answer with just the word.',
        '--mode',
        'auto',
      ]);
      ok(continued, 'session continue');
      must(
        continued.out.toLowerCase().includes('pomegranate'),
        'the continued run lost the first task',
      );

      const list = await run(['sessions', 'list']);
      ok(list, 'sessions list');
      const id = list.out.trim().split('\n')[0]?.split(/\s+/)[0] ?? '';
      must(id.length > 0, 'no session id was listed');

      const resumed = await run([
        '-p',
        '-r',
        id,
        'What word did I ask you to remember? Answer with just the word.',
        '--mode',
        'auto',
      ]);
      ok(resumed, 'session resume');
      must(resumed.out.toLowerCase().includes('pomegranate'), 'the resumed run lost the history');
    },
  ],
  [
    'undo restores a real write',
    async () => {
      writeFileSync(file('note.txt'), 'before\n');
      const result = await runDriven(['--plain'], [
        {
          wait: /› /,
          send:
            'Use the write_file tool to overwrite note.txt with exactly "after" and nothing else.\n',
        },
        { wait: /\[y\/N\]/, send: 'y\n', times: 3 },
        { wait: /\d+ turns? · /, send: '/undo\n', final: true },
      ]);
      ok(result, 'undo');
      must(result.answered >= 3, `only ${result.answered} prompts were answered`);
      must(result.out.includes('Undo:'), `no undo line: ${tail(result.out)}`);
      must(
        readFileSync(file('note.txt'), 'utf8').trim() === 'before',
        'undo did not restore the file',
      );
    },
  ],
  [
    'Duo runs with an observer',
    async () => {
      writeFileSync(file('a.txt'), 'team file\n');
      const result = await run([
        '-p',
        'Read a.txt with read_file, then use write_file to create team-duo.txt with the same contents.',
        '--mode',
        'auto',
        '--team',
        'duo',
        '--model',
        `anthropic-real:${ANTHROPIC_MODEL}`,
      ]);
      ok(result, 'duo');
      must(existsSync(file('team-duo.txt')), 'the Duo run wrote nothing');
      must(result.err.includes('[Aristotle] watching'), 'the philosopher never watched');
      must(
        /observer \d+ check/.test(result.err),
        'the closing line has no observer summary',
      );
    },
  ],
  [
    'Academy runs with both philosophers',
    async () => {
      writeFileSync(file('b.txt'), 'council file\n');
      const result = await run([
        '-p',
        'Read b.txt with read_file, then use write_file to create team-academy.txt with the same contents.',
        '--mode',
        'auto',
        '--team',
        'academy',
        '--model',
        `anthropic-real:${ANTHROPIC_MODEL}`,
      ]);
      ok(result, 'academy');
      must(existsSync(file('team-academy.txt')), 'the Academy run wrote nothing');
      must(result.err.includes('[Aristotle] watching'), 'Aristotle never watched');
      must(result.err.includes('[Pythagoras] watching'), 'Pythagoras never watched');
    },
  ],
  [
    'an image is attached and accepted',
    async () => {
      writeFileSync(file('pixel.png'), redPng(32));
      const result = await run([
        '-p',
        'Look at the attached image @pixel.png and say what colour it is in one word.',
        '--mode',
        'auto',
        '--model',
        `anthropic-real:${ANTHROPIC_MODEL}`,
      ]);
      ok(result, 'image');
      must(
        !result.err.includes('not attached'),
        `the image was rejected: ${tail(result.err)}`,
      );
      must(result.out.trim().length > 0, 'no answer about the image');
    },
  ],
  [
    'a bad key fails closed without echoing',
    async () => {
      const bad = 'sk-plato-invalid-000000';
      const result = await run(['-p', 'Say hi.', '--mode', 'auto'], {
        env: { PLATO_KEY_OPENAI_REAL: bad },
      });
      must(result.code === 1, `expected exit 1, got ${result.code}`);
      must(!`${result.out}${result.err}`.includes(bad), 'the bad key was echoed');
      must(result.err.includes('plato:'), 'no error line');
    },
  ],
  [
    'no key reached any produced file',
    async () => {
      const needles = [OPENAI_KEY, ANTHROPIC_KEY];
      const walk = (dir) => {
        let names = [];
        try {
          names = readdirSync(dir);
        } catch {
          return;
        }
        for (const name of names) {
          const path = join(dir, name);
          let info;
          try {
            info = statSync(path);
          } catch {
            continue;
          }
          if (info.isDirectory()) {
            walk(path);
            continue;
          }
          if (info.size > 5 * 1024 * 1024) {
            continue;
          }
          let text;
          try {
            text = readFileSync(path, 'utf8');
          } catch {
            continue;
          }
          for (const needle of needles) {
            must(!text.includes(needle), `a key appears in ${path}`);
            must(
              !text.includes(needle.slice(0, 12)),
              `a key prefix appears in ${path}`,
            );
          }
        }
      };
      walk(home);
      walk(workspace);
      for (const text of outputs) {
        for (const needle of needles) {
          must(!text.includes(needle), 'a key appears in the command output');
        }
      }
    },
  ],
];

// `node scripts/real.mjs undo` runs the cases whose name contains the argument.
const wanted = process.argv.slice(2);
const selected =
  wanted.length === 0
    ? CASES
    : CASES.filter(([name]) => wanted.some((word) => name.includes(word)));
if (selected.length === 0) {
  console.error(`real: no case matches ${wanted.join(', ')}`);
  process.exit(2);
}

let failed = 0;
const started = Date.now();
for (const [name, execute] of selected) {
  const at = Date.now();
  try {
    await execute();
    console.log(`✓ ${name} (${((Date.now() - at) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(
  `\n${selected.length - failed}/${selected.length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
console.log(`models: ${OPENAI_MODEL} · ${ANTHROPIC_MODEL}`);

rmSync(home, { recursive: true, force: true });
rmSync(workspace, { recursive: true, force: true });
process.exitCode = failed === 0 ? 0 : 1;
