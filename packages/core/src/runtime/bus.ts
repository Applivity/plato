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
      type: 'run-completed';
      runId: string;
      reason: 'complete' | 'cap' | 'cancelled';
      turns: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  | { type: 'run-failed'; runId: string; error: string };

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
 */
export class RunController {
  private guidanceQueue: string[] = [];
  private paused = false;
  private cancelled = false;
  private waiter: (() => void) | null = null;

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
