#!/usr/bin/env node
/**
 * ACP v1 client harness.
 *
 *   node scripts/acp/run.mjs                    self-test, then `plato --acp`
 *   node scripts/acp/run.mjs --mock-only        self-test only
 *   node scripts/acp/run.mjs --agent "<command>" test any ACP agent
 *
 * The self-test runs every case against the mock agent. The fault checks run
 * one case against a deliberately broken mock variant and require that the
 * case fails. Only then does the harness touch the target, so a broken harness
 * cannot report a false pass.
 *
 * Exit status is non-zero if any case fails, if the mock self-test fails, or if
 * a deliberately broken mock is not detected.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient, spawnAgent } from './lib/client.mjs';
import { buildCases } from './cases.mjs';
import {
  evaluateCase,
  printResult,
  summarize,
} from './lib/harness.mjs';
import {
  createLocalProviderHome,
  removeLocalProviderHome,
  startLocalProvider,
} from './lib/local-provider.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const MOCK_PATH = join(HERE, 'mock-agent.mjs');

const SELF_CASE_TIMEOUT_MS = 45_000;

const FAULT_CHECKS = [
  { name: 'the registry auth trap is detected', variant: 'trap-auth', caseId: 2, expect: 'fail' },
  { name: 'empty authMethods is detected', variant: 'no-auth', caseId: 1, expect: 'fail' },
  { name: 'a missing tool call is detected', variant: 'no-tool', caseId: 4, expect: 'fail' },
  {
    name: 'a missing plan update is detected',
    variant: 'no-plan',
    caseId: 4,
    expect: 'fail',
    expectPlan: true,
  },
  { name: 'a missing permission request is detected', variant: 'no-permission', caseId: 5, expect: 'fail' },
  { name: 'an ignored cancel is detected', variant: 'ignore-cancel', caseId: 6, expect: 'fail' },
  { name: 'stdout noise is detected', variant: 'noisy', caseId: 7, expect: 'fail' },
  { name: 'auth_required on session/new is accepted', variant: 'auth-required', caseId: 3, expect: 'skip' },
  {
    name: 'a crash on a closed pipe is detected',
    variant: 'crash-on-pipe',
    caseId: 11,
    expect: 'fail',
  },
  {
    name: 'a cut last frame is detected',
    variant: 'truncate-last',
    caseId: 12,
    expect: 'fail',
  },
];

const HELP = `ACP harness — drives an ACP v1 agent over stdio and checks the protocol

Usage
  node scripts/acp/run.mjs                      self-test, then test plato --acp
  node scripts/acp/run.mjs --agent "<command>"  test another agent command
  node scripts/acp/run.mjs --mock-only          self-test only
  node scripts/acp/run.mjs --target-only        target only
  node scripts/acp/run.mjs --list               list the case numbers

Options
  --agent <command>        the agent to launch (default: plato --acp)
  --local-provider         serve a local HTTP model, for a credential-free run
                           (writes a temporary Plato config; see the README)
  --prompt-timeout <ms>    time allowed for one prompt (default: 120000)
  --request-timeout <ms>   time allowed for one request (default: 15000)
  --verbose                print every JSON-RPC message on stderr
  -h, --help               show this help

The prompt cases need a configured model. If session/new answers
auth_required (-32000), those cases report SKIP, not FAIL. Use
--local-provider to supply a local model with no credentials.
`;

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    console.error(`plato-acp: ${flag} needs a value`);
    process.exit(2);
  }
  return value;
}

function positiveNumber(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    console.error(`plato-acp: ${flag} must be a positive number of milliseconds`);
    process.exit(2);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    agent: 'plato --acp',
    mockOnly: false,
    targetOnly: false,
    verbose: false,
    localProvider: false,
    requestTimeoutMs: 15_000,
    promptTimeoutMs: 120_000,
    help: false,
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case '--agent':
        options.agent = requireValue(argv, ++index, flag);
        break;
      case '--prompt-timeout':
        options.promptTimeoutMs = positiveNumber(requireValue(argv, ++index, flag), flag);
        break;
      case '--request-timeout':
        options.requestTimeoutMs = positiveNumber(requireValue(argv, ++index, flag), flag);
        break;
      case '--mock-only':
        options.mockOnly = true;
        break;
      case '--target-only':
        options.targetOnly = true;
        break;
      case '--local-provider':
        options.localProvider = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        console.error(`plato-acp: unknown option '${flag}'`);
        console.error("Run 'node scripts/acp/run.mjs --help' for usage.");
        process.exit(2);
    }
  }
  if (options.mockOnly && options.targetOnly) {
    console.error('plato-acp: use --mock-only or --target-only, not both');
    process.exit(2);
  }
  return options;
}

function mockFactory(variant, options) {
  const argv = [process.execPath, MOCK_PATH];
  if (variant !== 'default') argv.push('--variant', variant);
  const factory = async (open = {}) => {
    const client = new AcpClient({
      argv,
      cwd: REPO,
      env: open.env ?? process.env,
      requestTimeoutMs: options.requestTimeoutMs,
      label: `mock:${variant}`,
      verbose: options.verbose,
    });
    client.start();
    return client;
  };
  factory.raw = (open = {}) =>
    spawnAgent({ argv, cwd: REPO, env: open.env ?? process.env });
  return factory;
}

function commandFactory(command, options) {
  const envFor = (open) => open.env ?? options.localEnv ?? process.env;
  const factory = async (open = {}) => {
    const client = new AcpClient({
      command,
      cwd: REPO,
      env: envFor(open),
      requestTimeoutMs: options.requestTimeoutMs,
      label: command,
      verbose: options.verbose,
    });
    client.start();
    return client;
  };
  factory.raw = (open = {}) => spawnAgent({ command, cwd: REPO, env: envFor(open) });
  return factory;
}

async function runSuite(label, definitions, factory, options) {
  console.log(`\n${label}`);
  const results = [];
  for (const definition of definitions) {
    const result = await evaluateCase(definition, factory, options);
    results.push(result);
    printResult(definition, result);
  }
  const counts = summarize(results);
  console.log(`  ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`);
  return results;
}

async function runFaultChecks(options) {
  console.log('\nHarness self-checks — each broken mock variant must be detected');
  let failures = 0;
  for (const check of FAULT_CHECKS) {
    const definition = buildCases().find((entry) => entry.id === check.caseId);
    const result = await evaluateCase(definition, mockFactory(check.variant, options), {
      ...options,
      caseTimeoutMs: SELF_CASE_TIMEOUT_MS,
      expectPlan: check.expectPlan === true,
    });
    const detected = result.status === check.expect;
    console.log(
      `  ${detected ? 'PASS' : 'FAIL'}  ${check.name} ` +
        `(case ${check.caseId}, variant ${check.variant})`,
    );
    const observed = String(result.detail ?? '').split('\n').slice(0, 3);
    console.log(
      `        expected ${check.expect}, got ${result.status}${observed[0] ? `: ${observed[0]}` : ''}`,
    );
    for (const line of observed.slice(1)) console.log(`        ${line}`);
    if (!detected) failures += 1;
  }
  console.log(`  ${FAULT_CHECKS.length - failures} passed, ${failures} failed`);
  return failures;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const definitions = buildCases();
  if (options.list) {
    for (const definition of definitions) console.log(`${definition.id}. ${definition.title}`);
    return 0;
  }

  let failures = 0;
  let provider = null;
  let providerHome = null;
  try {
    if (!options.targetOnly) {
      const selfResults = await runSuite(
        'Self-test — mock ACP agent (every case must pass)',
        definitions,
        mockFactory('default', options),
        {
          ...options,
          promptTimeoutMs: 15_000,
          caseTimeoutMs: SELF_CASE_TIMEOUT_MS,
          expectPlan: true,
        },
      );
      failures += selfResults.filter((result) => result.status === 'fail').length;
      failures += await runFaultChecks(options);
    }

    if (!options.mockOnly) {
      if (options.localProvider) {
        provider = await startLocalProvider();
        providerHome = createLocalProviderHome(provider.baseUrl);
        options.localEnv = providerHome.env;
        console.log(`\nLocal provider — ${provider.baseUrl} (no credentials)`);
      }
      const targetResults = await runSuite(
        `Target — ${options.agent}${options.localProvider ? ' (local provider)' : ''}`,
        definitions,
        commandFactory(options.agent, options),
        {
          ...options,
          caseTimeoutMs: options.promptTimeoutMs + 30_000,
          expectPlan: options.localProvider,
        },
      );
      const failed = targetResults.filter((result) => result.status === 'fail').length;
      failures += failed;
      const neverStarted =
        failed === definitions.length &&
        targetResults.every((result) =>
          String(result.detail).includes('before answering initialize'),
        );
      if (neverStarted) {
        console.log('');
        console.log('Note: the target never answered initialize.');
        console.log('If you are testing the branch build, build it first and name the bundle:');
        console.log('  pnpm --filter @applivity/plato build');
        console.log('  node scripts/acp/run.mjs --agent "node packages/cli/dist/cli.js --acp"');
      }
    }
  } finally {
    if (provider !== null) await provider.close();
    if (providerHome !== null) removeLocalProviderHome(providerHome.home);
  }

  console.log('');
  console.log(failures === 0 ? 'ALL CHECKS PASS' : `${failures} CHECK(S) FAILED`);
  return failures === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`plato-acp: ${error?.message ?? error}`);
  process.exitCode = 1;
}
