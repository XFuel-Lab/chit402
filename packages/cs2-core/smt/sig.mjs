/**
 * EIP-712 digests for slot rules 3, 4 and 7.
 *
 * Domain is { name: "Chit402", version: "13", chainId, verifyingContract }.
 * verifyingContract is the ChitAnchor that admits the record. It comes from
 * the caller's pinned contract list for the admission hour. A signature under
 * a different contract, including the old domain with version "1" and no
 * verifyingContract, does not verify here.
 *
 * Hashing inside the typed data is keccak256. keyHash, possession, the
 * domain strings, and kind 0x05 slot keys come from the frozen eip712
 * module. CrossPayTo, WalletJoin, WalletLeave, WalletStop, and BookCreate
 * are not exported there, so each is defined once below. A 65-byte
 * signature is r ‖ s ‖ yParity. yParity is 0 or 1. s must be low-S.
 * A signature that is not 65 bytes is not checked: ERC-1271 is not verified
 * in this module.
 */

import { createHash } from 'node:crypto';
import { P256, SECP256K1 } from '../ecdsa/curves.js';
import { keccak256 } from '../ecdsa/keccak.js';
import { recoverPublicKey } from '../ecdsa/recover.js';
import { ethereumAddress } from '../ecdsa/address.js';
import { bigToBytes, bytesToBig, bytesToHex, concat, equalBytes, hexToBytes } from '../ecdsa/bytes.js';
import {
  DOMAIN_NAME,
  DOMAIN_TYPE,
  DOMAIN_VERSION,
  PAYTO_CONTROL_TYPE,
  REVOKE_BY_KEY_TYPE,
  REVOKE_TYPE,
} from '../eip712/domain.mjs';
import { keySlotKey } from '../eip712/kinds.mjs';
import { canonicalKey } from '../eip712/registry.mjs';
import { checkSigma, verifyPossession } from '../eip712/index.mjs';
import { formatKeyHash, keyHash, parseKeyHash } from '../eip712/key-hash.mjs';
import { deriveKeySlotKey } from '../key-status/status.mjs';

export {
  DOMAIN_NAME,
  DOMAIN_TYPE,
  DOMAIN_VERSION,
  PAYTO_CONTROL_TYPE,
  REVOKE_BY_KEY_TYPE,
  REVOKE_TYPE,
  checkSigma,
  deriveKeySlotKey,
  formatKeyHash,
  keyHash,
  keySlotKey,
  parseKeyHash,
};

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
  const canon = canonicalKey(0x01, compressed);
  if (!canon.ok) return false;
  const pub = recoverPublicKey(digest, parts.r, parts.s, parts.yParity, P256);
  if (!pub) return false;
  return equalBytes(pub, canon.uncompressed);
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
