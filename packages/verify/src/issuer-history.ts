/**
 * Public issuer key history.
 * The document is signed by the current issuer key. Entries chain by
 * SHA-256(JCS(entry without entry_hash)).
 */
import { createHash } from 'node:crypto';
import { jcsCanonicalize, rfc8785Canonicalize } from './jcs.js';
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
   * Loaded snapshot, for the issuer-root window check. Stripped before
   * `verifyReceipt` returns so the public result stays the 0.3.0 shape.
   */
  document?: IssuerHistoryDocument | null;
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

/**
 * Fields, and only these, in the `snapshot_hash` preimage.
 * `entry_hash` itself stays SHA-256 of the chit402-jcs-v1 entry body.
 * Gateway `historyEmbedEntry` (`72ac4d4`).
 */
export function historyEmbedEntry(entry: IssuerHistoryEntry): Record<string, unknown> {
  return {
    kid: entry.kid,
    jwk: entry.jwk,
    alg: entry.alg,
    not_before: entry.not_before,
    not_after: entry.not_after ?? null,
    status: entry.status,
    revoked_at: entry.revoked_at ?? null,
    reason: entry.reason ?? null,
    custody: entry.custody,
    prev_hash: entry.prev_hash ?? null,
    entry_hash: entry.entry_hash,
  };
}

/**
 * SHA-256 of the RFC 8785 UTF-8 bytes of the embed entries array.
 * No trailing newline. Not the well-known document hash.
 * Gateway `historyEntriesSnapshotHash` (`72ac4d4`).
 */
export function embedEntriesSnapshotHash(entries: unknown): string {
  const list = Array.isArray(entries) ? entries.map((entry) => historyEmbedEntry(entry as IssuerHistoryEntry)) : [];
  return sha256Hex(rfc8785Canonicalize(list));
}

export const ISSUER_HISTORY_EMBED_SCHEMA = 'chit402.issuer_history_embed.v1';

export interface IssuerHistorySnapshot {
  schema?: string;
  version?: number;
  seq?: number;
  head_hash?: string;
  snapshot_hash?: string;
  entries?: IssuerHistoryEntry[];
}

/**
 * Offline check of `issuer_history_snapshot`. `snapshot_hash` is
 * SHA-256 of the canonical entries, and it must also equal the pin.
 */
export function verifyIssuerHistorySnapshot(
  snapshot: unknown,
  pin: IssuerHistoryPin | null,
  { kid, issuedAt }: { kid: string | null; issuedAt: unknown },
): { ok: boolean; reason: string | null } {
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, reason: 'issuer_history_snapshot_missing' };
  }
  const embed = snapshot as IssuerHistorySnapshot;
  if (embed.schema !== ISSUER_HISTORY_EMBED_SCHEMA) {
    return { ok: false, reason: 'issuer_history_snapshot_schema' };
  }
  if (!Array.isArray(embed.entries) || embed.entries.length === 0) {
    return { ok: false, reason: 'issuer_history_snapshot_entry_hash' };
  }
  const recomputed = embedEntriesSnapshotHash(embed.entries);
  if (embed.snapshot_hash !== recomputed) {
    return { ok: false, reason: 'issuer_history_snapshot_hash' };
  }
  if (!pin || embed.snapshot_hash !== pin.hash
    || Number(embed.version) !== pin.version
    || Number(embed.seq) !== pin.seq) {
    return { ok: false, reason: 'issuer_history_snapshot_pin' };
  }
  let prev: string | null = null;
  for (const entry of embed.entries) {
    if ((entry.prev_hash ?? null) !== prev) return { ok: false, reason: 'issuer_history_snapshot_prev_hash' };
    if (issuerHistoryEntryHash(entry) !== entry.entry_hash) {
      return { ok: false, reason: 'issuer_history_snapshot_entry_hash' };
    }
    if (!['active', 'retired', 'revoked'].includes(entry.status)) {
      return { ok: false, reason: 'issuer_history_snapshot_entry_hash' };
    }
    prev = entry.entry_hash || null;
  }
  const head = embed.entries[embed.entries.length - 1].entry_hash;
  if (embed.head_hash !== head) return { ok: false, reason: 'issuer_history_snapshot_head_hash' };
  if (!kid) return { ok: false, reason: 'issuer_history_snapshot_window' };
  const window = issuerKeyWindow({ entries: embed.entries }, kid, issuedAt);
  if (!window.ok) return { ok: false, reason: `issuer_history_snapshot_window:${window.reason}` };
  return { ok: true, reason: null };
}

/** True when a fetched well-known document does not match the signed embed. */
export function historySnapshotDisagrees(
  snapshot: IssuerHistorySnapshot,
  doc: IssuerHistoryDocument,
  docHash: string,
): boolean {
  // snapshot_hash is the entries digest, not the well-known document hash.
  // docHash stays in the signature for callers that already computed it.
  void docHash;
  if (Number(doc.version) !== Number(snapshot.version)) return true;
  if (Number(doc.seq) !== Number(snapshot.seq)) return true;
  if (doc.head_hash !== snapshot.head_hash) return true;
  const live = doc.entries || [];
  const embedded = snapshot.entries || [];
  if (live.length !== embedded.length) return true;
  for (let i = 0; i < embedded.length; i += 1) {
    const left = embedded[i];
    const right = live[i];
    if (left.kid !== right.kid) return true;
    if (left.entry_hash !== right.entry_hash) return true;
    if ((left.prev_hash ?? null) !== (right.prev_hash ?? null)) return true;
    if (left.not_before !== right.not_before) return true;
    if ((left.not_after ?? null) !== (right.not_after ?? null)) return true;
    if (left.status !== right.status) return true;
    if ((left.revoked_at ?? null) !== (right.revoked_at ?? null)) return true;
  }
  return false;
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

function selfAssertedHistory(base: IssuerHistoryCheck): IssuerHistoryCheck {
  return {
    ...base,
    checked: true,
    ok: false,
    unreachable: false,
    reason: 'self_asserted',
    warning: 'issuer history is self-asserted: no registry pin and no history document. This is not a history proof.',
  };
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
    snapshot = null,
    offlineEmbed = false,
    registryPinned = false,
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
    /** Signed issuer_history_snapshot, when the receipt carried one. */
    snapshot?: IssuerHistorySnapshot | null;
    /** The embed already verified against the entries digest. */
    offlineEmbed?: boolean;
    /** A caller registry pin is set. Without one, an unfetched embed is self-asserted. */
    registryPinned?: boolean;
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
  const pinned = !!(pin && pin.hash);
  const failClosed = strict || pinned || requirePin;
  if (requirePin && !pinned) {
    return { ...base, checked: true, ok: false, reason: 'issuer_history_pin_missing' };
  }
  if (!kid) {
    const warning = 'issuer history not checked: receipt has no kid';
    if (failClosed) return { ...base, checked: true, ok: false, reason: warning };
    return { ...base, warning };
  }
  let doc = document;
  let raw = documentBytes;
  if (!doc && (fetchHistory || historyUrl || strict || pinned)) {
    const baseUrl = historyUrl || historyUrlFromReceipt(receipt);
    if (!baseUrl) {
      const warning = 'issuer history unreachable: no history url on the receipt';
      if (failClosed) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
    let url = baseUrl;
    try {
      url = historyUrlWithPin(baseUrl, pin);
    } catch {
      const warning = 'issuer history unreachable: bad history url';
      if (failClosed) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      const warning = 'issuer history unreachable: bad history url';
      if (failClosed) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
    const explicit = !!historyUrl;
    const hostOk = explicit
      ? parsed.protocol === 'https:'
      : parsed.protocol === 'https:' && trustedHosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase());
    if (!hostOk) {
      const warning = 'issuer history unreachable: history host is not allowed';
      if (failClosed) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.text();
      doc = JSON.parse(raw) as IssuerHistoryDocument;
    } catch (err) {
      const warning = `issuer history unreachable: ${err instanceof Error ? err.message : String(err)}`;
      if (offlineEmbed && !registryPinned) return selfAssertedHistory(base);
      if (offlineEmbed) return { ...base, checked: true, ok: true, unreachable: false, warning: null, reason: null };
      if (failClosed) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
      return { ...base, unreachable: true, warning };
    }
  }
  if (!doc) {
    if (offlineEmbed && !registryPinned) return selfAssertedHistory(base);
    if (offlineEmbed) return { ...base, checked: true, ok: true, unreachable: false, warning: null, reason: null };
    const warning = 'issuer history not checked';
    if (failClosed) return { ...base, checked: true, ok: false, unreachable: true, reason: warning, warning };
    return { ...base, warning };
  }
  if (snapshot) {
    const docHash = raw != null ? sha256Hex(raw) : issuerHistoryDocumentHash(doc);
    if (historySnapshotDisagrees(snapshot, doc, docHash)) {
      return { ...base, checked: true, ok: false, reason: 'history_snapshot_disagree', document: doc };
    }
  }
  if (pinned && pin) {
    // v11 and refusal v2 pin the RFC 8785 entries digest. Flag-off pins
    // stay the chit402-jcs-v1 hash of the whole well-known document.
    const pinnedHash = snapshot
      ? embedEntriesSnapshotHash(doc.entries)
      : (raw != null ? sha256Hex(raw) : issuerHistoryDocumentHash(doc));
    if (pinnedHash !== pin.hash) {
      return { ...base, checked: true, ok: false, reason: 'issuer_history_pin_mismatch', document: doc };
    }
    if (!snapshot && issuerHistoryDocumentHash(doc) !== pin.hash) {
      return { ...base, checked: true, ok: false, reason: 'issuer_history_pin_mismatch', document: doc };
    }
    if (Number(doc.version) !== pin.version) {
      return { ...base, checked: true, ok: false, reason: 'issuer_history_version_mismatch', document: doc };
    }
    if (Number(doc.seq) !== pin.seq) {
      return { ...base, checked: true, ok: false, reason: 'issuer_history_seq_mismatch', document: doc };
    }
  }
  const signed = verifyIssuerHistoryDocument(doc, { jwks, trustedKids });
  if (!signed.valid) {
    return { ...base, checked: true, ok: false, reason: signed.reason || 'issuer_history_invalid', document: doc };
  }
  const window = issuerKeyWindow(doc, kid, issuedAt);
  if (!window.ok) {
    return { ...base, checked: true, ok: false, reason: window.reason, document: doc };
  }
  return { ...base, checked: true, ok: true, document: doc };
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
