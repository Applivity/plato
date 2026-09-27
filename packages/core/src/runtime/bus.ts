/**
 * M2 event bus (D24a) + observer inbound mailbox (D24b, per D10).
 * Synchronous in-process pub-sub; listeners are isolated — a throwing
 * listener never breaks the run. The loop is the single emitter.
 */

export type ToolPhase =
  | 'requested'
  | 'allowed'
  | 'denied'
  | 'declined'
  // D49aq: the PRE-FLIGHT guard refused the call — a secret-bearing name or a
  // path outside the workspace. Distinct from 'denied', which is the mode table
  // (or an MCP capability) saying no. Before this phase existed the guard
  // emitted NOTHING, so the transcript could not tell "the guard refused it"
  // from "the model never called a tool" — the same silence either way.
  | 'refused'
  | 'done';

/**
 * D49aq: which guard refused a call. A fixed vocabulary rather than the
 * refusal sentence, because the sentence can quote the argument — and the
 * transcript's whole rule (D24c) is that arguments never reach the file.
 */
export type RefusalReason = 'secret' | 'containment';

export type AgentEvent =
  | { type: 'run-started'; runId: string; task: string; model: string }
  | { type: 'turn-started'; runId: string; turn: number }
  | { type: 'text'; runId: string; text: string }
  | {
      type: 'tool-event';
      runId: string;
      tool: string;
      phase: ToolPhase;
      ok?: boolean;
      /** Present for bridge parity; transcripts strip it (D24c). */
      args?: unknown;
      /** D49aq: set only on phase 'refused'. */
      reason?: RefusalReason;
    }
  | { type: 'approval-requested'; runId: string; tool: string; preview: string }
  /**
   * D49aq: what the HOST did with an ask, which the loop cannot know.
   *
   * `approval-requested` is emitted before the host is consulted, so it says an
   * ask was RAISED and never that a card was DRAWN. In `edit` the per-file
   * session memory (and the tool:host session approval) return true without
   * rendering anything — so a run with two `approval-requested` entries can have
   * shown the user one card, and the transcript could not say which. This event
   * is the host answering that question; a reader needs it to count cards
   * actually shown, and nothing else in the file can.
   */
  | {
      type: 'approval-card';
      runId: string;
      tool: string;
      via: 'shown' | 'session-memory' | 'session-approval';
    }
  | { type: 'approval-decided'; runId: string; tool: string; allowed: boolean }
  | {
      type: 'usage';
      runId: string;
      turn: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      /** D49g: the cached subset of `inputTokens`, when the provider reports it. */
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  | {
      /**
       * D37: emitted before every turn so the UI can show the live
       * context ring. `maxContext` is `null` when the model's window is
       * unknown (D26c: never guess). The breakdown is an estimate.
       */
      type: 'context';
      runId: string;
      turn: number;
      maxContext: number | null;
      total: number;
      system: number;
      user: number;
      assistant: number;
      tool: number;
      /**
       * Provider-reported inputTokens from the previous turn, when
       * available. Lets the tooltip compare the estimate with the
       * authoritative number from the last request.
       */
      lastInputTokens?: number;
    }
  | {
      /**
       * D37: emitted after a successful compaction. The loop has
       * already replaced `system` + `messages` in place; this event
       * is for the UI to render a notice ("compacted 42k → 6k").
       */
      type: 'context-compacted';
      runId: string;
      turn: number;
      mode: 'manual' | 'auto';
      beforeTokens: number;
      afterTokens: number;
      summaryTokens: number;
      keptMessages: number;
    }
  | {
      type: 'run-completed';
      runId: string;
      /** `stuck` (D49aw): the user stopped a run that was repeating itself. */
      reason: 'complete' | 'cap' | 'cancelled' | 'stuck';
      turns: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      truncated?: boolean;
    }
  | { type: 'run-failed'; runId: string; error: string }
  /**
   * D49m: a background shell started or exited. LIFECYCLE ONLY — deliberately
   * not the shell's output.
   *
   * `transcript.ts` writes every event verbatim, so a chunk per line of a dev
   * server would bloat every transcript; that is the same reason streaming
   * deltas stay off the bus (D49j). The model reads output by polling
   * `bash_output`, and the human sees the lifecycle in the log.
   */
  | {
      type: 'shell-event';
      runId: string;
      id: string;
      phase: 'started' | 'exited';
      command: string;
      /** Exit code, present on 'exited' only. Null when killed by a signal. */
      code?: number | null;
    }
  /** Human-readable in-flight notice. Not a run state. */
  | { type: 'notice'; runId: string; text: string };

export type AgentListener = (event: AgentEvent) => void;

export class AgentBus {
  private listeners = new Set<AgentListener>();

  /** Subscribe; returns an unsubscribe function. */
  on(fn: AgentListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(event: AgentEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(event);
      } catch {
        // Isolated by contract (D24a): one bad observer cannot kill a run.
      }
    }
  }
}

/**
 * Inbound control channel. Guidance queues FIFO and is injected at safe
 * points; pause blocks at safe points until resume; cancel stops after
 * the in-flight tool call (D24b).
 *
 * D37: `requestCompact` is a one-shot flag the loop checks at the same
 * safe points. Manual and Auto both funnel through here so the loop
 * has a single compactor entry point.
 */
export class RunController {
  private guidanceQueue: string[] = [];
  private paused = false;
  private cancelled = false;
  private waiter: (() => void) | null = null;
  private compactRequested = false;
  /**
   * D49i: `gate()` can only stop the run at a safe point — between turns or
   * between tool calls. A provider call already in flight was unstoppable, so a
   * hung request hung the run with no way out. This signal reaches the HTTP
   * layer, and the loop passes it on every turn.
   */
  private readonly abort = new AbortController();

  /** Threaded into the provider call so a cancel interrupts it. */
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  sendGuidance(text: string): void {
    if (text.trim().length > 0) {
      this.guidanceQueue.push(text);
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.waiter?.();
    this.waiter = null;
  }

  cancel(): void {
    this.cancelled = true;
    // D49i: abort AFTER setting the flag, so a caller that observes the abort
    // can still tell a cancel apart from a transport failure.
    this.abort.abort();
    this.waiter?.();
    this.waiter = null;
  }

  /** D37: ask the loop to compact at the next safe point. */
  requestCompact(): void {
    this.compactRequested = true;
  }

  /** D37: read & clear the compact request. */
  drainCompactRequest(): boolean {
    const v = this.compactRequested;
    this.compactRequested = false;
    return v;
  }

  drainGuidance(): string[] {
    const out = this.guidanceQueue;
    this.guidanceQueue = [];
    return out;
  }

  /** Await at safe points. Resolves false only when cancelled. */
  async gate(): Promise<boolean> {
    while (this.paused && !this.cancelled) {
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
    return !this.cancelled;
  }
}
