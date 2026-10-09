/**
 * Strict Solana address and signature checks. Pure: no env, no network, no provider.
 * Base58 matches services/gateway/src/payment-ref.js (BigInt, no dependency).
 */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_PROGRAM_V1_ID = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/** Full getGenesisHash values. CAIP-2 uses a shorter mainnet reference. */
export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const SOLANA_MAINNET_CAIP = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SOLANA_DEVNET_CAIP_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export const SOLANA_CHAIN_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

/**
 * Chit Solana USDC token account. The coverage canary reads the signature
 * immediately before the newest 2026-09-26 payment, so a later payment does
 * not move the cursor.
 */
export const SOLANA_CANARY_ACCOUNT = '2hCQcVmHfaMwtYbfWkuWGhvfVoUGRopkVgZ5Cpgi7ZNC';
export const SOLANA_CANARY_BEFORE = '2WaXaTT2LkpMAuryrGqPYsK48V8RDcbnt1ksGMsfwj8Pxpx2G1Z52PEZgjTHZK4YZDdTcv36P2o9toSVVke4iWBy';
export const SOLANA_CANARY_SIGNATURE = '4KZ9iXA43AnV4yqfDNuST3z2HcSjpDEuKZ1sjhUd6kmn3WWN1wUTEAXGaQeYSd8ZPiZ43rXoVGZAjvZGif42t5P';
export const SOLANA_CANARY_PAYEE = 'ALLdmmAsbUnhHS7x2556449syP5Wz73Gng4gzzLHqsC7';
export const SOLANA_CANARY_AMOUNT = '2000';

/** Live 2026-09-26 payer used by the offline smoke fixture. Not a public sample button. */
export const SOLANA_FIXTURE_PAYER = '2Xjg1hXgty9Yd1LDU2iCd5hGV4kuD8PdBvfhECQtdmh2';

export const DENY_SOLANA_ACCOUNTS = Object.freeze([
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  MEMO_PROGRAM_V1_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SOLANA_USDC_MINT,
  DEVNET_USDC_MINT,
]);

const DENY_SET = new Set(DENY_SOLANA_ACCOUNTS);

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
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[zeros + i] = bytes[i];
  return out;
}

export function encodeBase58(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
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
  return '1'.repeat(zeros) + out;
}

function trimAsciiEnds(raw) {
  return String(raw ?? '').replace(/^[ \t\r\n\f\v]+/, '').replace(/[ \t\r\n\f\v]+$/, '');
}

function hasForbiddenChar(s) {
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code > 0x7f) return true;
    if (code === 0x7f) return true;
  }
  if (/[\u200B\u200C\u200D\uFEFF\u2060\u202A-\u202E\u2066-\u2069]/.test(s)) return true;
  return false;
}

function hasInteriorWhitespace(s) {
  return /[ \t\r\n\f\v]/.test(s);
}

/**
 * Decode and require the canonical base58 form of exactly `width` bytes.
 * @returns {string | null}
 */
export function canonicalBase58(str, width) {
  if (typeof str !== 'string' || str.length < 32 || str.length > 88) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(str)) return null;
  const raw = decodeBase58(str);
  if (!raw || raw.length !== width) return null;
  const again = encodeBase58(raw);
  if (again !== str) return null;
  return str;
}

/**
 * @param {string} raw
 * @returns {{ ok: true, address: string } | { ok: false, reason: 'invalid' | 'signature' | 'devnet' | 'not_wallet' }}
 */
export function parseSolanaAddress(raw) {
  const original = String(raw ?? '');
  const trimmed = trimAsciiEnds(original);
  if (!trimmed || hasForbiddenChar(original) || hasForbiddenChar(trimmed)) {
    return { ok: false, reason: 'invalid' };
  }
  if (trimmed !== original.trim() && hasInteriorWhitespace(original)) {
    return { ok: false, reason: 'invalid' };
  }
  if (hasInteriorWhitespace(trimmed)) return { ok: false, reason: 'invalid' };

  let body = trimmed;
  if (body.startsWith('solana:')) {
    const rest = body.slice('solana:'.length);
    if (
      rest === SOLANA_DEVNET_GENESIS
      || rest.startsWith(`${SOLANA_DEVNET_GENESIS}:`)
      || rest === SOLANA_DEVNET_CAIP_GENESIS
      || rest.startsWith(`${SOLANA_DEVNET_CAIP_GENESIS}:`)
    ) {
      return { ok: false, reason: 'devnet' };
    }
    const mainnetPrefix = `${SOLANA_MAINNET_CAIP.slice('solana:'.length)}:`;
    if (rest.startsWith(mainnetPrefix)) body = rest.slice(mainnetPrefix.length);
    else if (rest.startsWith(`${SOLANA_MAINNET_GENESIS}:`)) body = rest.slice(SOLANA_MAINNET_GENESIS.length + 1);
    else if (!rest.includes(':')) body = rest;
    else return { ok: false, reason: 'invalid' };
  }

  if (hasInteriorWhitespace(body) || hasForbiddenChar(body)) return { ok: false, reason: 'invalid' };

  const asSig = canonicalBase58(body, 64);
  if (asSig) return { ok: false, reason: 'signature' };

  if (body.length < 32 || body.length > 44) return { ok: false, reason: 'invalid' };
  const address = canonicalBase58(body, 32);
  if (!address) return { ok: false, reason: 'invalid' };
  if (DENY_SET.has(address)) return { ok: false, reason: 'not_wallet' };
  return { ok: true, address };
}

/**
 * @param {string} raw
 * @returns {{ ok: true, signature: string } | { ok: false }}
 */
export function parseSolanaSignature(raw) {
  if (typeof raw !== 'string') return { ok: false };
  if (raw !== trimAsciiEnds(raw) || hasInteriorWhitespace(raw) || hasForbiddenChar(raw)) {
    return { ok: false };
  }
  const signature = canonicalBase58(raw, 64);
  if (!signature) return { ok: false };
  return { ok: true, signature };
}

export const RECEIPT_ID_RE = /^(xfuel|chit|foreign-x402)-[A-Za-z0-9-]{8,80}$/;

export function receiptPageHref(receiptId) {
  if (typeof receiptId !== 'string' || !RECEIPT_ID_RE.test(receiptId)) return null;
  return `https://api.chit402.com/receipt/${encodeURIComponent(receiptId)}`;
}

export function baseExplorerHref(txHash) {
  const tx = String(txHash || '').toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(tx)) return null;
  return `https://basescan.org/tx/${tx}`;
}

export function solanaExplorerHref(signature) {
  const parsed = parseSolanaSignature(signature);
  if (!parsed.ok) return null;
  return `https://solscan.io/tx/${parsed.signature}`;
}

export function safeHttpsHref(url) {
  if (typeof url !== 'string') return null;
  if (!/^https:\/\/(api\.chit402\.com\/receipt\/|solscan\.io\/tx\/|basescan\.org\/tx\/)/.test(url)) {
    return null;
  }
  if (url.includes('?') || url.includes('#') || url.includes('\\')) return null;
  return url;
}
