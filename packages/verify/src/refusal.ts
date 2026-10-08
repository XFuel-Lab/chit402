/**
 * Offline check for a chit402.refusal.v1 document.
 *
 * Same ES256 issuer key and JWKS trust rules as a payment receipt.
 * A refusal is not a payment. verifyReceipt refuses to treat one as spend.
 */
import {
  verifyIssuerJws,
  resolvePinnedIssuerJwk,
  isPinnedTrustedJwk,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  KEY_UNTRUSTED,
  readJwsHeader,
  type Es256Jwk,
} from './jws.js';
import { verifyRequestDigest, type RequestBindingStatus } from './request-binding.js';

export const REFUSAL_SCHEMA = 'chit402.refusal.v1';
export const REFUSAL_SCHEMA_V2 = 'chit402.refusal.v2';
/** Versions a verifier accepts. Version 1 has no history pin. Version 3 is refusal v2. */
export const REFUSAL_PAYLOAD_VERSIONS = [1, 2, 3] as const;
/** Current issuance version. Version 1 still verifies. */
export const REFUSAL_PAYLOAD_VERSION = 2;

export const REFUSAL_PROVES = [
  'The issuer signed that it refused this spend.',
  'refusal_code is the code the issuer recorded.',
  'nonce identifies this refusal document.',
  'chain_id and anchor are the Base observation at refusal time. status UNAVAILABLE means the issuer had no block.',
  'When status is observed, block_number and block_hash are that block. state_root is copied only when the RPC returned one; otherwise it is null.',
  'book_row.seq, task_id, and row_hash name the policy_blocked row this refusal joins.',
  'charged is false and amount_charged is 0. This refusal took no USDC.',
];

export const REFUSAL_DOES_NOT_PROVE = [
  'It does not prove a payment, a settlement, or a balance change.',
  'It does not prove the refused spend would have landed in that block.',
  'It does not prove a later reorg left the block hash or state root in place.',
  'UNAVAILABLE means the issuer did not have a block. It does not mean the chain was empty.',
  'It does not prove the policy rule was the right rule. It proves the issuer refused under that code.',
  'It does not prove amount_requested would have been the settled price.',
  'It is not a payment receipt. A payment verifier must not treat it as proof of spend.',
  'verify_url is not inside the signature.',
];

export interface RefusalJwks {
  keys: Es256Jwk[];
}

export interface RefusalAnchor {
  status?: string;
  rail?: string;
  chain_id?: number | null;
  block_number?: string | null;
  block_hash?: string | null;
  state_root?: string | null;
}

export interface RefusalBookRow {
  task_id?: string;
  seq?: number;
  prev_hash?: string | null;
  row_hash?: string;
  event?: string;
}

export interface RefusalDocument {
  schema?: string;
  payload_version?: number;
  kind?: string;
  refusal_id?: string;
  nonce?: string;
  issued_at?: string;
  refusal_code?: string;
  agent_id?: number;
  book_id?: number;
  task_id?: string;
  amount_requested?: string | null;
  chain_id?: number | null;
  anchor?: RefusalAnchor | null;
  book_row?: RefusalBookRow | null;
  charged?: boolean;
  amount_charged?: string;
  issuer_signature?: {
    jws?: string;
    kid?: string;
    issuer_jwk?: Es256Jwk;
  };
}

export interface RefusalVerification {
  schema: typeof REFUSAL_SCHEMA;
  valid: boolean;
  checked: boolean;
  reason?: string;
  kid?: string | null;
  refusal_id?: string | null;
  refusal_code?: string | null;
  nonce?: string | null;
  chain_id?: number | null;
  charged: false;
  proves: string[];
  does_not_prove: string[];
  errors: string[];
  payload_version?: number;
  issuer_history?: { hash?: string; version?: number; seq?: number } | null;
  payload_hash?: string | null;
  request_binding?: RequestBindingStatus | null;
}

/** Schema inside the JWS payload. Unverified; callers still check the signature. */
export function jwsPayloadSchema(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const jws = (doc as RefusalDocument).issuer_signature?.jws;
  if (!jws || typeof jws !== 'string') return null;
  const payloadB64 = jws.split('.')[1];
  if (!payloadB64) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { schema?: unknown };
    return typeof payload.schema === 'string' ? payload.schema : null;
  } catch {
    return null;
  }
}

export function isRefusalDocument(doc: unknown): doc is RefusalDocument {
  if (!doc || typeof doc !== 'object') return false;
  const schema = (doc as { schema?: unknown }).schema;
  if (schema === REFUSAL_SCHEMA || schema === REFUSAL_SCHEMA_V2) return true;
  const signedSchema = jwsPayloadSchema(doc);
  return signedSchema === REFUSAL_SCHEMA || signedSchema === REFUSAL_SCHEMA_V2;
}

function jwksCandidates(jwks: RefusalJwks | undefined, kid: string | undefined): Es256Jwk[] {
  if (!jwks?.keys?.length) return [];
  const es256 = jwks.keys.filter((key) => key.kty === 'EC' && key.crv === 'P-256' && key.x && key.y);
  if (!kid) return es256;
  return es256.filter((key) => key.kid === kid);
}

function same(left: unknown, right: unknown): boolean {
  return left === right;
}

function anchorSame(outer: RefusalAnchor | null | undefined, signed: RefusalAnchor | null | undefined): boolean {
  if (!outer || !signed) return false;
  return same(outer.status, signed.status)
    && same(outer.rail, signed.rail)
    && same(outer.chain_id ?? null, signed.chain_id ?? null)
    && same(outer.block_number ?? null, signed.block_number ?? null)
    && same(outer.block_hash ?? null, signed.block_hash ?? null)
    && same(outer.state_root ?? null, signed.state_root ?? null);
}

function bookRowSame(outer: RefusalBookRow | null | undefined, signed: RefusalBookRow | null | undefined): boolean {
  if (!outer || !signed) return false;
  return same(outer.task_id, signed.task_id)
    && Number(outer.seq) === Number(signed.seq)
    && same(outer.prev_hash || null, signed.prev_hash || null)
    && same(outer.row_hash, signed.row_hash)
    && same(outer.event, signed.event);
}

function requestPreimageOf(doc: RefusalDocument & { request_preimage?: unknown; preimages?: { fields?: Record<string, { preimage_utf8?: unknown }> } }): string | null {
  if (typeof doc.request_preimage === 'string' && doc.request_preimage) return doc.request_preimage;
  const published = doc.preimages?.fields?.request_digest?.preimage_utf8;
  return typeof published === 'string' && published ? published : null;
}

function failed(reason: string, extra: Partial<RefusalVerification> = {}): RefusalVerification {
  return {
    schema: REFUSAL_SCHEMA,
    checked: extra.checked ?? true,
    reason,
    charged: false,
    proves: REFUSAL_PROVES,
    does_not_prove: REFUSAL_DOES_NOT_PROVE,
    errors: [reason],
    kid: extra.kid,
    valid: false,
  };
}

/**
 * Verify the issuer signature and that the outer refusal fields match it.
 * Trust is a JWKS key matched by kid, or an embedded key whose thumbprint
 * is a pinned trusted kid. The embedded key alone is not a trust root.
 */
export function verifyRefusal(
  doc: RefusalDocument,
  options: { jwks?: RefusalJwks; trustedKids?: readonly string[] } = {},
): RefusalVerification {
  if (!isRefusalDocument(doc)) {
    return failed('not_a_refusal', { checked: false });
  }
  const jws = doc.issuer_signature?.jws;
  if (!jws) return failed('no_signature', { checked: false });

  const trustedKids = options.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const header = readJwsHeader(jws);
  const kid = header?.kid || doc.issuer_signature?.kid;
  const embedded = resolvePinnedIssuerJwk(doc);
  const pinned = !!(embedded && isPinnedTrustedJwk(embedded, trustedKids));
  const fromJwks = jwksCandidates(options.jwks, kid);

  let payload: Record<string, unknown> | null = null;
  let trusted = false;
  let reason = 'signature_invalid';
  for (const jwk of fromJwks) {
    const result = verifyIssuerJws(jws, jwk);
    if (result.valid && result.payload) {
      payload = result.payload;
      trusted = true;
      break;
    }
    reason = result.reason || 'signature_invalid';
  }
  if (!payload && pinned && embedded) {
    const result = verifyIssuerJws(jws, embedded);
    if (result.valid && result.payload) {
      payload = result.payload;
      trusted = true;
    } else {
      reason = result.reason || 'signature_invalid';
    }
  }
  if (!payload && embedded && verifyIssuerJws(jws, embedded).valid && !pinned && fromJwks.length === 0) {
    return failed(KEY_UNTRUSTED, { kid: kid || null });
  }
  if (!payload) {
    if (fromJwks.length === 0 && !pinned) return failed(KEY_UNTRUSTED, { kid: kid || null });
    return failed(reason, { kid: kid || null });
  }
  if (!trusted) return failed(KEY_UNTRUSTED, { kid: kid || null });

  const signed = payload as unknown as RefusalDocument & { request_digest?: unknown };
  const boundRefusal = signed.schema === REFUSAL_SCHEMA_V2 || Number(signed.payload_version) === 3;
  if (boundRefusal) {
    const digest = signed.request_digest;
    const preimage = requestPreimageOf(doc);
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest) || !preimage) {
      return { ...failed('REQUEST_UNBOUND', { kid }), request_binding: 'REQUEST_UNBOUND' };
    }
    const recomputed = verifyRequestDigest(digest, preimage);
    if (!recomputed.ok) {
      return { ...failed('request_digest_mismatch', { kid }), request_binding: 'request_digest_mismatch' };
    }
  }
  if (signed.schema !== REFUSAL_SCHEMA && signed.schema !== REFUSAL_SCHEMA_V2) return failed('schema_mismatch', { kid });
  // The outer schema is unsigned. A present value that disagrees with the
  // signed schema fails. An omitted outer schema still follows the JWS.
  if (doc.schema != null && doc.schema !== signed.schema) return failed('schema_mismatch', { kid });
  const version = Number(signed.payload_version);
  if (!REFUSAL_PAYLOAD_VERSIONS.includes(version as 1 | 2 | 3)) {
    return failed('payload_version_mismatch', { kid });
  }
  if (doc.payload_version != null && Number(doc.payload_version) !== version) {
    return failed('payload_version_mismatch', { kid });
  }
  if (version >= 2) {
    const pin = (signed as { issuer_history?: { hash?: unknown; version?: unknown; seq?: unknown } }).issuer_history;
    if (!pin || typeof pin.hash !== 'string' || pin.version == null || pin.seq == null) {
      return failed('issuer_history_pin_missing', { kid });
    }
    const payloadHash = (signed as { payload_hash?: unknown }).payload_hash;
    if (typeof payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(payloadHash)) {
      return failed('payload_hash_missing', { kid });
    }
  }
  if (signed.kind !== 'refusal') return failed('kind_mismatch', { kid });
  if (signed.charged !== false || signed.amount_charged !== '0'
    || doc.charged !== false || doc.amount_charged !== '0') {
    return failed('charged_not_zero', { kid });
  }
  if (!same(doc.refusal_code, signed.refusal_code)) return failed('refusal_code_mismatch', { kid });
  if (!same(doc.nonce, signed.nonce)) return failed('nonce_mismatch', { kid });
  if (!same(doc.refusal_id, signed.refusal_id)) return failed('refusal_id_mismatch', { kid });
  if (!same(doc.chain_id ?? null, signed.chain_id ?? null)) return failed('chain_id_mismatch', { kid });
  if (!same(doc.task_id, signed.task_id)
    || Number(doc.agent_id) !== Number(signed.agent_id)
    || Number(doc.book_id) !== Number(signed.book_id)) {
    return failed('identity_mismatch', { kid });
  }
  if (!same(doc.issued_at, signed.issued_at)) return failed('issued_at_mismatch', { kid });
  if (!same(doc.amount_requested ?? null, signed.amount_requested ?? null)) {
    return failed('amount_mismatch', { kid });
  }
  if (!anchorSame(doc.anchor, signed.anchor as RefusalAnchor)) return failed('anchor_mismatch', { kid });
  if (!bookRowSame(doc.book_row, signed.book_row as RefusalBookRow)) return failed('book_row_mismatch', { kid });

  return {
    schema: REFUSAL_SCHEMA,
    valid: true,
    checked: true,
    kid: kid || null,
    refusal_id: signed.refusal_id || null,
    refusal_code: signed.refusal_code || null,
    nonce: signed.nonce || null,
    chain_id: signed.chain_id ?? null,
    charged: false,
    proves: REFUSAL_PROVES,
    does_not_prove: REFUSAL_DOES_NOT_PROVE,
    errors: [],
    payload_version: version,
    issuer_history: (signed as { issuer_history?: RefusalVerification['issuer_history'] }).issuer_history ?? null,
    payload_hash: (signed as { payload_hash?: string | null }).payload_hash ?? null,
  };
}
