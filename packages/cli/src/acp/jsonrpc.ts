/**
 * JSON-RPC 2.0 over stdio, one UTF-8 JSON object per line — the ACP transport
 * (agentclientprotocol.com/protocol/v1/transports).
 *
 * Hand-written on purpose. `@agentclientprotocol/sdk` pulls `zod/v4` into its
 * v1 entry through generated guards, and this package ships one dependency-free
 * bundle; the SDK plus zod measured 151 KB minified for a surface of four
 * inbound methods. The framing is the part of ACP that is easy to pin with a
 * test, so it is pinned here instead (test/acp.test.ts).
 *
 * Rules this file exists to hold:
 *  - request ids may be numbers OR strings; both are echoed back unchanged;
 *  - a message WITH `method` and `id` is a request, WITH `method` and no `id` is
 *    a notification, and with no `method` it is a response to one of our calls;
 *  - the standard errors, plus ACP's `auth_required` (-32000);
 *  - a maximum line length, so a malformed client cannot grow the buffer
 *    without bound (32 MiB, the reference SDK's default).
 */

export type Id = number | string;

export interface RpcError {
  code: number;
  message: string;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
/** ACP: authentication is required before this operation (v1 ErrorCode). */
export const AUTH_REQUIRED = -32000;
/** ACP: a session or file was not found. */
export const RESOURCE_NOT_FOUND = -32002;
/** ACP: execution was aborted (reserved LSP range). */
export const REQUEST_CANCELLED = -32800;

/** A failure a handler wants on the wire with a specific code. */
export class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcFailure';
  }
}

export const MAX_LINE_BYTES = 32 * 1024 * 1024;

export interface ConnectionIo {
  input: AsyncIterable<string | Buffer>;
  /** Must write whole lines to stdout and nothing else. */
  out(text: string): void;
  /** Diagnostics only; never protocol. */
  err(text: string): void;
}

type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
type NotificationHandler = (params: unknown) => void | Promise<void>;

interface Pending {
  resolve(value: unknown): void;
  reject(error: RpcFailure): void;
}

export class JsonRpcConnection {
  private readonly requests = new Map<string, RequestHandler>();
  private readonly notifications = new Map<string, NotificationHandler>();
  private readonly pending = new Map<Id, Pending>();
  private nextId = 1;
  private shut = false;
  private resolveClosed!: () => void;
  /** Resolves when the peer closes stdin, whether cleanly or by exiting. */
  readonly closed: Promise<void> = new Promise((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(private readonly io: ConnectionIo) {}

  onRequest(method: string, handler: RequestHandler): void {
    this.requests.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notifications.set(method, handler);
  }

  /** Sends a notification. Silent once the peer is gone. */
  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
  }

  /** Calls the client and waits for its response. */
  request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.shut) {
      return Promise.reject(new RpcFailure(REQUEST_CANCELLED, 'the connection is closed'));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const settle: Pending = {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      const onAbort = (): void => {
        this.pending.delete(id);
        settle.reject(new RpcFailure(REQUEST_CANCELLED, 'the request was cancelled'));
      };
      const cleanup = (): void => {
        this.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
      };
      if (signal?.aborted === true) {
        reject(new RpcFailure(REQUEST_CANCELLED, 'the request was cancelled'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, settle);
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  /**
   * Reads lines until the input ends. Handlers are dispatched WITHOUT being
   * awaited: `session/cancel` must be handled while `session/prompt` is still
   * running, which is the whole point of the notification.
   */
  async start(): Promise<void> {
    let buffer = '';
    let bytes = 0;
    try {
      for await (const chunk of this.io.input) {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        buffer += text;
        bytes += Buffer.byteLength(text);
        if (bytes > MAX_LINE_BYTES && !buffer.includes('\n')) {
          buffer = '';
          bytes = 0;
          this.fail(null, PARSE_ERROR, `a message exceeded ${MAX_LINE_BYTES} bytes`);
          continue;
        }
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          bytes = Buffer.byteLength(buffer);
          if (line.trim().length > 0) {
            this.dispatch(line);
          }
          index = buffer.indexOf('\n');
        }
        if (bytes > MAX_LINE_BYTES) {
          buffer = '';
          bytes = 0;
          this.fail(null, PARSE_ERROR, `a message exceeded ${MAX_LINE_BYTES} bytes`);
        }
      }
      if (buffer.trim().length > 0) {
        this.dispatch(buffer);
      }
    } catch (error) {
      this.io.err(`plato acp: reading stdin failed: ${(error as Error).message}\n`);
    } finally {
      this.shutdown();
    }
  }

  /** Refuses further writes and fails every call still waiting on the client. */
  shutdown(): void {
    if (this.shut) {
      return;
    }
    this.shut = true;
    for (const [, pending] of this.pending) {
      pending.reject(new RpcFailure(REQUEST_CANCELLED, 'the connection closed'));
    }
    this.pending.clear();
    this.resolveClosed();
  }

  private write(message: object): void {
    if (this.shut) {
      return;
    }
    try {
      this.io.out(`${JSON.stringify(message)}\n`);
    } catch (error) {
      // A closed pipe is the client going away, not a protocol fault.
      this.io.err(`plato acp: writing failed: ${(error as Error).message}\n`);
      this.shutdown();
    }
  }

  private respond(id: Id | null, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result: result === undefined ? null : result });
  }

  private fail(id: Id | null, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private dispatch(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(null, PARSE_ERROR, 'invalid JSON');
      return;
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      // ACP does not use JSON-RPC batches; a batch is answered once, id null.
      this.fail(null, INVALID_REQUEST, 'a message must be one JSON object');
      return;
    }
    const record = message as Record<string, unknown>;
    const method = record['method'];
    if (method === undefined) {
      this.handleResponse(record);
      return;
    }
    if (typeof method !== 'string') {
      this.fail(null, INVALID_REQUEST, 'method must be a string');
      return;
    }
    const params = record['params'];
    if ('id' in record) {
      const id = record['id'];
      if (typeof id !== 'number' && typeof id !== 'string') {
        this.fail(null, INVALID_REQUEST, 'id must be a number or a string');
        return;
      }
      const handler = this.requests.get(method);
      if (handler === undefined) {
        this.fail(id, METHOD_NOT_FOUND, `unknown method '${method}'`);
        return;
      }
      let outcome: unknown | Promise<unknown>;
      try {
        outcome = handler(params);
      } catch (error) {
        // Deferred like the success path, so responses leave in request order.
        void Promise.resolve().then(() => this.fallback(id, error));
        return;
      }
      void Promise.resolve(outcome).then(
        (result) => this.respond(id, result),
        (error: unknown) => this.fallback(id, error),
      );
      return;
    }
    const handler = this.notifications.get(method);
    if (handler === undefined) {
      // Notifications are never answered; an unknown one is simply ignored.
      return;
    }
    try {
      void Promise.resolve(handler(params)).catch((error: unknown) => {
        this.io.err(`plato acp: '${method}' failed: ${describe(error)}\n`);
      });
    } catch (error) {
      this.io.err(`plato acp: '${method}' failed: ${describe(error)}\n`);
    }
  }

  private handleResponse(message: Record<string, unknown>): void {
    const id = message['id'];
    if (typeof id !== 'number' && typeof id !== 'string') {
      this.fail(null, INVALID_REQUEST, 'a response must carry the id it answers');
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      // A response to a call we already abandoned (cancelled, or the peer
      // answered late). Nothing to do.
      return;
    }
    const error = message['error'];
    if (typeof error === 'object' && error !== null) {
      const rec = error as Record<string, unknown>;
      const code = typeof rec['code'] === 'number' ? rec['code'] : INTERNAL_ERROR;
      const text = typeof rec['message'] === 'string' ? rec['message'] : 'the client refused';
      pending.reject(new RpcFailure(code, text));
      return;
    }
    pending.resolve(message['result']);
  }

  private fallback(id: Id, error: unknown): void {
    if (error instanceof RpcFailure) {
      this.fail(id, error.code, error.message);
      return;
    }
    this.io.err(`plato acp: handler failed: ${describe(error)}\n`);
    this.fail(id, INTERNAL_ERROR, describe(error));
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
