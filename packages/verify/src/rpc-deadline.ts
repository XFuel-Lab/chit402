/**
 * One JSON-RPC call, one deadline, no retry.
 * Public hosts are refused while Node's test runner is the parent, so the
 * suite cannot POST to a production RPC. Loopback is the test server.
 */

export const RPC_TIMEOUT_MS = 12_000;

/** One Solana payer JSON-RPC check. No retry. Anchor calls pass their own timeout into `jsonRpc`. */
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
  const active = (signal ?? owned?.signal) as AbortSignal;
  // The deadline covers the whole call, including the body read. Aborting a
  // fetch does not always interrupt a body that stalled after the headers, so
  // the call also races the signal itself.
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(active.reason instanceof Error
      ? active.reason
      : Object.assign(new Error('rpc_timeout'), { name: 'TimeoutError' }));
    if (active.aborted) return fail();
    onAbort = fail;
    active.addEventListener('abort', fail, { once: true });
  });
  aborted.catch(() => {});
  try {
    return await Promise.race([jsonRpcCall(url, method, params, active), aborted]);
  } finally {
    if (onAbort) active.removeEventListener('abort', onAbort);
    owned?.cancel();
  }
}

async function jsonRpcCall(url: string, method: string, params: unknown[], active: AbortSignal): Promise<unknown> {
  {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: active,
        // A redirect is not followed: the POST is never replayed to another host.
        redirect: 'error',
      });
    } catch (err) {
      const cause = (err as { cause?: { message?: string; code?: string } } | null)?.cause;
      if (/redirect/i.test(String(cause?.message || ''))) {
        throw Object.assign(new Error('rpc_error: redirect refused'), { rpcCode: 'redirect' });
      }
      if (err instanceof TypeError && err.message === 'fetch failed') {
        throw new Error(`rpc_network${cause?.code ? `: ${cause.code}` : ''}`);
      }
      throw err;
    }
    if (!res.ok) throw new Error(`rpc_http_${res.status}`);
    const json = await res.json() as { result?: unknown; error?: { message?: string; code?: unknown } | null };
    if (json.error) {
      throw Object.assign(new Error(`rpc_error: ${json.error.message || 'unknown'}`), { rpcCode: json.error.code ?? null });
    }
    return json.result ?? null;
  }
}
