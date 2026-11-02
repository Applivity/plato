# Plato

Plato is an AI coding agent for VS Code. It works inside your project and shows
you what it is doing while it does it. You can watch every step, change its
direction mid-run, and stop it at a safe point.

Plato is pre-release.

## Install

Install from the Visual Studio Marketplace:

1. Open the Extensions view in VS Code.
2. Search for **Plato by Applivity**.
3. Choose **Install**.

Or run:

```sh
code --install-extension applivity.plato
```

The listing is at
[Plato by Applivity](https://marketplace.visualstudio.com/items?itemName=applivity.plato).

For a local build, install the VSIX:

```sh
code --install-extension plato-<version>.vsix
```

## Configure a model

Run **Plato: Set API Key** for an Anthropic key. To use another provider, add a
connection in **Settings** (a named Anthropic or OpenAI-compatible endpoint) and
choose the model in the chat header.

You supply the key and pay the model provider.

## What it does

- Shows the agent's work as it runs, and lets you change direction mid-run.
- Pauses at the next safe point. It cannot stop a model call already in flight.
- `plan` is read-only. `edit` asks before writes and shell commands. `auto` runs
  them.
- If a mode blocks the work, Plato can ask to switch. You decide on a card; it
  cannot switch by itself.
- Keeps undo copies of files Plato wrote. A terminal command, or a change you
  made yourself, cannot be undone.
- Reads protected files with their values masked. A value reaches a model only
  through a card you answered.
- Supports Anthropic and any OpenAI-compatible endpoint.
- Runs MCP servers during a run, after a 20-second handshake.
- Saves one transcript per task in `~/.plato/runs/`. Old transcripts are
  compressed after 15 days and can be deleted from History.
- Attaches images to a message.

Prompts go to the model provider you configure. A local model is possible; it is
not the default.

## License

Plato is licensed under the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0). The
full text is in the license file included with the extension. Third-party
notices are in `THIRD-PARTY-NOTICES.md`.

The source is public at
[github.com/Applivity/plato](https://github.com/Applivity/plato) and is licensed
under the Apache License, Version 2.0.
