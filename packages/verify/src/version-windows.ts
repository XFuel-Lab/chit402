/**
 * Signed version validity windows (verifier redesign step 3, rule #1a).
 *
 * Each receipt version has a window on the issuer's clock. A version opens
 * when the code that signs it merged (GitHub merge time) and, once the next
 * version shipped, closes at the next version's merge time plus a deploy
 * grace. A receipt whose signed `iat` is after its version's close is
 * refused. For a receipt that has a log entry, the log time (chain time of
 * the earliest anchored signed head that covers the leaf) must also be at or
 * before the close plus a log grace (spec L5, check-input.ts).
 *
 * The lower bound (`iat` before the version opened) is enforced only for
 * versions marked `floor`. Up to v10 the issuer re-signed a stored receipt
 * on each read with its original `iat`, so a real v8 to v10 receipt can carry
 * an `iat` from before its version merged.
 *
 * The windows ship as a signed companion document (version-windows.json),
 * not as issuer-history entries: an extra entry type in issuer-history.json
 * would fail every 0.4.x client (entry hash, status set, prefix check, and
 * the v10 history pin). The bundled bytes are pinned by SHA-256 here, so the
 * windows enforced offline are exactly the reviewed ones whatever key signed
 * them. The signature is reported, and the publish check refuses a package
 * whose document is not signed by the production issuer key.
 */
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { jcsCanonicalize } from './jcs.js';
import type { Es256Jwk } from './jws.js';

export const VERSION_WINDOWS_SCHEMA = 'chit402.version_windows.v1';
export const VERSION_WINDOWS_TYP = 'chit402-version-windows+jwt';
/** SHA-256 of version-windows.json (LF newlines). Changes only with the document. */
export const VERSION_WINDOWS_SHA256 = 'f6c92c9e76385d336aa14ce25d061d57b2e4289acde51afe6447fe6f65ab62d2';
/** Production issuer kid. The windows document must be signed by it before publish. */
export const VERSION_WINDOWS_PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

export interface VersionWindow {
  /** Registry id (version-registry.ts), e.g. `pv9`. */
  id: string;
  not_before: string;
  /** Null while the version is still issued. */
  not_after: string | null;
  /** When true, an `iat` before `not_before` is refused. */
  floor: boolean;
  basis: string;
}

export type WindowsSignature = 'production' | 'not_production' | 'invalid';

export interface VersionWindows {
  ok: boolean;
  reason: string | null;
  log_grace_seconds: number;
  windows: ReadonlyMap<string, VersionWindow>;
  signature: WindowsSignature;
  signed_kid: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const WINDOW_KEYS = 'basis,floor,id,not_after,not_before';

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function failed(reason: string): VersionWindows {
  return Object.freeze({
    ok: false,
    reason,
    log_grace_seconds: 0,
    windows: new Map(),
    signature: 'invalid' as const,
    signed_kid: null,
  });
}

function validWindow(w: unknown): w is VersionWindow {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return false;
  const r = w as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== WINDOW_KEYS) return false;
  if (typeof r.id !== 'string' || !r.id) return false;
  if (typeof r.not_before !== 'string' || !ISO.test(r.not_before)) return false;
  if (r.not_after !== null && (typeof r.not_after !== 'string' || !ISO.test(r.not_after))) return false;
  if (typeof r.not_after === 'string' && Date.parse(r.not_after) < Date.parse(r.not_before)) return false;
  return typeof r.floor === 'boolean' && typeof r.basis === 'string';
}

/** SHA-256 over the JCS of the document without `issuer_signature`. The JWS signs this. */
export function versionWindowsBodyHash(doc: Record<string, unknown>): string {
  const { issuer_signature: _sig, ...body } = doc;
  return sha256(jcsCanonicalize(body));
}

function signatureStatus(
  doc: Record<string, unknown>,
  keys: readonly { kid: string; jwk: Es256Jwk }[],
): { status: WindowsSignature; kid: string | null } {
  const sig = doc.issuer_signature as { jws?: unknown; kid?: unknown } | undefined;
  if (!sig || typeof sig.jws !== 'string') return { status: 'invalid', kid: null };
  const parts = sig.jws.split('.');
  if (parts.length !== 3) return { status: 'invalid', kid: null };
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { status: 'invalid', kid: null };
  }
  const kid = typeof header.kid === 'string' ? header.kid : null;
  if (header.alg !== 'ES256' || header.typ !== VERSION_WINDOWS_TYP || !kid || sig.kid !== kid) {
    return { status: 'invalid', kid };
  }
  if (payload.schema !== VERSION_WINDOWS_SCHEMA || payload.body_sha256 !== versionWindowsBodyHash(doc)) {
    return { status: 'invalid', kid };
  }
  const key = keys.find((k) => k.kid === kid);
  if (!key) return { status: 'not_production', kid };
  try {
    const ok = verifySignature('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), {
      key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: key.jwk.x, y: key.jwk.y }, format: 'jwk' }),
      dsaEncoding: 'ieee-p1363',
    }, Buffer.from(parts[2], 'base64url'));
    if (!ok) return { status: 'invalid', kid };
  } catch {
    return { status: 'invalid', kid };
  }
  return { status: kid === VERSION_WINDOWS_PRODUCTION_KID ? 'production' : 'not_production', kid };
}

/**
 * Parse the document. A digest mismatch or any malformed field fails closed
 * (`ok: false`); the caller then refuses every version that needs a window.
 * `keys` are the issuer keys the signature is checked against (the
 * production key from the bundled issuer history in normal use).
 */
export function parseVersionWindows(
  bytes: string,
  {
    expectedSha256 = VERSION_WINDOWS_SHA256,
    keys = [],
  }: { expectedSha256?: string | null; keys?: readonly { kid: string; jwk: Es256Jwk }[] } = {},
): VersionWindows {
  const normalized = bytes.replace(/\r\n/g, '\n');
  if (expectedSha256 !== null && sha256(normalized) !== expectedSha256) return failed('version_windows_digest_mismatch');
  let doc: unknown;
  try {
    doc = JSON.parse(normalized);
  } catch {
    return failed('version_windows_unreadable');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return failed('version_windows_unreadable');
  const d = doc as Record<string, unknown>;
  if (d.schema !== VERSION_WINDOWS_SCHEMA) return failed('version_windows_schema');
  if (!Number.isSafeInteger(d.log_grace_seconds) || (d.log_grace_seconds as number) < 0) return failed('version_windows_log_grace');
  if (!Array.isArray(d.windows) || !d.windows.every(validWindow)) return failed('version_windows_entry');
  const windows = new Map<string, VersionWindow>();
  for (const w of d.windows as VersionWindow[]) {
    if (windows.has(w.id)) return failed('version_windows_duplicate');
    windows.set(w.id, Object.freeze({ ...w }));
  }
  const sig = signatureStatus(d, keys);
  return Object.freeze({
    ok: true,
    reason: null,
    log_grace_seconds: d.log_grace_seconds as number,
    windows,
    signature: sig.status,
    signed_kid: sig.kid,
  });
}

function bundledKeys(): { kid: string; jwk: Es256Jwk }[] {
  try {
    const require = createRequire(__filename);
    const history = JSON.parse(readFileSync(require.resolve('../issuer-history.snapshot.json'), 'utf8')) as {
      entries?: { kid?: string; jwk?: Es256Jwk }[];
    };
    return (history.entries || [])
      .filter((e) => e && e.kid === VERSION_WINDOWS_PRODUCTION_KID && e.jwk)
      .map((e) => ({ kid: e.kid as string, jwk: e.jwk as Es256Jwk }));
  } catch {
    return [];
  }
}

let bundled: VersionWindows | null = null;

/** The windows bundled with this package, digest-checked. */
export function loadBundledVersionWindows(): VersionWindows {
  if (bundled) return bundled;
  try {
    const require = createRequire(__filename);
    bundled = parseVersionWindows(readFileSync(require.resolve('../version-windows.json'), 'utf8'), { keys: bundledKeys() });
  } catch {
    bundled = failed('version_windows_unreadable');
  }
  return bundled;
}

/** Window id for a signed payload version, or null when it has none. */
export function windowIdForPayloadVersion(version: number, issuerRoot = false): string | null {
  if (!Number.isInteger(version) || version < 1) return null;
  if (version <= 10) return `pv${version}`;
  if (version === 11) return issuerRoot ? 'pv11-issuer-root' : null;
  return null;
}

export function parseIssuedAt(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export type SignedTimeResult =
  | { ok: true; closed: boolean; window: VersionWindow }
  | { ok: false; reason: 'version_window_missing' | 'version_window_closed' | 'version_window_not_open' | 'issued_at_missing'; window: VersionWindow | null };

/** Signed-time check: `iat` against the version's window. */
export function checkSignedTime(id: string | null, issuedAt: unknown, windows: VersionWindows): SignedTimeResult {
  const window = id && windows.ok ? windows.windows.get(id) ?? null : null;
  if (!window) return { ok: false, reason: 'version_window_missing', window: null };
  // An open window with no floor bounds nothing, so iat is not needed.
  if (window.not_after === null && !window.floor) return { ok: true, closed: false, window };
  const iat = parseIssuedAt(issuedAt);
  if (iat == null) return { ok: false, reason: 'issued_at_missing', window };
  if (window.not_after !== null && iat > Date.parse(window.not_after)) return { ok: false, reason: 'version_window_closed', window };
  if (window.floor && iat < Date.parse(window.not_before)) return { ok: false, reason: 'version_window_not_open', window };
  return { ok: true, closed: window.not_after !== null, window };
}

/** Log-time check (L5): the log time must be at or before close + log grace. Open windows always pass. */
export function checkLogTime(window: VersionWindow, logTimeMs: number, windows: VersionWindows): boolean {
  if (window.not_after === null) return true;
  return logTimeMs <= Date.parse(window.not_after) + windows.log_grace_seconds * 1000;
}
