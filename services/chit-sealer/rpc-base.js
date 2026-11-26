/**
 * Base mainnet RPC for the v13 checkpoint anchor.
 *
 * Two URLs, checked the same way as the issuer-root pair: different hosts,
 * different registrable domains, and not a loopback alias. This module does
 * not import the gateway and does not read BASE_RPC_URL. A missing URL, a
 * non-https URL outside NODE_ENV=test, a wrong chain id, or a ChitAnchor
 * code or domain mismatch fails closed. Nothing here logs a URL.
 *
 * Fee quote is baseFeePerGas * 2 + tip. The gas limit is ANCHOR_GAS_LIMIT.
 * ChitAnchor.anchor genesis measures above 100000, so the floor is higher.
 */

import net from 'node:net';
import { bytesToHex } from '../../packages/cs2-core/ecdsa/bytes.js';
import { eip1559Decode } from '../../packages/cs2-core/ecdsa/eip1559.js';
import { keccak256 } from '../../packages/cs2-core/ecdsa/keccak.js';
import { ANCHOR_SELECTOR } from './calldata.js';
import {
  MAINNET_ANCHOR,
  MAINNET_CHECKPOINT,
  MAINNET_DOMAIN,
  normHex,
} from './mainnet-pin.js';

/** Inner gas for a genesis anchor is 130115. 100000 cannot land. */
export const ANCHOR_GAS_FLOOR = 250000n;

/** Headroom over the measured genesis call for calldata and a short proof. */
export const ANCHOR_GAS_LIMIT = 300000n;

export const BASE_CHAIN_ID = 8453n;

const BASE_CHAIN_HEX = '0x2105';
const RPC_TIMEOUT_MS = 8000;
const RPC_BODY_MAX = 1_000_000;

const DOMAIN_SELECTOR = bytesToHex(keccak256(new TextEncoder().encode('domain()')).subarray(0, 4));
const ANCHORED_TOPIC = `0x${bytesToHex(keccak256(new TextEncoder().encode('Anchored(uint64,uint64,uint64,bytes32,bytes32,uint8)')))}`;

const LOOPBACK_HOSTS = new net.BlockList();
LOOPBACK_HOSTS.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK_HOSTS.addAddress('0.0.0.0', 'ipv4');
LOOPBACK_HOSTS.addAddress('::1', 'ipv6');
LOOPBACK_HOSTS.addAddress('::', 'ipv6');
LOOPBACK_HOSTS.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');
LOOPBACK_HOSTS.addAddress('::ffff:0.0.0.0', 'ipv6');

const LOOPBACK_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function permissionBits(mode) {
  return mode & 0o777;
}

export function dirModeOk(mode) {
  return (permissionBits(mode) & ~0o700) === 0;
}

export function fileModeOk(mode) {
  return (permissionBits(mode) & ~0o600) === 0;
}

/**
 * Positive integer wei. Empty, zero, negative, and non-integers are refused.
 * There is no default.
 * @param {unknown} raw
 */
export function readFeeCapWei(raw) {
  if (typeof raw === 'bigint') return raw > 0n ? raw : null;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) return null;
    return BigInt(raw);
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!/^[1-9][0-9]*$/.test(text)) return null;
  try {
    const value = BigInt(text);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

function canonicalRpcHost(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  let host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return null;
  return host;
}

function hostIsLoopback(host) {
  if (LOOPBACK_NAMES.has(host) || host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = net.isIP(host);
  if (kind === 4) return LOOPBACK_HOSTS.check(host, 'ipv4');
  if (kind === 6) return LOOPBACK_HOSTS.check(host, 'ipv6');
  return false;
}

function registrableDomain(host) {
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return labels.slice(-2).join('.');
}

/**
 * Two RPC URLs are independent only when they name different providers.
 * Distinct strings, paths, or ports are not enough. Same rules as the
 * issuer-root pair.
 * @param {string|null|undefined} left
 * @param {string|null|undefined} right
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function classifySealerRpcIndependence(left, right) {
  if (!left || !right) return { ok: false, reason: 'missing' };
  const a = canonicalRpcHost(left);
  const b = canonicalRpcHost(right);
  if (!a || !b) return { ok: false, reason: 'unparseable URL' };
  if (a === b) return { ok: false, reason: 'same host' };
  if (hostIsLoopback(a) && hostIsLoopback(b)) return { ok: false, reason: 'localhost or IP alias' };
  const aIp = net.isIP(a) !== 0;
  const bIp = net.isIP(b) !== 0;
  if (!aIp && !bIp) {
    const leftDomain = registrableDomain(a);
    const rightDomain = registrableDomain(b);
    if (!leftDomain || !rightDomain || leftDomain === rightDomain) {
      return { ok: false, reason: 'same registrable domain' };
    }
  }
  return { ok: true };
}

/**
 * https is required outside NODE_ENV=test. Loopback is refused outside test.
 * Independence is always required. No default URL is substituted.
 * @param {string|null|undefined} left
 * @param {string|null|undefined} right
 * @param {object} [env]
 */
export function assertSealerRpcPair(left, right, env) {
  const independence = classifySealerRpcIndependence(left, right);
  if (!independence.ok) throw coded('v13_boot_refused');
  const test = env?.NODE_ENV === 'test';
  const urls = [left, right];
  for (let i = 0; i < urls.length; i += 1) {
    const parsed = new URL(String(urls[i]).trim());
    if (parsed.username || parsed.password) throw coded('v13_boot_refused');
    if (parsed.protocol !== 'https:' && !(test && parsed.protocol === 'http:')) {
      throw coded('v13_boot_refused');
    }
    const host = canonicalRpcHost(urls[i]);
    if (!test && host && hostIsLoopback(host)) throw coded('v13_boot_refused');
  }
  return [String(left).trim(), String(right).trim()];
}

function hexQuantity(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  try {
    if (/^0x[0-9a-fA-F]+$/.test(text)) return BigInt(text);
    if (/^[0-9]+$/.test(text)) return BigInt(text);
  } catch {
    return null;
  }
  return null;
}

/**
 * maxFeePerGas = base * 2 + tip, tip clamped to that max, gas at ANCHOR_GAS_LIMIT.
 * @param {unknown} baseFeePerGas
 * @param {unknown} maxPriorityFeePerGas
 */
export function quoteAnchorFees(baseFeePerGas, maxPriorityFeePerGas) {
  const base = hexQuantity(baseFeePerGas);
  let tip = hexQuantity(maxPriorityFeePerGas);
  if (base == null || tip == null || base < 0n || tip < 0n) throw coded('anchor_rpc_unavailable');
  let maxFee = (base * 2n) + tip;
  if (tip > maxFee) tip = maxFee;
  if (maxFee <= 0n) throw coded('bad_fees');
  return {
    gasLimit: ANCHOR_GAS_LIMIT.toString(),
    maxFeePerGas: maxFee.toString(),
    maxPriorityFeePerGas: tip.toString(),
  };
}

function addressHex(value) {
  const hex = normHex(value).replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(hex)) return '';
  return `0x${hex}`;
}

/**
 * The signed wire must be the EIP-1559 anchor: chain 8453, value 0, the
 * pinned contract, the anchor selector, and gas at or above the floor.
 * @param {string} wire
 */
export function assertAnchorWire(wire) {
  let decoded;
  try {
    decoded = eip1559Decode(wire);
  } catch {
    throw coded('anchor_target');
  }
  if (decoded.chainId !== BASE_CHAIN_ID) throw coded('anchor_chain_mismatch');
  if (decoded.value !== 0n) throw coded('anchor_target');
  if (addressHex(decoded.to) !== addressHex(MAINNET_ANCHOR)) throw coded('anchor_target');
  const data = String(decoded.data || '').replace(/^0x/i, '').toLowerCase();
  if (!data.startsWith(ANCHOR_SELECTOR)) throw coded('anchor_target');
  if (decoded.gasLimit < ANCHOR_GAS_FLOOR) throw coded('anchor_target');
  return decoded;
}

export function observedChainOk(value) {
  const parsed = hexQuantity(value);
  if (parsed == null) return false;
  return parsed === BASE_CHAIN_ID;
}

function codeHasBody(code) {
  if (typeof code !== 'string') return false;
  const hex = code.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(hex)) return false;
  return /[1-9a-f]/.test(hex);
}

function domainMatches(word) {
  if (typeof word !== 'string') return false;
  const hex = word.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  return `0x${hex}` === normHex(MAINNET_DOMAIN);
}

function wordHex(data, index) {
  const body = String(data || '').replace(/^0x/i, '');
  return body.slice(index * 64, (index + 1) * 64).toLowerCase();
}

/**
 * Finalized Anchored logs whose sender is the pinned checkpoint.
 * An unfinalized log is omitted. noteAnchored is not called here.
 * @param {object} input
 */
export function selectFinalizedAnchored({ logs, finalizedNumber, txFromOf }) {
  const finalized = hexQuantity(finalizedNumber);
  if (finalized == null) return [];
  const admitted = [];
  const list = Array.isArray(logs) ? logs : [];
  for (let i = 0; i < list.length; i += 1) {
    const log = list[i];
    if (!log || typeof log !== 'object') continue;
    if (addressHex(log.address) !== addressHex(MAINNET_ANCHOR)) continue;
    const topic = normHex(log.topics && log.topics[0]);
    if (topic !== ANCHORED_TOPIC) continue;
    const blockNumber = hexQuantity(log.blockNumber);
    if (blockNumber == null || finalizedNumber == null || blockNumber > finalized) continue;
    const from = addressHex(typeof txFromOf === 'function' ? txFromOf(log) : '');
    if (from !== addressHex(MAINNET_CHECKPOINT)) continue;
    const epoch = hexQuantity(log.topics && log.topics[1]);
    const hourStart = hexQuantity(log.topics && log.topics[2]);
    const size = hexQuantity(`0x${wordHex(log.data, 0)}`);
    const root = wordHex(log.data, 1);
    const stateRoot = wordHex(log.data, 2);
    if (epoch == null || hourStart == null || size == null) continue;
    if (!/^[0-9a-f]{64}$/.test(root) || !/^[0-9a-f]{64}$/.test(stateRoot)) continue;
    if (!Number.isSafeInteger(Number(epoch)) || !Number.isSafeInteger(Number(hourStart))) continue;
    if (!Number.isSafeInteger(Number(size))) continue;
    admitted.push({
      epoch: Number(epoch),
      hourStart: Number(hourStart),
      size: Number(size),
      root,
      stateRoot,
      from,
      blockNumber,
      finalized: true,
    });
  }
  return admitted;
}

function withTimeout(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return timeout;
}

async function rpcCall(fetchImpl, url, method, params, signal, timeoutMs) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: withTimeout(signal, timeoutMs),
      cache: 'no-store',
    });
  } catch (err) {
    const wrapped = coded('anchor_rpc_unavailable');
    wrapped.transport = true;
    wrapped.cause = err;
    throw wrapped;
  }
  if (!res || res.ok !== true) {
    const err = coded('anchor_rpc_unavailable');
    err.transport = true;
    throw err;
  }
  let text;
  try {
    text = await res.text();
  } catch {
    const err = coded('anchor_rpc_unavailable');
    err.transport = true;
    throw err;
  }
  if (typeof text !== 'string' || text.length > RPC_BODY_MAX) {
    const err = coded('anchor_rpc_unavailable');
    err.transport = true;
    throw err;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    const err = coded('anchor_rpc_unavailable');
    err.transport = true;
    throw err;
  }
  if (!body || typeof body !== 'object' || body.error) {
    const err = coded('broadcast_failed');
    err.transport = false;
    throw err;
  }
  return body.result;
}

/**
 * Active-standby Base client. Primary is used when it passes the chain and
 * pin checks. A transport failure fails over only after the secondary has
 * passed the same checks. A chain or contract mismatch on either URL refuses
 * the call before a signature or a raw transaction is sent.
 * @param {{ urls: string[], fetchImpl?: Function, timeoutMs?: number }} opts
 */
export function createBaseBroadcaster(opts) {
  const urls = opts && Array.isArray(opts.urls) ? opts.urls.slice(0, 2) : [];
  const fetchImpl = opts && typeof opts.fetchImpl === 'function' ? opts.fetchImpl : globalThis.fetch;
  const timeoutMs = Number.isFinite(opts && opts.timeoutMs) && opts.timeoutMs > 0
    ? Math.min(opts.timeoutMs, 30000)
    : RPC_TIMEOUT_MS;
  if (urls.length !== 2 || typeof fetchImpl !== 'function') throw coded('v13_boot_refused');

  async function probe(url, signal) {
    try {
      const chainId = await rpcCall(fetchImpl, url, 'eth_chainId', [], signal, timeoutMs);
      if (!observedChainOk(chainId)) return { url, mismatch: 'anchor_chain_mismatch' };
      return { url, ok: true };
    } catch (err) {
      if (err && err.transport === true) return { url, transport: true };
      return { url, mismatch: 'anchor_chain_mismatch' };
    }
  }

  async function pin(url, signal) {
    let code;
    let domain;
    try {
      code = await rpcCall(fetchImpl, url, 'eth_getCode', [MAINNET_ANCHOR, 'latest'], signal, timeoutMs);
      domain = await rpcCall(
        fetchImpl,
        url,
        'eth_call',
        [{ to: MAINNET_ANCHOR, data: `0x${DOMAIN_SELECTOR}` }, 'latest'],
        signal,
        timeoutMs,
      );
    } catch (err) {
      if (err && err.transport === true) return { transport: true };
      return { mismatch: 'v13_pin_refused' };
    }
    if (!codeHasBody(code) || !domainMatches(domain)) return { mismatch: 'v13_pin_refused' };
    return { ok: true };
  }

  async function prepare(signal) {
    const probed = await Promise.all([probe(urls[0], signal), probe(urls[1], signal)]);
    if (probed.some((row) => row.mismatch)) throw coded('anchor_chain_mismatch');
    const up = probed.filter((row) => row.ok === true);
    if (up.length === 0) throw coded('anchor_rpc_unavailable');
    const ready = [];
    for (let i = 0; i < up.length; i += 1) {
      const checked = await pin(up[i].url, signal);
      if (checked.mismatch) throw coded('v13_pin_refused');
      if (checked.ok === true) ready.push(up[i].url);
    }
    if (ready.length === 0) throw coded('anchor_rpc_unavailable');
    return ready;
  }

  async function firstReady(signal, read) {
    const ready = await prepare(signal);
    let last = coded('anchor_rpc_unavailable');
    for (let i = 0; i < ready.length; i += 1) {
      try {
        return await read(ready[i]);
      } catch (err) {
        last = err && err.code ? err : coded('anchor_rpc_unavailable');
        if (!err || err.transport !== true) throw last;
      }
    }
    throw last;
  }

  return {
    async prepare(signal) {
      return prepare(signal);
    },
    async quote(signal) {
      return firstReady(signal, async (url) => {
        const block = await rpcCall(fetchImpl, url, 'eth_getBlockByNumber', ['latest', false], signal, timeoutMs);
        const tip = await rpcCall(fetchImpl, url, 'eth_maxPriorityFeePerGas', [], signal, timeoutMs);
        if (!block || block.baseFeePerGas == null || tip == null) throw coded('anchor_rpc_unavailable');
        return quoteAnchorFees(block.baseFeePerGas, tip);
      });
    },
    async sendRaw(wire, signal) {
      assertAnchorWire(wire);
      const hash = await firstReady(signal, async (url) => {
        const sent = await rpcCall(fetchImpl, url, 'eth_sendRawTransaction', [wire], signal, timeoutMs);
        if (typeof sent !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sent)) {
          throw coded('broadcast_failed');
        }
        return sent;
      });
      return hash;
    },
    async receipt(txHash, signal) {
      if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
      return firstReady(signal, async (url) => (
        rpcCall(fetchImpl, url, 'eth_getTransactionReceipt', [txHash], signal, timeoutMs)
      ));
    },
    async finalizedAnchored(signal) {
      return firstReady(signal, async (url) => {
        const chainId = await rpcCall(fetchImpl, url, 'eth_chainId', [], signal, timeoutMs);
        if (!observedChainOk(chainId)) throw coded('anchor_chain_mismatch');
        const finalized = await rpcCall(fetchImpl, url, 'eth_getBlockByNumber', ['finalized', false], signal, timeoutMs);
        const finalizedNumber = finalized && finalized.number != null ? finalized.number : null;
        if (finalizedNumber == null) return [];
        const logs = await rpcCall(fetchImpl, url, 'eth_getLogs', [{
          address: MAINNET_ANCHOR,
          fromBlock: '0x0',
          toBlock: 'latest',
          topics: [ANCHORED_TOPIC],
        }], signal, timeoutMs);
        const senders = new Map();
        const list = Array.isArray(logs) ? logs : [];
        for (let i = 0; i < list.length; i += 1) {
          const hash = list[i] && list[i].transactionHash;
          if (typeof hash !== 'string' || senders.has(hash)) continue;
          const tx = await rpcCall(fetchImpl, url, 'eth_getTransactionByHash', [hash], signal, timeoutMs);
          senders.set(hash, tx && typeof tx.from === 'string' ? tx.from : '');
        }
        return selectFinalizedAnchored({
          logs: list,
          finalizedNumber,
          txFromOf: (log) => senders.get(log.transactionHash) || '',
        });
      });
    },
  };
}

export { ANCHORED_TOPIC, BASE_CHAIN_HEX };
