/**
 * M1 entry: start the existing VS Code host against the shim.
 *
 * The extension source is imported unchanged from its compiled output. The
 * esbuild alias in `esbuild.mjs` replaces its `vscode` import with the shim.
 */
import { activate } from '../../vscode/out/extension.js';
import * as vscode from 'vscode';
import type { ShimConfig } from './shim/vscode.ts';

export interface StartedHost {
  ctx: unknown;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  panel(): unknown;
  receive(msg: unknown): void;
}

export function start(config: ShimConfig): StartedHost {
  vscode.__configure(config);
  const ctx = vscode.__createContext();
  activate(ctx);
  return {
    ctx,
    execute: (id: string, ...args: unknown[]) =>
      vscode.commands.executeCommand(id, ...args),
    panel: () => vscode.__panel(),
    receive: (msg: unknown) => vscode.__receive(msg),
  };
}

export { activate };
