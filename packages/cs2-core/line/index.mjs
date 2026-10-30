/**
 * Chit Simple v13 line codec (SIMPLE §S1, §S5).
 *
 * A line is 1,024 bytes: a 2-byte header, a 271-byte payment half, a 465-byte
 * content half, a 65-byte σ block, and 221 zero pad bytes. P, K and C are
 * SHA-256 commitments. C binds the header and H(alg ‖ σ). The σ message binds
 * alg too. The canonical payment id is (chainId, blockHash, txIndex,
 * localLogIndex). blockHash is required and must be non-zero. The Y dedup key
 * is (chainId, txHash, localLogIndex) and does not include blockHash.
 * localLogIndex is the Transfer's index inside the transaction receipt, not
 * an RPC block log index. Slot keys and the state leaf, node, and empty hash
 * domains follow the published byte layout.
 *
 * Bad input returns { ok: false, reason } and does not throw. Reasons are the
 * fixed strings in REASONS. A reason never contains input bytes. This module
 * does not verify signatures, read a chain, or touch the live gateway.
 *
 * SHA-256 is node:crypto, the same choice as the v13 Merkle module. The
 * empty-hash depth cap is an implementation limit, not a wire field.
 */

import { createHash } from 'node:crypto';

export const SCHEMA = 'chit402.cs2.line.v1';

export const LINE_BYTES = 1024;
export const HEADER_BYTES = 2;
export const PAYMENT_BYTES = 271;
export const CONTENT_BYTES = 465;
export const SIGMA_BYTES = 65;
export const SALT_BYTES = 32;
export const USED_BYTES = HEADER_BYTES + PAYMENT_BYTES + CONTENT_BYTES + SIGMA_BYTES;
export const PAD_BYTES = LINE_BYTES - USED_BYTES;

/**
 * Pinned reading of §S1 "Header (2 B): cs2, line type."
 * The two bytes are ASCII "c2". The commitment domain "cs2" is three bytes
 * and is not the header.
 */
export const HEADER_BYTE_0 = 0x63;
export const HEADER_BYTE_1 = 0x32;

export const KIND_PAYTO = 0x01;
export const KIND_WALLET = 0x02;
export const KIND_BOOK = 0x03;
export const KIND_EPOCH = 0x04;

/** Implementation limit for emptyHash. Not a wire field. */
export const MAX_EMPTY_DEPTH = 64;

const DOMAIN_PAY = 'pay';
const DOMAIN_CNT = 'cnt';
const DOMAIN_LINE = 'cs2';
const DOMAIN_SIG = 'cs2-sig';
const DOMAIN_STATE = 'chit402-state-v1';
const DOMAIN_EMPTY = 'empty';

const STATE_LEAF_PREFIX = 0x00;
const STATE_NODE_PREFIX = 0x01;
const STATE_EMPTY_PREFIX = 0x02;

/** NIST P-256 order. Seller keys are compressed P-256, so σ is low-S on this n. */
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_N = P256_N >> 1n;

/** The only σ algorithm. 1 is the P-256 low-S slot-entry alg. */
export const ALGS = Object.freeze(new Set([1]));

const ID_LENGTH_BY_KIND = new Map([
  [KIND_PAYTO, 20],
  [KIND_WALLET, 20],
  [KIND_BOOK, 32],
  [KIND_EPOCH, 0],
]);

/** Ordered §S1 fields: name, width. Offsets are the running sum. */
export const PAYMENT_FIELDS = Object.freeze([
  ['chainId', 8],
  ['blockHash', 32],
  ['blockNumber', 8],
  ['blockTime', 8],
  ['txIndex', 4],
  ['localLogIndex', 2],
  ['txHash', 32],
  ['token', 20],
  ['from', 20],
  ['to', 20],
  ['value', 32],
  ['method', 1],
  ['authorizer', 20],
  ['nonce', 32],
  ['saltP', 32],
]);

export const CONTENT_FIELDS = Object.freeze([
  ['uuid', 16],
  ['sellerIdHash', 32],
  ['sellerKeyId', 32],
  ['requestMethod', 1],
  ['uriDigest', 32],
  ['uriPrefix', 256],
  ['contentDigest', 32],
  ['responseDigest', 32],
  ['saltC', 32],
]);

export const SIGMA_FIELDS = Object.freeze([
  ['alg', 1],
  ['sigma', 64],
]);

const UINT_BITS = Object.freeze({
  chainId: 64,
  blockNumber: 64,
  blockTime: 64,
  txIndex: 32,
  localLogIndex: 16,
  value: 256,
  method: 8,
  requestMethod: 8,
  alg: 8,
});

export const REASONS = Object.freeze([
  'bad_type',
  'bad_length',
  'bad_header',
  'bad_hex',
  'bad_uint',
  'bad_range',
  'missing_block_hash',
  'bad_padding',
  'bad_kind',
  'bad_id_length',
  'bad_depth',
  'bad_salt',
  'bad_sigma',
  'bad_alg',
  'bad_uri',
  'unknown_field',
  'nonce_none',
]);

const REASON_SET = new Set(REASONS);

function fail(reason) {
  if (!REASON_SET.has(reason)) {
    throw new Error('unknown reason');
  }
  return { ok: false, reason };
}

function offsetsOf(fields) {
  const out = [];
  let at = 0;
  for (const [name, size] of fields) {
    out.push([name, at, size]);
    at += size;
  }
  return out;
}

export function paymentOffsets() {
  return offsetsOf(PAYMENT_FIELDS);
}

export function contentOffsets() {
  return offsetsOf(CONTENT_FIELDS);
}

export function sigmaOffsets() {
  return offsetsOf(SIGMA_FIELDS);
}

export const LAYOUT = Object.freeze({
  lineBytes: LINE_BYTES,
  header: 0,
  headerBytes: HEADER_BYTES,
  payment: HEADER_BYTES,
  paymentBytes: PAYMENT_BYTES,
  content: HEADER_BYTES + PAYMENT_BYTES,
  contentBytes: CONTENT_BYTES,
  sigma: HEADER_BYTES + PAYMENT_BYTES + CONTENT_BYTES,
  sigmaBytes: SIGMA_BYTES,
  pad: USED_BYTES,
  padBytes: PAD_BYTES,
});

function ascii(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error('domain string must be ASCII');
    }
    out[i] = code;
  }
  return out;
}

function sha256(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

export function toHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function writeBe(target, offset, value, width) {
  let x = value;
  for (let i = width - 1; i >= 0; i -= 1) {
    target[offset + i] = Number(x & 0xffn);
    x >>= 8n;
  }
}

function readBe(bytes, offset, width) {
  let x = 0n;
  for (let i = 0; i < width; i += 1) {
    x = (x << 8n) | BigInt(bytes[offset + i]);
  }
  return x;
}

function readFixed(value, width) {
  if (value instanceof Uint8Array) {
    if (value.length !== width) return fail('bad_length');
    return { ok: true, bytes: value.slice() };
  }
  if (typeof value !== 'string') return fail('bad_type');
  const hexBody = value;
  if (hexBody.length % 2 !== 0) return fail('bad_hex');
  if (!/^[0-9a-f]+$/.test(hexBody)) return fail('bad_hex');
  if (hexBody.length !== width * 2) return fail('bad_length');
  const out = new Uint8Array(width);
  for (let i = 0; i < width; i += 1) {
    out[i] = Number.parseInt(hexBody.slice(i * 2, i * 2 + 2), 16);
  }
  return { ok: true, bytes: out };
}

function isZero(bytes) {
  let acc = 0;
  for (let i = 0; i < bytes.length; i += 1) acc |= bytes[i];
  return acc === 0;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function knownOnly(input, names) {
  const allowed = new Set(names);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) return fail('unknown_field');
  }
  return { ok: true };
}

function fieldSlice(buf, base, fields, name) {
  let at = base;
  for (const [field, size] of fields) {
    if (field === name) return buf.slice(at, at + size);
    at += size;
  }
  return null;
}

function readBlockHash(value) {
  if (value === undefined || value === null || value === '') return fail('missing_block_hash');
  const parsed = readFixed(value, 32);
  if (!parsed.ok) return parsed;
  if (isZero(parsed.bytes)) return fail('missing_block_hash');
  return parsed;
}

function readUint(value, bits) {
  const max = (1n << BigInt(bits)) - 1n;
  if (typeof value === 'bigint') {
    if (value < 0n || value > max) return fail('bad_range');
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return fail('bad_range');
    if (!Number.isSafeInteger(value)) return fail('bad_uint');
    if (value < 0 || BigInt(value) > max) return fail('bad_range');
    return { ok: true, value: BigInt(value) };
  }
  if (value instanceof Uint8Array) {
    const width = bits >> 3;
    if (value.length !== width) return fail('bad_length');
    return { ok: true, value: readBe(value, 0, width) };
  }
  if (typeof value === 'string') {
    if (value.length === 0 || value.length > 78) return fail('bad_uint');
    if (!/^(0|[1-9][0-9]*)$/.test(value)) return fail('bad_uint');
    const parsed = BigInt(value);
    if (parsed > max) return fail('bad_range');
    return { ok: true, value: parsed };
  }
  return fail('bad_type');
}

function uriPrefixOk(bytes) {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  for (let i = end; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) return false;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
    return !text.includes('\u0000');
  } catch {
    return false;
  }
}

function readUriPrefix(value) {
  let bytes;
  if (value instanceof Uint8Array) {
    if (value.length > 256) return fail('bad_length');
    const out = new Uint8Array(256);
    out.set(value, 0);
    bytes = out;
  } else if (typeof value === 'string') {
    if (value.includes('\0')) return fail('bad_uri');
    if (value.length === 512 && /^[0-9a-fA-F]{512}$/.test(value)) {
      if (!/^[0-9a-f]{512}$/.test(value)) return fail('bad_hex');
      const parsed = readFixed(value, 256);
      if (!parsed.ok) return parsed;
      bytes = parsed.bytes;
    } else {
      const utf8 = new TextEncoder().encode(value);
      if (utf8.length > 256) return fail('bad_length');
      const out = new Uint8Array(256);
      out.set(utf8, 0);
      bytes = out;
    }
  } else {
    return fail('bad_type');
  }
  if (!uriPrefixOk(bytes)) return fail('bad_uri');
  return { ok: true, bytes };
}

function requireAlg(alg) {
  if (!ALGS.has(alg)) return fail('bad_alg');
  return { ok: true };
}

function checkSigma(sigma64) {
  if (sigma64.length !== 64) return fail('bad_length');
  const r = readBe(sigma64, 0, 32);
  const s = readBe(sigma64, 32, 32);
  if (r < 1n || r >= P256_N) return fail('bad_sigma');
  if (s < 1n || s > P256_HALF_N) return fail('bad_sigma');
  return { ok: true };
}

function checkSalts(saltP, saltC) {
  if (isZero(saltP) || isZero(saltC) || bytesEqual(saltP, saltC)) return fail('bad_salt');
  return { ok: true };
}

function readField(name, value, size) {
  if (name === 'blockHash') return readBlockHash(value);
  if (name === 'uriPrefix') return readUriPrefix(value);
  const bits = UINT_BITS[name];
  if (bits) {
    const parsed = readUint(value, bits);
    if (!parsed.ok) return parsed;
    if (name === 'alg') {
      const allowed = requireAlg(Number(parsed.value));
      if (!allowed.ok) return allowed;
    }
    const encoded = new Uint8Array(size);
    writeBe(encoded, 0, parsed.value, size);
    return { ok: true, bytes: encoded };
  }
  return readFixed(value, size);
}

function writeFields(target, base, fields, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('bad_type');
  const known = knownOnly(input, fields.map(([name]) => name));
  if (!known.ok) return known;
  let at = base;
  for (const [name, size] of fields) {
    const parsed = readField(name, input[name], size);
    if (!parsed.ok) return parsed;
    target.set(parsed.bytes, at);
    at += size;
  }
  return { ok: true };
}

function readFields(bytes, base, fields) {
  const out = {};
  let at = base;
  for (const [name, size] of fields) {
    if (UINT_BITS[name]) {
      const value = readBe(bytes, at, size);
      out[name] = size <= 4 ? Number(value) : value;
    } else {
      out[name] = bytes.slice(at, at + size);
    }
    at += size;
  }
  return out;
}

function assertSpecSizes() {
  const sum = (fields) => fields.reduce((total, [, size]) => total + size, 0);
  if (sum(PAYMENT_FIELDS) !== PAYMENT_BYTES) throw new Error('payment half must be 271 bytes');
  if (sum(CONTENT_FIELDS) !== CONTENT_BYTES) throw new Error('content half must be 465 bytes');
  if (sum(SIGMA_FIELDS) !== SIGMA_BYTES) throw new Error('sigma block must be 65 bytes');
  if (USED_BYTES !== 803 || PAD_BYTES !== 221 || LINE_BYTES !== 1024) {
    throw new Error('line must be 1024 bytes with 221 zero pad bytes');
  }
  if (ascii(DOMAIN_STATE).length !== 16) throw new Error('state tag must be 16 bytes');
}

assertSpecSizes();

/**
 * Encode a payment line. blockHash is required. The 221 pad bytes are zero.
 * @param {{ payment: object, content: object, sigma: object }} parts
 */
export function encodeLine(parts) {
  if (parts === null || typeof parts !== 'object' || Array.isArray(parts)) return fail('bad_type');
  const top = knownOnly(parts, ['payment', 'content', 'sigma']);
  if (!top.ok) return top;
  const line = new Uint8Array(LINE_BYTES);
  line[0] = HEADER_BYTE_0;
  line[1] = HEADER_BYTE_1;
  const payment = writeFields(line, LAYOUT.payment, PAYMENT_FIELDS, parts.payment);
  if (!payment.ok) return payment;
  const content = writeFields(line, LAYOUT.content, CONTENT_FIELDS, parts.content);
  if (!content.ok) return content;
  const sigma = writeFields(line, LAYOUT.sigma, SIGMA_FIELDS, parts.sigma);
  if (!sigma.ok) return sigma;
  const algOk = requireAlg(line[LAYOUT.sigma]);
  if (!algOk.ok) return algOk;
  const salts = checkSalts(
    fieldSlice(line, LAYOUT.payment, PAYMENT_FIELDS, 'saltP'),
    fieldSlice(line, LAYOUT.content, CONTENT_FIELDS, 'saltC'),
  );
  if (!salts.ok) return salts;
  const sigmaOk = checkSigma(fieldSlice(line, LAYOUT.sigma, SIGMA_FIELDS, 'sigma'));
  if (!sigmaOk.ok) return sigmaOk;
  for (let i = USED_BYTES; i < LINE_BYTES; i += 1) line[i] = 0;
  return { ok: true, line };
}

/**
 * Decode a 1,024-byte line. Non-zero padding, a zero blockHash, a zero or
 * repeated salt, a non-canonical URI prefix, and a σ outside P-256 low-S
 * are rejected.
 * @param {Uint8Array} value
 */
export function decodeLine(value) {
  if (!(value instanceof Uint8Array)) return fail('bad_type');
  if (value.length !== LINE_BYTES) return fail('bad_length');
  const line = value.slice();
  if (line[0] !== HEADER_BYTE_0 || line[1] !== HEADER_BYTE_1) return fail('bad_header');
  for (let i = USED_BYTES; i < LINE_BYTES; i += 1) {
    if (line[i] !== 0) return fail('bad_padding');
  }
  const blockHash = fieldSlice(line, LAYOUT.payment, PAYMENT_FIELDS, 'blockHash');
  if (isZero(blockHash)) return fail('missing_block_hash');
  const salts = checkSalts(
    fieldSlice(line, LAYOUT.payment, PAYMENT_FIELDS, 'saltP'),
    fieldSlice(line, LAYOUT.content, CONTENT_FIELDS, 'saltC'),
  );
  if (!salts.ok) return salts;
  const prefix = fieldSlice(line, LAYOUT.content, CONTENT_FIELDS, 'uriPrefix');
  if (!uriPrefixOk(prefix)) return fail('bad_uri');
  const algOk = requireAlg(line[LAYOUT.sigma]);
  if (!algOk.ok) return algOk;
  const sigmaOk = checkSigma(fieldSlice(line, LAYOUT.sigma, SIGMA_FIELDS, 'sigma'));
  if (!sigmaOk.ok) return sigmaOk;
  return {
    ok: true,
    payment: readFields(line, LAYOUT.payment, PAYMENT_FIELDS),
    content: readFields(line, LAYOUT.content, CONTENT_FIELDS),
    sigma: readFields(line, LAYOUT.sigma, SIGMA_FIELDS),
  };
}

function paymentIdBytes(chainId, blockHash, txIndex, localLogIndex) {
  const out = new Uint8Array(8 + 32 + 4 + 2);
  writeBe(out, 0, chainId, 8);
  out.set(blockHash, 8);
  writeBe(out, 40, txIndex, 4);
  writeBe(out, 44, localLogIndex, 2);
  return out;
}

function dedupBytes(chainId, txHash, localLogIndex) {
  const out = new Uint8Array(8 + 32 + 2);
  writeBe(out, 0, chainId, 8);
  out.set(txHash, 8);
  writeBe(out, 40, localLogIndex, 2);
  return out;
}

/**
 * Canonical payment id (chainId, blockHash, txIndex, local log index).
 * A missing or all-zero blockHash is rejected.
 * @param {object} input payment fields, or a full payment half
 */
export function canonicalPaymentId(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('bad_type');
  const blockHash = readBlockHash(input.blockHash);
  if (!blockHash.ok) return blockHash;
  const chainId = readUint(input.chainId, 64);
  if (!chainId.ok) return chainId;
  const txIndex = readUint(input.txIndex, 32);
  if (!txIndex.ok) return txIndex;
  const localLogIndex = readUint(input.localLogIndex, 16);
  if (!localLogIndex.ok) return localLogIndex;
  const bytes = paymentIdBytes(chainId.value, blockHash.bytes, txIndex.value, localLogIndex.value);
  return { ok: true, bytes, hex: toHex(bytes) };
}

/**
 * Y dedup key (chainId, txHash, localLogIndex). blockHash is not part of this key,
 * so one Transfer under two block hashes dedups once.
 * @param {object} input
 */
export function yDedupKey(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('bad_type');
  const chainId = readUint(input.chainId, 64);
  if (!chainId.ok) return chainId;
  const txHash = readFixed(input.txHash, 32);
  if (!txHash.ok) return txHash;
  const localLogIndex = readUint(input.localLogIndex, 16);
  if (!localLogIndex.ok) return localLogIndex;
  const bytes = dedupBytes(chainId.value, txHash.bytes, localLogIndex.value);
  return { ok: true, bytes, hex: toHex(bytes) };
}

function commitmentBytes(line) {
  const lineHeader = line.slice(0, HEADER_BYTES);
  const paymentHalf = line.slice(LAYOUT.payment, LAYOUT.payment + PAYMENT_BYTES);
  const saltP = paymentHalf.slice(PAYMENT_BYTES - SALT_BYTES);
  const contentHalf = line.slice(LAYOUT.content, LAYOUT.content + CONTENT_BYTES);
  const saltC = contentHalf.slice(CONTENT_BYTES - SALT_BYTES);
  const contentBody = contentHalf.slice(0, CONTENT_BYTES - SALT_BYTES);
  const sigmaBlock = line.slice(LAYOUT.sigma, LAYOUT.sigma + SIGMA_BYTES);
  const p = sha256(ascii(DOMAIN_PAY), saltP, paymentHalf);
  const k = sha256(ascii(DOMAIN_CNT), saltC, contentBody);
  const sigmaHash = sha256(sigmaBlock);
  const c = sha256(ascii(DOMAIN_LINE), lineHeader, p, k, sigmaHash);
  const id = paymentIdBytes(
    readBe(paymentHalf, 0, 8),
    paymentHalf.slice(8, 40),
    readBe(paymentHalf, 56, 4),
    readBe(paymentHalf, 60, 2),
  );
  const sigmaDigest = sha256(ascii(DOMAIN_SIG), id, k, sigmaBlock.subarray(0, 1));
  return { p, k, c, sigmaDigest };
}

/**
 * P, K, C and the σ message hash. Accepts a 1,024-byte line or encodeLine parts.
 * P = H("pay" ‖ salt_p ‖ payment half). salt_p is also the last 32 bytes of the half.
 * K = H("cnt" ‖ salt_c ‖ content without salt_c).
 * C = H("cs2" ‖ header ‖ P ‖ K ‖ H(alg ‖ σ)).
 * @param {Uint8Array | object} input
 */
export function commitments(input) {
  let line;
  if (input instanceof Uint8Array) {
    const decoded = decodeLine(input);
    if (!decoded.ok) return decoded;
    line = input;
  } else {
    const encoded = encodeLine(input);
    if (!encoded.ok) return encoded;
    line = encoded.line;
  }
  const algOk = requireAlg(line[LAYOUT.sigma]);
  if (!algOk.ok) return algOk;
  const { p, k, c, sigmaDigest } = commitmentBytes(line);
  return {
    ok: true,
    P: p,
    K: k,
    C: c,
    sigmaDigest,
    hex: { P: toHex(p), K: toHex(k), C: toHex(c), sigmaDigest: toHex(sigmaDigest) },
  };
}

/**
 * σ message H("cs2-sig" ‖ payment id ‖ K ‖ alg). K is 32 bytes. alg is one byte.
 * @param {object} payment
 * @param {Uint8Array | string} k
 * @param {number | bigint | string} alg
 */
export function sigmaDigest(payment, k, alg) {
  const id = canonicalPaymentId(payment);
  if (!id.ok) return id;
  const key = readFixed(k, 32);
  if (!key.ok) return key;
  const algByte = readUint(alg, 8);
  if (!algByte.ok) return algByte;
  const allowed = requireAlg(Number(algByte.value));
  if (!allowed.ok) return allowed;
  const algBytes = new Uint8Array(1);
  writeBe(algBytes, 0, algByte.value, 1);
  const bytes = sha256(ascii(DOMAIN_SIG), id.bytes, key.bytes, algBytes);
  return { ok: true, bytes, hex: toHex(bytes) };
}

/**
 * Authorization dedup key (chainId, token, authorizer, nonce).
 * A zero nonce means "nonce: none" and produces no key.
 * @param {object} input
 */
export function authorizationKey(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('bad_type');
  const known = knownOnly(input, ['chainId', 'token', 'authorizer', 'nonce']);
  if (!known.ok) return known;
  const chainId = readUint(input.chainId, 64);
  if (!chainId.ok) return chainId;
  const token = readFixed(input.token, 20);
  if (!token.ok) return token;
  const authorizer = readFixed(input.authorizer, 20);
  if (!authorizer.ok) return authorizer;
  const nonce = readFixed(input.nonce, 32);
  if (!nonce.ok) return nonce;
  if (isZero(nonce.bytes)) return fail('nonce_none');
  const bytes = new Uint8Array(8 + 20 + 20 + 32);
  writeBe(bytes, 0, chainId.value, 8);
  bytes.set(token.bytes, 8);
  bytes.set(authorizer.bytes, 28);
  bytes.set(nonce.bytes, 48);
  return { ok: true, bytes, hex: toHex(bytes) };
}

function chainBytes(chainId) {
  const parsed = readUint(chainId, 64);
  if (!parsed.ok) return parsed;
  const out = new Uint8Array(8);
  writeBe(out, 0, parsed.value, 8);
  return { ok: true, bytes: out };
}

/**
 * Slot key H("chit402-state-v1" ‖ kind ‖ chainId ‖ id).
 * Kinds 0x00 and 0x05–0xFF are rejected. Id width is 20 / 20 / 32 / 0.
 * @param {{ kind: number, chainId: bigint | number | string, id: Uint8Array | string }} input
 */
export function slotKey(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('bad_type');
  const { kind } = input;
  if (typeof kind !== 'number' || !Number.isInteger(kind)) return fail('bad_kind');
  const want = ID_LENGTH_BY_KIND.get(kind);
  if (want === undefined) return fail('bad_kind');
  const chain = chainBytes(input.chainId);
  if (!chain.ok) return chain;
  const id = want === 0 ? readEpochId(input.id) : readFixed(input.id, want);
  if (!id.ok) return id.reason === 'bad_length' ? fail('bad_id_length') : id;
  const bytes = sha256(ascii(DOMAIN_STATE), Uint8Array.of(kind), chain.bytes, id.bytes);
  return { ok: true, bytes, hex: toHex(bytes) };
}

function readEpochId(value) {
  if (value === undefined || value === null || value === '') return { ok: true, bytes: new Uint8Array(0) };
  if (value instanceof Uint8Array) {
    if (value.length !== 0) return fail('bad_id_length');
    return { ok: true, bytes: new Uint8Array(0) };
  }
  if (typeof value === 'string') {
    if (value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) return fail('bad_hex');
    if (value.length !== 0) return fail('bad_id_length');
    return { ok: true, bytes: new Uint8Array(0) };
  }
  return fail('bad_type');
}

/**
 * State leaf H(0x00 ‖ "chit402-state-v1" ‖ key ‖ H(value)). key is 32 bytes.
 * @param {Uint8Array | string} key
 * @param {Uint8Array | string} value
 */
export function stateLeaf(key, value) {
  const keyBytes = readFixed(key, 32);
  if (!keyBytes.ok) return keyBytes;
  const body = readBytes(value);
  if (!body.ok) return body;
  const bytes = sha256(
    Uint8Array.of(STATE_LEAF_PREFIX),
    ascii(DOMAIN_STATE),
    keyBytes.bytes,
    sha256(body.bytes),
  );
  return { ok: true, bytes, hex: toHex(bytes) };
}

/**
 * State node H(0x01 ‖ left ‖ right). Each child is 32 bytes.
 * @param {Uint8Array | string} left
 * @param {Uint8Array | string} right
 */
export function stateNode(left, right) {
  const l = readFixed(left, 32);
  if (!l.ok) return l;
  const r = readFixed(right, 32);
  if (!r.ok) return r;
  const bytes = sha256(Uint8Array.of(STATE_NODE_PREFIX), l.bytes, r.bytes);
  return { ok: true, bytes, hex: toHex(bytes) };
}

/**
 * Per-depth empty hash. depth 0 is H(0x02 ‖ "empty").
 * depth d+1 is H(0x01 ‖ empty_d ‖ empty_d).
 * @param {number} depth
 */
export function emptyHash(depth) {
  if (typeof depth !== 'number' || !Number.isSafeInteger(depth) || Object.is(depth, -0)) {
    return fail('bad_depth');
  }
  if (depth < 0 || depth > MAX_EMPTY_DEPTH) return fail('bad_depth');
  let hash = sha256(Uint8Array.of(STATE_EMPTY_PREFIX), ascii(DOMAIN_EMPTY));
  for (let d = 0; d < depth; d += 1) {
    hash = sha256(Uint8Array.of(STATE_NODE_PREFIX), hash, hash);
  }
  return { ok: true, bytes: hash, hex: toHex(hash) };
}

function readBytes(value) {
  if (value instanceof Uint8Array) return { ok: true, bytes: value.slice() };
  if (typeof value !== 'string') return fail('bad_type');
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) return fail('bad_hex');
  if (value.length === 0) return { ok: true, bytes: new Uint8Array(0) };
  return readFixed(value, value.length / 2);
}
