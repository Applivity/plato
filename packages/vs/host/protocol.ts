/**
 * The host <-> sidecar protocol: one JSON object per line over stdio.
 *
 * Requests carry `id`; responses carry the same `id` and one of `result` or
 * `error`; notifications carry `method` and `params`, no `id`.
 */

export interface RpcError {
  code?: number | string;
  message: string;
}

export interface RpcRequest {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: RpcError;
}

export type RpcMessage = RpcRequest | RpcResponse;

export interface InitParams {
  root: string;
  settingsPath: string;
  stateDir: string;
  workspaceStateFile: string;
  version?: string;
}

export function isResponse(message: RpcMessage): message is RpcResponse {
  return (
    typeof (message as RpcResponse).id === 'number' &&
    !('method' in message)
  );
}

/**
 * A person answers the page's dialogs. A modal that expires under them leaves
 * a control that does nothing when it is finally pressed, so UI calls wait ten
 * minutes; credential calls are machine work and keep the plan's 30 seconds.
 */
export function timeoutFor(method: string): number {
  const override = Number(process.env['PLATO_VS_RPC_TIMEOUT_MS'] ?? '');
  if (Number.isFinite(override) && override > 0) {
    return override;
  }
  if (method.startsWith('ui.')) {
    return 10 * 60_000;
  }
  return method.startsWith('secrets.') ? 30_000 : 10_000;
}
