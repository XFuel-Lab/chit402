/**
 * EIP-712 digests for wallet and book slot records.
 *
 * Domain is { name: "Chit402", version: "13", chainId, verifyingContract }.
 * verifyingContract is the ChitAnchor that admits the record. It comes from
 * the caller's pinned contract list for the admission hour. A signature under
 * a different contract does not verify here.
 *
 * WalletJoin, WalletLeave, WalletStop, and BookCreate are not exported by
 * the frozen eip712 module, so each type string is defined once below.
 * A 65-byte signature is r ‖ s ‖ yParity. yParity is 0 or 1. s must be low-S.
 * ERC-1271 is not verified in this module.
 */

import { createHash } from 'node:crypto';
import { P256, SECP256K1 } from '../ecdsa/curves.js';
import { keccak256 } from '../ecdsa/keccak.js';
import { recoverPublicKey } from '../ecdsa/recover.js';
import { ethereumAddress } from '../ecdsa/address.js';
import { bigToBytes, bytesToBig, concat, equalBytes, hexToBytes } from '../ecdsa/bytes.js';
import { DOMAIN_NAME, DOMAIN_TYPE, DOMAIN_VERSION } from '../eip712/domain.mjs';
import { canonicalKey } from '../eip712/registry.mjs';

export { DOMAIN_NAME, DOMAIN_TYPE, DOMAIN_VERSION };

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
