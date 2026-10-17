/**
 * One JSON-RPC call, one deadline, no retry.
 * Public hosts are refused while Node's test runner is the parent, so the
 * suite cannot POST to a production RPC. Loopback is the test server.
 */

export const RPC_TIMEOUT_MS = 12_000;

/** One Solana JSON-RPC check. No retry. The payer call is one request; an anchor adds genesis under the same cap when a shared signal is passed. */
export const SOLANA_RPC_TIMEOUT_MS = 30_000;

export function rpcFailureReason(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err
    ? String((err as { name?: string }).name)
    : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(message)) {
    return 'rpc_timeout';
  }
  if (message.startsWith('rpc_error:') || message.startsWith('rpc_timeout') || message.startsWith('hermetic_rpc')) {
    return message.startsWith('rpc_error:') ? message : `rpc_error: ${message}`;
  }
  return `rpc_error: ${message}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isLoopbackRpc(url: string): boolean {
  const host = hostOf(url);
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Node's test runner sets NODE_TEST_CONTEXT and child processes inherit it.
 * A public RPC from that process would be a live POST. Loopback stays open.
 */
export function assertHermeticRpc(url: string): void {
  if (process.env.CHIT402_ALLOW_PUBLIC_RPC === '1') return;
  const hermetic = process.env.CHIT402_HERMETIC === '1' || Boolean(process.env.NODE_TEST_CONTEXT);
  if (!hermetic) return;
  if (isLoopbackRpc(url)) return;
  const host = hostOf(url) || 'invalid-url';
  throw new Error(`hermetic_rpc: ${host} is not a local test RPC`);
}

/**
 * A ref'd timer. AbortSignal.timeout() does not keep the process alive, so a
 * fetch that never opens a socket could otherwise let the process exit 0.
 */
export function openRpcDeadline(ms = RPC_TIMEOUT_MS): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(Object.assign(new Error('rpc_timeout'), { name: 'TimeoutError' }));
  }, ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export async function jsonRpc(
  url: string,
  method: string,
  params: unknown[],
  signal?: AbortSignal,
  timeoutMs: number = RPC_TIMEOUT_MS,
): Promise<unknown> {
  assertHermeticRpc(url);
  const owned = signal ? null : openRpcDeadline(timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: signal ?? owned?.signal,
    });
    if (!res.ok) throw new Error(`rpc_http_${res.status}`);
    const json = await res.json() as { result?: unknown; error?: { message?: string } | null };
    if (json.error) throw new Error(`rpc_error: ${json.error.message || 'unknown'}`);
    return json.result ?? null;
  } finally {
    owned?.cancel();
  }
}
