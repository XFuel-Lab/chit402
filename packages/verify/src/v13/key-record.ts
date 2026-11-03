/**
 * Key hash, tombstone, and expiry for a v13 slot record.
 *
 * Type strings and the domain (name Chit402, version "13", chainId,
 * verifyingContract, no salt) match the shared EIP-712 module. Import that
 * module when it is in the tree. Until then these strings stay identical.
 *
 * keyHash is SHA-256(keyAlg || key). keyAlg 0x01 is secp256k1, and the key
 * is 33-byte compressed (prefix 0x02 or 0x03). validFrom and revokedAt are
 * not signed. expiry and hourStart are unix seconds.
 */

export const DOMAIN_NAME = 'Chit402';
export const DOMAIN_VERSION = '13';
export const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
export const PAYTO_CONTROL_TYPE = 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)';
export const REVOKE_TYPE = 'Revoke(address payTo,bytes32 keyHash)';
export const REVOKE_BY_KEY_TYPE = 'RevokeByKey(bytes32 keyHash)';
export const KEY_ALG_SECP256K1 = 0x01;

/** Disclosed ChitAnchor runtime code hash. A pin still carries its own codeHash. */
export const EXAMPLE_ANCHOR_CODE_HASH = '0xcd66271f37f16d9a2b526a63c539875ed3b56904cd2014ba0e1cd4aa33a0e080';

type Sha = (message: Uint8Array) => Uint8Array;
type Keccak = (message: Uint8Array) => Uint8Array;

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const part of parts) len += part.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

function padUint(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function padAddress(hex20: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 20; i += 1) out[12 + i] = Number.parseInt(hex20.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function utf8(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i);
  return out;
}

export function compressedSecp256k1(key: Uint8Array): boolean {
  return key.length === 33 && (key[0] === 0x02 || key[0] === 0x03);
}

/** SHA-256(keyAlg || key). A 65-byte or 0x04 key is refused. */
export function keyHashOf(alg: number, key: Uint8Array, sha256: Sha): Uint8Array | null {
  if (alg !== KEY_ALG_SECP256K1 || !compressedSecp256k1(key)) return null;
  const body = new Uint8Array(1 + key.length);
  body[0] = alg;
  body.set(key, 1);
  return sha256(body);
}

export function chitDomainSeparator(keccak: Keccak, chainId: number, verifyingContract: string): Uint8Array | null {
  const address = verifyingContract.startsWith('0x') ? verifyingContract.slice(2) : verifyingContract;
  if (!Number.isSafeInteger(chainId) || chainId < 0 || !/^[0-9a-f]{40}$/.test(address)) return null;
  const typeHash = keccak(utf8(DOMAIN_TYPE));
  return keccak(concat([
    typeHash,
    keccak(utf8(DOMAIN_NAME)),
    keccak(utf8(DOMAIN_VERSION)),
    padUint(BigInt(chainId)),
    padAddress(address),
  ]));
}

export function revokeByKeyDigest(
  keccak: Keccak,
  chainId: number,
  verifyingContract: string,
  keyHash: Uint8Array,
): Uint8Array | null {
  if (keyHash.length !== 32) return null;
  const separator = chitDomainSeparator(keccak, chainId, verifyingContract);
  if (!separator) return null;
  const structHash = keccak(concat([keccak(utf8(REVOKE_BY_KEY_TYPE)), keyHash]));
  return keccak(concat([Uint8Array.of(0x19, 0x01), separator, structHash]));
}

export interface PayToJudgement {
  ok: boolean;
  reason: 'key_hash_mismatch' | 'key_revoked_tombstone' | 'expiry_not_after_hour' | 'key_expired' | 'bad_key' | null;
}

/**
 * The record is shown at showingHour. expiry must be strictly after that
 * hour, and a receipt at or after expiry does not verify. A tombstoned
 * keyHash never becomes valid again.
 */
export function judgePayTo(input: {
  alg: number;
  key: Uint8Array;
  keyHash: Uint8Array;
  expiry: bigint;
  showingHour: number;
  receiptHour: number;
  tombstoned: boolean;
  sha256: Sha;
}): PayToJudgement {
  const hash = keyHashOf(input.alg, input.key, input.sha256);
  if (!hash || !equalBytes(hash, input.keyHash)) return { ok: false, reason: 'key_hash_mismatch' };
  if (input.tombstoned) return { ok: false, reason: 'key_revoked_tombstone' };
  if (input.expiry <= BigInt(input.showingHour)) return { ok: false, reason: 'expiry_not_after_hour' };
  if (BigInt(input.receiptHour) >= input.expiry) return { ok: false, reason: 'key_expired' };
  return { ok: true, reason: null };
}

export interface RevokeByKeyParts {
  alg: number;
  key: Uint8Array;
  keyHash: Uint8Array;
  signature: Uint8Array;
}

/**
 * A slot value is either a 33-byte compressed key, or that key plus
 * alg || expiry || keyHash || revokeCount || RevokeByKey bodies.
 * A longer value that does not parse fails closed.
 */
export function parseSlotValue(slotValue: Uint8Array): {
  ok: true;
  key: Uint8Array;
  record: { alg: number; expiry: bigint; keyHash: Uint8Array; revokes: RevokeByKeyParts[] } | null;
} | { ok: false; reason: 'bad_key' } {
  if (!compressedSecp256k1(slotValue.subarray(0, 33)) && slotValue.length < 33) {
    return { ok: false, reason: 'bad_key' };
  }
  if (slotValue.length === 33) {
    if (!compressedSecp256k1(slotValue)) return { ok: false, reason: 'bad_key' };
    return { ok: true, key: slotValue, record: null };
  }
  if (slotValue.length < 33 + 1 + 8 + 32 + 1 || !compressedSecp256k1(slotValue.subarray(0, 33))) {
    return { ok: false, reason: 'bad_key' };
  }
  const key = slotValue.subarray(0, 33);
  const alg = slotValue[33];
  let expiry = 0n;
  for (let i = 0; i < 8; i += 1) expiry = (expiry << 8n) | BigInt(slotValue[34 + i]);
  const keyHash = slotValue.subarray(42, 74);
  const count = slotValue[74];
  const revokes: RevokeByKeyParts[] = [];
  let off = 75;
  for (let i = 0; i < count; i += 1) {
    if (off + 1 + 33 + 32 + 65 > slotValue.length) return { ok: false, reason: 'bad_key' };
    const revokeAlg = slotValue[off];
    const revokeKey = slotValue.subarray(off + 1, off + 34);
    const revokeHash = slotValue.subarray(off + 34, off + 66);
    const signature = slotValue.subarray(off + 66, off + 131);
    revokes.push({
      alg: revokeAlg,
      key: revokeKey,
      keyHash: revokeHash,
      signature,
    });
    off += 131;
  }
  if (off !== slotValue.length) return { ok: false, reason: 'bad_key' };
  return { ok: true, key, record: { alg, expiry, keyHash, revokes } };
}

export function assessSlotValue(input: {
  slotValue: Uint8Array;
  sha256: Sha;
  keccak: Keccak;
  chainId: number;
  admitting: string | null;
  showingHour: number | null;
  receiptHour: number | null;
  signatureOk: (digest: Uint8Array, signature: Uint8Array, key: Uint8Array) => boolean;
}): { ok: boolean; reason: PayToJudgement['reason'] } {
  const parsed = parseSlotValue(input.slotValue);
  if (!parsed.ok) return parsed;
  if (!parsed.record) return { ok: true, reason: null };
  if (input.showingHour == null || input.receiptHour == null || !input.admitting) {
    return { ok: false, reason: 'bad_key' };
  }
  const tombstones = new Set<string>();
  for (const revoke of parsed.record.revokes) {
    const bound = keyHashOf(revoke.alg, revoke.key, input.sha256);
    if (!bound || !equalBytes(bound, revoke.keyHash)) return { ok: false, reason: 'key_hash_mismatch' };
    const digest = revokeByKeyDigest(input.keccak, input.chainId, input.admitting, revoke.keyHash);
    if (!digest || !input.signatureOk(digest, revoke.signature, revoke.key)) {
      return { ok: false, reason: 'key_hash_mismatch' };
    }
    let hex = '';
    for (let i = 0; i < revoke.keyHash.length; i += 1) hex += revoke.keyHash[i].toString(16).padStart(2, '0');
    tombstones.add(hex);
  }
  let claimed = '';
  for (let i = 0; i < parsed.record.keyHash.length; i += 1) {
    claimed += parsed.record.keyHash[i].toString(16).padStart(2, '0');
  }
  return judgePayTo({
    alg: parsed.record.alg,
    key: parsed.key,
    keyHash: parsed.record.keyHash,
    expiry: parsed.record.expiry,
    showingHour: input.showingHour,
    receiptHour: input.receiptHour,
    tombstoned: tombstones.has(claimed),
    sha256: input.sha256,
  });
}
