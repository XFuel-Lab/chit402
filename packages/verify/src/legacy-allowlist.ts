/**
 * L1 closed allowlist for the grandfathered receipt forms: object JWS
 * receipts whose version is not signed (outer 4/5) and the detached
 * `issuer_signature.value` form.
 *
 * A receipt in these forms is admitted only when its exact fingerprint is on
 * the bundled list: task id, the signed payload bytes, the signature bytes,
 * and the book row hash when the list has one. A new receipt signed in one
 * of these forms, under any key, is not on the list. No date is used: the
 * detached form signs no time field.
 *
 * The list ships in the package (legacy-allowlist.json) and its SHA-256 is
 * pinned here, so the list is part of the source digest. The list is final
 * and empty: the 2026-10-22 production export found no receipt in these
 * forms. The version gate (index.ts) refuses any receipt in these forms that
 * is not listed: legacy_form_not_allowlisted.
 *
 * The list only narrows. A listed receipt still has to pass the normal
 * signature verification; the list never stands in for it (the fingerprint
 * does not cover the JWS header, so it must not). Signatures are fingerprinted
 * in low-S form, so the second valid encoding of an ECDSA signature has the
 * same fingerprint, and the list admits at most one entry per
 * (form, task_id, payload_sha256).
 *
 * Public API: the pinned digest, the schema, and onLegacyAllowlist(fp)
 * against the bundled list. The parser and loader are internal; only the
 * test snapshot seam (internal/test-seam.ts) passes another list.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const LEGACY_ALLOWLIST_SCHEMA = 'chit402.legacy_allowlist.v1';
/** SHA-256 of legacy-allowlist.json (LF newlines). Changes only with the list. */
export const LEGACY_ALLOWLIST_SHA256 = 'ee1498f90cc098b62fdd54dc4378b63d8951366dd9810295f9db8f964d10f3e9';

export type LegacyForm = 'legacy-v4' | 'legacy-v5' | 'detached';

export interface LegacyFingerprint {
  form: LegacyForm;
  task_id: string;
  /** book_chain.row_hash, or null when the receipt has none. */
  row_hash: string | null;
  /** SHA-256 of the signed payload bytes (JWS payload, or the detached canonical payload). */
  payload_sha256: string;
  /** SHA-256 of the signature bytes in low-S form. */
  signature_sha256: string;
}

export interface LegacyAllowlist {
  ok: boolean;
  status: 'placeholder' | 'final' | null;
  entries: readonly LegacyFingerprint[];
  reason: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
// P-256 group order and half order, for low-S normalization.
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_HALF_N = P256_N >> 1n;

/**
 * Low-S form of a 64-byte P-256 (R || S) signature, or null when it is not
 * one: any other length, or r or s outside 0 < x < n. A null fingerprint is
 * on no list, so such a signature is refused.
 */
export function lowSSignature(signature: Buffer): Buffer | null {
  if (signature.length !== 64) return null;
  const r = BigInt(`0x${signature.subarray(0, 32).toString('hex')}`);
  const s = BigInt(`0x${signature.subarray(32).toString('hex')}`);
  if (r <= 0n || r >= P256_N || s <= 0n || s >= P256_N) return null;
  if (s <= P256_HALF_N) return signature;
  const low = (P256_N - s).toString(16).padStart(64, '0');
  return Buffer.concat([signature.subarray(0, 32), Buffer.from(low, 'hex')]);
}
const FORMS = new Set<LegacyForm>(['legacy-v4', 'legacy-v5', 'detached']);

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validEntry(e: unknown): e is LegacyFingerprint {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const r = e as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(',');
  if (keys !== 'form,payload_sha256,row_hash,signature_sha256,task_id') return false;
  return FORMS.has(r.form as LegacyForm)
    && typeof r.task_id === 'string' && r.task_id.length > 0
    && (r.row_hash === null || (typeof r.row_hash === 'string' && HEX64.test(r.row_hash)))
    && typeof r.payload_sha256 === 'string' && HEX64.test(r.payload_sha256)
    && typeof r.signature_sha256 === 'string' && HEX64.test(r.signature_sha256);
}

function failed(reason: string): LegacyAllowlist {
  return Object.freeze({ ok: false, status: null, entries: Object.freeze([]), reason });
}

/**
 * Parse list bytes. Internal: the bundled loader passes the pinned digest;
 * only the test seam passes `unpinnedForTest`. A digest mismatch, a bad
 * schema or any malformed entry gives an empty list (fail closed).
 */
export function parseLegacyAllowlistInternal(bytes: string, { unpinnedForTest = false }: { unpinnedForTest?: boolean } = {}): LegacyAllowlist {
  const normalized = bytes.replace(/\r\n/g, '\n');
  if (!unpinnedForTest && sha256(normalized) !== LEGACY_ALLOWLIST_SHA256) return failed('legacy_allowlist_digest_mismatch');
  let doc: unknown;
  try {
    doc = JSON.parse(normalized);
  } catch {
    return failed('legacy_allowlist_unreadable');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return failed('legacy_allowlist_unreadable');
  const d = doc as Record<string, unknown>;
  if (d.schema !== LEGACY_ALLOWLIST_SCHEMA) return failed('legacy_allowlist_schema');
  if (d.status !== 'placeholder' && d.status !== 'final') return failed('legacy_allowlist_status');
  if (!Array.isArray(d.entries) || !d.entries.every(validEntry)) return failed('legacy_allowlist_entry');
  if (d.status === 'placeholder' && d.entries.length > 0) return failed('legacy_allowlist_status');
  const seen = new Set<string>();
  for (const e of d.entries as LegacyFingerprint[]) {
    // One entry per signed payload: a second signature over the same bytes is not a second receipt.
    const k = `${e.form}|${e.task_id}|${e.payload_sha256}`;
    if (seen.has(k)) return failed('legacy_allowlist_duplicate');
    seen.add(k);
  }
  const entries = Object.freeze((d.entries as LegacyFingerprint[]).map((e) => Object.freeze({ ...e })));
  return Object.freeze({ ok: true, status: d.status, entries, reason: null });
}

let bundled: LegacyAllowlist | null = null;

/** The list bundled with this package (internal). */
export function loadBundledLegacyAllowlistInternal(): LegacyAllowlist {
  if (bundled) return bundled;
  try {
    const require = createRequire(__filename);
    bundled = parseLegacyAllowlistInternal(readFileSync(require.resolve('../legacy-allowlist.json'), 'utf8'));
  } catch {
    bundled = failed('legacy_allowlist_unreadable');
  }
  return bundled;
}

function b64urlBytes(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  return Buffer.from(value, 'base64url');
}

/**
 * Fingerprint of a receipt in one of the L1 forms, or null when the receipt
 * is not in one. `detachedPayload` is the canonical issuer payload string
 * the detached signature covers (index.ts canonicalIssuerPayload).
 */
export function legacyFingerprint(
  receipt: Record<string, unknown>,
  form: LegacyForm,
  detachedPayload?: string,
): LegacyFingerprint | null {
  const sig = receipt.issuer_signature as Record<string, unknown> | undefined;
  if (!sig || typeof sig !== 'object' || typeof receipt.task_id !== 'string') return null;
  const book = receipt.book_chain as Record<string, unknown> | undefined;
  const rowHash = book && typeof book.row_hash === 'string' && HEX64.test(book.row_hash) ? book.row_hash : null;
  let payload: Buffer | null;
  let signature: Buffer | null;
  if (form === 'detached') {
    if (typeof sig.value !== 'string' || typeof detachedPayload !== 'string') return null;
    payload = Buffer.from(detachedPayload, 'utf8');
    signature = b64urlBytes(sig.value);
  } else {
    if (typeof sig.jws !== 'string') return null;
    const parts = sig.jws.split('.');
    if (parts.length !== 3) return null;
    payload = b64urlBytes(parts[1]);
    signature = b64urlBytes(parts[2]);
  }
  if (!payload || !signature || signature.length === 0) return null;
  signature = lowSSignature(signature);
  if (!signature) return null;
  return {
    form,
    task_id: receipt.task_id,
    row_hash: rowHash,
    payload_sha256: sha256(payload),
    signature_sha256: sha256(signature),
  };
}

/** True only for an exact match on the bundled list. */
export function onLegacyAllowlist(fp: LegacyFingerprint | null): boolean {
  return onLegacyAllowlistInternal(fp, loadBundledLegacyAllowlistInternal());
}

/** Internal: match against a given list (the bundled one, or the test seam's). A list that failed to load admits nothing. */
export function onLegacyAllowlistInternal(fp: LegacyFingerprint | null, list: LegacyAllowlist): boolean {
  if (!fp || !list.ok) return false;
  return list.entries.some((e) => e.form === fp.form
    && e.task_id === fp.task_id
    && e.payload_sha256 === fp.payload_sha256
    && e.signature_sha256 === fp.signature_sha256
    && (e.row_hash === null || e.row_hash === fp.row_hash));
}
