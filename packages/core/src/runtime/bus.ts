/**
 * M2 event bus (D24a) + observer inbound mailbox (D24b, per D10).
 * Synchronous in-process pub-sub; listeners are isolated — a throwing
 * listener never breaks the run. The loop is the single emitter.
 */
import type { Mode } from './modes.js';

/**
 * How a run ended. Named once here (D49bo) rather than repeated inline, because
 * the queue rule in `queue.ts` branches on it and a second spelling of the same
 * union is a union that can drift.
 */
export type RunEndReason = 'complete' | 'cap' | 'cancelled' | 'stuck';

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
 *
 * `relay` (D49cq, amended) is the pre-flight on `send_to_session`: a run that
 * arrived from another session, or a message that is empty or too long, is
 * refused before the plan-mode card can ask about it.
 */
export type RefusalReason = 'secret' | 'containment' | 'relay';

export type AgentEvent =
  // D49bj: the mode the run STARTED in. Required, not optional, so an emitter
  // that forgets it is a compile error rather than a run record that cannot say
  // what its own writes were gated by. A switch is the `mode-changed` event
  // below (D49ca), so the two together read as the run's whole mode story.
  | { type: 'run-started'; runId: string; task: string; model: string; mode: Mode }
  /**
   * D49ca: the USER changed the mode. Emitted by the host, never by the loop —
   * the model cannot switch the mode and the loop has nothing to add.
   *
   * The run header names the mode the run BEGAN in, which cannot answer
   * "was the mode I am looking at the one it ran under?". This event answers
   * it: `from` and `to` are the two modes in force either side of the click,
   * and `at` is the click, which for a switch made between runs predates the
   * transcript's own `startedAt`.
   *
   * A switch made while no run is live is held by the host and emitted at the
   * start of the next run, so the next record carries it rather than losing it
   * with the panel.
   */
  | {
      type: 'mode-changed';
      runId: string;
      from: Mode;
      to: Mode;
      at: string;
      /**
       * D49cb: who asked. `picker` is the user's own control; `request` is the
       * model's request that the user approved on its card. The two are
       * different stories and the record should not make them read alike.
       */
      via: 'picker' | 'request';
    }
  /**
   * D49cb: the model asked for a mode, and the user answered. Emitted whether
   * the answer was yes or no, so a declined request is in the record too — the
   * mode-changed event only exists for the yes.
   *
   * The model's REASON is deliberately absent. It is prose written for a card,
   * and a transcript never carries model prose that could quote what was in
   * front of it; the card shows the reason, the record keeps the decision.
   */
  | {
      type: 'mode-requested';
      runId: string;
      from: Mode;
      to: Mode;
      approved: boolean;
    }
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
      /**
       * D49cq (amended): a send that reached a target, recorded as a digest —
       * whether it was an ordinary message or a reply, where it went, and how
       * long it was. Deliberately NOT the text: the message body is model prose
       * and args are stripped from the file for the same reason.
       */
      relay?: { kind: 'send' | 'reply'; to: string; chars: number };
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
      reason: RunEndReason;
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
 *
 * D49bm: `pause()` states a REQUEST. Only `gate()` knows when the run really
 * stopped, so it reports both edges through `RunControllerOptions.onPark`.
 */
export interface RunControllerOptions {
  /**
   * D49bm: fired when the loop **actually parks** at a safe point, and again
   * when it leaves — the only two moments `gate()` knows the run has stopped.
   *
   * `pause()` records a REQUEST and nothing else, so without this a caller
   * cannot tell "the user asked to pause" from "the run is paused", and a UI
   * that flips its own button on the click is claiming the second while only
   * the first is true. The loop may never reach a gate at all — a turn that
   * returns no tool calls ends the run — so a request can also go unhonoured,
   * which is why the caller needs both edges rather than one.
   */
  onPark?: (parked: boolean) => void;
}

export class RunController {
  private guidanceQueue: string[] = [];
  private paused = false;
  private cancelled = false;
  /** D49bm: whether `gate()` is inside its wait right now. */
  private parked = false;
  private waiter: (() => void) | null = null;
  private compactRequested = false;

  constructor(private readonly opts: RunControllerOptions = {}) {}
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

  /**
   * Isolated the same way `AgentBus.emit` is: a caller's listener is the UI's
   * problem, and a throw from it would propagate out of the `await` below and
   * **kill the run**. The controller must be as hard to break as the bus.
   */
  private notify(parked: boolean): void {
    try {
      this.opts.onPark?.(parked);
    } catch {
      // Isolated by contract (D24b).
    }
  }

  /** Await at safe points. Resolves false only when cancelled. */
  async gate(): Promise<boolean> {
    // D49bm: announce the EDGES only, and only edges that happened.
    //  - `true` fires on ENTERING the wait, not before it, so a resume-then-pause
    //    inside one wait does not leave the outside believing it was never parked.
    //  - `false` fires only if a park actually happened, or every ordinary gate
    //    would report a resume that never occurred.
    while (this.paused && !this.cancelled) {
      if (!this.parked) {
        this.parked = true;
        this.notify(true);
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
    if (this.parked) {
      this.parked = false;
      this.notify(false);
    }
    return !this.cancelled;
  }
}
