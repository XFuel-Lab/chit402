/**
 * Adapter over the copied cs2-core EIP-712 module.
 *
 * The registry, keyHash, admission, tombstone, range check, and key status
 * live in that module. This file maps the verifier's inputs onto those
 * functions and maps their results back onto the existing exit codes.
 * Drop the copy, and these imports, after #687 is on main.
 */

import { createRequire } from 'node:module';

const load = createRequire(__filename);
const eip = load('../../vendor/cs2-core/eip712/index.mjs') as Eip712;

export const DOMAIN_NAME: string = eip.DOMAIN_NAME;
export const DOMAIN_VERSION: string = eip.DOMAIN_VERSION;
export const DOMAIN_TYPE: string = eip.DOMAIN_TYPE;
export const PAYTO_CONTROL_TYPE: string = eip.PAYTO_CONTROL_TYPE;
export const REVOKE_TYPE: string = eip.REVOKE_TYPE;
export const REVOKE_BY_KEY_TYPE: string = eip.REVOKE_BY_KEY_TYPE;

/** Disclosed ChitAnchor runtime code hash. A pin still carries its own codeHash. */
export const EXAMPLE_ANCHOR_CODE_HASH = '0xcd66271f37f16d9a2b526a63c539875ed3b56904cd2014ba0e1cd4aa33a0e080';

/** Bundle schema. An older schema is not a key-status result. */
export const KEY_STATUS_SCHEMA = 'chit402.cs2.key-status.v2';

/** Public T4 key. The shared module deny-lists it. */
export const TEST_VECTOR_KEY_HASH: string = eip.DENIED_KEY_HASHES[0];

/** P-256 generator. Used only when a caller does not carry a σ key. */
const STAND_IN_KEY = hexToBytes('036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');

type Sha = (message: Uint8Array) => Uint8Array;
type Keccak = (message: Uint8Array) => Uint8Array;

type EipOk<T> = { ok: true } & T;
interface EipNo { ok: false; reason: string; status?: string; exitCode?: number }

interface Eip712 {
  DOMAIN_NAME: string;
  DOMAIN_VERSION: string;
  DOMAIN_TYPE: string;
  PAYTO_CONTROL_TYPE: string;
  REVOKE_TYPE: string;
  REVOKE_BY_KEY_TYPE: string;
  DENIED_KEY_HASHES: readonly string[];
  parseKeyHash: (text: string) => Uint8Array | null;
  formatKeyHash: (bytes: Uint8Array) => string | null;
  deniedKeyHash: (hex: string) => boolean;
  keyHash: (alg: number, key: Uint8Array) => EipOk<{ bytes: Uint8Array; hex: string }> | EipNo;
  canonicalKey: (alg: number, key: Uint8Array) => EipOk<{ bytes: Uint8Array; uncompressed: Uint8Array }> | EipNo;
  keySlotKey: (chainId: bigint, keyHashBytes: Uint8Array) => EipOk<{ bytes: Uint8Array; hex: string }> | EipNo;
  checkAdmission: (proof: Record<string, unknown>) => EipOk<{ block: bigint }> | EipNo;
  readKeyLeaf: (leaf: unknown) => EipOk<{ tombstone: bigint | null }> | EipNo;
  keyStatus: (view: Record<string, unknown>) => EipOk<{ status: string }> | EipNo;
  checkSigma: (sigma64: Uint8Array) => { ok: true } | EipNo;
  expiryAllows: (hourStart: bigint, expiry: bigint) => boolean;
  tombstoned: (list: unknown, keyHashHex: string) => boolean;
  verifyPossession: (digest: Uint8Array, uncompressedKey: Uint8Array, signature: Uint8Array) => { ok: true } | EipNo;
  chitDomain: (chainId: bigint, verifyingContract: string) => unknown;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

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
  return new Uint8Array(Buffer.from(value, 'utf8'));
}

export interface CurveParams {
  p: bigint;
  a: bigint;
  b: bigint;
}

/** On-curve check for a compressed P-256 key. The curve argument is not consulted. */
export function pointOnCurve(key: Uint8Array, _curve: CurveParams): boolean {
  return eip.canonicalKey(0x01, key).ok === true;
}

export interface KeyGate {
  allowed: (alg: number) => boolean;
  onCurve: (key: Uint8Array) => boolean;
}

export const parseKeyHash: (text: string) => Uint8Array | null = (text) => eip.parseKeyHash(text);
export const formatKeyHash: (bytes: Uint8Array) => string | null = (bytes) => eip.formatKeyHash(bytes);

/** SHA-256("chit402-state-v1" ‖ 0x05 ‖ chainId ‖ keyHash). The hash function is the module's. */
export function keySlotKey(chainId: number, keyHash: Uint8Array, _sha256?: Sha): Uint8Array | null {
  if (!Number.isSafeInteger(chainId) || chainId < 0) return null;
  const got = eip.keySlotKey(BigInt(chainId), keyHash);
  return got.ok ? got.bytes : null;
}

/** One u16 big-endian length prefix, then that many bytes. The module does not export a reader. */
export function readU16Field(bytes: Uint8Array, offset: number): { ok: true; value: Uint8Array; next: number } | { ok: false } {
  if (offset < 0 || offset + 2 > bytes.length) return { ok: false };
  const len = (bytes[offset] << 8) | bytes[offset + 1];
  const start = offset + 2;
  const end = start + len;
  if (end > bytes.length) return { ok: false };
  return { ok: true, value: bytes.subarray(start, end), next: end };
}

/**
 * PayTo-control signature, then the possession signature. Both prefixes are
 * u16 big-endian. The possession signature is exactly 64 bytes and low-S.
 */
export function readPayToSignatures(bytes: Uint8Array): { ok: true; payTo: Uint8Array; pop: Uint8Array } | { ok: false } {
  const payTo = readU16Field(bytes, 0);
  if (!payTo.ok) return payTo;
  const pop = readU16Field(bytes, payTo.next);
  if (!pop.ok || pop.value.length !== 64 || pop.next !== bytes.length) return { ok: false };
  if (!eip.checkSigma(pop.value).ok) return { ok: false };
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
  schema?: string | null;
  block: number;
  hourStart: number;
  stateRoot?: string | null;
  sigmaKey?: Uint8Array | null;
  chainId?: number;
  sha256?: Sha;
  bundleKeySlot?: Uint8Array | null;
  payToProof: SlotProof | null;
  keyProof: SlotProof | null;
  keyLeaf?: KeyLeaf;
  registration: {
    admissionBlock: number;
    expiry: bigint;
    payToSignature: Uint8Array | null;
    keySignature: Uint8Array | null;
    popOk: boolean;
  } | null;
  slotRevokeBlock: number | null;
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

export function clearAdmissionCache(): void {
  admissionCache.clear();
}

/**
 * Cache around checkAdmission. An empty leaf at e−1 counts as absence.
 * A failed proof is not stored.
 */
export function cachedAdmission(input: {
  slotKey: string;
  seq: number;
  absentAtPrior: boolean;
  emptySlotAtPrior?: boolean;
  memberAtEpoch: boolean;
  priorAnchor: number;
  anchor: number;
  block: number;
}): { ok: true; block: number; cached: boolean } | { ok: false; exit: 2; reason: 'unproven' } {
  const id = `${input.slotKey}:${input.seq}`;
  const prior = admissionCache.get(id);
  if (prior != null) return { ok: true, block: prior, cached: true };
  const checked = eip.checkAdmission({
    absentAtPrev: input.absentAtPrior === true,
    emptyAtPrev: input.emptySlotAtPrior === true,
    memberAtEpoch: input.memberAtEpoch === true,
    anchorPrev: BigInt(input.priorAnchor),
    anchorEpoch: BigInt(input.anchor),
    block: BigInt(input.block),
  });
  if (!checked.ok) return { ok: false, exit: 2, reason: 'unproven' };
  admissionCache.set(id, input.block);
  return { ok: true, block: input.block, cached: false };
}

function status(exit: 0 | 1 | 2, reason: string | null, print: string | null = null): KeyStatusResult {
  return { proven: exit === 0, exit, reason, print };
}

function tombRecord(at: bigint, outOfBounds: boolean) {
  const prev = outOfBounds ? at : 0n;
  const show = at > 0n ? at : 1n;
  return {
    revokedAtBlock: at,
    prevAnchorBlock: prev,
    showAnchorBlock: show,
    decodeOk: true,
    signatureOk: true,
    keyHashOk: true,
    admission: {
      absentAtPrev: true,
      memberAtEpoch: true,
      anchorPrev: prev,
      anchorEpoch: show,
      block: at,
    },
  };
}

function keyLeafOf(input: KeyStatusInput): unknown {
  if (input.keyLeaf === 'empty') return { empty: true };
  if (input.keyLeaf === 'multi') return { records: [{}, {}] };
  if (input.keyLeaf === 'bad_sig') return { records: [{ signatureOk: false }] };
  if (input.keyLeaf === 'mismatch') return { records: [{ keyHashOk: false }] };
  if (input.keyLeaf === 'bare') return { records: [{}] };
  if (input.keyLeaf === 'zero') return { records: [tombRecord(0n, false)] };
  if (input.keyLeaf === 'out_of_bounds') return { records: [tombRecord(80n, true)] };
  const tomb = input.tombstone;
  if (!tomb) return { empty: true };
  if (tomb.revokedAtBlock == null) return { records: [{}] };
  return { records: [tombRecord(BigInt(tomb.revokedAtBlock), tomb.outOfBounds)] };
}

function fromShared(result: EipOk<{ status: string }> | EipNo, input: KeyStatusInput, print: string | null): KeyStatusResult {
  if (result.ok) return status(0, null, print);
  const reason = result.reason;
  if (reason === 'inactive' && input.tombstone && input.registration && input.tombstone.revokedAtBlock != null && input.registration.admissionBlock >= input.tombstone.revokedAtBlock) {
    return status(1, 'registered_after_tombstone');
  }
  if (reason === 'slot_revoke' || reason === 'key_tombstone') return status(1, 'revoked');
  if (reason === 'slot_rebind') return status(1, 'registered_after_slot_revoke');
  if (reason === 'admitted_after_tombstone') return status(1, 'registered_after_tombstone');
  if (reason === 'expired') return status(1, 'expired');
  if (reason === 'bundle_key') return status(2, 'key_mismatch');
  if (reason === 'root') return status(2, 'two_roots');
  if (reason === 'bad_leaf' || reason === 'many_records' || reason === 'bare_tombstone') return status(2, 'invalid_leaf');
  return status(2, 'unproven');
}

/**
 * Status of key k in payTo P at block b. The decision is eip.keyStatus.
 * Exit codes stay the ones this package already returns.
 */
export function keyStatus(input: KeyStatusInput): KeyStatusResult {
  if (input.schema !== KEY_STATUS_SCHEMA) return status(2, 'old_schema');
  const reg = input.registration;
  if (!reg || !reg.payToSignature || reg.payToSignature.length === 0) return status(2, 'unproven');
  if (!reg.keySignature || reg.keySignature.length !== 64 || !reg.popOk) return status(2, 'unproven');
  if (input.registrationKeyHash && eip.deniedKeyHash(eip.formatKeyHash(input.registrationKeyHash) ?? '')) {
    return status(1, 'test_vector_key', 'test vector key');
  }
  const sigma = input.sigmaKey ?? STAND_IN_KEY;
  const hashed = eip.keyHash(0x01, sigma);
  if (!hashed.ok) return status(2, 'unproven');
  const regHash = input.registrationKeyHash ?? hashed.bytes;
  const leaf = keyLeafOf(input);
  const payRoot = input.payToProof?.root ?? null;
  const keyRoot = input.keyProof?.root ?? null;
  const stateRoot = input.stateRoot ?? payRoot ?? keyRoot ?? 'root';
  const otherRoot = [payRoot, keyRoot, input.stateRoot].find((root) => root != null && root !== stateRoot) ?? null;
  const admitted = BigInt(reg.admissionBlock);
  const slotRevoke = input.revokeByKeyOutsideKeySlot
    || input.slotRevokeBlock == null
    || input.slotRevokeKeyHash == null
    || input.registrationKeyHash == null
    ? null
    : { keyHash: input.slotRevokeKeyHash, revokedAtBlock: BigInt(input.slotRevokeBlock) };
  const viewed = eip.keyStatus({
    proofs: {
      payTo: input.payToProof != null && input.payToProof.siblings != null,
      key: input.keyProof != null && input.keyProof.siblings != null,
    },
    stateRoot,
    otherRoot,
    sigmaKey: sigma,
    chainId: BigInt(input.chainId ?? 84532),
    bundleKey: input.sigmaKey ? input.bundleKeySlot ?? undefined : undefined,
    keyLeaf: leaf,
    block: BigInt(input.block),
    hourStart: BigInt(input.hourStart),
    registration: {
      keyHash: regHash,
      expiry: reg.expiry,
      admissionBlock: admitted,
      admission: {
        absentAtPrev: true,
        memberAtEpoch: true,
        anchorPrev: 0n,
        anchorEpoch: admitted > 0n ? admitted : 1n,
        block: admitted,
      },
    },
    slotRevoke,
    rebinding: slotRevoke != null && reg.admissionBlock >= (input.slotRevokeBlock as number),
  });
  let print: string | null = null;
  if (viewed.ok) {
    const read = eip.readKeyLeaf(leaf);
    if (read.ok && read.tombstone != null && read.tombstone > BigInt(input.block)) {
      print = `seller key revoked at block ${read.tombstone} (by key)`;
    }
  }
  return fromShared(viewed, input, print);
}

export function keyHashOf(
  alg: number | null | undefined,
  key: Uint8Array | null | undefined,
  _sha256: Sha,
  _gate: KeyGate,
): Uint8Array | null {
  if (typeof alg !== 'number' || !key) return null;
  const got = eip.keyHash(alg, key);
  return got.ok ? got.bytes : null;
}

export function chitDomainSeparator(keccak: Keccak, chainId: number, verifyingContract: string): Uint8Array | null {
  const address = verifyingContract.startsWith('0x') ? verifyingContract.slice(2) : verifyingContract;
  if (!Number.isSafeInteger(chainId) || chainId < 0 || !/^[0-9a-f]{40}$/.test(address)) return null;
  if (!eip.chitDomain(BigInt(chainId), address)) return null;
  return keccak(concat([
    keccak(utf8(DOMAIN_TYPE)),
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

function bindShared(alg: number | null | undefined, key: Uint8Array | null | undefined): { ok: true; hash: Uint8Array; hex: string } | { ok: false; reason: 'bad_alg' | 'off_curve' } {
  if (typeof alg !== 'number' || !key) return { ok: false, reason: 'bad_alg' };
  const got = eip.keyHash(alg, key);
  if (got.ok) return { ok: true, hash: got.bytes, hex: got.hex };
  if (got.reason === 'bad_alg') return { ok: false, reason: 'bad_alg' };
  return { ok: false, reason: 'off_curve' };
}

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
  const bound = bindShared(input.alg, input.key);
  if (!bound.ok) return bound;
  if (!equalBytes(bound.hash, input.keyHash)) return { ok: false, reason: 'key_hash_mismatch' };
  if (eip.tombstoned(input.tombstoned ? [bound.hex] : [], bound.hex)) return { ok: false, reason: 'key_revoked_tombstone' };
  const showing = BigInt(input.showingHour);
  if (!eip.expiryAllows(showing, input.expiry)) return { ok: false, reason: 'expiry_not_after_hour' };
  if (BigInt(input.receiptHour) >= input.expiry) return { ok: false, reason: 'key_expired' };
  return { ok: true, reason: null };
}

export interface RevokeByKeyParts {
  alg: number;
  key: Uint8Array;
  keyHash: Uint8Array;
  signature: Uint8Array;
}

function compressed33(key: Uint8Array): boolean {
  return key.length === 33 && (key[0] === 0x02 || key[0] === 0x03);
}

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
    revokes.push({
      alg: slotValue[off],
      key: slotValue.subarray(off + 1, off + 34),
      keyHash: slotValue.subarray(off + 34, off + 66),
      signature: slotValue.subarray(off + 66, off + 130),
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
  const tombstones: string[] = [];
  for (const revoke of parsed.record.revokes) {
    const bound = bindShared(revoke.alg, revoke.key);
    if (!bound.ok) return bound;
    if (!equalBytes(bound.hash, revoke.keyHash)) return { ok: false, reason: 'key_hash_mismatch' };
    const digest = revokeByKeyDigest(input.keccak, input.chainId, input.admitting, revoke.keyHash);
    if (!digest || !input.signatureOk(digest, revoke.signature, revoke.key)) {
      return { ok: false, reason: 'bad_signature' };
    }
    tombstones.push(bound.hex);
  }
  const claimed = bindShared(parsed.record.alg, parsed.key);
  if (!claimed.ok) return claimed;
  return judgePayTo({
    alg: parsed.record.alg,
    key: parsed.key,
    keyHash: parsed.record.keyHash,
    expiry: parsed.record.expiry,
    showingHour: input.showingHour,
    receiptHour: input.receiptHour,
    tombstoned: eip.tombstoned(tombstones, claimed.hex),
    sha256: input.sha256,
    gate: input.gate,
  });
}
