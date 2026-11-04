/**
 * EIP-712 digests for slot rules 3, 4 and 7.
 *
 * Domain is { name: "Chit402", version: "13", chainId, verifyingContract }.
 * verifyingContract is the ChitAnchor that admits the record. It comes from
 * the caller's pinned contract list for the admission hour. A signature under
 * a different contract, including the old domain with version "1" and no
 * verifyingContract, does not verify here.
 *
 * Hashing inside the typed data is keccak256. keyHash is SHA-256(keyAlg ||
 * key). keyAlg 0x01 is a 33-byte SEC1 key with prefix 0x02 or 0x03. These
 * strings match the shared eip712 module; import that module once it lands
 * instead of keeping this copy. A 65-byte signature is r ‖ s ‖ yParity.
 * yParity may be 0/1 or 27/28. s must be low-S on the curve that signed.
 * A signature that is not 65 bytes is not checked: ERC-1271 is not verified
 * in this module.
 */

import { createHash } from 'node:crypto';
import { P256, SECP256K1 } from '../ecdsa/curves.js';
import { keccak256 } from '../ecdsa/keccak.js';
import { recoverPublicKey } from '../ecdsa/recover.js';
import { ethereumAddress } from '../ecdsa/address.js';
import { bigToBytes, bytesToBig, bytesToHex, concat, equalBytes, hexToBytes } from '../ecdsa/bytes.js';
import { canonicalKey } from '../eip712/registry.mjs';
import { checkSigma, verifyPossession } from '../eip712/index.mjs';
import { formatKeyHash, keyHash, parseKeyHash } from '../eip712/key-hash.mjs';

export { checkSigma, formatKeyHash, keyHash, parseKeyHash };

export const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
export const DOMAIN_NAME = 'Chit402';
export const DOMAIN_VERSION = '13';
export const PAYTO_CONTROL_TYPE = 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)';
export const REVOKE_TYPE = 'Revoke(address payTo,bytes32 keyHash)';
export const REVOKE_BY_KEY_TYPE = 'RevokeByKey(bytes32 keyHash)';
export const CROSS_TYPE = 'CrossPayTo(address payTo,address otherPayTo,bytes32 keyHash)';
export const WALLET_JOIN_TYPE = 'WalletJoin(address wallet,bytes32 bookCommitment,uint64 block)';
export const WALLET_LEAVE_TYPE = 'WalletLeave(address wallet,uint64 block)';
export const WALLET_STOP_TYPE = 'WalletStop(address wallet,bytes32 bookCommitment,uint64 block)';
export const BOOK_CREATE_TYPE = 'BookCreate(bytes32 bookId,bytes32 identityKeyHash,uint64 block)';

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

export function domainSeparator(chainId, contract) {
  return structHash(DOMAIN_TYPE, [
    keccakText(DOMAIN_NAME),
    keccakText(DOMAIN_VERSION),
    padUint(chainId),
    padAddress(contract),
  ]);
}

function digestOf(chainId, contract, struct) {
  return keccak256(concat([
    Uint8Array.of(0x19, 0x01),
    domainSeparator(chainId, contract),
    struct,
  ]));
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

/** Bytes of the shared keyHash, or null when the registry rejects the key. */
export function sellerKeyHash(alg, key) {
  const got = keyHash(alg, key);
  return got.ok ? got.bytes : null;
}

function possess(digest, alg, key, sig) {
  const canon = canonicalKey(alg, key);
  if (!canon.ok) return false;
  return verifyPossession(digest, canon.uncompressed, sig).ok;
}

export function verifySellerSig(digest, sig, key) {
  return possess(digest, 1, key, sig);
}

/** Uncompressed P-256 point, or null. Book creation still recovers a 65-byte signature. */
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

export function payToControlDigest(chainId, contract, payTo, alg, key, expiry) {
  const struct = structHash(PAYTO_CONTROL_TYPE, [
    padAddress(payTo),
    padUint(BigInt(alg)),
    keccak256(key),
    padUint(expiry),
  ]);
  return digestOf(chainId, contract, struct);
}

export function verifyPayToControl(chainId, contract, payTo, alg, key, expiry, sig) {
  return verifyK1(payToControlDigest(chainId, contract, payTo, alg, key, expiry), sig, payTo);
}

/** The seller key's own signature over the same PayToControl digest. 64-byte r‖s. */
export function verifyKeyPossession(chainId, contract, payTo, alg, key, expiry, sig) {
  return possess(payToControlDigest(chainId, contract, payTo, alg, key, expiry), alg, key, sig);
}

export function revokeDigest(chainId, contract, payTo, keyHash) {
  const struct = structHash(REVOKE_TYPE, [padAddress(payTo), keyHash]);
  return digestOf(chainId, contract, struct);
}

export function verifyPayToRevoke(chainId, contract, payTo, keyHash, sig) {
  return verifyK1(revokeDigest(chainId, contract, payTo, keyHash), sig, payTo);
}

export function revokeByKeyDigest(chainId, contract, keyHash) {
  const struct = structHash(REVOKE_BY_KEY_TYPE, [keyHash]);
  return digestOf(chainId, contract, struct);
}

export function verifyKeyRevoke(chainId, contract, key, keyHashBytes, sig) {
  return possess(revokeByKeyDigest(chainId, contract, keyHashBytes), 1, key, sig);
}

function sortedPair(a, b) {
  const ha = bytesToHex(a);
  const hb = bytesToHex(b);
  return ha <= hb ? [a, b] : [b, a];
}

/** Both payTos sign this digest. Addresses are sorted so there is one message. */
export function crossDigest(chainId, contract, addrA, addrB, keyHash) {
  const [first, second] = sortedPair(addrA, addrB);
  const struct = structHash(CROSS_TYPE, [padAddress(first), padAddress(second), keyHash]);
  return digestOf(chainId, contract, struct);
}

export function verifyCrossSig(chainId, contract, addrA, addrB, keyHash, sig, signer) {
  return verifyK1(crossDigest(chainId, contract, addrA, addrB, keyHash), sig, signer);
}

export function walletJoinDigest(chainId, contract, wallet, commitment, block) {
  const struct = structHash(WALLET_JOIN_TYPE, [padAddress(wallet), commitment, padUint(block)]);
  return digestOf(chainId, contract, struct);
}

export function verifyWalletJoin(chainId, contract, wallet, commitment, block, sig) {
  return verifyK1(walletJoinDigest(chainId, contract, wallet, commitment, block), sig, wallet);
}

export function walletLeaveDigest(chainId, contract, wallet, block) {
  const struct = structHash(WALLET_LEAVE_TYPE, [padAddress(wallet), padUint(block)]);
  return digestOf(chainId, contract, struct);
}

export function verifyWalletLeave(chainId, contract, wallet, block, sig) {
  return verifyK1(walletLeaveDigest(chainId, contract, wallet, block), sig, wallet);
}

export function walletStopDigest(chainId, contract, wallet, commitment, block) {
  const struct = structHash(WALLET_STOP_TYPE, [padAddress(wallet), commitment, padUint(block)]);
  return digestOf(chainId, contract, struct);
}

export function verifyWalletStop(chainId, contract, wallet, commitment, block, sig) {
  return verifyK1(walletStopDigest(chainId, contract, wallet, commitment, block), sig, wallet);
}

export function bookCreateDigest(chainId, contract, bookId, identityKey, block) {
  const struct = structHash(BOOK_CREATE_TYPE, [
    bookId,
    sha256(identityKey),
    padUint(block),
  ]);
  return digestOf(chainId, contract, struct);
}

export function verifyBookCreate(chainId, contract, bookId, identityKey, block, sig) {
  return verifyP256Key(bookCreateDigest(chainId, contract, bookId, identityKey, block), sig, identityKey);
}

/**
 * The pinned contract whose coverage contains `hour`.
 * An entry is { address, fromHour, untilHour }. untilHour null means open.
 * Zero or two matches is no contract.
 */
export function contractForHour(list, hour) {
  if (!Array.isArray(list) || typeof hour !== 'bigint') return null;
  const matches = [];
  for (const entry of list) {
    if (!entry || !(entry.address instanceof Uint8Array) || entry.address.length !== 20) continue;
    if (typeof entry.fromHour !== 'bigint' || hour < entry.fromHour) continue;
    if (entry.untilHour !== null && entry.untilHour !== undefined && hour >= entry.untilHour) continue;
    matches.push(entry.address);
  }
  if (matches.length !== 1) return null;
  return matches[0];
}
