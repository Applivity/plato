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
  | 'done';

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
    }
  | { type: 'approval-requested'; runId: string; tool: string; preview: string }
  | { type: 'approval-decided'; runId: string; tool: string; allowed: boolean }
  | {
      type: 'usage';
      runId: string;
      turn: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
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
      reason: 'complete' | 'cap' | 'cancelled';
      turns: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      truncated?: boolean;
    }
  | { type: 'run-failed'; runId: string; error: string }
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
