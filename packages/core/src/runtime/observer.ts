/**
 * Observer-AI v1 (D30): a second model that watches the coder run and
 * answers with exactly one JSON action. This module owns the prompt,
 * digest shaping, and response parsing — providers and the controller
 * are injected, so everything here is unit-testable without network.
 */
import type { ChatProvider } from '../providers/types.js';
import { estimateCost } from './cost.js';

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
  /** Replies that were not parseable as one-line JSON (D33+). */
  parseErrors = 0;
  /** First 200 chars of the last unparseable reply, for diagnostics. */
  lastRaw: string | null = null;
  /** Actions the philosopher wanted but the tier config disabled (D33+). */
  degraded = 0;
  /** Metered philosopher usage (D33+): tokens across all checks. */
  inputTokens = 0;
  outputTokens = 0;
  /** Estimated USD across all checks; 0 when the model is unpriced. */
  costUsd = 0;
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
    for (const e of entries.slice(-40)) {
      lines.push(e.kind === 'tool' ? `[tool] ${e.text}` : `[${e.kind}] ${e.text}`);
    }
    // The coder's recent narration is the strongest steering signal: it says
    // what the coder believes it is doing. Keep the tail (most recent), not
    // the head (D33+ enrichment: was a 600-char cap).
    if (this.lastText.length > 0) {
      lines.push(
        `CODER RECENT REPLY (truncated to last 1500 chars): ${this.lastText.slice(-1500)}`,
      );
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
      // Philosopher cost metering (D33+): usage rides here, not the bus.
      this.inputTokens += res.usage.inputTokens;
      this.outputTokens += res.usage.outputTokens;
      this.costUsd += estimateCost(this.opts.model, res.usage).usd;
      this.apiErrors = 0;
      this.lastError = null;
    } catch (e) {
      this.apiErrors += 1;
      this.lastError = e instanceof Error ? e.message : 'observer error';
      return { action: 'noop' }; // observer failure never disturbs the run
    }

    const parsed = this.parseAction(raw);
    if (parsed === null) {
      // Unparseable reply (e.g. prose with no JSON). Count it so the done
      // card can distinguish "chose noop" from "could not answer" (D33+).
      this.parseErrors += 1;
      this.lastRaw = raw.slice(0, 200);
      return { action: 'noop' };
    }
    // Tier enforcement (D30b): disabled verbs degrade to noop — but they
    // are counted (D33+), so "0 interventions" stays explainable.
    if (parsed.action === 'guidance' && !this.opts.guidance) {
      this.degraded += 1;
      return { action: 'noop' };
    }
    if (parsed.action === 'pause' && !this.opts.pause) {
      this.degraded += 1;
      return { action: 'noop' };
    }
    if (parsed.action === 'cancel' && !this.opts.cancel) {
      this.degraded += 1;
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
