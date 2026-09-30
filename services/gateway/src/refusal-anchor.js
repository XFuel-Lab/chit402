/**
 * Chain anchor for a policy refusal.
 *
 * At clamp time we record the latest observed Base block (chain id, number,
 * hash). If the RPC is missing or fails, the refusal still appends and the
 * anchor status is UNAVAILABLE. A refusal must not depend on the chain.
 */
import logger from './logger.js';

export const ANCHOR_UNAVAILABLE = 'UNAVAILABLE';
const DEFAULT_TIMEOUT_MS = 800;

let cached = null;

function unavailable(reason) {
  return {
    status: ANCHOR_UNAVAILABLE,
    rail: 'base',
    chain_id: null,
    block_number: null,
    block_hash: null,
    observed_at: new Date().toISOString(),
    reason: reason || 'rpc_error',
  };
}

function rpcUrl() {
  return process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || null;
}

async function rpc(url, method, params, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`rpc_http_${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'rpc_error');
  return body.result;
}

function hexToDec(hex) {
  if (hex == null) return null;
  return BigInt(hex).toString(10);
}

/**
 * Observe the latest Base block. Never throws.
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 */
export async function observeBaseAnchor({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = rpcUrl();
  if (!url) return unavailable('no_rpc');
  try {
    const [chainHex, block] = await Promise.all([
      rpc(url, 'eth_chainId', [], timeoutMs),
      rpc(url, 'eth_getBlockByNumber', ['latest', false], timeoutMs),
    ]);
    if (!block?.hash || block.number == null) return unavailable('empty_block');
    const anchor = {
      status: 'observed',
      rail: 'base',
      chain_id: chainHex != null ? Number(BigInt(chainHex)) : null,
      block_number: hexToDec(block.number),
      block_hash: String(block.hash),
      observed_at: new Date().toISOString(),
      reason: null,
    };
    cached = anchor;
    return anchor;
  } catch (err) {
    logger.warn({ err: err.message }, 'refusal anchor unavailable');
    const failed = unavailable(err.message || 'rpc_error');
    return failed;
  }
}

/** Last successful observation, or UNAVAILABLE. Does not call the network. */
export function peekRefusalAnchor() {
  if (cached && cached.status === 'observed') return { ...cached };
  return unavailable(cached?.reason || 'no_observation');
}

/**
 * Anchor to store on a refusal. Uses a fresh observation when the caller
 * can wait, and falls back to UNAVAILABLE without failing the refusal.
 * @param {object|null|undefined} supplied
 */
export function refusalAnchorOrUnavailable(supplied) {
  if (supplied && typeof supplied === 'object') {
    if (supplied.status === ANCHOR_UNAVAILABLE || supplied.status === 'observed') {
      return supplied;
    }
  }
  return peekRefusalAnchor();
}
