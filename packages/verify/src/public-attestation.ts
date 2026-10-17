/**
 * Public receipt attestation (0.4.6).
 *
 * A separate ES256 JWS over the public fields of a collected Base USDC
 * receipt. The payload is not JSON: it is the tag line
 * `chit402.public_receipt.v1\n` followed by the RFC 8785 canonical claims.
 * Every verifier before 0.4.6 parses JWS payloads as JSON, so it rejects
 * this payload. The JWS typ is `chit402-public-receipt+jwt`, and
 * verifyIssuerJws refuses that typ, so the attestation can never stand in
 * for a receipt, head, epoch, refusal, or history signature.
 *
 * The claims are an exact allowlist. `payload_version` and `v` are not
 * allowed: the version is the tag line.
 */

import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { jcsCanonicalize } from './jcs.js';
import { jwkThumbprint, isEs256PublicJwk, PUBLIC_RECEIPT_TYP, type Es256Jwk } from './jws.js';
import { epochHistoryKeyAllowed, type IssuerHistoryDocument } from './issuer-history.js';
import { USDC_ADDRESSES } from './base-payer.js';

export { PUBLIC_RECEIPT_TYP };
export const PUBLIC_RECEIPT_TAG = 'chit402.public_receipt.v1';
export const PUBLIC_RECEIPT_PREFIX = `${PUBLIC_RECEIPT_TAG}\n`;

/** Exact top-level claim keys, sorted. */
export const PUBLIC_RECEIPT_CLAIM_KEYS = Object.freeze([
  'attested_at',
  'iss',
  'issued_at',
  'log',
  'payment',
  'task_id',
]);
export const PUBLIC_RECEIPT_PAYMENT_KEYS = Object.freeze([
  'asset',
  'gross_amount',
  'payee',
  'rail',
  'ref',
  'settled_amount',
]);
export const PUBLIC_RECEIPT_LOG_KEYS = Object.freeze(['epoch', 'leaf_hash', 'leaf_index']);
export const PUBLIC_RECEIPT_HEADER_KEYS = Object.freeze(['alg', 'kid', 'typ']);

export interface PublicReceiptClaims {
  attested_at: string;
  iss: 'chit402';
  issued_at: string;
  log: { epoch: number; leaf_hash: string; leaf_index: number };
  payment: {
    asset: string;
    gross_amount: string;
    payee: string;
    rail: 'usdc';
    ref: string;
    settled_amount: string;
  };
  task_id: string;
}

export interface ParsedPublicAttestation {
  ok: boolean;
  reason: string | null;
  detail?: string;
  header?: { alg: string; kid: string; typ: string };
  claims?: PublicReceiptClaims;
  signingInput?: string;
  signature?: Buffer;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
const TASK_ID = /^(chit|xfuel)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE_REF = /^base:0x[0-9a-f]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^[1-9][0-9]{0,77}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_REF = /^solana:[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const got = Object.keys(value).sort();
  return got.length === keys.length && got.every((key, i) => key === keys[i]);
}

function minuteTime(value: unknown): number | null {
  if (typeof value !== 'string' || !MINUTE.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return null;
  return ms;
}

function fail(reason: string, detail: string): ParsedPublicAttestation {
  return { ok: false, reason, detail };
}

/** Validate the claim object against the exact allowlist. */
export function checkPublicReceiptClaims(claims: unknown): { ok: boolean; detail: string | null } {
  if (!plainObject(claims)) return { ok: false, detail: 'claims are not an object' };
  if ('payload_version' in claims || 'v' in claims) return { ok: false, detail: 'payload_version and v are not allowed' };
  if (!exactKeys(claims, PUBLIC_RECEIPT_CLAIM_KEYS)) return { ok: false, detail: 'claim keys are not the allowlist' };
  if (claims.iss !== 'chit402') return { ok: false, detail: 'iss' };
  if (typeof claims.task_id !== 'string' || !TASK_ID.test(claims.task_id)) return { ok: false, detail: 'task_id' };
  const issued = minuteTime(claims.issued_at);
  const attested = minuteTime(claims.attested_at);
  if (issued == null) return { ok: false, detail: 'issued_at is not a minute' };
  if (attested == null) return { ok: false, detail: 'attested_at is not a minute' };
  if (issued > attested) return { ok: false, detail: 'issued_at is after attested_at' };
  const payment = claims.payment;
  if (!plainObject(payment) || !exactKeys(payment, PUBLIC_RECEIPT_PAYMENT_KEYS)) return { ok: false, detail: 'payment keys' };
  if (payment.rail !== 'usdc') return { ok: false, detail: 'payment.rail' };
  if (typeof payment.ref === 'string' && SOLANA_REF.test(payment.ref)) {
    // Shape only. 0.4.6 does not check Solana; the caller reports exit 2
    // after the signature verifies.
    if (typeof payment.asset !== 'string' || !BASE58.test(payment.asset)) return { ok: false, detail: 'payment.asset' };
    if (typeof payment.payee !== 'string' || !BASE58.test(payment.payee)) return { ok: false, detail: 'payment.payee' };
  } else {
    if (typeof payment.ref !== 'string' || !BASE_REF.test(payment.ref)) return { ok: false, detail: 'payment.ref' };
    if (typeof payment.asset !== 'string' || payment.asset.toLowerCase() !== USDC_ADDRESSES.base.toLowerCase()) {
      return { ok: false, detail: 'payment.asset' };
    }
    if (typeof payment.payee !== 'string' || !EVM_ADDRESS.test(payment.payee)) return { ok: false, detail: 'payment.payee' };
  }
  if (typeof payment.gross_amount !== 'string' || !AMOUNT.test(payment.gross_amount)) return { ok: false, detail: 'payment.gross_amount' };
  if (typeof payment.settled_amount !== 'string' || !AMOUNT.test(payment.settled_amount)) return { ok: false, detail: 'payment.settled_amount' };
  const log = claims.log;
  if (!plainObject(log) || !exactKeys(log, PUBLIC_RECEIPT_LOG_KEYS)) return { ok: false, detail: 'log keys' };
  if (typeof log.leaf_hash !== 'string' || !HEX32.test(log.leaf_hash)) return { ok: false, detail: 'log.leaf_hash' };
  if (!Number.isSafeInteger(log.leaf_index) || (log.leaf_index as number) < 0) return { ok: false, detail: 'log.leaf_index' };
  if (!Number.isSafeInteger(log.epoch) || (log.epoch as number) < 1) return { ok: false, detail: 'log.epoch' };
  return { ok: true, detail: null };
}

/** The exact payload bytes for a claim object. Throws on a claim outside the allowlist. */
export function publicReceiptPayload(claims: PublicReceiptClaims): string {
  const check = checkPublicReceiptClaims(claims);
  if (!check.ok) throw new Error(`public receipt claims: ${check.detail}`);
  return `${PUBLIC_RECEIPT_PREFIX}${jcsCanonicalize(claims)}`;
}

/**
 * Parse without trusting: header keys, typ, tag, canonical form, allowlist.
 * Any failure is `invalid_jws` (exit 1). Nothing here checks the signature.
 */
export function parsePublicAttestation(jws: unknown): ParsedPublicAttestation {
  if (typeof jws !== 'string' || jws.length === 0 || jws.length > 8192) return fail('invalid_jws', 'not a jws string');
  const parts = jws.split('.');
  if (parts.length !== 3 || !parts.every((part) => B64URL.test(part))) return fail('invalid_jws', 'not three base64url parts');
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    return fail('invalid_jws', 'header is not JSON');
  }
  if (!plainObject(header) || !exactKeys(header, PUBLIC_RECEIPT_HEADER_KEYS)) return fail('invalid_jws', 'header keys');
  if (header.alg !== 'ES256') return fail('invalid_jws', 'alg');
  if (header.typ !== PUBLIC_RECEIPT_TYP) return fail('invalid_jws', 'typ');
  if (typeof header.kid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(header.kid)) return fail('invalid_jws', 'kid');
  const payloadBytes = Buffer.from(payloadB64, 'base64url');
  if (payloadBytes.toString('base64url') !== payloadB64) return fail('invalid_jws', 'payload encoding');
  const payload = payloadBytes.toString('utf8');
  if (!payload.startsWith(PUBLIC_RECEIPT_PREFIX)) return fail('invalid_jws', 'payload tag');
  const body = payload.slice(PUBLIC_RECEIPT_PREFIX.length);
  let claims: unknown;
  try {
    claims = JSON.parse(body);
  } catch {
    return fail('invalid_jws', 'claims are not JSON');
  }
  const check = checkPublicReceiptClaims(claims);
  if (!check.ok) return fail('invalid_jws', check.detail || 'claims');
  if (jcsCanonicalize(claims) !== body) return fail('invalid_jws', 'claims are not canonical');
  const signature = Buffer.from(signatureB64, 'base64url');
  if (signature.length !== 64) return fail('invalid_jws', 'signature length');
  return {
    ok: true,
    reason: null,
    header: header as { alg: string; kid: string; typ: string },
    claims: claims as unknown as PublicReceiptClaims,
    signingInput: `${headerB64}.${payloadB64}`,
    signature,
  };
}

export interface PublicAttestationTrust {
  ok: boolean;
  /** signature: `signature_invalid` or `key untrusted`. key_window: a window reason. */
  check: 'signature' | 'key_window' | null;
  reason: string | null;
  jwk?: Es256Jwk;
}

/**
 * Signature and key trust. The key must be a verified issuer-history entry
 * whose JWK thumbprint is the header kid, and that entry must be active and
 * never revoked for the whole attested minute.
 */
export function verifyPublicAttestationTrust(
  parsed: ParsedPublicAttestation,
  history: IssuerHistoryDocument | null,
): PublicAttestationTrust {
  if (!parsed.ok || !parsed.header || !parsed.claims || !parsed.signingInput || !parsed.signature) {
    return { ok: false, check: 'signature', reason: 'signature_invalid' };
  }
  const kid = parsed.header.kid;
  const rows = (history?.entries || []).filter((row) => row.kid === kid && isEs256PublicJwk(row.jwk));
  const jwk = rows.map((row) => row.jwk).find((candidate) => jwkThumbprint(candidate) === kid);
  if (!jwk) return { ok: false, check: 'signature', reason: 'key untrusted' };
  let valid = false;
  try {
    const key: KeyObject = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
    valid = verify('sha256', Buffer.from(parsed.signingInput, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, parsed.signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, check: 'signature', reason: 'signature_invalid' };
  const start = Date.parse(parsed.claims.attested_at);
  const end = start + 59_999;
  const startOk = epochHistoryKeyAllowed(history, kid, new Date(start).toISOString());
  const endOk = epochHistoryKeyAllowed(history, kid, new Date(end).toISOString());
  if (!startOk || !endOk) return { ok: false, check: 'key_window', reason: 'key_window', jwk };
  return { ok: true, check: null, reason: null, jwk };
}

/** chit-<uuid> and xfuel-<uuid> name the same receipt. */
export function sameReceiptId(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const strip = (id: string) => id.trim().toLowerCase().replace(/^(chit|xfuel)-/, '');
  const left = strip(a);
  const right = strip(b);
  return left.length === 36 && left === right;
}
