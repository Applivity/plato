# Plato CLI

Plato is an AI coding agent for the terminal. It shows its work, lets you steer
mid-run, and stops at a safe point. The same engine powers the
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=applivity.plato).

**Plan, edit, or auto. Solo, duo, or academy. You hold the switch.**

[plato.applivity.com](https://plato.applivity.com) · [Install](#install) ·
[Authenticate](#authenticate) · [Teams](#teams) · [Commands](#commands) ·
[Source](https://github.com/Applivity/plato)

**Pre-release.** This is `0.3.0`. The core of the agent is the same code the
extension has shipped, but the terminal host is new.

**0.3.0** brings long conversations to the terminal. `/compact` folds the older
messages into a summary, and so does the history when it reaches your compaction
threshold; `plato config set compactionIdle true` also summarises after an hour
with no activity. Later runs receive the summary and the recent tail, together
with the current content of the files the conversation worked on. A path outside
the project, for a read or a write, asks first: allow once, allow for this
session, or deny. Plato now starts knowing the operating system, the shell and
the project root, and a very large folder listing says when it stopped. An `@`
mention of an absolute or UNC path attaches an image or a text file.

**0.2.4** tells Plato that a path, host or share it cannot find is not proof
that it is absent: it checks the connections, mounts, known hosts, drives and
shares the machine already has, and says what it checked.

**0.2.3** adds a `read_image` tool, so Plato can look at a screenshot or a
diagram you point it at. A search can be limited to one folder. An edit that
would change nothing says so instead of reporting success. Project instructions
are read from every `AGENTS.md` and `CLAUDE.md` in the project, each labelled
with where it came from.

**0.2.2** updates this README to the current version; no code changed.

**0.2.1** adds the author and keywords the npm page shows; no code changed.

**0.2.0** adds session messaging. A Plato session can list the other Plato
sessions on this machine and send one a message. The receiver shows who asked,
starts work if it is idle, and queues the message behind a run that is already
going. One answer comes back, and the session that answered cannot send it
onward.

**0.1.5** adds the source link above; no behaviour changed.

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

### Long conversations

The conversation is kept as a transcript, and what the model reads is derived
from it. When the history reaches the `compactionThreshold` share of the
model's context window, the older messages are folded into a summary. `/compact`
does the same when you ask, and takes an instruction about what to keep:
`/compact keep the failing test names`. The notice names the cause and says that
nothing was removed from the transcript, because nothing is: a fold changes what
is sent, not what you can scroll.

Every later run sends the summary and the recent tail. After a summary exists,
Plato also receives the current content of up to five files the conversation
read or edited, and the current git state, so it does not reason from a stale
note. Before a fold there is no summary and no such block.

To summarise while the terminal is idle, turn the setting on:

```sh
plato config set compactionIdle true
```

After an hour with no activity and at least 200,000 estimated tokens of
history, Plato folds the older messages. Your next input cancels the wait. The
setting is off by default because it summarises below your threshold.

### Files from anywhere

Type `@` before a path to attach it. A path inside the project works as before.
An absolute or UNC path also works, which is how you point at a screenshot on
the Desktop or a file on a share: an image is sent as bytes, and a text file is
sent as text. The limits are the same as the desktop chat — 3 MB for one image,
200 KB for one text file — and a protected file is refused by name.

A read that a TOOL asks for, outside the project, asks you first: allow once,
allow this folder for this session, or deny. A denial is a result the model
reads, and the run continues. The folder answer lasts until this session ends
and is never written to your settings. Writes never ask; they stay inside the
project.

A terminal shows no image thumbnails, and an image pasted into a terminal does
not arrive as bytes. Plato does not pretend otherwise. A pasted PATH is text,
and works as an `@` mention.

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

### Other Plato sessions

Sessions running on this machine can see each other and exchange one message.
Ask Plato to list them — each entry names the session, the host it runs in,
whether it is busy, and what it is working on — then ask it to send one a
message. The receiving session shows who asked and starts work if it is idle. A
session that was started by an incoming message cannot send one onward, and a
Plan-mode session asks before it sends.

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
