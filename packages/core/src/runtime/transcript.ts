/**
 * M2 transcript writer (D24c): one JSONL file per run, appended into the
 * runs directory the CALLER supplies — the VS Code host passes
 * `~/.plato/runs/<project-key>/` (D46: personal state, never the repo).
 * Header line first (schemaVersion 1), then one line per bus event.
 * Secret-safety by construction: fields are whitelisted — tool args,
 * approval previews and raw outputs are never written (file content can
 * carry secrets).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentBus, AgentEvent } from './bus.js';

const SCHEMA_VERSION = 1;

export interface TranscriptMeta {
  task: string;
  root: string;
}

export class TranscriptWriter {
  private file: string | null = null;
  private off: (() => void) | null = null;

  constructor(
    private readonly runsDir: string,
    private readonly meta: TranscriptMeta,
  ) {}

  /** Subscribes; opens the file lazily on the first run-started event. */
  attach(bus: AgentBus): void {
    this.off = bus.on((event) => this.append(event));
  }

  /** Detaches. Safe to call more than once. */
  close(): void {
    this.off?.();
    this.off = null;
  }

  append(event: AgentEvent): void {
    if (this.file === null) {
      if (event.type !== 'run-started') {
        return; // No header yet; nothing to anchor a file to.
      }
      mkdirSync(this.runsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.file = join(this.runsDir, `${ts}-${event.runId}.jsonl`);
      const header = {
        kind: 'header',
        // D49bj: still 1. `mode` is ADDED, not redefined — a reader of an older
        // file finds the same keys it always did, and nothing branches on this
        // number. A bump would claim the older shape needs different handling,
        // and it does not.
        schemaVersion: SCHEMA_VERSION,
        runId: event.runId,
        startedAt: new Date().toISOString(),
        task: this.meta.task,
        root: this.meta.root,
        // D49bj: the mode the run began in, from the event rather than the meta
        // — the meta is built before the loop exists and cannot know it.
        mode: event.mode,
      };
      appendFileSync(this.file, `${JSON.stringify(header)}\n`);
    }
    appendFileSync(this.file, `${JSON.stringify(redact(event))}\n`);
  }
}

/** Whitelist per event type (D24c): drop args and previews. */
function redact(event: AgentEvent): Record<string, unknown> {
  const e = event as unknown as Record<string, unknown>;
  switch (event.type) {
    case 'tool-event': {
      const { args: _args, ...rest } = e;
      return rest;
    }
    case 'approval-requested': {
      const { preview: _preview, ...rest } = e;
      return rest;
    }
    default:
      return e;
  }
}
