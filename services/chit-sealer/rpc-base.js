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
import { eip1559Decode, eip1559TxHash } from '../../packages/cs2-core/ecdsa/eip1559.js';
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
const LATEST_SELECTOR = bytesToHex(keccak256(new TextEncoder().encode('latest()')).subarray(0, 4));
const ANCHORED_TOPIC = `0x${bytesToHex(keccak256(new TextEncoder().encode('Anchored(uint64,uint64,uint64,bytes32,bytes32,uint8)')))}`;

export const DOMAIN_CALL = `0x${DOMAIN_SELECTOR}`;
export const LATEST_CALL = `0x${LATEST_SELECTOR}`;

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

/**
 * Allow-listed class of a node error string. The raw text is not returned.
 * @param {unknown} message
 */
export function classifyNodeError(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('nonce too low')) return 'nonce_low';
  if (text.includes('already known')) return 'known';
  if (
    text.includes('replacement transaction underpriced')
    || text.includes('transaction underpriced')
    || text.includes('underpriced')
  ) return 'underpriced';
  if (
    text.includes('insufficient funds')
    || text.includes('intrinsic gas')
    || text.includes('exceeds block gas')
    || text.includes('invalid sender')
    || text.includes('execution reverted')
    || text.includes('nonce has already been used')
    || text.includes('dropped')
  ) return 'permanent';
  return 'rejected';
}

/** ABI words for ChitAnchor.latest(). Tests and the boot probe share this. */
export function encodeLatestHead(epoch, hourStart) {
  const word = (value) => BigInt(value).toString(16).padStart(64, '0');
  return `0x${word(epoch)}${word(hourStart)}${word(0)}${'0'.repeat(64)}${'0'.repeat(64)}`;
}

/**
 * One block, one contract, one topic. Never from genesis to latest.
 * @param {unknown} blockNumber
 */
export function anchorLogFilter(blockNumber) {
  const block = hexQuantity(blockNumber);
  if (block == null) throw coded('anchor_rpc_unavailable');
  const hex = `0x${block.toString(16)}`;
  return {
    address: MAINNET_ANCHOR,
    fromBlock: hex,
    toBlock: hex,
    topics: [ANCHORED_TOPIC],
  };
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

function codeWellFormed(code) {
  if (typeof code !== 'string') return false;
  const hex = code.toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]*$/.test(hex) && hex.length % 2 === 0;
}

function domainWellFormed(word) {
  if (typeof word !== 'string') return false;
  const hex = word.toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(hex);
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
  } catch {
    const wrapped = coded('anchor_rpc_unavailable');
    wrapped.transport = true;
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
    const raw = body && body.error && typeof body.error.message === 'string' ? body.error.message : '';
    err.kind = classifyNodeError(raw);
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

  let sawUnreachable = false;

  async function probe(url, signal) {
    let chainId;
    try {
      chainId = await rpcCall(fetchImpl, url, 'eth_chainId', [], signal, timeoutMs);
    } catch {
      return { url, transport: true };
    }
    // A JSON-RPC error, a timeout, or a value that is not a chain id is
    // unreachable. Only a parsed chain id other than 8453 is a mismatch.
    // Decimal "8453" and "zz" are junk, not a chain id. Only 0x quantities are well-formed.
    if (typeof chainId !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chainId.trim())) return { url, transport: true };
    if (!observedChainOk(chainId)) return { url, mismatch: 'anchor_chain_mismatch' };
    return { url, ok: true };
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
        [{ to: MAINNET_ANCHOR, data: DOMAIN_CALL }, 'latest'],
        signal,
        timeoutMs,
      );
    } catch {
      return { transport: true };
    }
    if (!codeWellFormed(code) || !domainWellFormed(domain)) return { transport: true };
    if (!codeHasBody(code) || !domainMatches(domain)) return { mismatch: 'v13_pin_refused' };
    return { ok: true };
  }

  async function prepare(signal) {
    sawUnreachable = false;
    const probed = await Promise.all([probe(urls[0], signal), probe(urls[1], signal)]);
    if (probed.some((row) => row.mismatch)) throw coded('anchor_chain_mismatch');
    if (probed.some((row) => row.transport)) sawUnreachable = true;
    const up = probed.filter((row) => row.ok === true);
    if (up.length === 0) throw coded('anchor_rpc_unavailable');
    const ready = [];
    for (let i = 0; i < up.length; i += 1) {
      const checked = await pin(up[i].url, signal);
      if (checked.mismatch) throw coded('v13_pin_refused');
      if (checked.transport) sawUnreachable = true;
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
    bootUnreachable() {
      return sawUnreachable;
    },
    async prepare(signal) {
      return prepare(signal);
    },
    async accountNonce(signal) {
      const ready = await prepare(signal);
      if (ready.length < 2) throw coded('anchor_quorum');
      const values = [];
      for (let i = 0; i < ready.length; i += 1) {
        const raw = await rpcCall(
          fetchImpl,
          ready[i],
          'eth_getTransactionCount',
          [MAINNET_CHECKPOINT, 'latest'],
          signal,
          timeoutMs,
        );
        if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw.trim())) throw coded('anchor_rpc_unavailable');
        const parsed = hexQuantity(raw);
        if (parsed == null) throw coded('anchor_rpc_unavailable');
        values.push(parsed);
      }
      if (values[0] !== values[1]) throw coded('anchor_quorum');
      return values[0];
    },
    async hashesAbsent(hashes, signal) {
      const ready = await prepare(signal);
      if (ready.length < 2) return false;
      const list = Array.isArray(hashes) ? hashes : [];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = 0; j < ready.length; j += 1) {
          let seen = '';
          try {
            seen = await findTx(fetchImpl, ready[j], list[i], signal, timeoutMs);
          } catch {
            return false;
          }
          if (seen) return false;
        }
      }
      return true;
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
        try {
          const sent = await rpcCall(fetchImpl, url, 'eth_sendRawTransaction', [wire], signal, timeoutMs);
          if (typeof sent !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sent)) {
            throw coded('broadcast_failed');
          }
          return sent;
        } catch (err) {
          if (err && err.kind === 'known') return `0x${bytesToHex(eip1559TxHash(wire))}`;
          if (err && err.kind === 'nonce_low') {
            const ours = `0x${bytesToHex(eip1559TxHash(wire))}`;
            const seen = await findTx(fetchImpl, url, ours, signal, timeoutMs);
            if (seen) return ours;
            throw coded('anchor_nonce_conflict');
          }
          throw err;
        }
      });
      return hash;
    },
    async receipt(txHash, signal) {
      if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
      return firstReady(signal, async (url) => (
        rpcCall(fetchImpl, url, 'eth_getTransactionReceipt', [txHash], signal, timeoutMs)
      ));
    },
    async chainHead(signal) {
      const ready = await prepare(signal);
      const heads = [];
      for (let i = 0; i < ready.length; i += 1) {
        try {
          const data = await rpcCall(
            fetchImpl,
            ready[i],
            'eth_call',
            [{ to: MAINNET_ANCHOR, data: LATEST_CALL }, 'latest'],
            signal,
            timeoutMs,
          );
          const head = decodeLatest(data);
          if (!head) throw coded('anchor_head_mismatch');
          heads.push(head);
        } catch (err) {
          if (err && err.code === 'anchor_head_mismatch') throw err;
          if (!err || err.transport !== true) throw coded('anchor_head_mismatch');
        }
      }
      if (heads.length === 0) throw coded('anchor_rpc_unavailable');
      if (heads.length >= 2 && (heads[0].epoch !== heads[1].epoch || heads[0].hourStart !== heads[1].hourStart)) {
        throw coded('anchor_quorum');
      }
      return heads[0];
    },
    async simulateAnchor(tx, signal) {
      let data = '';
      if (tx && tx.data instanceof Uint8Array) data = `0x${bytesToHex(tx.data)}`;
      else if (typeof tx?.data === 'string') data = tx.data.startsWith('0x') ? tx.data : `0x${tx.data}`;
      const gas = tx && tx.gasLimit != null ? `0x${BigInt(tx.gasLimit).toString(16)}` : '0x493e0';
      const ready = await prepare(signal);
      let saw = false;
      for (let i = 0; i < ready.length; i += 1) {
        try {
          await rpcCall(fetchImpl, ready[i], 'eth_call', [{
            from: MAINNET_CHECKPOINT,
            to: MAINNET_ANCHOR,
            data,
            gas,
          }, 'latest'], signal, timeoutMs);
          saw = true;
        } catch (err) {
          if (err && err.transport === true) continue;
          throw coded('anchor_simulation_failed');
        }
      }
      if (!saw) throw coded('anchor_rpc_unavailable');
    },
    async findTx(txHash, signal) {
      if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return '';
      const ready = await prepare(signal);
      for (let i = 0; i < ready.length; i += 1) {
        try {
          const seen = await findTx(fetchImpl, ready[i], txHash, signal, timeoutMs);
          if (seen) return txHash;
        } catch (err) {
          if (!err || err.transport !== true) throw err;
        }
      }
      return '';
    },
    async observeTx(txHash, signal, depth = 64) {
      if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { pending: true };
      const ready = await prepare(signal);
      const rows = [];
      for (let i = 0; i < ready.length; i += 1) {
        try {
          rows.push(await readObservation(fetchImpl, ready[i], txHash, signal, timeoutMs));
        } catch (err) {
          if (!err || err.transport !== true) throw err;
        }
      }
      if (rows.length === 0) throw coded('anchor_rpc_unavailable');
      if (ready.length >= 2 && rows.length >= 2) {
        if (!sameObservation(rows[0], rows[1])) throw coded('anchor_quorum');
        return rows[0];
      }
      return deepen(rows[0], depth);
    },
  };
}

function decodeLatest(word) {
  const epoch = hexQuantity(`0x${wordHex(word, 0)}`);
  const hourStart = hexQuantity(`0x${wordHex(word, 1)}`);
  if (epoch == null || hourStart == null) return null;
  if (!Number.isSafeInteger(Number(epoch)) || !Number.isSafeInteger(Number(hourStart))) return null;
  return { epoch: Number(epoch), hourStart: Number(hourStart) };
}

function sameObservation(left, right) {
  if (!left || !right) return false;
  if (left.reverted === true || right.reverted === true) {
    return left.reverted === true && right.reverted === true && left.blockNumber === right.blockNumber;
  }
  if (left.pending === true || right.pending === true) return left.pending === true && right.pending === true;
  return left.blockNumber === right.blockNumber
    && left.status === right.status
    && left.from === right.from
    && left.finalized === right.finalized
    && left.epoch === right.epoch
    && left.hourStart === right.hourStart
    && left.root === right.root
    && left.stateRoot === right.stateRoot;
}

async function readObservation(fetchImpl, url, txHash, signal, timeoutMs) {
  const receipt = await rpcCall(fetchImpl, url, 'eth_getTransactionReceipt', [txHash], signal, timeoutMs);
  if (!receipt) return { pending: true };
  const status = hexQuantity(receipt.status);
  const blockNumber = hexQuantity(receipt.blockNumber);
  if (status == null || blockNumber == null) throw coded('anchor_rpc_unavailable');
  if (status === 0n) return { reverted: true, status, blockNumber };
  const tx = await rpcCall(fetchImpl, url, 'eth_getTransactionByHash', [txHash], signal, timeoutMs);
  const from = tx && typeof tx.from === 'string' ? tx.from : '';
  const finalized = await rpcCall(fetchImpl, url, 'eth_getBlockByNumber', ['finalized', false], signal, timeoutMs);
  const finalizedNumber = finalized && finalized.number != null ? finalized.number : null;
  let logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  try {
    const queried = await rpcCall(fetchImpl, url, 'eth_getLogs', [anchorLogFilter(blockNumber)], signal, timeoutMs);
    if (logs.length === 0 && Array.isArray(queried) && queried.length > 0) logs = queried;
  } catch (err) {
    if (!err || err.transport !== true) throw err;
  }
  const admitted = selectFinalizedAnchored({
    logs,
    finalizedNumber: blockNumber,
    txFromOf: () => from,
  });
  const fin = hexQuantity(finalizedNumber);
  const isFinal = fin != null && blockNumber <= fin && admitted.length > 0;
  if (admitted.length === 0) {
    return {
      pending: false,
      finalized: false,
      status,
      blockNumber,
      from: addressHex(from),
    };
  }
  return {
    ...admitted[0],
    status,
    blockNumber,
    finalizedBlock: fin,
    from: addressHex(from),
    finalized: isFinal,
  };
}

function deepen(row, depth) {
  if (!row || row.pending === true || row.reverted === true || row.finalized !== true) return row;
  const gap = row.finalizedBlock != null && row.blockNumber != null
    ? row.finalizedBlock - row.blockNumber
    : -1n;
  const need = BigInt(Number.isSafeInteger(depth) && depth >= 0 ? depth : 64);
  if (gap >= need) return row;
  return { ...row, finalized: false };
}

async function findTx(fetchImpl, url, txHash, signal, timeoutMs) {
  const tx = await rpcCall(fetchImpl, url, 'eth_getTransactionByHash', [txHash], signal, timeoutMs);
  if (tx && typeof tx === 'object') return txHash;
  const receipt = await rpcCall(fetchImpl, url, 'eth_getTransactionReceipt', [txHash], signal, timeoutMs);
  if (receipt && typeof receipt === 'object') return txHash;
  return '';
}

export { ANCHORED_TOPIC, BASE_CHAIN_HEX };
