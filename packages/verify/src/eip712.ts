/**
 * Fixed tree heads and payer bindings: EIP-712 typed structs signed by the
 * issuer P-256 key.
 *
 * Mirrors services/gateway/src/eip712-p256.js, tree-head-eip712.js and
 * receipt-binding-eip712.js. The signed message is the 66-byte preimage
 * 0x19 0x01 || domainSeparator || structHash; the ECDSA hash is
 * SHA-256(preimage) ("sha256(eip712_preimage)"). Domain:
 * EIP712Domain(string name,string version,uint256 chainId,bytes32 salt),
 * version "1", chainId 84532 (Base Sepolia, the v0 escrow chain), salt the
 * log id. The payer binding's network gate is Base mainnet (the signed
 * payment.ref prefix) while its domain chainId is 84532. They differ on
 * purpose, as in the gateway.
 *
 * Offline: no fetch, no RPC.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { keccak256 } from 'ethers';
import { jwkThumbprint, type Es256Jwk } from './jws.js';

export const EIP712_DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,bytes32 salt)';
export const EIP712_DOMAIN_VERSION = '1';
/** Base Sepolia. The escrow v0 contract chain, as on the gateway. */
export const EIP712_CHAIN_ID = 84532;
export const EIP712_DIGEST_ALG = 'sha256(eip712_preimage)';
/** keccak256("chit402.receipt-log.v1" || epoch-1 root || genesis digest). */
export const EXPECTED_LOG_SALT = '0x7a92860b2db8dfee1901affef1a3352ab94a3b3bfcc410aef7238ef170435211';

export const TREE_HEAD_TYPE = 'TreeHead(uint32 epoch,uint64 tree_size,bytes32 root,uint64 published_at,bytes32 kid)';
export const TREE_HEAD_DOMAIN_NAME = 'Chit402TreeHead';
export const FIXED_HEAD_SCHEMA = 'chit402.tree_head_eip712.v1';

export const RECEIPT_BINDING_TYPE = 'ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint64 amount_atomic,bytes32 asset_id,bytes32 kid)';
export const RECEIPT_BINDING_DOMAIN_NAME = 'Chit402ReceiptBinding';
export const PAYER_BINDING_SCHEMA = 'chit402.receipt_binding_eip712.v1';
export const PAYER_COMMITMENT_TAG_TEXT = 'chit402.payer-commitment.v1';
export const BASE_USDC_ASSET_TEXT = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
/** Base mainnet USDC, the only asset a binding is made for. */
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const HEX32 = /^[0-9a-f]{64}$/;
const HEX32_0X = /^0x[0-9a-f]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^[1-9][0-9]*$/;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT32_MAX = 0xffffffff;
const SIGNED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** Spellings of Base mainnet in an optional signed payment.network field. */
const BASE_NETWORKS = new Set(['base', 'eip155:8453']);

class FieldRange extends Error {
  code = 'eip712_field_range';
}

function utf8Keccak(text: string): string {
  return keccak256(Buffer.from(text, 'utf8'));
}

export const EIP712_DOMAIN_TYPEHASH = utf8Keccak(EIP712_DOMAIN_TYPE);
export const TREE_HEAD_TYPEHASH = utf8Keccak(TREE_HEAD_TYPE);
export const RECEIPT_BINDING_TYPEHASH = utf8Keccak(RECEIPT_BINDING_TYPE);
export const PAYER_COMMITMENT_TAG = utf8Keccak(PAYER_COMMITMENT_TAG_TEXT);
export const BASE_USDC_ASSET_ID = utf8Keccak(BASE_USDC_ASSET_TEXT);

function bytesOf0x(hex: string): Buffer {
  return Buffer.from(hex.slice(2), 'hex');
}

function uintWord(value: unknown, bits: number): Buffer {
  let n: bigint;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value);
  else throw new FieldRange('integer field is not a safe integer');
  if (n < 0n || n > (1n << BigInt(bits)) - 1n) throw new FieldRange(`integer field is outside uint${bits}`);
  return Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
}

function bytes32Word(hex: unknown): Buffer {
  if (typeof hex !== 'string' || !HEX32_0X.test(hex)) throw new FieldRange('bytes32 field must be 0x + 64 lowercase hex');
  return bytesOf0x(hex);
}

/** Amounts travel as decimal strings in JSON (uint64 can exceed 2^53). */
function amountValue(v: unknown): unknown {
  if (typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v)) return BigInt(v);
  return v;
}

export function domainSeparator(name: string, salt: string): string {
  return keccak256(Buffer.concat([
    bytesOf0x(EIP712_DOMAIN_TYPEHASH),
    bytesOf0x(utf8Keccak(name)),
    bytesOf0x(utf8Keccak(EIP712_DOMAIN_VERSION)),
    uintWord(EIP712_CHAIN_ID, 256),
    bytes32Word(salt),
  ]));
}

/** bytes32 form of a base64url RFC 7638 thumbprint kid. Throws on anything else. */
export function kidBytes32(kid: unknown): string {
  const text = String(kid || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new FieldRange('kid must be 43 base64url characters');
  const raw = Buffer.from(text, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== text) throw new FieldRange('kid must decode to exactly 32 bytes');
  return `0x${raw.toString('hex')}`;
}

export interface TreeHeadMessage {
  epoch: number;
  tree_size: number;
  root: string;
  published_at: number;
  kid: string;
}

export interface ReceiptBindingMessage {
  leaf_hash: string;
  payer_commitment: string;
  amount_atomic: string;
  asset_id: string;
  kid: string;
}

function treeHeadStructHash(m: TreeHeadMessage): string {
  return keccak256(Buffer.concat([
    bytesOf0x(TREE_HEAD_TYPEHASH),
    uintWord(m.epoch, 32),
    uintWord(m.tree_size, 64),
    bytes32Word(m.root),
    uintWord(m.published_at, 64),
    bytes32Word(m.kid),
  ]));
}

function receiptBindingStructHash(m: ReceiptBindingMessage): string {
  return keccak256(Buffer.concat([
    bytesOf0x(RECEIPT_BINDING_TYPEHASH),
    bytes32Word(m.leaf_hash),
    bytes32Word(m.payer_commitment),
    uintWord(amountValue(m.amount_atomic), 64),
    bytes32Word(m.asset_id),
    bytes32Word(m.kid),
  ]));
}

export interface TypedDigest {
  typehash: string;
  domainName: string;
  domainSeparator: string;
  structHash: string;
  preimage: Buffer;
  e: string;
}

/** Everything a verifier recomputes for one typed struct. Throws on a field out of range. */
export function typedDigest(kind: 'TreeHead' | 'ReceiptBinding', message: unknown, salt: string): TypedDigest {
  const tree = kind === 'TreeHead';
  if (!tree && kind !== 'ReceiptBinding') throw new FieldRange('typed struct kind is not allowed');
  const structHash = tree
    ? treeHeadStructHash(message as TreeHeadMessage)
    : receiptBindingStructHash(message as ReceiptBindingMessage);
  const domainName = tree ? TREE_HEAD_DOMAIN_NAME : RECEIPT_BINDING_DOMAIN_NAME;
  const domainSep = domainSeparator(domainName, salt);
  const preimage = Buffer.concat([Buffer.from([0x19, 0x01]), bytes32Word(domainSep), bytes32Word(structHash)]);
  return {
    typehash: tree ? TREE_HEAD_TYPEHASH : RECEIPT_BINDING_TYPEHASH,
    domainName,
    domainSeparator: domainSep,
    structHash,
    preimage,
    e: `0x${createHash('sha256').update(preimage).digest('hex')}`,
  };
}

/** r || s over the preimage under a P-256 JWK. High-S verifies too, as on the gateway and the contract. */
export function verifyTypedSignature(preimage: Buffer, r: unknown, s: unknown, jwk: Pick<Es256Jwk, 'x' | 'y'>): boolean {
  try {
    const sig = Buffer.concat([bytes32Word(r), bytes32Word(s)]);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    return cryptoVerify('sha256', preimage, { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

/** Strict ISO time to floor(ms / 1000). Null for anything else. */
export function publishedAtSeconds(value: unknown): number | null {
  if (typeof value !== 'string' || !SIGNED_TIME.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return Math.floor(ms / 1000);
}

/** TreeHead message from the signed JWS head claims and the head's kid. Throws on a field out of range. */
export function treeHeadMessageFromClaims(claims: Record<string, unknown> | null | undefined, kid: string): TreeHeadMessage {
  const epoch = claims?.epoch;
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0 || epoch > UINT32_MAX) throw new FieldRange('epoch out of range');
  const treeSize = claims?.tree_size;
  if (typeof treeSize !== 'number' || !Number.isSafeInteger(treeSize) || treeSize < 0) throw new FieldRange('tree_size out of range');
  const root = claims?.root;
  if (typeof root !== 'string' || !HEX32.test(root)) throw new FieldRange('root must be 64 lowercase hex');
  const publishedAt = publishedAtSeconds(claims?.published_at);
  if (publishedAt == null) throw new FieldRange('published_at is not a signed time');
  return { epoch, tree_size: treeSize, root: `0x${root}`, published_at: publishedAt, kid: kidBytes32(kid) };
}

/** `base:0x<64 hex>` in lowercase, or null. A string only. Same as the gateway's normalizeBaseRef. */
export function normalizeBaseRef(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const m = /^(?:base|eip155:8453):(0x[0-9a-fA-F]{64})$/.exec(ref.trim());
  return m ? `base:${m[1].toLowerCase()}` : null;
}

export type BindingInputs =
  | { ok: true; payer: string; amount_atomic: string }
  | { ok: false; reason: string };

/**
 * Binding inputs from the signed receipt claims only. Same order and reason
 * codes as the gateway's bindingInputsFromClaims.
 */
export function bindingInputsFromClaims(claims: unknown): BindingInputs {
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'no_claims' };
  const c = claims as Record<string, unknown>;
  const payer = (c.caller_binding as Record<string, unknown> | null | undefined)?.payer_wallet;
  if (typeof payer !== 'string' || !EVM_ADDRESS.test(payer) || /^0x0{40}$/i.test(payer)) return { ok: false, reason: 'no_payer' };
  const pay = c.payment as Record<string, unknown> | null | undefined;
  if (!pay || typeof pay !== 'object') return { ok: false, reason: 'no_payment' };
  if (pay.rail != null && pay.rail !== 'usdc') return { ok: false, reason: 'asset' };
  if (pay.ref == null || (typeof pay.ref === 'string' && pay.ref.trim() === '')) return { ok: false, reason: 'no_payment_ref' };
  if (typeof pay.ref !== 'string' || !normalizeBaseRef(pay.ref)) return { ok: false, reason: 'network' };
  if (pay.network != null && !BASE_NETWORKS.has(String(pay.network).trim().toLowerCase())) return { ok: false, reason: 'network' };
  if (typeof pay.asset !== 'string' || pay.asset.toLowerCase() !== BASE_USDC.toLowerCase()) return { ok: false, reason: 'asset' };
  const gross = pay.gross_amount == null ? '' : String(pay.gross_amount);
  if (!AMOUNT.test(gross) || BigInt(gross) > UINT64_MAX) return { ok: false, reason: 'amount' };
  return { ok: true, payer, amount_atomic: gross };
}

/** keccak256(abi.encode(PAYER_COMMITMENT_TAG, payer, payer_salt)). */
export function payerCommitment(payer: string, payerSalt: Buffer): string {
  if (typeof payer !== 'string' || !EVM_ADDRESS.test(payer)) throw new FieldRange('payer must be a 20-byte address');
  if (!Buffer.isBuffer(payerSalt) || payerSalt.length !== 32) throw new FieldRange('payer salt must be 32 bytes');
  const addressWord = Buffer.concat([Buffer.alloc(12), Buffer.from(payer.slice(2), 'hex')]);
  return keccak256(Buffer.concat([bytesOf0x(PAYER_COMMITMENT_TAG), addressWord, payerSalt]));
}

/** SHA-256(0x00 || `${task_id}|${row_hash}`), lowercase hex. The log leaf. */
export function receiptLeafHash(taskId: string, rowHash: string): string {
  return createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${taskId}|${rowHash}`)])).digest('hex');
}

/**
 * First key in `candidates` whose RFC 7638 thumbprint is `kid`. The kid of
 * every issuer key is its thumbprint, so this is that key and no other.
 */
export function keyForKid(kid: unknown, candidates: ReadonlyArray<unknown>): Es256Jwk | null {
  if (typeof kid !== 'string' || !kid) return null;
  for (const c of candidates) {
    const jwk = c as Es256Jwk | null | undefined;
    if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256') continue;
    if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') continue;
    try {
      if (jwkThumbprint(jwk) === kid) return jwk;
    } catch {
      // not a key
    }
  }
  return null;
}

function domainOk(domain: unknown, name: string): boolean {
  const d = (domain && typeof domain === 'object' ? domain : {}) as Record<string, unknown>;
  return d.name === name
    && d.version === EIP712_DOMAIN_VERSION
    && d.chainId === EIP712_CHAIN_ID
    && d.salt === EXPECTED_LOG_SALT;
}

function sameKeys(obj: unknown, keys: string[]): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const have = Object.keys(obj).sort();
  const want = [...keys].sort();
  return have.length === want.length && have.every((k, i) => k === want[i]);
}

export type Eip712Check = { ok: true } | { ok: false; reason: string };

/**
 * A fixed head next to a signed JWS tree head. `claims` are the verified
 * head claims, `kid` the head's kid and `jwk` the key that verified the head.
 * The fixed head must say exactly what the JWS head says, under the expected
 * log salt and chainId 84532, signed by the same key.
 */
export function verifyFixedHeadEip712(
  fixed: unknown,
  { claims, kid, jwk }: { claims: Record<string, unknown> | null | undefined; kid: string; jwk: Pick<Es256Jwk, 'x' | 'y'> },
): Eip712Check {
  const f = (fixed && typeof fixed === 'object' ? fixed : null) as Record<string, unknown> | null;
  if (!f || f.schema !== FIXED_HEAD_SCHEMA) return { ok: false, reason: 'schema' };
  if (f.digest_alg !== EIP712_DIGEST_ALG || f.types !== TREE_HEAD_TYPE) return { ok: false, reason: 'type' };
  if (!domainOk(f.domain, TREE_HEAD_DOMAIN_NAME)) return { ok: false, reason: 'domain' };
  let expected: TreeHeadMessage;
  try {
    expected = treeHeadMessageFromClaims(claims, kid);
  } catch {
    return { ok: false, reason: 'head_claims' };
  }
  const m = f.message as Record<string, unknown> | null | undefined;
  if (!sameKeys(m, ['epoch', 'tree_size', 'root', 'published_at', 'kid'])) return { ok: false, reason: 'message' };
  for (const key of Object.keys(expected) as (keyof TreeHeadMessage)[]) {
    if (m?.[key] !== expected[key]) return { ok: false, reason: key === 'kid' ? 'kid' : 'message' };
  }
  let digest: TypedDigest;
  try {
    digest = typedDigest('TreeHead', m, EXPECTED_LOG_SALT);
  } catch {
    return { ok: false, reason: 'field_range' };
  }
  if (!verifyTypedSignature(digest.preimage, f.r, f.s, jwk)) return { ok: false, reason: 'signature' };
  return { ok: true };
}

export type PayerBindingCheck =
  | { checked: true; valid: true }
  | { checked: true; valid: false; reason: string }
  | { checked: false; valid: false; reason: string };

/**
 * A payer binding next to a receipt whose JWS already verified. `claims` are
 * the verified receipt claims, `kid` and `jwk` the key that verified them.
 * `rowHash` (the ledger row hash of the log leaf) links the binding to this
 * receipt; `payerSalt` (0x + 64 hex, owner view) opens the commitment to the
 * signed payer. Without either the binding is not checked.
 */
export function verifyReceiptBindingEip712(
  binding: unknown,
  { claims, kid, jwk, rowHash, payerSalt }: {
    claims: Record<string, unknown> | null | undefined;
    kid: string;
    jwk: Pick<Es256Jwk, 'x' | 'y'>;
    rowHash?: unknown;
    payerSalt?: unknown;
  },
): PayerBindingCheck {
  const b = (binding && typeof binding === 'object' ? binding : null) as Record<string, unknown> | null;
  const fail = (reason: string): PayerBindingCheck => ({ checked: true, valid: false, reason });
  if (!b || b.schema !== PAYER_BINDING_SCHEMA) return fail('schema');
  if (b.digest_alg !== EIP712_DIGEST_ALG || b.types !== RECEIPT_BINDING_TYPE) return fail('type');
  if (!domainOk(b.domain, RECEIPT_BINDING_DOMAIN_NAME)) return fail('domain');
  const m = b.message as Record<string, unknown> | null | undefined;
  if (!sameKeys(m, ['leaf_hash', 'payer_commitment', 'amount_atomic', 'asset_id', 'kid'])) return fail('message');
  let digest: TypedDigest;
  try {
    digest = typedDigest('ReceiptBinding', m, EXPECTED_LOG_SALT);
  } catch {
    return fail('field_range');
  }
  if (!verifyTypedSignature(digest.preimage, b.r, b.s, jwk)) return fail('signature');
  let kidHex: string;
  try {
    kidHex = kidBytes32(kid);
  } catch {
    return fail('kid');
  }
  if (m?.kid !== kidHex) return fail('kid');
  if (m?.asset_id !== BASE_USDC_ASSET_ID) return fail('asset');
  // The signed receipt must be one the gateway binds: Base mainnet ref, Base USDC.
  const inputs = bindingInputsFromClaims(claims);
  if (!inputs.ok) return fail(inputs.reason);
  if (typeof m?.amount_atomic !== 'string' || m.amount_atomic !== inputs.amount_atomic) return fail('amount');
  const taskId = claims?.task_id;
  if (typeof taskId !== 'string' || !taskId) return fail('no_task_id');
  if (typeof rowHash !== 'string' || rowHash === '') return { checked: false, valid: false, reason: 'row_hash_missing' };
  if (m?.leaf_hash !== `0x${receiptLeafHash(taskId, rowHash)}`) return fail('leaf');
  if (typeof payerSalt !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(payerSalt)) {
    return payerSalt == null
      ? { checked: false, valid: false, reason: 'payer_salt_missing' }
      : fail('payer_salt');
  }
  if (payerCommitment(inputs.payer, Buffer.from(payerSalt.slice(2), 'hex')) !== m?.payer_commitment) return fail('commitment');
  return { checked: true, valid: true };
}
