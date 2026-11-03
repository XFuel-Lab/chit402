/**
 * Key hash, tombstone, and expiry for a v13 slot record.
 *
 * Type strings and the domain (name Chit402, version "13", chainId,
 * verifyingContract, no salt) match the shared EIP-712 module. Import that
 * module when it is in the tree. Until then these strings stay identical.
 *
 * keyHash is SHA-256(keyAlg || key). At v13 the only allowed algorithm is
 * 0x01, compressed P-256. 0x00, 0x02, and 0x03–0xFF are refused, as is a
 * missing algorithm. The line codec owns that allow-list. This file does
 * not keep a second one, and it does not treat 0x01 as secp256k1.
 * validFrom and revokedAt are not signed. expiry and hourStart are unix seconds.
 */

export const DOMAIN_NAME = 'Chit402';
export const DOMAIN_VERSION = '13';
export const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
export const PAYTO_CONTROL_TYPE = 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)';
export const REVOKE_TYPE = 'Revoke(address payTo,bytes32 keyHash)';
export const REVOKE_BY_KEY_TYPE = 'RevokeByKey(bytes32 keyHash)';

/** PayTo slot. The line codec already uses this kind. */
export const KIND_PAYTO_SLOT = 0x01;
/** Key slot. Id is the 32-byte keyHash. The line codec does not accept this kind yet. */
export const KIND_KEY_SLOT = 0x05;

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

export interface CurveParams {
  p: bigint;
  a: bigint;
  b: bigint;
}

function compressed33(key: Uint8Array): boolean {
  return key.length === 33 && (key[0] === 0x02 || key[0] === 0x03);
}

/** Prefix 0x02 or 0x03, X < p, and y² = x³ + ax + b has a root. */
export function pointOnCurve(key: Uint8Array, curve: CurveParams): boolean {
  if (key.length !== 33 || (key[0] !== 0x02 && key[0] !== 0x03)) return false;
  let x = 0n;
  for (let i = 1; i < 33; i += 1) x = (x << 8n) | BigInt(key[i]);
  const p = curve.p;
  if (x >= p) return false;
  const x2 = (x * x) % p;
  const x3 = (x2 * x) % p;
  let rhs = (x3 + ((curve.a % p) * x) % p + curve.b) % p;
  if (rhs < 0n) rhs += p;
  if (rhs === 0n) return true;
  let exp = (p - 1n) / 2n;
  let base = rhs;
  let acc = 1n;
  while (exp > 0n) {
    if ((exp & 1n) === 1n) acc = (acc * base) % p;
    base = (base * base) % p;
    exp >>= 1n;
  }
  return acc === 1n;
}

export interface KeyGate {
  allowed: (alg: number) => boolean;
  onCurve: (key: Uint8Array) => boolean;
}

/**
 * Allowed algorithm, then a point on that curve, then SHA-256(keyAlg || key).
 * A missing or unknown algorithm never becomes a hash.
 */
/**
 * Text form is `0x` plus 64 lowercase hex characters. Anything else is
 * refused and is not rewritten.
 */
export function parseKeyHash(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

export function formatKeyHash(bytes: Uint8Array): string | null {
  if (bytes.length !== 32) return null;
  let hex = '0x';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** SHA-256("chit402-state-v1" ‖ 0x05 ‖ chainId ‖ keyHash). chainId is 8 bytes. */
export function keySlotKey(chainId: number, keyHash: Uint8Array, sha256: Sha): Uint8Array | null {
  if (!Number.isSafeInteger(chainId) || chainId < 0 || keyHash.length !== 32) return null;
  const label = 'chit402-state-v1';
  const domain = new Uint8Array(label.length);
  for (let i = 0; i < label.length; i += 1) domain[i] = label.charCodeAt(i);
  const chain = new Uint8Array(8);
  let value = BigInt(chainId);
  for (let i = 7; i >= 0; i -= 1) {
    chain[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  const body = new Uint8Array(domain.length + 1 + chain.length + keyHash.length);
  body.set(domain, 0);
  body[domain.length] = KIND_KEY_SLOT;
  body.set(chain, domain.length + 1);
  body.set(keyHash, domain.length + 1 + chain.length);
  return sha256(body);
}

export const KEY_STATUS_SCHEMA = 'chit402.cs2.key-status.v2';

/** Public T4 key. The verifier never treats it as a live seller key. */
export const TEST_VECTOR_KEY_HASH = '70703a0707c1ba660d772d3b613966bf84599afa8059b29636a613fefbfa9390';

function bytesToHexLocal(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** One u16 big-endian length prefix, then that many bytes. */
export function readU16Field(bytes: Uint8Array, offset: number): { ok: true; value: Uint8Array; next: number } | { ok: false } {
  if (offset < 0 || offset + 2 > bytes.length) return { ok: false };
  const len = (bytes[offset] << 8) | bytes[offset + 1];
  const start = offset + 2;
  const end = start + len;
  if (len < 0 || end > bytes.length) return { ok: false };
  return { ok: true, value: bytes.subarray(start, end), next: end };
}

/**
 * PayTo-control signature, then the possession signature. Both prefixes are
 * u16 big-endian. The possession signature is exactly 64 bytes and nothing follows.
 */
export function readPayToSignatures(bytes: Uint8Array): { ok: true; payTo: Uint8Array; pop: Uint8Array } | { ok: false } {
  const payTo = readU16Field(bytes, 0);
  if (!payTo.ok) return payTo;
  const pop = readU16Field(bytes, payTo.next);
  if (!pop.ok || pop.value.length !== 64 || pop.next !== bytes.length) return { ok: false };
  return { ok: true, payTo: payTo.value, pop: pop.value };
}

export interface SlotProof {
  siblings: string[] | null;
  root?: string | null;
}

export type KeyLeaf =
  | 'empty'
  | 'bare'
  | 'zero'
  | 'out_of_bounds'
  | 'bad_sig'
  | 'mismatch'
  | 'multi'
  | null;

export interface KeyStatusInput {
  /** Missing or any schema other than v2 is an old bundle. */
  schema?: string | null;
  block: number;
  /** hourStart of the receipt epoch, unix seconds. Compared with expiry. */
  hourStart: number;
  stateRoot?: string | null;
  sigmaKey?: Uint8Array | null;
  chainId?: number;
  sha256?: Sha;
  /** A key-slot key carried by the bundle. It must match the derived key. */
  bundleKeySlot?: Uint8Array | null;
  payToProof: SlotProof | null;
  keyProof: SlotProof | null;
  /** Null with a present proof means the caller did not classify the leaf. */
  keyLeaf?: KeyLeaf;
  registration: {
    admissionBlock: number;
    expiry: bigint;
    payToSignature: Uint8Array | null;
    keySignature: Uint8Array | null;
    popOk: boolean;
  } | null;
  /**
   * Same-slot Revoke(payTo, keyHash). Ignored when the record is a
   * RevokeByKey sitting outside kind 0x05.
   */
  slotRevokeBlock: number | null;
  /** The Revoke's keyHash. The check applies only when it equals the registration. */
  slotRevokeKeyHash?: Uint8Array | null;
  registrationKeyHash?: Uint8Array | null;
  revokeByKeyOutsideKeySlot?: boolean;
  tombstone: { revokedAtBlock: number | null; outOfBounds: boolean } | null;
}

export interface KeyStatusResult {
  proven: boolean;
  exit: 0 | 1 | 2;
  reason: string | null;
  print: string | null;
}

const admissionCache = new Map<string, number>();

/** Forget cached admission blocks. Tests start from an empty cache. */
export function clearAdmissionCache(): void {
  admissionCache.clear();
}

/**
 * Accept an admission block once: absent at e−1, member at e, and the
 * block strictly after the previous anchor and at or before this anchor.
 * The result is cached by slot key and seq. A failed proof is not cached
 * as a block.
 */
export function cachedAdmission(input: {
  slotKey: string;
  seq: number;
  absentAtPrior: boolean;
  /** An empty leaf at e−1 is absence for a slot's first registration. */
  emptySlotAtPrior?: boolean;
  memberAtEpoch: boolean;
  priorAnchor: number;
  anchor: number;
  block: number;
}): { ok: true; block: number; cached: boolean } | { ok: false; exit: 2; reason: 'unproven' } {
  const id = `${input.slotKey}:${input.seq}`;
  const prior = admissionCache.get(id);
  if (prior != null) return { ok: true, block: prior, cached: true };
  const absent = input.absentAtPrior || input.emptySlotAtPrior === true;
  if (!absent || !input.memberAtEpoch) return { ok: false, exit: 2, reason: 'unproven' };
  if (!(input.priorAnchor < input.block && input.block <= input.anchor)) {
    return { ok: false, exit: 2, reason: 'unproven' };
  }
  admissionCache.set(id, input.block);
  return { ok: true, block: input.block, cached: false };
}

function status(exit: 0 | 1 | 2, reason: string | null, print: string | null = null): KeyStatusResult {
  return { proven: exit === 0, exit, reason, print };
}

/**
 * Status of key k in payTo P at block b. Both proofs use one state root.
 * The key-slot key is derived from the seller key. A RevokeByKey outside
 * kind 0x05 is ignored. There is no cross-payTo consent check.
 */
export function keyStatus(input: KeyStatusInput): KeyStatusResult {
  if (input.schema !== KEY_STATUS_SCHEMA) return status(2, 'old_schema');
  const payRoot = input.payToProof?.root;
  const keyRoot = input.keyProof?.root;
  if (payRoot && keyRoot && payRoot !== keyRoot) return status(2, 'two_roots');
  if (input.stateRoot && payRoot && payRoot !== input.stateRoot) return status(2, 'two_roots');
  if (input.stateRoot && keyRoot && keyRoot !== input.stateRoot) return status(2, 'two_roots');
  if (input.sigmaKey && input.sha256 && input.chainId != null && input.bundleKeySlot) {
    const derivedHash = input.sha256(concat([Uint8Array.of(0x01), input.sigmaKey]));
    const derived = keySlotKey(input.chainId, derivedHash, input.sha256);
    if (!derived || !equalBytes(derived, input.bundleKeySlot)) return status(2, 'key_mismatch');
  }
  if (!input.payToProof || input.payToProof.siblings == null) return status(2, 'unproven');
  if (!input.keyProof || input.keyProof.siblings == null) return status(2, 'unproven');
  if (input.keyLeaf && input.keyLeaf !== 'empty') return status(2, 'invalid_leaf');
  const reg = input.registration;
  if (!reg || !reg.payToSignature || reg.payToSignature.length === 0) return status(2, 'unproven');
  if (!reg.keySignature || reg.keySignature.length !== 64 || !reg.popOk) return status(2, 'unproven');
  const sameKey = input.slotRevokeKeyHash != null
    && input.registrationKeyHash != null
    && equalBytes(input.slotRevokeKeyHash, input.registrationKeyHash);
  const slotRevoke = input.revokeByKeyOutsideKeySlot || !sameKey ? null : input.slotRevokeBlock;
  if (input.registrationKeyHash && bytesToHexLocal(input.registrationKeyHash) === TEST_VECTOR_KEY_HASH) {
    return status(1, 'test_vector_key', 'test vector key');
  }
  if (slotRevoke != null && reg.admissionBlock >= slotRevoke) {
    return status(1, 'registered_after_slot_revoke');
  }
  const tomb = input.keyLeaf === 'empty' ? null : input.tombstone;
  let laterNote: string | null = null;
  if (tomb) {
    if (tomb.revokedAtBlock == null || tomb.revokedAtBlock <= 0 || tomb.outOfBounds) {
      return status(2, 'invalid_leaf');
    }
    if (reg.admissionBlock >= tomb.revokedAtBlock) return status(1, 'registered_after_tombstone');
    if (tomb.revokedAtBlock <= input.block) return status(1, 'revoked');
    laterNote = `seller key revoked at block ${tomb.revokedAtBlock} (by key)`;
  }
  if (slotRevoke != null && slotRevoke <= input.block) return status(1, 'revoked');
  if (!(reg.admissionBlock <= input.block)) return status(2, 'unproven');
  if (!(input.hourStart < reg.expiry)) return status(1, 'expired');
  return status(0, null, laterNote);
}

export function keyHashOf(
  alg: number | null | undefined,
  key: Uint8Array | null | undefined,
  sha256: Sha,
  gate: KeyGate,
): Uint8Array | null {
  if (typeof alg !== 'number' || !Number.isInteger(alg) || alg < 0 || alg > 255) return null;
  if (!gate.allowed(alg)) return null;
  if (!key || !gate.onCurve(key)) return null;
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
  reason: 'bad_alg' | 'off_curve' | 'key_hash_mismatch' | 'bad_signature' | 'key_revoked_tombstone' | 'expiry_not_after_hour' | 'key_expired' | 'bad_key' | null;
}

function hashBytes(alg: number, key: Uint8Array, sha256: Sha): Uint8Array {
  const body = new Uint8Array(1 + key.length);
  body[0] = alg;
  body.set(key, 1);
  return sha256(body);
}

/** Algorithm, then the curve, then the hash. A failure is not a keyHash. */
export function bindKey(
  alg: number | null | undefined,
  key: Uint8Array | null | undefined,
  sha256: Sha,
  gate: KeyGate,
): { ok: true; hash: Uint8Array } | { ok: false; reason: 'bad_alg' | 'off_curve' } {
  if (typeof alg !== 'number' || !Number.isInteger(alg) || !gate.allowed(alg)) {
    return { ok: false, reason: 'bad_alg' };
  }
  if (!key || !gate.onCurve(key)) return { ok: false, reason: 'off_curve' };
  return { ok: true, hash: hashBytes(alg, key, sha256) };
}

/**
 * The record is shown at showingHour. expiry must be strictly after that
 * hour, and a receipt at or after expiry does not verify. A tombstoned
 * keyHash never becomes valid again.
 */
export function judgePayTo(input: {
  alg: number | null | undefined;
  key: Uint8Array | null | undefined;
  keyHash: Uint8Array;
  expiry: bigint;
  showingHour: number;
  receiptHour: number;
  tombstoned: boolean;
  sha256: Sha;
  gate: KeyGate;
}): PayToJudgement {
  const bound = bindKey(input.alg, input.key, input.sha256, input.gate);
  if (!bound.ok) return bound;
  if (!equalBytes(bound.hash, input.keyHash)) return { ok: false, reason: 'key_hash_mismatch' };
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
  if (!compressed33(slotValue.subarray(0, 33)) && slotValue.length < 33) {
    return { ok: false, reason: 'bad_key' };
  }
  if (slotValue.length === 33) {
    if (!compressed33(slotValue)) return { ok: false, reason: 'bad_key' };
    return { ok: true, key: slotValue, record: null };
  }
  if (slotValue.length < 33 + 1 + 8 + 32 + 1 || !compressed33(slotValue.subarray(0, 33))) {
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
    if (off + 1 + 33 + 32 + 64 > slotValue.length) return { ok: false, reason: 'bad_key' };
    const revokeAlg = slotValue[off];
    const revokeKey = slotValue.subarray(off + 1, off + 34);
    const revokeHash = slotValue.subarray(off + 34, off + 66);
    const signature = slotValue.subarray(off + 66, off + 130);
    revokes.push({
      alg: revokeAlg,
      key: revokeKey,
      keyHash: revokeHash,
      signature,
    });
    off += 130;
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
  gate: KeyGate;
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
    const bound = bindKey(revoke.alg, revoke.key, input.sha256, input.gate);
    if (!bound.ok) return bound;
    if (!equalBytes(bound.hash, revoke.keyHash)) return { ok: false, reason: 'key_hash_mismatch' };
    const digest = revokeByKeyDigest(input.keccak, input.chainId, input.admitting, revoke.keyHash);
    if (!digest || revoke.signature.length !== 64 || !input.signatureOk(digest, revoke.signature, revoke.key)) {
      return { ok: false, reason: 'bad_signature' };
    }
    let hex = '';
    for (let i = 0; i < bound.hash.length; i += 1) hex += bound.hash[i].toString(16).padStart(2, '0');
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
    gate: input.gate,
  });
}
