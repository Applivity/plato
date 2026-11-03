/**
 * M2 sidecar entry: newline-delimited JSON over stdio.
 *
 * The host (the Visual Studio VSIX) starts `node.exe plato-host.cjs` and
 * speaks the protocol in `protocol.ts`. The existing IDE host runs unchanged
 * behind the shim; this file only moves HTML, page messages, UI requests, and
 * credentials between the two processes.
 */
import './silence.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { start, type StartedHost } from './entry.ts';
import {
  isResponse,
  timeoutFor,
  type InitParams,
  type RpcMessage,
  type RpcResponse,
} from './protocol.ts';
import type {
  SecretStorageLike,
  ShimTransport,
} from './shim/vscode.ts';
import { __setRoot } from './shim/vscode.ts';

/* -------------------------------------------------------------- transport */

let nextRequestId = 1;
const pending = new Map<
  number,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  }
>();

let output: Promise<void> = Promise.resolve();

function send(message: RpcMessage): void {
  const line = `${JSON.stringify(message)}\n`;
  output = output.then(
    () =>
      new Promise<void>((resolve) => {
        process.stdout.write(line, () => resolve());
      }),
  );
}

function notify(method: string, params: Record<string, unknown> = {}): void {
  send({ method, params });
}

function request(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const id = nextRequestId;
  nextRequestId += 1;
  send({ id, method, params });
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${timeoutFor(method)} ms`));
    }, timeoutFor(method));
    pending.set(id, { resolve, reject, timer });
  });
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  notify('log', { level, message });
  if (level !== 'info') {
    console.error(`[plato-host] ${level}: ${message}`);
  }
}

function fail(code: number | string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

const transport: ShimTransport = {
  setHtml(html: string): void {
    notify('webview.html', { html });
  },
  post(message: unknown): void {
    notify('webview.post', { message });
  },
  reveal(): void {
    notify('panel.reveal');
  },
  disposed(): void {
    notify('panel.disposed');
  },
  async request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    return await request(method, params);
  },
};

const secretStore: SecretStorageLike = {
  async get(key: string): Promise<string | undefined> {
    const result = (await request('secrets.get', { key })) as
      | { value?: unknown }
      | undefined;
    return typeof result?.value === 'string' ? result.value : undefined;
  },
  async store(key: string, value: string): Promise<void> {
    await request('secrets.store', { key, value });
  },
  async delete(key: string): Promise<void> {
    await request('secrets.delete', { key });
  },
};

/* ----------------------------------------------------------------- state */

let host: StartedHost | null = null;
let stopping = false;

function projectKey(root: string): string {
  return createHash('sha1').update(root).digest('hex').slice(0, 8);
}

function readSettings(file: string): Record<string, unknown> {
  try {
    // A BOM is legal in a UTF-8 file and some editors write one. JSON.parse
    // rejects it, so strip it before parsing.
    const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log('warn', `settings could not be read (${file}): ${String(error)}`);
    }
    return {};
  }
}

function init(params: Record<string, unknown>): unknown {
  const root = params['root'];
  const settingsPath = params['settingsPath'];
  const stateDir = params['stateDir'];
  if (typeof root !== 'string' || root.length === 0) {
    fail(-32602, 'init.root is required');
  }
  if (typeof settingsPath !== 'string' || settingsPath.length === 0) {
    fail(-32602, 'init.settingsPath is required');
  }
  if (typeof stateDir !== 'string' || stateDir.length === 0) {
    fail(-32602, 'init.stateDir is required');
  }
  const workspaceStateFile =
    typeof params['workspaceStateFile'] === 'string'
      ? params['workspaceStateFile']
      : join(stateDir, 'workspace-state', `${projectKey(root)}.json`);
  const sharedStateFile =
    typeof params['sharedStateFile'] === 'string'
      ? params['sharedStateFile']
      : undefined;

  const settings = readSettings(settingsPath);
  host = start({
    root,
    stateDir,
    settings,
    secrets: {},
    secretStore,
    workspaceStateFile,
    sharedStateFile,
    transport,
  });
  log('info', `sidecar started for ${root} (${String(params['version'] ?? '')})`);
  return { ok: true };
}

/* -------------------------------------------------------------- handlers */

async function handleRequest(message: {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}): Promise<void> {
  const { id, method } = message;
  const params = message.params ?? {};

  try {
    let result: unknown = undefined;
    switch (method) {
      case 'init':
        result = init(params);
        break;
      case 'command': {
        if (host === null) {
          fail(-32000, 'not initialized');
        }
        const command = params['command'];
        if (typeof command !== 'string') {
          fail(-32602, 'command.command is required');
        }
        const args = Array.isArray(params['args']) ? params['args'] : [];
        result = await host.execute(command, ...args);
        break;
      }
      case 'webview.message': {
        if (host === null) {
          fail(-32000, 'not initialized');
        }
        host.receive(params['message']);
        result = { ok: true };
        break;
      }
      case 'theme.changed':
        // Visual Studio colors are applied by the C# shell as CSS variables.
        result = { ok: true };
        break;
      case 'panel.close': {
        // The tool window was closed. Disposing the panel stops the run, as
        // closing the chat tab does in the VS Code host. The response is sent
        // only after the run has unwound and the chat has been archived, so
        // the shell can stop the process without cutting its own archive short.
        const panel = host?.panel() as {
          disposeAsync?: () => Promise<void>;
          dispose?: () => void;
        } | null;
        if (panel?.disposeAsync) {
          await panel.disposeAsync();
        } else {
          panel?.dispose?.();
        }
        result = { ok: true };
        break;
      }
      case 'solution.changed': {
        const root = params['root'];
        if (typeof root === 'string' && root.length > 0) {
          __setRoot(root);
        }
        result = { ok: true };
        break;
      }
      case 'shutdown':
        if (typeof id === 'number') {
          send({ id, result: { ok: true } });
        }
        await shutdown();
        return;
      default:
        fail(-32601, `unknown method: ${method}`);
    }
    if (typeof id === 'number') {
      send({ id, result });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('error', `${method}: ${reason}`);
    if (typeof id === 'number') {
      send({
        id,
        error: {
          code:
            typeof error === 'object' && error !== null && 'code' in error
              ? ((error as { code: number | string }).code as number | string)
              : -32603,
          message: reason,
        },
      });
    }
  }
}

async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  try {
    const panel = host?.panel() as {
      disposeAsync?: () => Promise<void>;
      dispose?: () => void;
    } | null;
    if (panel?.disposeAsync) {
      await panel.disposeAsync();
    } else {
      panel?.dispose?.();
    }
  } catch (error) {
    console.error(`[plato-host] shutdown: ${String(error)}`);
  }
  await output;
  // Let the response flush before the process leaves.
  setTimeout(() => process.exit(0), 20);
}

function handleLine(line: string): void {
  const text = line.trim();
  if (text.length === 0) {
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch (error) {
    log('warn', `discarded a line that is not JSON: ${String(error)}`);
    return;
  }
  if (message === null || typeof message !== 'object') {
    log('warn', 'discarded a message that is not an object');
    return;
  }

  if (isResponse(message as RpcMessage)) {
    const response = message as RpcResponse;
    const waiter = pending.get(response.id);
    if (waiter === undefined) {
      log('warn', `response for an unknown request id: ${response.id}`);
      return;
    }
    pending.delete(response.id);
    clearTimeout(waiter.timer);
    if (response.error !== undefined) {
      waiter.reject(new Error(response.error.message));
    } else {
      waiter.resolve(response.result);
    }
    return;
  }

  const request = message as {
    id?: number;
    method?: unknown;
    params?: Record<string, unknown>;
  };
  if (typeof request.method !== 'string') {
    log('warn', 'discarded a message with no method');
    return;
  }
  void handleRequest({
    id: typeof request.id === 'number' ? request.id : undefined,
    method: request.method,
    params: request.params,
  });
}

/* --------------------------------------------------------------- process */

function main(): void {
  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  input.on('line', handleLine);
  input.on('close', () => {
    void shutdown();
  });
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      console.error(`[plato-host] stdout: ${String(error)}`);
    }
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
  // A timed-out dialog or a stray rejection must not stop the agent. The
  // shim already turns a failed UI request into "no answer"; this is the
  // last line of defence for anything else.
  process.on('unhandledRejection', (reason) => {
    log('error', `unhandled rejection: ${String(reason)}`);
  });
}

if (require.main === module) {
  main();
}

export { start };
export type { StartedHost };
export type { InitParams };
