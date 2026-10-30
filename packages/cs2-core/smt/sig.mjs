/**
 * EIP-712 digests for slot rules 3, 4 and 7.
 *
 * Domain is { name: "Chit402", version: "1", chainId }. Hashing inside the
 * typed data is keccak256, as EIP-712 requires. keyHash is SHA-256 of the
 * compressed seller key, because SIMPLE §S1 fixes H as SHA-256 (DS-64).
 * A 65-byte signature is r ‖ s ‖ yParity. yParity may be 0/1 or 27/28.
 * s must be low-S on the curve that signed. ERC-1271 blobs are not checked
 * here: this module has no chain, and a signature that is not 65 bytes fails.
 */

import { createHash } from 'node:crypto';
import { P256, SECP256K1 } from '../ecdsa/curves.js';
import { keccak256 } from '../ecdsa/keccak.js';
import { recoverPublicKey } from '../ecdsa/recover.js';
import { ethereumAddress } from '../ecdsa/address.js';
import { bigToBytes, bytesToBig, bytesToHex, concat, equalBytes, hexToBytes } from '../ecdsa/bytes.js';

export const PAYTO_CONTROL_TYPE = 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 validFrom)';
export const REVOKE_TYPE = 'Revoke(address payTo,bytes32 keyHash,uint64 revokedAt)';
export const REVOKE_BY_KEY_TYPE = 'RevokeByKey(bytes32 keyHash,uint64 revokedAt)';
export const CROSS_TYPE = 'CrossPayTo(address payTo,address otherPayTo,bytes32 keyHash)';
export const WALLET_JOIN_TYPE = 'WalletJoin(address wallet,bytes32 bookCommitment,uint64 block)';
export const WALLET_LEAVE_TYPE = 'WalletLeave(address wallet,uint64 block)';
export const WALLET_STOP_TYPE = 'WalletStop(address wallet,bytes32 bookCommitment,uint64 block)';
export const BOOK_CREATE_TYPE = 'BookCreate(bytes32 bookId,bytes32 identityKeyHash,uint64 block)';

const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId)';
const DOMAIN_NAME = 'Chit402';
const DOMAIN_VERSION = '1';

function ascii(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function sha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function keccakText(text) {
  return keccak256(ascii(text));
}

function padUint(value) {
  return bigToBytes(value, 32);
}

function padAddress(addr) {
  const out = new Uint8Array(32);
  out.set(addr, 12);
  return out;
}

function structHash(typeString, fields) {
  return keccak256(concat([keccakText(typeString), ...fields]));
}

function domainSeparator(chainId) {
  return structHash(DOMAIN_TYPE, [
    keccakText(DOMAIN_NAME),
    keccakText(DOMAIN_VERSION),
    padUint(chainId),
  ]);
}

function digestOf(chainId, struct) {
  return keccak256(concat([Uint8Array.of(0x19, 0x01), domainSeparator(chainId), struct]));
}

function mod(a, p) {
  const r = a % p;
  return r >= 0n ? r : r + p;
}

function modPow(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return result;
}

/** SHA-256 of the 33-byte compressed seller key. */
export function sellerKeyHash(key) {
  if (!(key instanceof Uint8Array) || key.length !== 33) return null;
  return sha256(key);
}

/** Uncompressed P-256 point, or null. */
export function decompressP256(compressed) {
  if (!(compressed instanceof Uint8Array) || compressed.length !== 33) return null;
  const prefix = compressed[0];
  if (prefix !== 0x02 && prefix !== 0x03) return null;
  const x = bytesToBig(compressed.subarray(1));
  const p = P256.p;
  if (x >= p) return null;
  const rhs = mod(mod(mod(x * x, p) * x, p) + mod(P256.a * x, p) + P256.b, p);
  const y0 = modPow(rhs, (p + 1n) / 4n, p);
  if (mod(y0 * y0, p) !== rhs) return null;
  const odd = (y0 & 1n) === 1n;
  const y = odd === (prefix === 0x03) ? y0 : mod(p - y0, p);
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(bigToBytes(x, 32), 1);
  out.set(bigToBytes(y, 32), 33);
  return out;
}

function parityOf(v) {
  if (v === 0 || v === 1) return v;
  if (v === 27 || v === 28) return v - 27;
  return null;
}

function splitSig(sig, curve) {
  if (!(sig instanceof Uint8Array) || sig.length !== 65) return null;
  const yParity = parityOf(sig[64]);
  if (yParity === null) return null;
  const r = sig.subarray(0, 32);
  const sBytes = sig.subarray(32, 64);
  const s = bytesToBig(sBytes);
  if (s > curve.order / 2n) return null;
  return { r, s: sBytes, yParity };
}

function verifyK1(digest, sig, address) {
  const parts = splitSig(sig, SECP256K1);
  if (!parts || !(address instanceof Uint8Array) || address.length !== 20) return false;
  const pub = recoverPublicKey(digest, parts.r, parts.s, parts.yParity, SECP256K1);
  if (!pub) return false;
  const got = hexToBytes(ethereumAddress(pub).slice(2));
  return equalBytes(got, address);
}

function verifyP256Key(digest, sig, compressed) {
  const parts = splitSig(sig, P256);
  if (!parts) return false;
  const want = decompressP256(compressed);
  if (!want) return false;
  const pub = recoverPublicKey(digest, parts.r, parts.s, parts.yParity, P256);
  if (!pub) return false;
  return equalBytes(pub, want);
}

export function payToControlDigest(chainId, payTo, alg, key, validFrom) {
  const struct = structHash(PAYTO_CONTROL_TYPE, [
    padAddress(payTo),
    padUint(BigInt(alg)),
    keccak256(key),
    padUint(validFrom),
  ]);
  return digestOf(chainId, struct);
}

export function verifyPayToControl(chainId, payTo, alg, key, validFrom, sig) {
  return verifyK1(payToControlDigest(chainId, payTo, alg, key, validFrom), sig, payTo);
}

export function revokeDigest(chainId, payTo, keyHash, revokedAt) {
  const struct = structHash(REVOKE_TYPE, [
    padAddress(payTo),
    keyHash,
    padUint(revokedAt),
  ]);
  return digestOf(chainId, struct);
}

export function verifyPayToRevoke(chainId, payTo, keyHash, revokedAt, sig) {
  return verifyK1(revokeDigest(chainId, payTo, keyHash, revokedAt), sig, payTo);
}

export function revokeByKeyDigest(chainId, keyHash, revokedAt) {
  const struct = structHash(REVOKE_BY_KEY_TYPE, [keyHash, padUint(revokedAt)]);
  return digestOf(chainId, struct);
}

export function verifyKeyRevoke(chainId, key, keyHash, revokedAt, sig) {
  return verifyP256Key(revokeByKeyDigest(chainId, keyHash, revokedAt), sig, key);
}

function sortedPair(a, b) {
  const ha = bytesToHex(a);
  const hb = bytesToHex(b);
  return ha <= hb ? [a, b] : [b, a];
}

/** Both payTos sign this digest. Addresses are sorted so there is one message. */
export function crossDigest(chainId, addrA, addrB, keyHash) {
  const [first, second] = sortedPair(addrA, addrB);
  const struct = structHash(CROSS_TYPE, [padAddress(first), padAddress(second), keyHash]);
  return digestOf(chainId, struct);
}

export function verifyCrossSig(chainId, addrA, addrB, keyHash, sig, signer) {
  return verifyK1(crossDigest(chainId, addrA, addrB, keyHash), sig, signer);
}

export function walletJoinDigest(chainId, wallet, commitment, block) {
  const struct = structHash(WALLET_JOIN_TYPE, [padAddress(wallet), commitment, padUint(block)]);
  return digestOf(chainId, struct);
}

export function verifyWalletJoin(chainId, wallet, commitment, block, sig) {
  return verifyK1(walletJoinDigest(chainId, wallet, commitment, block), sig, wallet);
}

export function walletLeaveDigest(chainId, wallet, block) {
  const struct = structHash(WALLET_LEAVE_TYPE, [padAddress(wallet), padUint(block)]);
  return digestOf(chainId, struct);
}

export function verifyWalletLeave(chainId, wallet, block, sig) {
  return verifyK1(walletLeaveDigest(chainId, wallet, block), sig, wallet);
}

export function walletStopDigest(chainId, wallet, commitment, block) {
  const struct = structHash(WALLET_STOP_TYPE, [padAddress(wallet), commitment, padUint(block)]);
  return digestOf(chainId, struct);
}

export function verifyWalletStop(chainId, wallet, commitment, block, sig) {
  return verifyK1(walletStopDigest(chainId, wallet, commitment, block), sig, wallet);
}

export function bookCreateDigest(chainId, bookId, identityKey, block) {
  const struct = structHash(BOOK_CREATE_TYPE, [
    bookId,
    sha256(identityKey),
    padUint(block),
  ]);
  return digestOf(chainId, struct);
}

export function verifyBookCreate(chainId, bookId, identityKey, block, sig) {
  return verifyP256Key(bookCreateDigest(chainId, bookId, identityKey, block), sig, identityKey);
}
