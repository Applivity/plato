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

/** UI and credential calls may wait for a person; everything else may not. */
export function timeoutFor(method: string): number {
  const override = Number(process.env['PLATO_VS_RPC_TIMEOUT_MS'] ?? '');
  if (Number.isFinite(override) && override > 0) {
    return override;
  }
  return method.startsWith('ui.') || method.startsWith('secrets.')
    ? 30_000
    : 10_000;
}
