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
 * pinned here, so the list is part of the source digest. It is a placeholder
 * until the production export is reviewed, and is not enforced yet.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const LEGACY_ALLOWLIST_SCHEMA = 'chit402.legacy_allowlist.v1';
/** SHA-256 of legacy-allowlist.json (LF newlines). Changes only with the list. */
export const LEGACY_ALLOWLIST_SHA256 = 'e71ab66447bdd79a98b3345931d4a5319e582858e1c5487e1dcbeb5098a67267';

export type LegacyForm = 'legacy-v4' | 'legacy-v5' | 'detached';

export interface LegacyFingerprint {
  form: LegacyForm;
  task_id: string;
  /** book_chain.row_hash, or null when the receipt has none. */
  row_hash: string | null;
  /** SHA-256 of the signed payload bytes (JWS payload, or the detached canonical payload). */
  payload_sha256: string;
  /** SHA-256 of the signature bytes. */
  signature_sha256: string;
}

export interface LegacyAllowlist {
  ok: boolean;
  status: 'placeholder' | 'final' | null;
  entries: readonly LegacyFingerprint[];
  reason: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
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
 * Parse list bytes. `expectedSha256` defaults to the pinned digest; a
 * mismatch, a bad schema or any malformed entry gives an empty list
 * (fail closed).
 */
export function parseLegacyAllowlist(bytes: string, expectedSha256: string | null = LEGACY_ALLOWLIST_SHA256): LegacyAllowlist {
  const normalized = bytes.replace(/\r\n/g, '\n');
  if (expectedSha256 !== null && sha256(normalized) !== expectedSha256) return failed('legacy_allowlist_digest_mismatch');
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
    const k = `${e.form}|${e.task_id}|${e.payload_sha256}|${e.signature_sha256}`;
    if (seen.has(k)) return failed('legacy_allowlist_duplicate');
    seen.add(k);
  }
  const entries = Object.freeze((d.entries as LegacyFingerprint[]).map((e) => Object.freeze({ ...e })));
  return Object.freeze({ ok: true, status: d.status, entries, reason: null });
}

let bundled: LegacyAllowlist | null = null;

/** The list bundled with this package. */
export function loadBundledLegacyAllowlist(): LegacyAllowlist {
  if (bundled) return bundled;
  try {
    const require = createRequire(__filename);
    bundled = parseLegacyAllowlist(readFileSync(require.resolve('../legacy-allowlist.json'), 'utf8'));
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
  return {
    form,
    task_id: receipt.task_id,
    row_hash: rowHash,
    payload_sha256: sha256(payload),
    signature_sha256: sha256(signature),
  };
}

/** True only for an exact match on the list. A list that failed to load admits nothing. */
export function onLegacyAllowlist(fp: LegacyFingerprint | null, list: LegacyAllowlist = loadBundledLegacyAllowlist()): boolean {
  if (!fp || !list.ok) return false;
  return list.entries.some((e) => e.form === fp.form
    && e.task_id === fp.task_id
    && e.payload_sha256 === fp.payload_sha256
    && e.signature_sha256 === fp.signature_sha256
    && (e.row_hash === null || e.row_hash === fp.row_hash));
}
