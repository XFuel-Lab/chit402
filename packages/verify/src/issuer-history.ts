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

export interface IssuerHistoryDocument {
  schema?: string;
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
  const head = doc.entries[doc.entries.length - 1].entry_hash;
  if (doc.head_hash !== head) return { valid: false, reason: 'head_hash_mismatch' };
  const jws = doc.issuer_signature?.jws;
  if (!jws) return { valid: false, reason: 'no_signature' };
  const headerKid = doc.issuer_signature?.kid || null;
  const candidates: Es256Jwk[] = [];
  if (jwks?.keys) {
    for (const key of jwks.keys) {
      if (!headerKid || key.kid === headerKid) candidates.push(key);
    }
  }
  const embedded = doc.issuer_signature?.issuer_jwk;
  if (embedded && isPinnedTrustedJwk(embedded, trustedKids ?? [])) candidates.push(embedded);
  if (!candidates.length && embedded && headerKid && trustedKids?.includes(headerKid)) {
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
    return { valid: true };
  }
  return { valid: false, reason: 'signature_invalid' };
}

export function issuerKeyWindow(
  doc: IssuerHistoryDocument,
  kid: string,
  issuedAt: unknown,
): { ok: boolean; reason: string | null } {
  const entry = (doc.entries || []).find((row) => row.kid === kid);
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
  } = {},
): Promise<IssuerHistoryCheck> {
  const base: IssuerHistoryCheck = {
    checked: false,
    ok: true,
    unreachable: false,
    warning: null,
    reason: null,
    kid,
  };
  if (!kid) {
    const warning = 'issuer history not checked: receipt has no kid';
    if (strict) return { ...base, checked: true, ok: false, reason: warning };
    return { ...base, warning };
  }
  let doc = document;
  if (!doc && (fetchHistory || historyUrl || strict)) {
    const url = historyUrl || historyUrlFromReceipt(receipt);
    if (!url) {
      const warning = 'issuer history unreachable: no history url on the receipt';
      if (strict) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      const warning = 'issuer history unreachable: bad history url';
      if (strict) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
    const explicit = !!historyUrl;
    const hostOk = explicit
      ? parsed.protocol === 'https:'
      : parsed.protocol === 'https:' && trustedHosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase());
    if (!hostOk) {
      const warning = 'issuer history unreachable: history host is not allowed';
      if (strict) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = await res.json() as IssuerHistoryDocument;
    } catch (err) {
      const warning = `issuer history unreachable: ${err instanceof Error ? err.message : String(err)}`;
      if (strict) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
  }
  if (!doc) {
    const warning = 'issuer history not checked';
    if (strict) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
    return { ...base, warning };
  }
  const signed = verifyIssuerHistoryDocument(doc, { jwks, trustedKids });
  if (!signed.valid) {
    return { ...base, checked: true, ok: false, reason: signed.reason || 'issuer_history_invalid' };
  }
  const window = issuerKeyWindow(doc, kid, issuedAt);
  if (!window.ok) {
    return { ...base, checked: true, ok: false, reason: window.reason };
  }
  return { ...base, checked: true, ok: true };
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
