/**
 * Public signed pull-export for treasury desks (hemei test3).
 *
 * Stranger-GET, no session. ES256 JWS over canonical claims; verify via
 * /.well-known/jwks.json (same issuer as receipts). Possession-gated
 * /v1/agents/:id/book/export is unchanged.
 */
import crypto from 'crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signJws, getIssuerPublicKeyJwk, verifyJwsWithJwks } from './issuer-key.js';
import { buildJwksUri } from './receipt.js';

/** Signed pull-export envelope schema. */
export const PUBLIC_PULL_EXPORT_SCHEMA = 'chit402.book_pull_export.v1';

const PULL_EXPORT_JWT_TYP = 'chit402-pull-export+jwt';

const GATEWAY_SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPECIMENS_DIR = path.join(GATEWAY_SRC_DIR, '../public/specimens');

/**
 * House-published pull-export slugs. Redacted specimens only — not live private books.
 * @type {Record<string, { agent_id: number, specimen: boolean, json: string, csv: string, note?: string }>}
 */
export const PUBLIC_PULL_EXPORTS = Object.freeze({
  'hemei-treasury': {
    agent_id: 149,
    specimen: true,
    json: 'hemei-stranger-export.json',
    csv: 'hemei-stranger-export.csv',
    note: 'Redacted hemei design-partner specimen. Re-verify JWKS ~2h on next wake.',
  },
});

/**
 * @param {string} slug
 * @returns {boolean}
 */
export function isKnownPullExportSlug(slug) {
  return Object.prototype.hasOwnProperty.call(PUBLIC_PULL_EXPORTS, slug);
}

/**
 * SHA-256 hex digest of canonical document bytes.
 * @param {object|string} document
 * @param {'json'|'csv'} format
 */
export function documentDigest(document, format) {
  const bytes = format === 'csv'
    ? Buffer.from(String(document), 'utf8')
    : Buffer.from(JSON.stringify(document), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Canonical JWS claims for a pull-export envelope.
 * @param {{ slug: string, agent_id: number, format: string, exported_at: string, document_sha256: string, specimen?: boolean }} input
 */
export function canonicalPullExportClaims(input) {
  return {
    schema: PUBLIC_PULL_EXPORT_SCHEMA,
    slug: input.slug,
    agent_id: Number(input.agent_id),
    format: input.format,
    exported_at: input.exported_at,
    document_sha256: input.document_sha256,
    specimen: input.specimen === true,
    iat: Math.floor(Date.now() / 1000),
  };
}

/**
 * Load a published export document from the specimens directory.
 * @param {string} filename
 * @param {'json'|'csv'} format
 */
export function loadPublishedExportDocument(filename, format) {
  const raw = readFileSync(path.join(SPECIMENS_DIR, filename), 'utf8');
  if (format === 'json') {
    return JSON.parse(raw);
  }
  return raw;
}

/**
 * Build a signed public pull-export envelope.
 * @param {string} slug
 * @param {{ format?: 'json'|'csv', baseUrl?: string }} [opts]
 */
export function buildPublicPullExport(slug, { format = 'json', baseUrl = '' } = {}) {
  const meta = PUBLIC_PULL_EXPORTS[slug];
  if (!meta) {
    throw new Error('unknown_pull_export');
  }
  const fmt = format === 'csv' ? 'csv' : 'json';
  const filename = fmt === 'csv' ? meta.csv : meta.json;
  const document = loadPublishedExportDocument(filename, fmt);
  const exported_at = new Date().toISOString();
  const document_sha256 = documentDigest(document, fmt);
  const claims = canonicalPullExportClaims({
    slug,
    agent_id: meta.agent_id,
    format: fmt,
    exported_at,
    document_sha256,
    specimen: meta.specimen,
  });
  const jwksUri = buildJwksUri(baseUrl);
  const { jws, kid } = signJws(claims, {
    jku: jwksUri.startsWith('http') ? jwksUri : null,
    typ: PULL_EXPORT_JWT_TYP,
  });
  const issuer_jwk = getIssuerPublicKeyJwk();
  return {
    schema: PUBLIC_PULL_EXPORT_SCHEMA,
    slug,
    agent_id: meta.agent_id,
    format: fmt,
    exported_at,
    specimen: meta.specimen === true,
    verify_jwks: buildJwksUri(baseUrl),
    document_media_type: fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
    document,
    issuer_signature: {
      alg: 'ES256',
      typ: PULL_EXPORT_JWT_TYP,
      kid,
      jws,
      issuer_jwk,
    },
    pull_note: meta.note || null,
  };
}

/**
 * Verify envelope JWS against JWKS.
 * @param {object} envelope
 * @param {{ keys: object[] }} jwks
 */
export function verifyPublicPullExport(envelope, jwks) {
  const jws = envelope?.issuer_signature?.jws;
  if (!jws) return { valid: false, reason: 'no_jws' };
  const result = verifyJwsWithJwks(jws, jwks);
  if (!result.valid) return result;

  const payload = result.payload;
  const fmt = envelope.format === 'csv' ? 'csv' : 'json';
  const expectedDigest = documentDigest(envelope.document, fmt);
  if (payload.document_sha256 !== expectedDigest) {
    return { valid: false, reason: 'document_sha256_mismatch' };
  }
  if (payload.slug !== envelope.slug) {
    return { valid: false, reason: 'slug_mismatch' };
  }
  if (Number(payload.agent_id) !== Number(envelope.agent_id)) {
    return { valid: false, reason: 'agent_id_mismatch' };
  }
  if (payload.schema !== PUBLIC_PULL_EXPORT_SCHEMA) {
    return { valid: false, reason: 'schema_mismatch' };
  }
  return { valid: true, payload, header: result.header, kid: result.kid };
}

export default {
  PUBLIC_PULL_EXPORT_SCHEMA,
  PUBLIC_PULL_EXPORTS,
  isKnownPullExportSlug,
  documentDigest,
  canonicalPullExportClaims,
  loadPublishedExportDocument,
  buildPublicPullExport,
  verifyPublicPullExport,
};
