/**
 * EIP-712 payTo control, revoke, and revoke-by-key.
 *
 * Domain fields and type strings live in typed-data.mjs. The admitting
 * contract comes from the pinned list for the hour, not from config or
 * the network, and not from a caller-supplied address. A signature made
 * under an earlier contract is verified under that contract. It is not
 * re-signed.
 *
 * PayToControl and Revoke are signed by the payTo account on secp256k1.
 * Their signature field is a uint16 length prefix plus 65 bytes, low-S,
 * yParity 0 or 1. ERC-1271 is not verified. Any other inner length is
 * refused.
 *
 * PayToControl.key and RevokeByKey are the seller P-256 key (keyAlg 0x01).
 * RevokeByKey is a 64-byte low-S r‖s over the EIP-712 digest, checked
 * against that carried key. It is signed only when the operator calls
 * signRevokeByKey. A failed check tombstones nothing.
 */

import { keccak256 } from '../cs2-core/ecdsa/keccak.js';
import { P256, SECP256K1 } from '../cs2-core/ecdsa/curves.js';
import { publicPoint, signRawDigest } from '../cs2-core/ecdsa/sign.js';
import { recoverPublicKey } from '../cs2-core/ecdsa/recover.js';
import { ethereumAddress } from '../cs2-core/ecdsa/address.js';
import { bytesToBig, bytesToHex, concat, hexToBytes } from '../cs2-core/ecdsa/bytes.js';
import { isAllowedAlg } from '../cs2-core/line/index.mjs';
import { refuse } from './reasons.mjs';
import { addressHex, isZeroHex, normalizeHex, parseScalar, parseUint } from './hex.mjs';
import { isLowS } from './low-s.mjs';
import {
  CHIT_TYPES,
  DOMAIN_FIELDS,
  PAYTO_CONTROL,
  REVOKE,
  REVOKE_BY_KEY,
  chitDomain,
} from './typed-data.mjs';
import { encodeSignatureField, readSignatureField } from './signature-field.mjs';
import {
  canonicalKey,
  deniedKeyHash,
  expiryAllows,
  formatKeyHash,
  keyHash,
  parseKeyHash,
  possessionPreimage,
  verifyPossession,
  tombstoned,
} from '../cs2-core/eip712/index.mjs';
import { contractForHour } from './pinned-contract.mjs';
import { PINNED_CONTRACTS } from './pins.mjs';
import { nonceFor } from './rfc6979.mjs';
import { compressP256 } from './sigma.mjs';

const text = new TextEncoder();

function keccakText(value) {
  return keccak256(text.encode(value));
}

function padUint(value) {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function padAddress(hex20) {
  const out = new Uint8Array(32);
  const raw = hexToBytes(hex20);
  out.set(raw, 12);
  return out;
}

function baseType(type) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(type);
  return match ? match[1] : type;
}

function encodeType(primary, types) {
  const found = [];
  const walk = (name) => {
    if (found.includes(name)) return;
    const fields = types[name];
    if (!fields) return;
    found.push(name);
    for (const field of fields) {
      if (field.type.includes('[')) {
        const err = new Error('bad_type');
        err.code = 'bad_type';
        throw err;
      }
      walk(baseType(field.type));
    }
  };
  walk(primary);
  const deps = found.filter((name) => name !== primary).sort();
  const ordered = [primary, ...deps];
  return ordered.map((name) => {
    const fields = types[name];
    const body = fields.map((field) => `${field.type} ${field.name}`).join(',');
    return `${name}(${body})`;
  }).join('');
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  const hex = normalizeHex(value, (typeof value === 'string'
    ? ((value.startsWith('0x') || value.startsWith('0X')) ? value.length - 2 : value.length) / 2
    : -1));
  if (!hex) {
    const err = new Error('bad_hex');
    err.code = 'bad_hex';
    throw err;
  }
  return hexToBytes(hex);
}

function encodeAtomic(type, value) {
  if (type === 'string') return keccakText(String(value));
  if (type === 'bytes') return keccak256(asBytes(value));
  if (type === 'address') {
    const hex = addressHex(value);
    if (!hex) {
      const err = new Error('bad_hex');
      err.code = 'bad_hex';
      throw err;
    }
    return padAddress(hex);
  }
  const uint = /^uint(\d+)?$/.exec(type);
  if (uint) {
    const bits = uint[1] ? Number(uint[1]) : 256;
    const n = typeof value === 'bigint' ? value : parseUint(value, bits);
    if (n == null || (typeof value === 'bigint' && (value < 0n || value >= (1n << BigInt(bits))))) {
      const err = new Error('bad_uint');
      err.code = 'bad_uint';
      throw err;
    }
    return padUint(n);
  }
  const fixed = /^bytes(\d+)$/.exec(type);
  if (fixed) {
    const width = Number(fixed[1]);
    const raw = asBytes(value);
    if (raw.length !== width || width < 1 || width > 32) {
      const err = new Error('bad_length');
      err.code = 'bad_length';
      throw err;
    }
    const out = new Uint8Array(32);
    out.set(raw, 0);
    return out;
  }
  const err = new Error('bad_type');
  err.code = 'bad_type';
  throw err;
}

export function hashStruct(primary, types, data) {
  const typeHash = keccakText(encodeType(primary, types));
  const parts = [typeHash];
  for (const field of types[primary]) {
    if (types[field.type]) parts.push(hashStruct(field.type, types, data[field.name]));
    else if (field.name === 'keyHash' && field.type === 'bytes32') {
      const hash = readKeyHash(data[field.name]);
      if (!hash) {
        const err = new Error('bad_length');
        err.code = 'bad_length';
        throw err;
      }
      parts.push(encodeAtomic(field.type, hash));
    } else parts.push(encodeAtomic(field.type, data[field.name]));
  }
  return keccak256(concat(parts));
}

function domainFields(domain) {
  const fields = [];
  if (domain.name != null) fields.push({ name: 'name', type: 'string' });
  if (domain.version != null) fields.push({ name: 'version', type: 'string' });
  if (domain.chainId != null) fields.push({ name: 'chainId', type: 'uint256' });
  if (domain.verifyingContract != null) fields.push({ name: 'verifyingContract', type: 'address' });
  if (domain.salt != null) fields.push({ name: 'salt', type: 'bytes32' });
  return fields;
}

export function hashTypedData(domain, types, primary, message) {
  const domainTypes = { EIP712Domain: domainFields(domain) };
  const domainSeparator = hashStruct('EIP712Domain', domainTypes, domain);
  const structHash = hashStruct(primary, types, message);
  return keccak256(concat([Uint8Array.of(0x19, 0x01), domainSeparator, structHash]));
}

function admitting(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return refuse('bad_type');
  if (Object.hasOwn(input, 'k')) return refuse('bad_key');
  if (Object.hasOwn(input, 'digest')) return refuse('bad_payment');
  if (Object.hasOwn(input, 'verifyingContract') || Object.hasOwn(input, 'pinnedContracts')) {
    return refuse('bad_payment');
  }
  return contractForHour(PINNED_CONTRACTS, input.chainId, input.hourStart);
}

/** Revoke id is (slot, keyHash). revokedAt is not part of it. */
export function revokeRecordId(slot, keyHashValue) {
  const slotHex = normalizeHex(slot, 32);
  const hash = readKeyHash(keyHashValue);
  if (!slotHex || !hash) return refuse('bad_length');
  const bytes = concat([hexToBytes(slotHex), hash]);
  return { ok: true, bytes, hex: bytesToHex(bytes) };
}

export function chitDomainSeparator(chainId, verifyingContract) {
  const domain = chitDomain(chainId, verifyingContract);
  if (!domain) return null;
  return hashStruct('EIP712Domain', { EIP712Domain: DOMAIN_FIELDS }, domain);
}

export function hashChit(primary, message, chainId, verifyingContract) {
  if (!CHIT_TYPES[primary]) return refuse('bad_type');
  try {
    const separator = chitDomainSeparator(chainId, verifyingContract);
    if (!separator) return refuse('bad_payment');
    const structHash = hashStruct(primary, CHIT_TYPES, message);
    const bytes = keccak256(concat([Uint8Array.of(0x19, 0x01), separator, structHash]));
    return { ok: true, bytes, hex: bytesToHex(bytes) };
  } catch {
    return refuse('bad_payment');
  }
}

function compressedKey(input) {
  const key = normalizeHex(input.key, 33);
  if (!key) return refuse('bad_length');
  if (key[0] !== '0' || (key[1] !== '2' && key[1] !== '3')) return refuse('bad_length');
  return { ok: true, hex: key, bytes: hexToBytes(key) };
}

function parsePayToControl(input, admitted) {
  const payTo = addressHex(input.payTo);
  if (!payTo) return refuse('bad_hex');
  if (isZeroHex(payTo)) return refuse('bad_payment');
  if (!isAllowedAlg(input.keyAlg)) return refuse('bad_alg');
  const key = compressedKey(input);
  if (!key.ok) return key;
  const expiry = parseUint(input.expiry, 64);
  if (expiry == null) return refuse('bad_uint');
  const canon = canonicalKey(input.keyAlg, key.bytes);
  if (!canon.ok) return canon;
  return {
    ok: true,
    chainId: admitted.chainId,
    verifyingContract: admitted.address,
    hourStart: admitted.hourStart,
    message: {
      payTo,
      keyAlg: input.keyAlg,
      key: key.bytes,
      expiry,
    },
  };
}

function readKeyHash(value) {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) return null;
    return value;
  }
  if (typeof value === 'string') return parseKeyHash(value);
  return null;
}

function parseRevoke(input, admitted) {
  const payTo = addressHex(input.payTo);
  if (!payTo) return refuse('bad_hex');
  if (isZeroHex(payTo)) return refuse('bad_payment');
  const hash = readKeyHash(input.keyHash);
  if (!hash) return refuse('bad_length');
  return {
    ok: true,
    chainId: admitted.chainId,
    verifyingContract: admitted.address,
    hourStart: admitted.hourStart,
    message: { payTo, keyHash: hash },
  };
}

function parseRevokeByKey(input, admitted) {
  const hash = readKeyHash(input.keyHash);
  if (!hash) return refuse('bad_length');
  return {
    ok: true,
    chainId: admitted.chainId,
    verifyingContract: admitted.address,
    hourStart: admitted.hourStart,
    message: { keyHash: hash },
  };
}

function digestOf(primary, parsed) {
  return hashChit(primary, parsed.message, parsed.chainId, parsed.verifyingContract);
}

function recordOf(primary, parsed, signatureField) {
  const domain = chitDomain(parsed.chainId, parsed.verifyingContract);
  const recordDomain = {};
  for (const field of DOMAIN_FIELDS) {
    const value = domain[field.name];
    if (field.type === 'address') recordDomain[field.name] = `0x${value}`;
    else if (typeof value === 'bigint') recordDomain[field.name] = value.toString(10);
    else recordDomain[field.name] = value;
  }
  const message = {};
  for (const field of CHIT_TYPES[primary]) {
    const value = parsed.message[field.name];
    if (typeof value === 'bigint') message[field.name] = value.toString(10);
    else if (value instanceof Uint8Array && field.type === 'bytes32') message[field.name] = formatKeyHash(value);
    else if (value instanceof Uint8Array) message[field.name] = field.type === 'address' ? `0x${bytesToHex(value)}` : bytesToHex(value);
    else if (field.type === 'address') message[field.name] = `0x${value}`;
    else message[field.name] = value;
  }
  return {
    name: primary,
    domain: recordDomain,
    message,
    signature: bytesToHex(signatureField),
  };
}

function signDigest(digest, privateKey, curve) {
  const d = parseScalar(privateKey, curve.order);
  const nonce = d == null ? null : nonceFor(digest, d, curve.order);
  if (d == null || nonce == null) return refuse('bad_key');
  const sig = signRawDigest(digest, d, nonce, curve);
  const signature = encodeSignatureField(concat([sig.raw, Uint8Array.of(sig.yParity)]));
  if (!signature) return refuse('bad_signature');
  return { ok: true, signature, raw: sig.raw, yParity: sig.yParity };
}

function openCanonical(signatureField, curve) {
  const opened = readSignatureField(signatureField);
  if (!opened.ok) return opened;
  const yParity = opened.bytes[64];
  if (yParity !== 0 && yParity !== 1) return refuse('bad_signature');
  const r = opened.bytes.subarray(0, 32);
  const s = opened.bytes.subarray(32, 64);
  if (bytesToBig(r) <= 0n || bytesToBig(r) >= curve.order) return refuse('bad_signature');
  if (!isLowS(s, curve)) return refuse('bad_signature');
  return { ok: true, r, s, yParity };
}

function verifyPayToSigner(digest, signatureField, payTo) {
  const opened = openCanonical(signatureField, SECP256K1);
  if (!opened.ok) return opened;
  const pub = recoverPublicKey(digest, opened.r, opened.s, opened.yParity, SECP256K1);
  if (!pub) return refuse('bad_signature');
  const signer = ethereumAddress(pub);
  const signerHex = addressHex(signer);
  if (!signerHex || isZeroHex(signerHex) || signerHex !== payTo) return refuse('bad_signature');
  return { ok: true, signer };
}

function controlReady(input, parsed) {
  if (!expiryAllows(parsed.hourStart, parsed.message.expiry)) return refuse('bad_payment');
  const hashed = keyHash(parsed.message.keyAlg, parsed.message.key);
  if (!hashed.ok) return hashed;
  if (deniedKeyHash(hashed.hex)) return refuse('bad_key');
  if (tombstoned(input.tombstones, hashed.hex)) return refuse('bad_payment');
  return hashed;
}

async function storeBool(promise) {
  try {
    return await promise;
  } catch {
    return undefined;
  }
}

async function releaseIds(store, ids) {
  if (!store) return;
  for (const id of ids) {
    try { await store.release(id); } catch { /* the refusal stands */ }
  }
}

const seatsByStore = new WeakMap();

function noteSeat(store, hex, payTo) {
  if (!store) return;
  let byKey = seatsByStore.get(store);
  if (!byKey) {
    byKey = new Map();
    seatsByStore.set(store, byKey);
  }
  let seats = byKey.get(hex);
  if (!seats) {
    seats = new Set();
    byKey.set(hex, seats);
  }
  seats.add(payTo);
}

async function clearLiveKey(store, hex) {
  if (!store) return;
  const byKey = seatsByStore.get(store);
  const seats = byKey && byKey.get(hex);
  const ids = [`open:${hex}`];
  if (seats) {
    for (const payTo of seats) ids.push(`live:${payTo}`, `cur:${payTo}:${hex}`);
    seats.clear();
  }
  await releaseIds(store, ids);
}

async function markDead(store, hex) {
  if (!store) return { ok: true };
  const already = await storeBool(store.has(`dead:${hex}`));
  if (already === undefined) return refuse('bad_payment');
  if (already === true) return { ok: true };
  return takeClaim(store, `dead:${hex}`);
}

async function bindingOpen(input, hex, chainId, payTo) {
  const store = input.store;
  if (!store) return { ok: true, claimed: [] };
  const claimed = [];
  const remember = async (id) => {
    const has = await storeBool(store.has(id));
    if (has === undefined) return refuse('bad_payment');
    if (has === true) return { ok: true };
    const took = await takeClaim(store, id);
    if (!took.ok) return took;
    claimed.push(id);
    return { ok: true };
  };
  const any = await storeBool(store.has(`bound:${hex}`));
  const here = await storeBool(store.has(`bound:${chainId}:${hex}`));
  if (any === undefined || here === undefined) return refuse('bad_payment');
  if (any === true && here !== true) return refuse('bad_payment');
  // live: this payTo has a key. liveKey: this key is that one. open: this key is live somewhere.
  const live = await storeBool(store.has(`live:${payTo}`));
  const liveKey = await storeBool(store.has(`cur:${payTo}:${hex}`));
  const open = await storeBool(store.has(`open:${hex}`));
  if (live === undefined || liveKey === undefined || open === undefined) return refuse('bad_payment');
  if (live === true && liveKey !== true) return refuse('bad_payment');
  if (input.operatorOverride !== true) {
    if (open === true && liveKey !== true) return refuse('bad_payment');
  }
  for (const id of [`bound:${hex}`, `bound:${chainId}:${hex}`, `live:${payTo}`, `cur:${payTo}:${hex}`, `open:${hex}`]) {
    const got = await remember(id);
    if (!got.ok) {
      await releaseIds(store, claimed);
      return got;
    }
  }
  return { ok: true, claimed };
}

async function keyClear(store, hex) {
  if (!store) return { ok: true };
  const tomb = await storeBool(store.has(`tomb:${hex}`));
  if (tomb !== false) return refuse('bad_payment');
  const dead = await storeBool(store.has(`dead:${hex}`));
  if (dead !== false) return refuse('bad_payment');
  return { ok: true };
}

function sameBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function splitPossession(field) {
  if (!(field instanceof Uint8Array) || field.length < 4) return refuse('bad_signature');
  const payLen = (field[0] << 8) | field[1];
  if (payLen !== 65 || field.length < 2 + payLen + 2) return refuse('bad_signature');
  const payTo = field.subarray(0, 2 + payLen);
  const rest = field.subarray(2 + payLen);
  const keyLen = (rest[0] << 8) | rest[1];
  if (keyLen !== 64 || rest.length !== 2 + keyLen) return refuse('bad_signature');
  return { ok: true, payTo, key: rest.subarray(2) };
}

async function takeClaim(store, id) {
  if (!store) return { ok: true };
  const took = await storeBool(store.claim(id));
  if (took !== true) return refuse('bad_payment');
  return { ok: true };
}

export function payToControlDigest(input) {
  const admitted = admitting(input);
  if (!admitted.ok) return admitted;
  const parsed = parsePayToControl(input, admitted);
  if (!parsed.ok) return parsed;
  const ready = controlReady(input, parsed);
  if (!ready.ok) return ready;
  return digestOf(PAYTO_CONTROL, parsed);
}

export async function signPayToControl(input) {
  let claimed = [];
  let store = null;
  let done = false;
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parsePayToControl(input, admitted);
    if (!parsed.ok) return parsed;
    const ready = controlReady(input, parsed);
    if (!ready.ok) return ready;
    store = input.store;
    const clear = await keyClear(store, ready.hex);
    if (!clear.ok) return clear;
    const opened = await bindingOpen(input, ready.hex, admitted.chainId, parsed.message.payTo);
    if (!opened.ok) return opened;
    claimed = opened.claimed;
    const digest = digestOf(PAYTO_CONTROL, parsed);
    if (!digest.ok) return digest;
    if (!Object.hasOwn(input, 'keyPrivateKey')) return refuse('bad_key');
    const payScalar = parseScalar(input.privateKey, SECP256K1.order);
    const keyScalar = parseScalar(input.keyPrivateKey, P256.order);
    if (payScalar == null || keyScalar == null || keyScalar === payScalar) return refuse('bad_key');
    let owned;
    try { owned = compressP256(publicPoint(keyScalar, P256)); } catch { return refuse('bad_key'); }
    if (!sameBytes(owned, parsed.message.key)) return refuse('bad_key');
    const signed = signDigest(digest.bytes, payScalar, SECP256K1);
    if (!signed.ok) {
      await releaseIds(input.store, opened.claimed);
      return signed;
    }
    const preimage = possessionPreimage(digest.bytes);
    if (!preimage) return refuse('bad_payment');
    const possessed = signDigest(preimage, keyScalar, P256);
    if (!possessed.ok || !(possessed.raw instanceof Uint8Array)) {
      return possessed.ok ? refuse('bad_signature') : possessed;
    }
    const keyField = encodeSignatureField(possessed.raw);
    if (!keyField) return refuse('bad_signature');
    const signature = concat([signed.signature, keyField]);
    noteSeat(store, ready.hex, parsed.message.payTo);
    done = true;
    return {
      ok: true,
      digest: digest.bytes,
      signature,
      record: recordOf(PAYTO_CONTROL, parsed, signature),
    };
  } catch {
    return refuse('bad_key');
  } finally {
    if (!done) await releaseIds(store, claimed);
  }
}

export function verifyPayToControl(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parsePayToControl(input, admitted);
    if (!parsed.ok) return parsed;
    const ready = controlReady(input, parsed);
    if (!ready.ok) return ready.reason === 'bad_length' || ready.reason === 'bad_alg' || ready.reason === 'bad_key' ? ready : refuse('bad_payment');
    const digest = digestOf(PAYTO_CONTROL, parsed);
    if (!digest.ok) return digest;
    const parts = splitPossession(input.signature);
    if (!parts.ok) return parts;
    const payTo = verifyPayToSigner(digest.bytes, parts.payTo, parsed.message.payTo);
    if (!payTo.ok) return payTo;
    const canon = canonicalKey(parsed.message.keyAlg, parsed.message.key);
    if (!canon.ok) return canon;
    const possessed = verifyPossession(digest.bytes, canon.uncompressed, parts.key);
    if (!possessed.ok) return refuse('bad_signature');
    return payTo;
  } catch {
    return refuse('bad_signature');
  }
}

export async function signRevoke(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parseRevoke(input, admitted);
    if (!parsed.ok) return parsed;
    const digest = digestOf(REVOKE, parsed);
    if (!digest.ok) return digest;
    const signed = signDigest(digest.bytes, input.privateKey, SECP256K1);
    if (!signed.ok) return signed;
    const hex = bytesToHex(parsed.message.keyHash);
    const dead = await markDead(input.store, hex);
    if (!dead.ok) return dead;
    await clearLiveKey(input.store, hex);
    return {
      ok: true,
      digest: digest.bytes,
      signature: signed.signature,
      record: recordOf(REVOKE, parsed, signed.signature),
    };
  } catch {
    return refuse('bad_key');
  }
}

export function verifyRevoke(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parseRevoke(input, admitted);
    if (!parsed.ok) return parsed;
    const digest = digestOf(REVOKE, parsed);
    if (!digest.ok) return digest;
    return verifyPayToSigner(digest.bytes, input.signature, parsed.message.payTo);
  } catch {
    return refuse('bad_signature');
  }
}

export async function signRevokeByKey(input) {
  let tombHeld = null;
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parseRevokeByKey(input, admitted);
    if (!parsed.ok) return parsed;
    if (!Object.hasOwn(input, 'keyAlg') || input.keyAlg == null) return refuse('bad_alg');
    const d = parseScalar(input.privateKey, P256.order);
    if (d == null) return refuse('bad_key');
    let owned;
    try { owned = compressP256(publicPoint(d, P256)); } catch { return refuse('bad_key'); }
    if (!owned) return refuse('bad_key');
    if (input.key != null && !sameBytes(input.key, owned)) return refuse('bad_key');
    const carried = owned;
    const hashed = keyHash(input.keyAlg, carried);
    const hash = hashed.ok ? hashed.bytes : null;
    if (!hash || bytesToHex(hash) !== bytesToHex(parsed.message.keyHash)) return refuse('bad_payment');
    const digest = digestOf(REVOKE_BY_KEY, parsed);
    if (!digest.ok) return digest;
    const preimage = possessionPreimage(digest.bytes);
    if (!preimage) return refuse('bad_payment');
    const signed = signDigest(preimage, d, P256);
    if (!signed.ok) return signed;
    const tombId = `tomb:${hashed.hex}`;
    const taken = await takeClaim(input.store, tombId);
    if (!taken.ok) return taken;
    tombHeld = tombId;
    const dead = await markDead(input.store, hashed.hex);
    if (!dead.ok) {
      await releaseIds(input.store, [tombId]);
      return dead;
    }
    await clearLiveKey(input.store, hashed.hex);
    return {
      ok: true,
      digest: digest.bytes,
      signature: signed.raw,
      record: recordOf(REVOKE_BY_KEY, parsed, signed.raw),
    };
  } catch {
    await releaseIds(input && input.store, tombHeld ? [tombHeld] : []);
    return refuse('bad_key');
  }
}

export function verifyRevokeByKey(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parseRevokeByKey(input, admitted);
    if (!parsed.ok) return parsed;
    if (!Object.hasOwn(input, 'keyAlg') || input.keyAlg == null) return refuse('bad_alg');
    const canon = canonicalKey(input.keyAlg, input.key);
    if (!canon.ok) return canon;
    const digest = digestOf(REVOKE_BY_KEY, parsed);
    if (!digest.ok) return digest;
    const possessed = verifyPossession(digest.bytes, canon.uncompressed, input.signature);
    if (!possessed.ok) return refuse(possessed.reason === 'bad_sigma' ? 'bad_signature' : possessed.reason);
    const hashed = keyHash(input.keyAlg, canon.bytes);
    const hash = hashed.ok ? hashed.bytes : null;
    if (!hash || bytesToHex(hash) !== bytesToHex(parsed.message.keyHash)) return refuse('bad_signature');
    return { ok: true };
  } catch {
    return refuse('bad_signature');
  }
}
