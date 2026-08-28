/**
 * Observer-AI v1 (D30): a second model that watches the coder run and
 * answers with exactly one JSON action. This module owns the prompt,
 * digest shaping, and response parsing — providers and the controller
 * are injected, so everything here is unit-testable without network.
 */
import type { ChatProvider } from '../providers/types.js';

export type ObserverAction =
  | { action: 'noop' }
  | { action: 'guidance'; message: string }
  | { action: 'pause'; message?: string }
  | { action: 'cancel'; message?: string };

export interface ObserverOptions {
  model: string;
  /** Extra role text appended to the system prompt. */
  role?: string;
  guidance: boolean;
  pause: boolean;
  cancel: boolean;
  maxInterventions: number;
}

export interface DigestEntry {
  kind: 'tool' | 'text' | 'note';
  text: string;
}

const SYSTEM =
  'You are the observer of an AI coding agent (the "coder") working ' +
  'inside a user workspace. You see a digest of the run so far. Judge ' +
  'whether the coder needs steering. Answer with EXACTLY one line of ' +
  'JSON, nothing else: ' +
  '{"action":"noop"} if all is well (use this most of the time), ' +
  '{"action":"guidance","message":"..."} to inject a short instruction ' +
  'at the next safe point, {"action":"pause"} to hold at the next safe ' +
  'point until the human resumes, {"action":"cancel"} if the run is ' +
  'wrong or dangerous and must stop after the current tool call. Be ' +
  'conservative: intervene only when clearly warranted; never try to ' +
  'approve or execute anything yourself.';

export class ObserverAgent {
  interventions = 0;
  /** How many times the observer was consulted (healthy or not). */
  checks = 0;
  /** Consecutive provider failures; reset on the next success. */
  apiErrors = 0;
  /** Last provider error message, null while healthy. */
  lastError: string | null = null;
  private lastText = '';

  constructor(
    private readonly provider: ChatProvider,
    private readonly opts: ObserverOptions,
  ) {}

  get exhausted(): boolean {
    return this.interventions >= this.opts.maxInterventions;
  }

  /** Builds the condensed run digest for the model. */
  digest(task: string, entries: DigestEntry[]): string {
    const lines = [`TASK: ${task}`];
    for (const e of entries.slice(-30)) {
      lines.push(e.kind === 'tool' ? `[tool] ${e.text}` : `[${e.kind}] ${e.text}`);
    }
    if (this.lastText.length > 0) {
      lines.push(`CODER LAST REPLY (truncated): ${this.lastText.slice(0, 600)}`);
    }
    return lines.join('\n');
  }

  noteText(text: string): void {
    if (text.trim().length > 0) {
      this.lastText += (this.lastText ? '\n' : '') + text;
    }
  }

  /** Asks the observer for one action; permission tiers are enforced. */
  async observe(task: string, entries: DigestEntry[]): Promise<ObserverAction> {
    if (this.exhausted) {
      return { action: 'noop' };
    }
    let raw: string;
    this.checks += 1;
    try {
      const res = await this.provider.completeTurn({
        model: this.opts.model,
        system: SYSTEM + (this.opts.role ? '\n' + this.opts.role : ''),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: this.digest(task, entries) },
            ],
          },
        ],
        tools: [],
        maxTokens: 300,
      });
      raw =
        res.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
      this.apiErrors = 0;
      this.lastError = null;
    } catch (e) {
      this.apiErrors += 1;
      this.lastError = e instanceof Error ? e.message : 'observer error';
      return { action: 'noop' }; // observer failure never disturbs the run
    }

    const parsed = this.parseAction(raw);
    if (parsed === null) {
      return { action: 'noop' };
    }
    // Tier enforcement (D30b): disabled verbs degrade to noop.
    if (parsed.action === 'guidance' && !this.opts.guidance) {
      return { action: 'noop' };
    }
    if (parsed.action === 'pause' && !this.opts.pause) {
      return { action: 'noop' };
    }
    if (parsed.action === 'cancel' && !this.opts.cancel) {
      return { action: 'noop' };
    }
    if (parsed.action !== 'noop') {
      this.interventions += 1;
    }
    return parsed;
  }

  /** Accepts the JSON with or without surrounding prose/fences. */
  private parseAction(raw: string): ObserverAction | null {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      const obj = JSON.parse(raw.slice(start, end + 1)) as {
        action?: unknown;
        message?: unknown;
      };
      const msg =
        typeof obj.message === 'string' ? obj.message.slice(0, 500) : undefined;
      switch (obj.action) {
        case 'noop':
          return { action: 'noop' };
        case 'guidance':
          return typeof msg === 'string' && msg.length > 0
            ? { action: 'guidance', message: msg }
            : null;
        case 'pause':
          return { action: 'pause', message: msg };
        case 'cancel':
          return { action: 'cancel', message: msg };
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}
