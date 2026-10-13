/**
 * Public issuer key history.
 * The document is signed by the current issuer key. Entries chain by
 * SHA-256(JCS(entry without entry_hash)).
 */
import { createHash } from 'node:crypto';
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

export interface IssuerHistoryDocumentPin {
  kind: 'document';
  hash: string;
  version: number;
  seq: number;
}

export interface IssuerHistoryHeadPin {
  kind: 'head';
  head_hash: string;
  entry_count: number;
}

/** v10 pins the whole document. v12 pins the entry-chain head. */
export type IssuerHistoryPin = IssuerHistoryDocumentPin | IssuerHistoryHeadPin;

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
    return { valid: true };
  }
  return { valid: false, reason: 'signature_invalid' };
}

/**
 * Revocation sticks. A later entry cannot move a kid off `revoked`, and a
 * retired kid cannot become active again.
 */
function kidStatusRegression(entries: IssuerHistoryEntry[]): boolean {
  const prior = new Map<string, string>();
  for (const entry of entries) {
    const prev = prior.get(entry.kid);
    if (prev === 'revoked') return true;
    if (prev === 'retired' && entry.status === 'active') return true;
    prior.set(entry.kid, entry.status);
  }
  return false;
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
  const matches = (doc.entries || []).filter((row) => row.kid === kid);
  if (!matches.length) return { ok: false, reason: 'kid_not_in_history' };
  const last = matches[matches.length - 1];
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
    not_before: last.not_before,
    not_after: notAfter,
    status: revoked ? 'revoked' : last.status,
    revoked_at: revoked ? revokedAt : null,
  }, issuedAt);
}

export function issuerHistoryDocumentHash(doc: unknown): string {
  return sha256Hex(jcsCanonicalize(doc));
}

function readDocumentPin(row: Record<string, unknown>): IssuerHistoryDocumentPin | null {
  if (typeof row.hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.hash)) return null;
  const version = Number(row.version);
  const seq = Number(row.seq);
  if (!Number.isInteger(version) || version < 1) return null;
  if (!Number.isInteger(seq) || seq < 1) return null;
  return { kind: 'document', hash: row.hash, version, seq };
}

function readHeadPin(row: Record<string, unknown>): IssuerHistoryHeadPin | null {
  if (typeof row.head_hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.head_hash)) return null;
  const entryCount = Number(row.entry_count);
  if (!Number.isInteger(entryCount) || entryCount < 1) return null;
  return { kind: 'head', head_hash: row.head_hash, entry_count: entryCount };
}

/** Both shapes at once is not a pin. The caller fails closed. */
export function issuerHistoryPinConflict(claims: Record<string, unknown> | null | undefined): boolean {
  const pin = claims?.issuer_history;
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return false;
  const row = pin as Record<string, unknown>;
  return readDocumentPin(row) != null && readHeadPin(row) != null;
}

/** Pin from verified JWS claims. An unsigned outer copy is not a pin. */
export function readIssuerHistoryPin(claims: Record<string, unknown> | null | undefined): IssuerHistoryPin | null {
  const pin = claims?.issuer_history;
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return null;
  const row = pin as Record<string, unknown>;
  const document = readDocumentPin(row);
  const head = readHeadPin(row);
  if (document && head) return null;
  return head || document;
}

function historyUrlWithPin(url: string, pin: IssuerHistoryPin | null): string {
  if (!pin || pin.kind !== 'document') return url;
  const parsed = new URL(url);
  parsed.searchParams.set('version', String(pin.version));
  return parsed.toString();
}

/** The pinned head is entry_hash of entries[entry_count - 1]. A longer chain still matches. */
export function historyExtendsPinnedHead(doc: IssuerHistoryDocument, pin: IssuerHistoryHeadPin): boolean {
  const entries = doc.entries || [];
  if (entries.length < pin.entry_count) return false;
  return entries[pin.entry_count - 1]?.entry_hash === pin.head_hash;
}

function historyPinMatches(
  doc: IssuerHistoryDocument,
  raw: string | null,
  pin: IssuerHistoryPin,
): boolean {
  if (pin.kind === 'head') return historyExtendsPinnedHead(doc, pin);
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
  const pinned = pin?.kind === 'document' ? pin.hash : pin?.kind === 'head' ? pin.head_hash : '';
  if (doc || !(fetchHistory || historyUrl || strict || pinned)) {
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
    pinShape = null,
    pinConflict = false,
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
    /**
     * v10 requires the whole-document pin. v12 requires the chain-head pin.
     * A present pin of the other shape fails closed.
     */
    pinShape?: 'document' | 'head' | null;
    /** Both document hash and chain head were signed. Not a pin. */
    pinConflict?: boolean;
    /** Exact response or file bytes. SHA-256 of these must equal the pin. */
    documentBytes?: string | null;
  } = {},
): Promise<IssuerHistoryCheck> {
  // Direct callers pass the signed claim `{ hash, version, seq }`. The
  // receipt path tags `kind`. Both are a pin.
  if (pin && pin.kind !== 'document' && pin.kind !== 'head') {
    pin = readIssuerHistoryPin({ issuer_history: pin as unknown as Record<string, unknown> });
  }
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
  const pinned = pin?.kind === 'document' || pin?.kind === 'head';
  const failClosed = strict || pinned || requirePin || pinShape != null;
  if (pinConflict && (pinShape != null || requirePin)) {
    return { ...base, checked: true, ok: false, reason: 'issuer_history_pin_shape' };
  }
  if (pinShape === 'head' && pin?.kind !== 'head') {
    return {
      ...base,
      checked: true,
      ok: false,
      reason: pin?.kind === 'document' ? 'issuer_history_pin_shape' : 'issuer_history_pin_missing',
    };
  }
  if (pinShape === 'document' && requirePin && pin?.kind !== 'document') {
    return {
      ...base,
      checked: true,
      ok: false,
      reason: pin?.kind === 'head' ? 'issuer_history_pin_shape' : 'issuer_history_pin_missing',
    };
  }
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
  if (pin.kind === 'head') return 'issuer_history_not_extension';
  if (raw != null && sha256Hex(raw) !== pin.hash) return 'issuer_history_pin_mismatch';
  if (issuerHistoryDocumentHash(doc) !== pin.hash) return 'issuer_history_pin_mismatch';
  if (Number(doc.version) !== pin.version) return 'issuer_history_version_mismatch';
  return 'issuer_history_seq_mismatch';
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
