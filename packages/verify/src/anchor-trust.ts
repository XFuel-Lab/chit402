/**
 * Bind an anchored tree head to the issuer.
 *
 * Anchor mode trusts a head only when its ES256 `issuer_signature` verifies
 * under the same rules as a receipt: a JWKS key matched by kid, an embedded
 * key whose RFC 7638 thumbprint is a pinned kid, or a kid in a verified
 * issuer-history document. The signed payload must match the outer fields
 * the anchor check uses.
 *
 * The Base sender and the Solana fee payer in that payload must be on the
 * issuer's anchor-wallet list, and the transactions the RPC returns must
 * have been sent by those wallets.
 *
 * The list is the package pin, plus wallets inside a verified
 * `chit402.anchor_wallets.v1` document or a verified issuer-history
 * payload's `anchor_wallets`. Two later sources are named and not read:
 * the Base `ChitIssuerRoot` registry (draft #485) and the DNS TXT at
 * `_issuer.chit402.com`. This module does not embed a registry address
 * and does not resolve DNS.
 */
import {
  DEFAULT_TRUSTED_ISSUER_KIDS,
  isEs256PublicJwk,
  isPinnedTrustedJwk,
  jwkThumbprint,
  KEY_UNTRUSTED,
  readJwsHeader,
  verifyIssuerJws,
  type Es256Jwk,
} from './jws.js';
import {
  issuerKeyWindow,
  verifyIssuerHistoryDocument,
  type IssuerHistoryDocument,
} from './issuer-history.js';

/** Confirmed sender of Base tx 0x1d8d7ea255170c8d4b87bef9382e13555dded2072fd877ce35f995f1ab54ee09. */
export const PINNED_BASE_ANCHOR_WALLET = '0x1844D1F5FE42aff1Cce6F776514Fd40374079582';

/** Fee payer of Solana memo 61RHMsPPseUc35v5oxDEtANEDCvXk5fmxZdrFDMknGWc5m7U8YhMfz4En1eFFj3z9n67ZtMiha1zkwnneL2LUiXk. */
export const PINNED_SOLANA_ANCHOR_FEE_PAYER = 'BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD';

export const ANCHOR_WALLETS_SCHEMA = 'chit402.anchor_wallets.v1';
export const ANCHOR_WALLETS_JWT_TYP = 'chit402-anchor-wallets+jwt';

/** Sources this version does not query. A later build can fill the same list. */
export const ANCHOR_WALLET_SOURCES_NOT_CONSULTED = ['issuer_root', 'dns'] as const;

export const HEAD_TRUST_MESSAGES: Record<string, string> = {
  head_signature_missing: 'Tree head has no issuer_signature. Anchor mode requires a valid ES256 signature from a trusted issuer key.',
  head_signature_invalid: 'Tree head issuer_signature is not a valid ES256 signature.',
  head_key_untrusted: 'Tree head kid is not trusted. Trust is the production pin, a verified issuer-history entry, or a JWKS key matched by kid.',
  head_claims_mismatch: 'Signed tree head does not match the root, size, epoch, or anchors on the head.',
  head_kid_window: 'Tree head kid is outside its issuer-history window.',
  published_at_missing: 'Tree head has no published_at. The kid is revoked or has not_after, so the window cannot be checked.',
  issuer_history_invalid: 'Issuer history did not verify, so the tree head key was not trusted from it.',
  anchor_wallets_invalid: 'Issuer anchor-wallet list did not verify.',
  anchor_sender_missing: 'Signed head does not name anchors.base.from. An anchored Base transaction must name its sender.',
  fee_payer_missing: 'Signed head does not name anchors.solana.fee_payer. An anchored Solana memo must name its fee payer.',
  anchor_sender_unlisted: 'Base anchor wallet is not on the issuer anchor-wallet list.',
  fee_payer_unlisted: 'Solana fee payer is not on the issuer anchor-wallet list.',
  sender_mismatch: 'Base transaction sender does not match the signed anchor wallet.',
  fee_payer_mismatch: 'Solana fee payer does not match the signed fee payer.',
};

interface JwksLike {
  keys?: Es256Jwk[];
}

export interface TreeHeadDocument {
  schema?: string;
  payload_version?: number;
  root?: string | null;
  tree_size?: number | null;
  epoch?: number | null;
  prev_epoch_root?: string | null;
  prev_epoch_size?: number | null;
  published_at?: string | null;
  anchors?: {
    base?: {
      status?: string | null;
      tx?: string | null;
      calldata?: string | null;
      chain_id?: number | null;
      from?: string | null;
    } | null;
    solana?: {
      status?: string | null;
      signature?: string | null;
      slot?: number | null;
      cluster?: string | null;
      memo?: string | null;
      fee_payer?: string | null;
    } | null;
  } | null;
  issuer_signature?: {
    jws?: string;
    kid?: string;
    issuer_jwk?: Es256Jwk;
  };
}

export interface HeadTrustResult {
  ok: boolean;
  reason: string | null;
  message: string | null;
  kid: string | null;
  trust: 'jwks' | 'pinned_kid' | 'issuer_history' | null;
  payload: Record<string, unknown> | null;
}

export interface AnchorWalletList {
  base: string[];
  solana: string[];
  sources: Array<'pin' | 'well_known' | 'issuer_history'>;
  not_consulted: readonly ['issuer_root', 'dns'];
}

function jwksCandidates(jwks: JwksLike | undefined, kid: string | undefined): Es256Jwk[] {
  const keys = jwks?.keys || [];
  const es256 = keys.filter((key) => isEs256PublicJwk(key) && (key.alg == null || key.alg === 'ES256'));
  if (!kid) return es256;
  return es256.filter((key) => key.kid === kid);
}

function decodePayload(jws: string): Record<string, unknown> | null {
  const part = jws.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Same ES256 trust order as `verifyIssuerSignatureWithJwks` for a compact JWS:
 * JWKS by kid, then an embedded key whose thumbprint is a pinned kid.
 */
function trustCompactJws(
  jws: string,
  embedded: Es256Jwk | undefined,
  jwks: JwksLike | undefined,
  trustedKids: readonly string[],
): { ok: boolean; trust: 'jwks' | 'pinned_kid' | null; kid: string | null; payload: Record<string, unknown> | null; reason: string } {
  const header = readJwsHeader(jws);
  const kid = header?.kid || embedded?.kid || null;
  const fromJwks = jwksCandidates(jwks, kid || undefined);
  for (const key of fromJwks) {
    const verified = verifyIssuerJws(jws, key);
    if (verified.valid && verified.payload) {
      return { ok: true, trust: 'jwks', kid: key.kid || kid, payload: verified.payload, reason: '' };
    }
  }
  const pinned = !!(embedded && isPinnedTrustedJwk(embedded, trustedKids));
  if (pinned && embedded) {
    const verified = verifyIssuerJws(jws, embedded);
    if (verified.valid && verified.payload) {
      return {
        ok: true,
        trust: 'pinned_kid',
        kid: embedded.kid || jwkThumbprint(embedded),
        payload: verified.payload,
        reason: '',
      };
    }
    return { ok: false, trust: 'pinned_kid', kid, payload: null, reason: verified.reason || 'head_signature_invalid' };
  }
  if (embedded && verifyIssuerJws(jws, embedded).valid) {
    return { ok: false, trust: null, kid: embedded.kid || kid, payload: null, reason: KEY_UNTRUSTED };
  }
  if (fromJwks.length === 0 && !pinned) {
    return { ok: false, trust: null, kid, payload: null, reason: KEY_UNTRUSTED };
  }
  return { ok: false, trust: null, kid, payload: null, reason: 'head_signature_invalid' };
}

function historyEntryKey(doc: IssuerHistoryDocument, kid: string | null): Es256Jwk | null {
  if (!kid) return null;
  for (const entry of doc.entries || []) {
    if (!entry?.jwk || !isEs256PublicJwk(entry.jwk)) continue;
    if (entry.kid === kid || jwkThumbprint(entry.jwk) === kid) return entry.jwk;
  }
  return null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function normalizeRoot(root: unknown): string | null {
  const hex = String(root || '').replace(/^0x/, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

const MATCHED_FIELDS = [
  'schema',
  'payload_version',
  'tree_size',
  'epoch',
  'prev_epoch_root',
  'prev_epoch_size',
  'published_at',
  'anchors',
] as const;

/** Signed payload must carry the same root, size, epoch, and anchors the check uses. */
export function headClaimsMatch(outer: TreeHeadDocument, payload: Record<string, unknown>): string | null {
  const outerRoot = normalizeRoot(outer.root);
  const signedRoot = normalizeRoot(payload.root);
  if (!outerRoot || outerRoot !== signedRoot) return 'root';
  for (const field of MATCHED_FIELDS) {
    const hasPayload = Object.prototype.hasOwnProperty.call(payload, field);
    const hasOuter = Object.prototype.hasOwnProperty.call(outer, field);
    if (!hasPayload && !hasOuter) continue;
    if (hasPayload !== hasOuter) return field;
    const signed = payload[field];
    const claimed = (outer as unknown as Record<string, unknown>)[field];
    if (field === 'tree_size' || field === 'epoch' || field === 'prev_epoch_size' || field === 'payload_version') {
      if (Number(signed) !== Number(claimed)) return field;
      continue;
    }
    if (stable(signed) !== stable(claimed)) return field;
  }
  return null;
}

function fail(reason: string, detail?: string): HeadTrustResult {
  const base = HEAD_TRUST_MESSAGES[reason] || reason;
  return {
    ok: false,
    reason,
    message: detail ? `${base} (${detail})` : base,
    kid: null,
    trust: null,
    payload: null,
  };
}

export function verifyTreeHeadTrust(
  head: TreeHeadDocument | null | undefined,
  {
    jwks,
    trustedKids,
    issuerHistory = null,
    strictIssuerHistory = false,
  }: {
    jwks?: JwksLike;
    trustedKids?: readonly string[];
    issuerHistory?: IssuerHistoryDocument | null;
    strictIssuerHistory?: boolean;
  } = {},
): HeadTrustResult {
  const jws = head?.issuer_signature?.jws;
  if (!jws) return fail('head_signature_missing');
  const pins = trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const embedded = head?.issuer_signature?.issuer_jwk;
  const direct = trustCompactJws(jws, embedded, jwks, pins);
  let trust: HeadTrustResult['trust'] = direct.trust;
  let payload = direct.payload;
  let kid = direct.kid;
  const historyKeys = jwks?.keys ? { keys: jwks.keys } : undefined;

  let historyOk = false;
  if (issuerHistory) {
    const verified = verifyIssuerHistoryDocument(issuerHistory, { jwks: historyKeys, trustedKids: pins });
    if (!verified.valid) {
      return { ...fail('issuer_history_invalid', verified.reason), kid };
    }
    historyOk = true;
    if (!payload) {
      const headerKid = readJwsHeader(jws)?.kid || head?.issuer_signature?.kid || null;
      const entryKey = historyEntryKey(issuerHistory, headerKid);
      if (entryKey) {
        const checked = verifyIssuerJws(jws, entryKey);
        if (checked.valid && checked.payload) {
          trust = 'issuer_history';
          payload = checked.payload;
          kid = headerKid;
        }
      }
    }
  } else if (strictIssuerHistory) {
    return { ...fail('issuer_history_invalid', 'issuer history was required and was not loaded'), kid };
  }

  if (!payload || !trust) {
    if (direct.reason === KEY_UNTRUSTED) return { ...fail('head_key_untrusted'), kid };
    return { ...fail('head_signature_invalid', direct.reason === 'head_signature_invalid' ? undefined : direct.reason), kid };
  }

  const mismatch = headClaimsMatch(head || {}, payload);
  if (mismatch) {
    return { ...fail('head_claims_mismatch', mismatch), kid, payload };
  }

  if (historyOk && issuerHistory && kid) {
    const publishedAt = Object.prototype.hasOwnProperty.call(head || {}, 'published_at')
      ? head?.published_at
      : payload.published_at;
    const window = headHistoryWindow(issuerHistory, kid, publishedAt);
    if (!window.ok) {
      const reason = window.reason === 'published_at_missing' ? 'published_at_missing' : 'head_kid_window';
      const detail = reason === 'head_kid_window' ? (window.reason || undefined) : undefined;
      return { ...fail(reason, detail), kid, trust, payload };
    }
  }

  return { ok: true, reason: null, message: null, kid, trust, payload };
}

/**
 * A signed published_at is checked with the receipt window rules.
 * v1 heads omit the field, and a closed head with no observed chain time
 * signs null. That is not issued_at_missing. An active kid with an open
 * window still verifies. A revoked kid, or one with not_after, fails closed
 * because the missing time cannot show the head was signed inside the window.
 */
function headHistoryWindow(
  doc: IssuerHistoryDocument,
  kid: string,
  publishedAt: unknown,
): { ok: boolean; reason: string | null } {
  const hasTime = publishedAt != null && publishedAt !== '';
  if (hasTime) return issuerKeyWindow(doc, kid, publishedAt);
  const entry = (doc.entries || []).find((row) => row.kid === kid);
  if (!entry) return { ok: false, reason: 'kid_not_in_history' };
  const notBefore = entry.not_before ? Date.parse(entry.not_before) : NaN;
  if (!Number.isFinite(notBefore)) return { ok: false, reason: 'not_before_missing' };
  if (notBefore > Date.now()) return { ok: false, reason: 'issued_before_not_before' };
  if (entry.status === 'revoked' || entry.not_after != null) {
    return { ok: false, reason: 'published_at_missing' };
  }
  return { ok: true, reason: null };
}

function asAddressList(value: unknown, chain: 'base' | 'solana'): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    if (chain === 'base') {
      if (/^0x[0-9a-fA-F]{40}$/.test(item)) out.push(item);
    } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item)) {
      out.push(item);
    }
  }
  return out;
}

export function verifyAnchorWalletDocument(
  doc: { schema?: string; base?: unknown; solana?: unknown; issuer_signature?: { jws?: string; issuer_jwk?: Es256Jwk } } | null | undefined,
  { jwks, trustedKids }: { jwks?: JwksLike; trustedKids?: readonly string[] } = {},
): { ok: true; base: string[]; solana: string[] } | { ok: false; reason: string } {
  const jws = doc?.issuer_signature?.jws;
  if (!doc || doc.schema !== ANCHOR_WALLETS_SCHEMA || !jws) {
    return { ok: false, reason: 'anchor_wallets_invalid' };
  }
  const pins = trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const trusted = trustCompactJws(jws, doc.issuer_signature?.issuer_jwk, jwks, pins);
  if (!trusted.ok || !trusted.payload) return { ok: false, reason: 'anchor_wallets_invalid' };
  if (trusted.payload.schema !== ANCHOR_WALLETS_SCHEMA) return { ok: false, reason: 'anchor_wallets_invalid' };
  const base = asAddressList(trusted.payload.base, 'base');
  const solana = asAddressList(trusted.payload.solana, 'solana');
  if (stable(base) !== stable(asAddressList(doc.base, 'base'))) return { ok: false, reason: 'anchor_wallets_invalid' };
  if (stable(solana) !== stable(asAddressList(doc.solana, 'solana'))) return { ok: false, reason: 'anchor_wallets_invalid' };
  return { ok: true, base, solana };
}

function walletsFromHistory(
  doc: IssuerHistoryDocument | null | undefined,
  jwks: JwksLike | undefined,
  trustedKids: readonly string[] | undefined,
): { base: string[]; solana: string[] } | null {
  if (!doc?.issuer_signature?.jws) return null;
  const verified = verifyIssuerHistoryDocument(doc, { jwks: jwks?.keys ? { keys: jwks.keys } : undefined, trustedKids });
  if (!verified.valid) return null;
  const payload = decodePayload(doc.issuer_signature.jws);
  const listed = payload?.anchor_wallets;
  if (!listed || typeof listed !== 'object') return { base: [], solana: [] };
  const row = listed as { base?: unknown; solana?: unknown };
  return { base: asAddressList(row.base, 'base'), solana: asAddressList(row.solana, 'solana') };
}

function unique(values: string[], chain: 'base' | 'solana'): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = chain === 'base' ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function compileAnchorWallets({
  jwks,
  trustedKids,
  issuerHistory = null,
  published = null,
}: {
  jwks?: JwksLike;
  trustedKids?: readonly string[];
  issuerHistory?: IssuerHistoryDocument | null;
  published?: { base: string[]; solana: string[] } | null;
} = {}): AnchorWalletList {
  const base = [PINNED_BASE_ANCHOR_WALLET];
  const solana = [PINNED_SOLANA_ANCHOR_FEE_PAYER];
  const sources: AnchorWalletList['sources'] = ['pin'];
  const fromHistory = walletsFromHistory(issuerHistory, jwks, trustedKids);
  if (fromHistory && (fromHistory.base.length || fromHistory.solana.length)) {
    base.push(...fromHistory.base);
    solana.push(...fromHistory.solana);
    sources.push('issuer_history');
  }
  if (published) {
    base.push(...published.base);
    solana.push(...published.solana);
    sources.push('well_known');
  }
  return {
    base: unique(base, 'base'),
    solana: unique(solana, 'solana'),
    sources,
    not_consulted: ANCHOR_WALLET_SOURCES_NOT_CONSULTED,
  };
}

export function walletListed(list: readonly string[], value: string, chain: 'base' | 'solana'): boolean {
  if (chain === 'base') {
    const needle = value.toLowerCase();
    return list.some((item) => item.toLowerCase() === needle);
  }
  return list.includes(value);
}

export function sameBaseAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
