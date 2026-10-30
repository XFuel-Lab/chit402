/**
 * EIP-712 payTo control, revoke, and revoke-by-key (DS-44).
 *
 * Domain fields and type strings live in typed-data.mjs. The admitting
 * contract comes from the pinned list for the hour, not from config or
 * the network, and not from a caller-supplied address. A signature made
 * under an earlier contract is verified under that contract. It is not
 * re-signed.
 *
 * The signature field is a uint16 length prefix plus 65 bytes, low-S,
 * yParity 0 or 1. ERC-1271 is not verified. Any other inner length is
 * refused. The seller P-256 key is the signed `key` on PayToControl, and
 * the key that signs RevokeByKey.
 */

import { randomBytes } from 'node:crypto';
import { keccak256 } from '../cs2-core/ecdsa/keccak.js';
import { P256, SECP256K1 } from '../cs2-core/ecdsa/curves.js';
import { publicPoint, signRawDigest } from '../cs2-core/ecdsa/sign.js';
import { recoverPublicKey, yParityByTrial } from '../cs2-core/ecdsa/recover.js';
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
import { contractForHour } from './pinned-contract.mjs';
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
    else parts.push(encodeAtomic(field.type, data[field.name]));
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
  return contractForHour(input.pinnedContracts, input.chainId, input.hourStart);
}

export function sellerKeyHash(key) {
  const hex = normalizeHex(key, 33);
  if (!hex) return null;
  return keccak256(hexToBytes(hex));
}

/** Revoke id is (slot, keyHash). revokedAt is not part of it. */
export function revokeRecordId(slot, keyHash) {
  const slotHex = normalizeHex(slot, 32);
  const hashHex = normalizeHex(keyHash, 32);
  if (!slotHex || !hashHex) return refuse('bad_length');
  const bytes = concat([hexToBytes(slotHex), hexToBytes(hashHex)]);
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

function parseRevoke(input, admitted) {
  const payTo = addressHex(input.payTo);
  if (!payTo) return refuse('bad_hex');
  if (isZeroHex(payTo)) return refuse('bad_payment');
  const keyHash = normalizeHex(input.keyHash, 32);
  if (!keyHash) return refuse('bad_length');
  return {
    ok: true,
    chainId: admitted.chainId,
    verifyingContract: admitted.address,
    hourStart: admitted.hourStart,
    message: { payTo, keyHash: hexToBytes(keyHash) },
  };
}

function parseRevokeByKey(input, admitted) {
  const keyHash = normalizeHex(input.keyHash, 32);
  if (!keyHash) return refuse('bad_length');
  return {
    ok: true,
    chainId: admitted.chainId,
    verifyingContract: admitted.address,
    hourStart: admitted.hourStart,
    message: { keyHash: hexToBytes(keyHash) },
  };
}

function digestOf(primary, parsed) {
  return hashChit(primary, parsed.message, parsed.chainId, parsed.verifyingContract);
}

function randomScalar(order) {
  for (let i = 0; i < 64; i += 1) {
    const k = bytesToBig(randomBytes(32));
    if (k > 0n && k < order) return k;
  }
  return null;
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

function signDigest(digest, privateKey, k, curve) {
  const d = parseScalar(privateKey, curve.order);
  const nonce = k == null ? randomScalar(curve.order) : parseScalar(k, curve.order);
  if (d == null || nonce == null) return refuse('bad_key');
  const sig = signRawDigest(digest, d, nonce, curve);
  const signature = encodeSignatureField(concat([sig.raw, Uint8Array.of(sig.yParity)]));
  if (!signature) return refuse('bad_signature');
  return { ok: true, signature, yParity: sig.yParity };
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

export function payToControlDigest(input) {
  const admitted = admitting(input);
  if (!admitted.ok) return admitted;
  const parsed = parsePayToControl(input, admitted);
  if (!parsed.ok) return parsed;
  return digestOf(PAYTO_CONTROL, parsed);
}

export function signPayToControl(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parsePayToControl(input, admitted);
    if (!parsed.ok) return parsed;
    const digest = digestOf(PAYTO_CONTROL, parsed);
    if (!digest.ok) return digest;
    const signed = signDigest(digest.bytes, input.privateKey, input.k, SECP256K1);
    if (!signed.ok) return signed;
    return {
      ok: true,
      digest: digest.bytes,
      signature: signed.signature,
      record: recordOf(PAYTO_CONTROL, parsed, signed.signature),
    };
  } catch {
    return refuse('bad_key');
  }
}

export function verifyPayToControl(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parsePayToControl(input, admitted);
    if (!parsed.ok) return parsed;
    const digest = digestOf(PAYTO_CONTROL, parsed);
    if (!digest.ok) return digest;
    return verifyPayToSigner(digest.bytes, input.signature, parsed.message.payTo);
  } catch {
    return refuse('bad_signature');
  }
}

export function signRevoke(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parseRevoke(input, admitted);
    if (!parsed.ok) return parsed;
    const digest = digestOf(REVOKE, parsed);
    if (!digest.ok) return digest;
    const signed = signDigest(digest.bytes, input.privateKey, input.k, SECP256K1);
    if (!signed.ok) return signed;
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

export function signRevokeByKey(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parseRevokeByKey(input, admitted);
    if (!parsed.ok) return parsed;
    const d = parseScalar(input.privateKey, P256.order);
    if (d == null) return refuse('bad_key');
    const hash = sellerKeyHash(compressP256(publicPoint(d, P256)));
    if (!hash || bytesToHex(hash) !== bytesToHex(parsed.message.keyHash)) return refuse('bad_payment');
    const digest = digestOf(REVOKE_BY_KEY, parsed);
    if (!digest.ok) return digest;
    const signed = signDigest(digest.bytes, d, input.k, P256);
    if (!signed.ok) return signed;
    return {
      ok: true,
      digest: digest.bytes,
      signature: signed.signature,
      record: recordOf(REVOKE_BY_KEY, parsed, signed.signature),
    };
  } catch {
    return refuse('bad_key');
  }
}

export function verifyRevokeByKey(input) {
  try {
    const admitted = admitting(input);
    if (!admitted.ok) return admitted;
    const parsed = parseRevokeByKey(input, admitted);
    if (!parsed.ok) return parsed;
    const opened = openCanonical(input.signature, P256);
    if (!opened.ok) return opened;
    const digest = digestOf(REVOKE_BY_KEY, parsed);
    if (!digest.ok) return digest;
    const parity = yParityByTrial(digest.bytes, concat([opened.r, opened.s]), input.publicKey, P256);
    if (parity !== opened.yParity) return refuse('bad_signature');
    const hash = sellerKeyHash(compressP256(input.publicKey));
    if (!hash || bytesToHex(hash) !== bytesToHex(parsed.message.keyHash)) return refuse('bad_signature');
    return { ok: true };
  } catch {
    return refuse('bad_signature');
  }
}
