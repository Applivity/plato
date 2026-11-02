# Plato CLI

Plato is an AI coding agent for the terminal. It shows its work, lets you steer
mid-run, and stops at a safe point. The same engine powers the
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=applivity.plato).

**Plan, edit, or auto. Solo, duo, or academy. You hold the switch.**

[plato.applivity.com](https://plato.applivity.com) · [Install](#install) ·
[Authenticate](#authenticate) · [Teams](#teams) · [Commands](#commands) ·
[Source](https://github.com/Applivity/plato)

**Pre-release.** This is `0.1.4`. The core of the agent is the same code the
extension has shipped, but the terminal host is new.

**0.1.4** adds Windows support for commands, background shells, and MCP
servers. It also fixes four terminal defects: a reply no longer repeats down
the scrollback, Markdown renders in the terminal, Ctrl+Left/Right/Delete and
Ctrl+W work, and a Duo worker is told which watchers started.

## Install

```sh
npm install -g @applivity/plato
```

Node 22 or newer is required.

Plato runs on macOS, Linux, and Windows. On Windows, `plan` does not run shell
commands, and `edit` asks before every command; `auto` runs them.

## Authenticate

One command, one key:

```sh
plato auth login anthropic
```

The key goes to the operating system's keychain when one is available. If it is
not, Plato writes `~/.local/share/plato/auth.json` with mode 0600 and says so.
The config file never holds a key.

`plato auth login` alone asks for the provider. It offers `anthropic`, `openai`,
`openrouter` and `litellm`, and accepts any other name — for a name it does not
know it asks for the wire protocol and the base URL. The **connection** it saves
is what tells Plato where to send requests; pressing Enter at the key prompt
saves the connection and no key.

That is how an environment variable works: the connection still has to exist, so
run the login once with an empty key (or add the connection to the config), then
export the variable. The key is looked up in this order:

1. `PLATO_KEY_<CONNECTION_ID>` — the connection's id, uppercased, with anything
   that is not a letter or a digit replaced by `_`: `openai-real` becomes
   `PLATO_KEY_OPENAI_REAL`
2. the provider's own variable — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, and the rest of the built-in list
3. the OS keychain
4. the 0600 file

For a container or CI:

```sh
echo "$ANTHROPIC_API_KEY" | plato auth login anthropic
```

## Run

```sh
plato                       # interactive terminal
plato "fix the failing test"   # start there
plato -p "summarise this repo" # one task, then exit
```

In the interactive terminal:

| Key | Action |
|---|---|
| `Shift+Tab` | switch `plan`, `edit`, `auto` |
| `Enter` | send |
| `Esc` | interrupt the run |
| `Ctrl+C` twice | exit |
| `↑` / `↓` | prompt history |

Slash commands: `/mode`, `/model`, `/team`, `/gitignore`, `/compact`, `/undo`,
`/new`, `/sessions`, `/help`, `/exit`.

Type `/` to list them. Typing after the slash filters the list, `↑`/`↓` move,
`Tab` fills the command in, and `Enter` runs a command that takes no
arguments. A long list scrolls; it never covers the conversation.

### Modes

- `plan` reads and proposes; it cannot write, and it runs only commands that
  read, from a short allowlist.
- `edit` asks before a write or a shell command.
- `auto` runs without asking. Use it when nobody can answer, and know what you
  are granting.

An approval defaults to No. `Yes, allow this file for this session` is
remembered for that file or host only.

When the mode blocks the task, the model can ask to switch. The request arrives
as a card with its reason and what the other mode means. Nothing changes unless
you agree, and the same run continues.

### Teams

Plato is always the one doing the work. The team decides who is watching.

| Team | Who is watching |
|---|---|
| `solo` | Nobody. The default, and the cheapest to run. |
| `duo` | One philosopher, with its own role and permissions. |
| `academy` | Up to five, each watching for something different. |

```sh
plato --team duo                 # Plato plus one philosopher
plato --team academy             # the council in ~/.plato/ACADEMY.yaml
plato -p "fix the test" --team duo
```

A philosopher reads the run and can do one of four things: leave it alone, send
a short correction, pause the run and hand it back to you, or stop it. It never
approves a tool call. Permissions are per watcher, so you can allow a pause and
refuse a stop. A run allows five interventions in total, however many are
watching, and a watcher that errors or answers with nonsense is counted and
ignored — it cannot hang the run.

Each watcher has its own model in the file, so it need not be the model doing
the work. Duo uses `~/.plato/DUO.yaml`; Academy uses `~/.plato/ACADEMY.yaml`.
Both are shared with the extension, and a missing file runs the built-in
default: Aristotle for Duo, and Aristotle and Pythagoras for Academy, seeded
with the working model.

Change it in a session with `/team duo`, or with `plato config set team duo`.
Both are saved, so the next run uses it too.

### Search and `.gitignore`

By default Plato searches every file, including the paths your repository's
`.gitignore` excludes, and tells you when results come from one of them
(`[plato] 4 of 9 results are in paths that .gitignore excludes: dist/app.js and
1 more`). Seeing a generated file and discounting it is better than silently
missing one.

To skip them instead:

```sh
plato config set respectGitignore true   # or /gitignore on in a session
```

A file you name directly is always readable and writable, and still says it is
ignored. The setting changes what a search returns, not what you can open.

### One-shot output

```sh
plato -p "list the TODOs" --output-format text        # default
plato -p "list the TODOs" --output-format json        # one result object
plato -p "list the TODOs" --output-format stream-json # NDJSON events
```

The answer goes to standard output. Tool activity, approvals, and the closing
summary go to standard error. Exit codes are `0` for a completed run, `1` for a
failure, refusal, or cancel, and `2` for a usage error.

Without a terminal, an approval is refused and the model is told why. The run
does not hang. `--mode auto` is the unattended mode.

## Commands

| Command | Purpose |
|---|---|
| `plato auth login\|status\|list\|logout` | Manage connections and keys |
| `plato models [connection] [--refresh]` | List the models a connection offers |
| `plato sessions list\|export\|delete` | Manage saved conversations |
| `plato config [get\|set] [key] [value]` | Show or change a setting |
| `plato doctor` | Check the config, keys, keychain, model limits, writes, and the last run |
| `plato -p "task"` | Run one task |
| `plato -c` / `plato -r <id>` | Continue or resume a conversation |

## Files

| Path | Contents |
|---|---|
| `~/.config/plato/config.json` | Connections, model, mode, team, compaction |
| `~/.local/share/plato/auth.json` | Keys, only when the keychain is unavailable |
| `~/.local/share/plato/models.json` | Discovered model lists (24-hour cache) |
| `~/.plato/runs/` | Run transcripts |
| `~/.plato/undo/` | Undo copies |
| `~/.plato/sessions/` | Saved conversations |
| `~/.plato/mcp.json` | MCP servers |
| `~/.plato/DUO.yaml`, `ACADEMY.yaml` | Teams |

`PLATO_CONFIG_DIR`, `PLATO_DATA_DIR`, and `PLATO_HOME` override the first three
roots.

## Privacy and safety

Plato sends your prompts, the conversation, and the results of the tools it
runs to the model provider you configure. It does not send them anywhere else.

Protected files (`keystore.properties`, `local.properties`, `.env*`,
`*.keystore`, and the rest of the built-in list) are never sent in full. Their
values are replaced by placeholders. A shell command that reads one indirectly
is covered by the same scrubbing wherever the value goes.

A 0600 file is plaintext. The keychain raises the effort; it does not protect a
compromised account. `plato auth status` names the source in use.

## Support

Questions, bug reports, and feature requests:
[plato-feedback@applivity.com](mailto:plato-feedback@applivity.com).

Plato is made by [Applivity](https://applivity.com).

## Licence

Apache License 2.0. See `LICENSE`, `NOTICE`, and `THIRD-PARTY-NOTICES.md` in this
package.
