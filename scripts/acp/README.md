# ACP client harness

A client that launches an ACP v1 agent over stdio, drives it, and checks the
protocol. It does not import from `packages/`. It talks to a command, the way a
real client does. The default target is `plato --acp`.

The directory also contains a small mock agent. The harness tests itself
against the mock before it tests the target.

## Run it

```sh
node scripts/acp/run.mjs
```

This command does three things in order:

1. Runs all cases against the mock agent. Every case must pass.
2. Runs the fault checks. Each one uses a deliberately broken mock and requires
   the harness to detect the fault.
3. Runs all cases against the target.

The command exits non-zero if a case fails, if the self-test fails, or if a
broken mock is not detected. A SKIP does not fail the run.

To test the branch build instead of the `plato` on `PATH`:

```sh
pnpm --filter @applivity/plato build
node scripts/acp/run.mjs --agent "node packages/cli/dist/cli.js --acp"
```

For a prompt run with no credentials, add `--local-provider`:

```sh
node scripts/acp/run.mjs --agent "node packages/cli/dist/cli.js --acp" --local-provider
```

This is the command for the phase-1 definition of done. It runs the self-test,
the fault checks, and all twelve cases against the branch build.

Other options:

```sh
node scripts/acp/run.mjs --mock-only      # harness self-test only
node scripts/acp/run.mjs --target-only    # skip the self-test
node scripts/acp/run.mjs --list           # list the cases
node scripts/acp/run.mjs --help
```

Use `--agent "<command>"` to test any ACP agent. Use `--prompt-timeout <ms>`
when a real model needs more time. Use `--verbose` to print each JSON-RPC
message on stderr.

The prompt cases need a configured model. If `session/new` answers
`auth_required` (-32000), cases 3 to 6 and 10 report SKIP. That is expected
with an empty home or no provider. Configure a provider, or use
`--local-provider`, to make those cases run.

## The cases

| # | Case | What must happen |
|---|---|---|
| 1 | initialize handshake | The result has `protocolVersion` 1, `agentInfo` with a name and version, a non-empty `authMethods`, and an `agentCapabilities` object. |
| 2 | registry auth rule | The client sends only the validator's legacy hints: `clientCapabilities.terminal: true` and `_meta["terminal-auth"]`. The result must still contain a method of type `agent` or `terminal`. A missing type counts as `agent`. |
| 3 | session/new | The result has a `sessionId`. An `auth_required` (-32000) error is accepted as SKIP. |
| 4 | prompt streams | `session/prompt` emits at least one text `agent_message_chunk` and one `tool_call` or `tool_call_update`. The result has a valid stop reason. When a plan is expected (`--local-provider` or the mock self-test), it must also emit a `plan` update with entries. |
| 5 | permission | `session/request_permission` arrives. The harness answers once with an allow option and once with a reject option. Each request has a `sessionId`, a `toolCallId`, and valid options. |
| 6 | cancel | The harness sends `session/cancel` after the first `session/update`. The prompt returns `cancelled`. |
| 7 | stdout purity | Every stdout line is a JSON-RPC 2.0 message. A bad line fails the case and is printed. |
| 8 | empty HOME | The agent answers `initialize` with a fresh home directory and no provider credentials. |
| 9 | framing | A string request id and a numeric request id are echoed exactly. A notification is not answered. A malformed line does not kill the agent. |
| 10 | concurrent prompt | A second `session/prompt` while one is running is refused with -32600, not queued. The first prompt is then cancelled. |
| 11 | closed stdout pipe | The client closes its read end. The agent exits promptly with code 0 or 1, writes at most one stderr line, and prints no stack trace. |
| 12 | last frame | A request is sent and stdin closes in the same tick. The response arrives whole, ends with a newline, and the agent exits 0. |

Case 9 exists because the CLI hand-writes its framing. The checks are: send a
request with a string id, send one with a number id, send a notification, and
send one line of garbage. The agent must answer the two requests with the same
ids, must not answer the notification, and must survive the garbage.

Purity is a global rule. A non-JSON-RPC line on stdout fails whichever case is
running, not only case 7. The offending line is printed.

## The mock agent

`mock-agent.mjs` implements `initialize`, `session/new`, `session/prompt`,
`session/cancel`, `session/update`, and `session/request_permission`. It needs
no model, key, or configuration.

`--variant <name>` makes it deliberately wrong:

| Variant | Fault |
|---|---|
| `default` | None. A conforming agent. |
| `trap-auth` | Advertises terminal auth only for `clientCapabilities.auth.terminal`. The legacy hints get an empty `authMethods`. |
| `no-auth` | Always returns an empty `authMethods`. |
| `auth-required` | `session/new` returns -32000. |
| `no-tool` | Never emits a tool call. |
| `no-plan` | Never emits a plan update. |
| `no-permission` | Never asks for permission. |
| `ignore-cancel` | Ignores `session/cancel` and finishes with `end_turn`. |
| `noisy` | Writes one non-JSON line to stdout on each prompt. |
| `crash-on-pipe` | Throws on a closed stdout pipe, with a stack trace. |
| `truncate-last` | Cuts the last frame when stdin closes. |

The fault checks run one case against each broken variant and require the
expected result. If the harness passes a case that should fail, the self-test
fails. This shows that the harness detects faults; it is not a rubber stamp.

## The local provider

`--local-provider` starts an OpenAI-compatible server on `127.0.0.1` and writes
a temporary Plato config into a new home directory. The connection uses an
`http://` base URL, so it needs no key. The harness starts the target with that
home.

The server answers `GET /v1/models` and streams `POST /v1/chat/completions`.
The first turn asks for `todo_write` and `write_file`. The follow-up turn, which
carries the tool result, gives the final text. This drives the real provider
path with no credentials. It also makes case 4's plan assertion run, because
`todo_write` produces a plan.

This profile is Plato-specific. It is off by default, and it is the only part
of the harness that writes a configuration file. The protocol cases do not
depend on it. Without it, those cases skip when `session/new` answers
`auth_required`.

## Isolation

Case 8 uses an isolated environment:

- `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, and
  `XDG_DATA_HOME` point into a new temporary directory.
- All `PLATO_*` variables and a known list of provider credential variables are
  removed.
- `PLATO_DISABLE_KEYRING=1` prevents a read of the machine's real keychain.

Without `--local-provider`, the other cases use the real environment, so the
prompt cases use the configured model. With `--local-provider`, they use the
temporary home and the local server. Each case uses a new temporary directory
as the session `cwd`. The harness removes the directory after the case.

The harness sends only `clientCapabilities.auth.terminal`. It does not
implement `fs/*` or `terminal/*`. An agent that calls those methods gets
-32601.

## Limits

- Protocol v1 only. Phase 1 does not cover `session/load`, `session/list`,
  `session/resume`, `session/delete`, modes, config options, or elicitation.
- A real model can choose not to call a tool. Cases 4 and 5 then fail for model
  behaviour, not for protocol behaviour. The prompts ask for a file read and a
  file write to make a tool call likely. `--local-provider` removes this
  uncertainty because its fixture always calls the tools.
- Case 11 accepts exit code 0 or 1. The branch build exits 1 on purpose and
  writes one line to stderr. A stack trace or a signal fails the case.
- The registry validator's `_meta` placement is not fully specified in the
  pages this harness was built from. The harness puts `_meta["terminal-auth"]`
  at the params root. If the validator nests it, change `legacyInit()` in
  `cases.mjs`. The current agent advertises its terminal method
  unconditionally, so the case passes either way.
- The mock is not a full agent. It has no model, no MCP, and one turn at a time.
- This harness installs and runs no third-party ACP agent. The target is our
  own CLI, and the mock is part of this directory.

## Files

| File | Job |
|---|---|
| `run.mjs` | The command line, the self-test, the fault checks, and the target run. |
| `cases.mjs` | The twelve cases and their prompts. |
| `mock-agent.mjs` | The mock ACP agent and its broken variants. |
| `lib/client.mjs` | JSON-RPC 2.0 over a child process, stdout purity, timeouts, process cleanup. |
| `lib/harness.mjs` | Assertions, the case runner, and the report. |
| `lib/env.mjs` | The empty-home environment profile. |
| `lib/local-provider.mjs` | The local OpenAI-compatible server and the temporary Plato config for `--local-provider`. |
