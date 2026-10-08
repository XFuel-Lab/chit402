/**
 * Payment-ref index keys. Stored rows and signed receipts keep the caller's
 * original string; only dedupe and replay indexes use the key from here.
 */
import { fromCaip2Network, isSolanaNetwork } from './x402-facilitator.js';

const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function isEvmTxHash(tx) {
  return typeof tx === 'string' && EVM_TX.test(tx.trim());
}

export function decodeBase58(str) {
  if (typeof str !== 'string' || str.length === 0) return null;
  let n = 0n;
  for (const ch of str) {
    const v = B58_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  bytes.reverse();
  let zeros = 0;
  for (const ch of str) {
    if (ch !== '1') break;
    zeros += 1;
  }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(bytes)]);
}

export function encodeBase58(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) {
    const rem = n % 58n;
    n /= 58n;
    out = B58_ALPHABET[Number(rem)] + out;
  }
  return '1'.repeat(zeros) + (out || (zeros ? '' : ''));
}

/** Solana signatures are 64 bytes, base58, compared exactly (no case fold). */
export function isSolanaSignature(sig) {
  if (typeof sig !== 'string') return false;
  if (sig.length < 64 || sig.length > 88) return false;
  if (sig !== sig.trim()) return false;
  const raw = decodeBase58(sig);
  return !!raw && raw.length === 64;
}

export function canonicalNetwork(network) {
  const short = fromCaip2Network(String(network || ''));
  if (short === 'base' || short === 'eip155:8453') return 'base';
  if (short === 'base-sepolia' || short === 'eip155:84532') return 'base-sepolia';
  if (isSolanaNetwork(short)) return fromCaip2Network(short);
  return String(network || '').trim();
}

export function sameNetwork(a, b) {
  if (!a || !b) return false;
  return canonicalNetwork(a) === canonicalNetwork(b);
}

/**
 * @returns {{ ok: true, key: string, network: string, tx: string, solana: boolean } | { ok: false, code: 'invalid_payment_ref' }}
 */
export function normalizePaymentRef(network, tx) {
  const net = canonicalNetwork(network);
  const raw = tx == null ? '' : String(tx);
  if (isSolanaNetwork(net) || isSolanaNetwork(network)) {
    if (!isSolanaSignature(raw)) return { ok: false, code: 'invalid_payment_ref' };
    const chain = canonicalNetwork(network || net);
    return { ok: true, key: `${chain}:${raw}`, network: chain, tx: raw, solana: true };
  }
  const hash = raw.startsWith('0x') || raw.startsWith('0X') ? raw : `0x${raw}`;
  if (!isEvmTxHash(hash)) return { ok: false, code: 'invalid_payment_ref' };
  const chain = net === 'base-sepolia' ? 'base-sepolia' : (net || 'base');
  const lowered = `0x${hash.slice(2).toLowerCase()}`;
  return { ok: true, key: `${chain}:${lowered}`, network: chain, tx: lowered, solana: false };
}

/**
 * Index key for a stored `payment_ref` (`base:0x…`, `eip155:8453:0x…`, `solana:…`).
 * Returns null when the ref is not a normalizable payment (legacy short fixtures).
 * @param {string} ref
 * @returns {string|null}
 */
export function paymentRefIndexKey(ref) {
  if (ref == null) return null;
  const s = String(ref);
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  // CAIP eip155:8453:0x… has two colons. The tx is the 0x word.
  const txMatch = s.match(/0x[0-9a-fA-F]{64}/);
  if (txMatch) {
    const prefix = s.slice(0, s.toLowerCase().indexOf(txMatch[0].toLowerCase())).replace(/:$/, '');
    const norm = normalizePaymentRef(prefix || 'base', txMatch[0]);
    return norm.ok ? norm.key : null;
  }
  const last = s.lastIndexOf(':');
  const prefix = s.slice(0, last);
  const tx = s.slice(last + 1);
  if (isSolanaNetwork(prefix) || isSolanaNetwork(prefix.split(':')[0])) {
    const norm = normalizePaymentRef(prefix, tx);
    return norm.ok ? norm.key : null;
  }
  return null;
}
