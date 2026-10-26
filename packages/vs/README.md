# Plato by Applivity for Visual Studio

Plato is an AI coding agent for Visual Studio 2026. It runs in a tool window
beside your code and shows you what it is doing while it does it. You can watch
every step, change its direction mid-run, and stop it at a safe point.

Plato is pre-release.

> **Plato runs an AI agent that can edit files and run commands in the open
> solution.** It acts only under the mode you choose and the approvals you
> give. Read each card before you answer it.

## Install

1. Open **Extensions → Manage Extensions** in Visual Studio.
2. Search for **Plato by Applivity**.
3. Choose **Download**, then close Visual Studio to complete the install.

Or install a downloaded VSIX:

```powershell
VSIXInstaller.exe plato-vs-<version>.vsix
```

## Configure a model

Plato needs a model provider key that you supply. Run **Plato: Set API Key**
for an Anthropic key. To use another provider, add a connection in **Settings**
(a named Anthropic or OpenAI-compatible endpoint) and choose the model in the
chat header.

You supply the key and pay the model provider.

## The Node.js runtime is bundled

Plato runs its agent in a small local process. The extension ships the Node.js
22 runtime that the process needs, so you do not install Node.js. The runtime
is `node.exe` from the official Node.js 22.20.0 LTS Windows x64 build, and its
licence is beside it in the extension's `sidecar` folder. The extension and the
runtime use local stdio only: there is no HTTP server and no network port.

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

Prompts go to the model provider you configure. A local model is possible; it
is not the default.

## License

Plato is licensed under the Apache License 2.0. The full text is in the license
file included with the extension. Third-party notices are in
`THIRD-PARTY-NOTICES.md`.

The source repository is private. The license does not require it to be public.

## Privacy

Plato sends nothing to Applivity. Prompts and the code the agent reads go to
the model provider you configure; transcripts, settings, and keys stay on your
machine. The policy is at
[plato.applivity.com/privacy](https://plato.applivity.com/privacy).

## Support

Questions, bug reports, and feedback: **plato-feedback@applivity.com**.
