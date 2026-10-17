/**
 * Public issuer key history.
 * The document is signed by the current issuer key. Entries chain by
 * SHA-256(JCS(entry without entry_hash)).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { jcsCanonicalize } from './jcs.js';
import {
  verifyIssuerJws,
  jwkThumbprint,
  isPinnedTrustedJwk,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  type Es256Jwk,
} from './jws.js';

interface HistoryJwks {
  keys: Es256Jwk[];
}

export const ISSUER_HISTORY_SCHEMA = 'chit402.issuer_history.v1';

export interface IssuerHistoryEntry {
  kid: string;
  jwk: Es256Jwk;
  alg: string;
  not_before: string;
  not_after?: string | null;
  status: 'active' | 'retired' | 'revoked' | string;
  revoked_at?: string | null;
  reason?: string | null;
  custody?: string;
  prev_hash?: string | null;
  entry_hash?: string;
}

export interface IssuerHistoryPin {
  hash: string;
  version: number;
  seq: number;
}

export interface IssuerHistoryDocument {
  schema?: string;
  version?: number;
  seq?: number;
  entries?: IssuerHistoryEntry[];
  head_hash?: string;
  issuer_signature?: { jws?: string; kid?: string; issuer_jwk?: Es256Jwk };
}

export interface IssuerHistoryCheck {
  checked: boolean;
  ok: boolean;
  unreachable: boolean;
  warning: string | null;
  reason: string | null;
  kid: string | null;
  /**
   * History body that verified (signature and pin). Offline head trust uses
   * this document. Null when nothing loaded, or when the body was rejected.
   */
  document: IssuerHistoryDocument | null;
  /**
   * A body was supplied or fetched. Offline head trust must use `document`
   * or fail closed. Unreachable is not loaded.
   */
  loaded: boolean;
}

function jwsHeaderKid(jws: string): string | null {
  const part = jws.split('.')[0];
  if (!part) return null;
  try {
    const header = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { kid?: unknown };
    return typeof header.kid === 'string' && header.kid ? header.kid : null;
  } catch {
    return null;
  }
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function issuerHistoryEntryBody(entry: IssuerHistoryEntry): Record<string, unknown> {
  return {
    kid: entry.kid,
    jwk: entry.jwk ? {
      kty: entry.jwk.kty,
      crv: entry.jwk.crv,
      x: entry.jwk.x,
      y: entry.jwk.y,
      kid: entry.jwk.kid,
      alg: entry.jwk.alg || 'ES256',
      use: entry.jwk.use || 'sig',
    } : null,
    alg: entry.alg || 'ES256',
    not_before: entry.not_before,
    not_after: entry.not_after ?? null,
    status: entry.status,
    revoked_at: entry.revoked_at ?? null,
    reason: entry.reason ?? null,
    custody: entry.custody,
    prev_hash: entry.prev_hash ?? null,
  };
}

export function issuerHistoryEntryHash(entry: IssuerHistoryEntry): string {
  return sha256Hex(jcsCanonicalize(issuerHistoryEntryBody(entry)));
}

function parseTime(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function verifyIssuerHistoryDocument(
  doc: IssuerHistoryDocument,
  { jwks, trustedKids }: { jwks?: HistoryJwks; trustedKids?: readonly string[] } = {},
): { valid: boolean; reason?: string } {
  if (!doc || doc.schema !== ISSUER_HISTORY_SCHEMA || !Array.isArray(doc.entries) || !doc.entries.length) {
    return { valid: false, reason: 'not_issuer_history' };
  }
  let prev: string | null = null;
  for (const entry of doc.entries) {
    if ((entry.prev_hash ?? null) !== prev) return { valid: false, reason: 'prev_hash_mismatch' };
    if (issuerHistoryEntryHash(entry) !== entry.entry_hash) return { valid: false, reason: 'entry_hash_mismatch' };
    if (!['active', 'retired', 'revoked'].includes(entry.status)) return { valid: false, reason: 'bad_status' };
    prev = entry.entry_hash || null;
  }
  if (kidStatusRegression(doc.entries)) return { valid: false, reason: 'kid_status_regression' };
  const head = doc.entries[doc.entries.length - 1].entry_hash;
  if (doc.head_hash !== head) return { valid: false, reason: 'head_hash_mismatch' };
  const jws = doc.issuer_signature?.jws;
  if (!jws) return { valid: false, reason: 'no_signature' };
  const headerKid = doc.issuer_signature?.kid || null;
  // Undefined matches verifyReceipt / verifyRefusal: the production pin.
  // An explicit empty list (--no-trusted-kid) does not.
  const pins = trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const candidates: Es256Jwk[] = [];
  if (jwks?.keys) {
    for (const key of jwks.keys) {
      if (!headerKid || key.kid === headerKid) candidates.push(key);
    }
  }
  const embedded = doc.issuer_signature?.issuer_jwk;
  if (embedded && isPinnedTrustedJwk(embedded, pins)) candidates.push(embedded);
  if (!candidates.length && embedded && headerKid && pins.includes(headerKid)) {
    if (jwkThumbprint(embedded) === headerKid) candidates.push(embedded);
  }
  if (!candidates.length) return { valid: false, reason: 'key untrusted' };
  for (const jwk of candidates) {
    const result = verifyIssuerJws(jws, jwk);
    if (!result.valid) continue;
    const payload = result.payload || {};
    if (payload.schema !== ISSUER_HISTORY_SCHEMA) return { valid: false, reason: 'schema_mismatch' };
    if (Number(payload.entry_count) !== doc.entries.length) return { valid: false, reason: 'entry_count_mismatch' };
    if (payload.head_hash !== head) return { valid: false, reason: 'signed_head_mismatch' };
    if (payload.version != null && Number(payload.version) !== Number(doc.version)) {
      return { valid: false, reason: 'version_mismatch' };
    }
    if (payload.seq != null && Number(payload.seq) !== Number(doc.seq)) {
      return { valid: false, reason: 'seq_mismatch' };
    }
    if (inheritedKeyWindow(doc.entries)) return { valid: false, reason: 'inherited_key_window' };
    const signerKid = jwsHeaderKid(jws) || headerKid;
    if (signedOnlyByIntroducedKey(doc.entries, signerKid)) {
      return { valid: false, reason: 'introduced_key_signature' };
    }
    return { valid: true };
  }
  return { valid: false, reason: 'signature_invalid' };
}

/**
 * A new kid must not start at or before an earlier kid's not_before.
 * That copy would accept receipts from the old window under the new key.
 */
function inheritedKeyWindow(entries: IssuerHistoryEntry[]): boolean {
  const seen = new Set<string>();
  let maxPrior: number | null = null;
  for (const entry of entries) {
    const start = parseTime(entry?.not_before);
    if (!seen.has(entry?.kid)) {
      if (seen.size > 0 && start != null && maxPrior != null && start <= maxPrior) return true;
      seen.add(entry.kid);
    }
    if (start != null && (maxPrior == null || start > maxPrior)) maxPrior = start;
  }
  return false;
}

/** Same instant is not a change. A missing stamp against a real one is. */
function notBeforeMoved(previous: string | null | undefined, next: string | null | undefined): boolean {
  const left = parseTime(previous);
  const right = parseTime(next);
  if (left == null || right == null) return String(previous ?? '') !== String(next ?? '');
  return left !== right;
}

/**
 * Revocation sticks. A later entry cannot move a kid off `revoked`, a
 * retired kid cannot become active again, and `not_before` cannot move.
 * Moving it earlier would widen the window backwards.
 */
function kidStatusRegression(entries: IssuerHistoryEntry[]): boolean {
  const prior = new Map<string, { status: string; notBefore: string | null | undefined }>();
  for (const entry of entries) {
    const prev = prior.get(entry.kid);
    if (prev) {
      if (prev.status === 'revoked') return true;
      if (prev.status === 'retired' && entry.status === 'active') return true;
      if (notBeforeMoved(prev.notBefore, entry.not_before)) return true;
    }
    prior.set(entry.kid, { status: entry.status, notBefore: entry.not_before });
  }
  return false;
}

/** The signer must already be the genesis key. A key introduced later cannot sign the document that adds it. */
function signedOnlyByIntroducedKey(entries: IssuerHistoryEntry[], signerKid: string | null): boolean {
  if (!signerKid || entries.length < 2) return false;
  const first = entries.findIndex((entry) => entry.kid === signerKid);
  return first > 0;
}

export function issuerEntryWindow(
  entry: {
    not_before?: string | null;
    not_after?: string | null;
    status?: string | null;
    revoked_at?: string | null;
  } | null | undefined,
  issuedAt: unknown,
): { ok: boolean; reason: string | null } {
  if (!entry) return { ok: false, reason: 'kid_not_in_history' };
  const issued = parseTime(issuedAt);
  if (issued == null) return { ok: false, reason: 'issued_at_missing' };
  const notBefore = parseTime(entry.not_before);
  if (notBefore == null) return { ok: false, reason: 'not_before_missing' };
  if (issued < notBefore) return { ok: false, reason: 'issued_before_not_before' };
  const notAfter = parseTime(entry.not_after);
  if (entry.not_after != null && notAfter == null) return { ok: false, reason: 'not_after_invalid' };
  if (notAfter != null && issued > notAfter) return { ok: false, reason: 'issued_after_not_after' };
  if (entry.status === 'revoked') {
    const revoked = parseTime(entry.revoked_at);
    if (revoked == null) return { ok: false, reason: 'revoked_at_missing' };
    if (issued >= revoked) return { ok: false, reason: 'kid_revoked_before_issuance' };
  }
  return { ok: true, reason: null };
}

export function issuerKeyWindow(
  doc: IssuerHistoryDocument,
  kid: string,
  issuedAt: unknown,
): { ok: boolean; reason: string | null } {
  // The end of the window is sticky. The earliest revoked_at and the earliest
  // not_after across every entry for this kid still apply after a later row.
  // not_before uses the latest stamp, so a later row cannot widen it backwards.
  const matches = (doc.entries || []).filter((row) => row.kid === kid);
  if (!matches.length) return { ok: false, reason: 'kid_not_in_history' };
  const last = matches[matches.length - 1];
  let notBefore: string | null = null;
  let notBeforeMs: number | null = null;
  for (const row of matches) {
    const parsed = parseTime(row.not_before);
    if (parsed == null) return { ok: false, reason: 'not_before_missing' };
    if (notBeforeMs == null || parsed > notBeforeMs) {
      notBeforeMs = parsed;
      notBefore = row.not_before;
    }
  }
  let notAfter: string | null = null;
  let notAfterMs: number | null = null;
  for (const row of matches) {
    if (row.not_after == null || row.not_after === '') continue;
    const parsed = parseTime(row.not_after);
    if (parsed == null) return { ok: false, reason: 'not_after_invalid' };
    if (notAfterMs == null || parsed < notAfterMs) {
      notAfterMs = parsed;
      notAfter = row.not_after;
    }
  }
  let revoked = false;
  let revokedAt: string | null = null;
  let revokedMs: number | null = null;
  for (const row of matches) {
    const stamp = row.revoked_at;
    const hasStamp = stamp != null && stamp !== '';
    if (row.status === 'revoked' || hasStamp) revoked = true;
    if (!hasStamp) continue;
    const parsed = parseTime(stamp);
    if (parsed == null) return { ok: false, reason: 'revoked_at_missing' };
    if (revokedMs == null || parsed < revokedMs) {
      revokedMs = parsed;
      revokedAt = stamp;
    }
  }
  if (revoked && revokedAt == null) return { ok: false, reason: 'revoked_at_missing' };
  return issuerEntryWindow({
    not_before: notBefore,
    not_after: notAfter,
    status: revoked ? 'revoked' : last.status,
    revoked_at: revoked ? revokedAt : null,
  }, issuedAt);
}

/**
 * Epoch records are a new trust path. The signer has to be `active` at `at`
 * and this history must never revoke that kid. A later `revoked` row sticks,
 * including for a time before `revoked_at`. `retired` is not active.
 * A missing time cannot show the key was active.
 */
export function epochHistoryKeyAllowed(
  doc: IssuerHistoryDocument | null | undefined,
  kid: string | null,
  at: unknown,
): boolean {
  if (!doc || !kid) return false;
  const matches = (doc.entries || []).filter((row) => row.kid === kid || row.jwk?.kid === kid);
  if (!matches.length) return false;
  for (const row of matches) {
    if (row.status === 'revoked') return false;
    if (row.revoked_at != null && row.revoked_at !== '') return false;
  }
  const issued = parseTime(at);
  if (issued == null) return false;
  let chosen: IssuerHistoryEntry | null = null;
  let chosenMs: number | null = null;
  for (const row of matches) {
    const start = parseTime(row.not_before);
    if (start == null || start > issued) continue;
    if (chosenMs == null || start >= chosenMs) {
      chosen = row;
      chosenMs = start;
    }
  }
  if (!chosen || chosen.status !== 'active') return false;
  if (chosen.not_after != null && chosen.not_after !== '') {
    const end = parseTime(chosen.not_after);
    if (end == null || issued > end) return false;
  }
  return true;
}

export function issuerHistoryDocumentHash(doc: unknown): string {
  return sha256Hex(jcsCanonicalize(doc));
}

/** Pin from verified JWS claims. An unsigned outer copy is not a pin. */
export function readIssuerHistoryPin(claims: Record<string, unknown> | null | undefined): IssuerHistoryPin | null {
  const pin = claims?.issuer_history;
  if (!pin || typeof pin !== 'object') return null;
  const row = pin as { hash?: unknown; version?: unknown; seq?: unknown };
  if (typeof row.hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.hash)) return null;
  const version = Number(row.version);
  const seq = Number(row.seq);
  if (!Number.isInteger(version) || version < 1) return null;
  if (!Number.isInteger(seq) || seq < 1) return null;
  return { hash: row.hash, version, seq };
}

function historyUrlWithPin(url: string, pin: IssuerHistoryPin | null): string {
  if (!pin) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('version', String(pin.version));
  return parsed.toString();
}

function historyPinMatches(
  doc: IssuerHistoryDocument,
  raw: string | null,
  pin: IssuerHistoryPin,
): boolean {
  if (raw != null && sha256Hex(raw) !== pin.hash) return false;
  if (issuerHistoryDocumentHash(doc) !== pin.hash) return false;
  if (Number(doc.version) !== pin.version) return false;
  if (Number(doc.seq) !== pin.seq) return false;
  return true;
}

/**
 * Fetch or accept the issuer-history body. A rejected body is still returned
 * so the caller can fail closed instead of ignoring it.
 */
async function loadIssuerHistoryBody({
  document = null,
  documentBytes = null,
  fetchHistory = false,
  strict = false,
  historyUrl = null,
  fetchImpl = globalThis.fetch,
  trustedHosts = ['api.chit402.com'],
  pin = null,
  receipt,
}: {
  document?: IssuerHistoryDocument | null;
  documentBytes?: string | null;
  fetchHistory?: boolean;
  strict?: boolean;
  historyUrl?: string | null;
  fetchImpl?: typeof fetch;
  trustedHosts?: readonly string[];
  pin?: IssuerHistoryPin | null;
  receipt: { verification?: { jwks_uri?: string }; verify_url?: string };
}): Promise<{
  doc: IssuerHistoryDocument | null;
  raw: string | null;
  unreachable: boolean;
  warning: string | null;
}> {
  let doc = document;
  let raw = documentBytes;
  if (doc || !(fetchHistory || historyUrl || strict || (pin && pin.hash))) {
    return { doc: doc ?? null, raw, unreachable: false, warning: null };
  }
  const baseUrl = historyUrl || historyUrlFromReceipt(receipt);
  if (!baseUrl) {
    return {
      doc: null,
      raw: null,
      unreachable: true,
      warning: 'issuer history unreachable: no history url on the receipt',
    };
  }
  let url = baseUrl;
  try {
    url = historyUrlWithPin(baseUrl, pin);
  } catch {
    return { doc: null, raw: null, unreachable: true, warning: 'issuer history unreachable: bad history url' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { doc: null, raw: null, unreachable: true, warning: 'issuer history unreachable: bad history url' };
  }
  const explicit = !!historyUrl;
  const hostOk = explicit
    ? parsed.protocol === 'https:'
    : parsed.protocol === 'https:' && trustedHosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase());
  if (!hostOk) {
    return {
      doc: null,
      raw: null,
      unreachable: true,
      warning: 'issuer history unreachable: history host is not allowed',
    };
  }
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.text();
    doc = JSON.parse(raw) as IssuerHistoryDocument;
    return { doc, raw, unreachable: false, warning: null };
  } catch (err) {
    const warning = `issuer history unreachable: ${err instanceof Error ? err.message : String(err)}`;
    return { doc: null, raw: null, unreachable: true, warning };
  }
}

export async function checkReceiptIssuerHistory(
  receipt: { verification?: { jwks_uri?: string }; verify_url?: string; created_at?: unknown },
  {
    document = null,
    fetchHistory = false,
    strict = false,
    historyUrl = null,
    jwks,
    trustedKids,
    fetchImpl = globalThis.fetch,
    trustedHosts = ['api.chit402.com'],
    issuedAt = null,
    kid = null,
    pin = null,
    requirePin = false,
    documentBytes = null,
  }: {
    document?: IssuerHistoryDocument | null;
    fetchHistory?: boolean;
    strict?: boolean;
    historyUrl?: string | null;
    jwks?: HistoryJwks;
    trustedKids?: readonly string[];
    fetchImpl?: typeof fetch;
    trustedHosts?: readonly string[];
    issuedAt?: unknown;
    kid?: string | null;
    /** From verified claims. When set, the fetched snapshot must match. */
    pin?: IssuerHistoryPin | null;
    /** Payload versions that sign a pin fail when the pin is absent. */
    requirePin?: boolean;
    /** Exact response or file bytes. SHA-256 of these must equal the pin. */
    documentBytes?: string | null;
  } = {},
): Promise<IssuerHistoryCheck> {
  const base: IssuerHistoryCheck = {
    checked: false,
    ok: true,
    unreachable: false,
    warning: null,
    reason: null,
    kid,
    document: null,
    loaded: false,
  };
  const pinned = !!(pin && pin.hash);
  const failClosed = strict || pinned || requirePin;
  if (requirePin && !pinned) {
    return { ...base, checked: true, ok: false, reason: 'issuer_history_pin_missing' };
  }
  const loadedBody = await loadIssuerHistoryBody({
    document,
    documentBytes,
    fetchHistory,
    strict,
    historyUrl,
    fetchImpl,
    trustedHosts,
    pin,
    receipt,
  });
  const doc = loadedBody.doc;
  // A body that fails the pin or the signature must not become a trust root.
  // `loaded` stays true so offline head trust fails closed instead of
  // falling through to the production pin alone.
  const pinOk = !doc || !pinned || !pin || historyPinMatches(doc, loadedBody.raw, pin);
  const signed = doc && pinOk
    ? verifyIssuerHistoryDocument(doc, { jwks, trustedKids })
    : null;
  const usable = doc && pinOk && signed?.valid ? doc : null;
  const loaded = doc != null;

  if (!kid) {
    const warning = 'issuer history not checked: receipt has no kid';
    if (failClosed) {
      return { ...base, checked: true, ok: false, reason: warning, document: usable, loaded };
    }
    return { ...base, warning, document: usable, loaded };
  }
  if (loadedBody.unreachable) {
    const warning = loadedBody.warning;
    if (failClosed) {
      return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
    }
    return { ...base, unreachable: true, warning };
  }
  if (!doc) {
    const warning = 'issuer history not checked';
    if (failClosed) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
    return { ...base, warning };
  }
  if (!pinOk && pin) {
    const reason = rawPinReason(doc, loadedBody.raw, pin);
    return { ...base, checked: true, ok: false, reason, loaded: true };
  }
  if (!signed?.valid) {
    return {
      ...base,
      checked: true,
      ok: false,
      reason: signed?.reason || 'issuer_history_invalid',
      loaded: true,
    };
  }
  const window = issuerKeyWindow(doc, kid, issuedAt);
  if (!window.ok) {
    return { ...base, checked: true, ok: false, reason: window.reason, document: usable, loaded: true };
  }
  return { ...base, checked: true, ok: true, document: usable, loaded: true };
}

function rawPinReason(
  doc: IssuerHistoryDocument,
  raw: string | null,
  pin: IssuerHistoryPin,
): string {
  if (raw != null && sha256Hex(raw) !== pin.hash) return 'issuer_history_pin_mismatch';
  if (issuerHistoryDocumentHash(doc) !== pin.hash) return 'issuer_history_pin_mismatch';
  if (Number(doc.version) !== pin.version) return 'issuer_history_version_mismatch';
  return 'issuer_history_seq_mismatch';
}

/**
 * The snapshot shipped in this package. A live body is accepted only when
 * it prefix-extends this chain. Used alone, the verifier reports this date.
 */
/** Day the bundled v2 snapshot was sealed into this package. */
export const BUNDLED_HISTORY_AS_OF = '2026-10-14';

/**
 * The one recorded rewrite. v1 genesis (custody field) may be followed by v2
 * (that field dropped). The reverse is not an extension: an old file must
 * not hide a later revoke.
 */
const GRANDFATHERED_HISTORY_REWRITES = [
  {
    from: '3d8259fb043f8ac80c924ea89d508f0a898f70bd0335658ef47370d5757e27a6',
    to: '349d7bb495bad55aaa25d05ee91134575e6e7d300795b37b41f4bcf29af80f0e',
  },
] as const;

export type IssuerHistorySource = 'file' | 'live' | 'bundled';

export interface ResolvedIssuerHistory {
  source: IssuerHistorySource;
  document: IssuerHistoryDocument | null;
  bytes: string | null;
  asOf: string | null;
  headHash: string | null;
  entryCount: number;
  /** A supplied file failed to parse or to verify. Do not fall back. */
  invalid: boolean;
  reason: string | null;
}

function grandfatheredRewrite(
  base: IssuerHistoryDocument | null | undefined,
  next: IssuerHistoryDocument | null | undefined,
): boolean {
  const from = base?.head_hash;
  const to = next?.head_hash;
  if (!from || !to) return false;
  return GRANDFATHERED_HISTORY_REWRITES.some((row) => row.from === from && row.to === to);
}

/** Later entries may be appended. The bundled entry_hash prefix must be unchanged. */
export function historyPrefixExtends(
  base: IssuerHistoryDocument | null | undefined,
  next: IssuerHistoryDocument | null | undefined,
): boolean {
  if (grandfatheredRewrite(base, next)) return true;
  const left = base?.entries || [];
  const right = next?.entries || [];
  if (!left.length || right.length < left.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (!left[i]?.entry_hash || right[i]?.entry_hash !== left[i]?.entry_hash) return false;
  }
  return true;
}

export function loadBundledIssuerHistory(): { document: IssuerHistoryDocument; bytes: string } {
  const require = createRequire(__filename);
  const bytes = readFileSync(require.resolve('../issuer-history.snapshot.json'), 'utf8');
  return { document: JSON.parse(bytes) as IssuerHistoryDocument, bytes };
}

function resolvedFrom(
  source: IssuerHistorySource,
  document: IssuerHistoryDocument | null,
  bytes: string | null,
  asOf: string | null,
  invalid = false,
  reason: string | null = null,
): ResolvedIssuerHistory {
  return {
    source,
    document,
    bytes,
    asOf,
    headHash: document?.head_hash ?? null,
    entryCount: document?.entries?.length ?? 0,
    invalid,
    reason,
  };
}

/**
 * File, else a live body that prefix-extends the bundled snapshot, else the
 * bundled snapshot. A file that does not verify is invalid and is not replaced.
 */
export async function resolveIssuerHistory({
  fileBytes = null,
  receipt = {},
  fetchImpl = globalThis.fetch,
  jwks,
  trustedKids,
  timeoutMs = 800,
}: {
  fileBytes?: string | null;
  receipt?: { verification?: { jwks_uri?: string }; verify_url?: string };
  fetchImpl?: typeof fetch;
  jwks?: HistoryJwks;
  trustedKids?: readonly string[];
  timeoutMs?: number;
} = {}): Promise<ResolvedIssuerHistory> {
  const bundled = loadBundledIssuerHistory();
  if (fileBytes != null) {
    let doc: IssuerHistoryDocument;
    try {
      doc = JSON.parse(fileBytes) as IssuerHistoryDocument;
    } catch {
      return resolvedFrom('file', null, fileBytes, null, true, 'issuer_history_unreadable');
    }
    const signed = verifyIssuerHistoryDocument(doc, { jwks, trustedKids });
    if (!signed.valid) {
      return resolvedFrom('file', doc, fileBytes, null, true, signed.reason || 'issuer_history_invalid');
    }
    // A supplied file must extend the bundled chain. An older or forked file
    // could hide a later revocation (truncation rollback).
    if (!historyPrefixExtends(bundled.document, doc)) {
      return resolvedFrom('file', doc, fileBytes, null, true, 'issuer_history_not_extension');
    }
    return resolvedFrom('file', doc, fileBytes, null, false, null);
  }

  const liveUrl = historyUrlFromReceipt(receipt);
  if (liveUrl) {
    let hostOk = false;
    try {
      const parsed = new URL(liveUrl);
      hostOk = parsed.protocol === 'https:'
        && ['api.chit402.com'].some((host) => host === parsed.hostname.toLowerCase());
    } catch {
      hostOk = false;
    }
    if (hostOk) {
      try {
        const res = await fetchImpl(liveUrl, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) {
          const bytes = await res.text();
          const doc = JSON.parse(bytes) as IssuerHistoryDocument;
          const signed = verifyIssuerHistoryDocument(doc, { jwks, trustedKids });
          if (signed.valid && historyPrefixExtends(bundled.document, doc)) {
            return resolvedFrom('live', doc, bytes, null, false, null);
          }
        }
      } catch {
        // A live miss falls through to the bundled snapshot.
      }
    }
  }

  const signedBundle = verifyIssuerHistoryDocument(bundled.document, { jwks, trustedKids });
  if (!signedBundle.valid) {
    return resolvedFrom('bundled', null, null, BUNDLED_HISTORY_AS_OF, false, 'kid_not_in_history');
  }
  return resolvedFrom('bundled', bundled.document, bundled.bytes, BUNDLED_HISTORY_AS_OF, false, null);
}

export function historyUrlFromReceipt(receipt: { verification?: { jwks_uri?: string }; verify_url?: string }): string | null {
  const jwks = receipt.verification?.jwks_uri;
  if (jwks && jwks.includes('/.well-known/jwks.json')) {
    return jwks.replace('/.well-known/jwks.json', '/.well-known/issuer-history.json');
  }
  if (receipt.verify_url) {
    try {
      const url = new URL(receipt.verify_url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      return `${url.origin}/.well-known/issuer-history.json`;
    } catch {
      return null;
    }
  }
  return null;
}
