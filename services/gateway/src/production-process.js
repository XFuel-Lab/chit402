/**
 * One answer to "is this the production process?".
 *
 * NODE_ENV alone is not enough: a host that loads the production issuer key
 * with NODE_ENV=development would otherwise switch off every production-only
 * gate. So the process also counts as production when:
 *   - the loaded issuer key (sync key, active signer, or the key material in
 *     ISSUER_PRIVATE_KEY) is a production key, by kid or by public key x/y, or
 *   - ISSUER_PRIVATE_KEY is set at all.
 *
 * Test and development runs that load a throwaway key set
 * ISSUER_TEST_KEY=1. That opt-out applies only when NODE_ENV is test or
 * development AND the key material parses to a kid that is not the
 * production kid. It can never downgrade the production key.
 */
import crypto from 'crypto';
import { peekIssuerSigner } from './issuer-signer-state.js';

/** Published api.chit402.com issuer kid. */
export const PRODUCTION_ISSUER_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

/**
 * Every production issuer public key, from the published issuer history
 * (/.well-known/issuer-history, v1). A key rotation adds its entry here; a
 * test pins this list to the published history fixture.
 */
export const PRODUCTION_ISSUER_PUBLIC_KEYS = Object.freeze([
  Object.freeze({
    kid: PRODUCTION_ISSUER_KID,
    kty: 'EC',
    crv: 'P-256',
    x: '_H7J9niXF2tez_MnF25pnrDN7iJ_VC9gBzYYW9gzSPk',
    y: 'jiorfRc9wtNaRmaFHsQaXNzcWteUA0RnpvD4SWdVl34',
  }),
]);

/** Same curve point, ignoring kid and any other label. */
function samePoint(a, b) {
  return Boolean(a && b) && typeof a.x === 'string' && typeof a.y === 'string'
    && a.x === b.x && a.y === b.y && String(a.crv || 'P-256') === String(b.crv || 'P-256');
}

/**
 * True when `jwk` is the public key of any production issuer key, by x/y,
 * whatever kid it is labelled with. `extra` adds more keys to match (for
 * example issuer history entries from ISSUER_HISTORY_EXTRA).
 * @param {{ x?: string, y?: string, crv?: string }|null|undefined} jwk
 * @param {Array<{ x?: string, y?: string, crv?: string }>} [extra]
 */
export function isProductionIssuerPublicKey(jwk, extra = []) {
  if (!jwk) return false;
  return PRODUCTION_ISSUER_PUBLIC_KEYS.some((k) => samePoint(jwk, k))
    || (Array.isArray(extra) && extra.some((k) => samePoint(jwk, k)));
}

let loadedKid = null;

/** issuer-key records the kid of the key it loaded. */
export function noteLoadedIssuerKid(kid) {
  loadedKid = kid ? String(kid) : null;
}

/** NODE_ENV unset, or anything but exact test/development, is production. */
export function nodeEnvIsProduction(nodeEnv) {
  const env = nodeEnv == null ? '' : String(nodeEnv).trim();
  return env !== 'test' && env !== 'development';
}

function keyMaterial(env) {
  const raw = env?.ISSUER_PRIVATE_KEY;
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
}

const kidCache = new Map();

/** Public JWK + RFC 7638 kid of base64 PEM key material, or null when it does not parse. */
function publicOfMaterial(material) {
  if (kidCache.has(material)) return kidCache.get(material);
  let out = null;
  try {
    const pem = Buffer.from(material, 'base64').toString('utf8');
    const jwk = crypto.createPublicKey(crypto.createPrivateKey({ key: pem, format: 'pem' })).export({ format: 'jwk' });
    if (jwk.kty === 'EC' && jwk.x && jwk.y) {
      const kid = crypto.createHash('sha256')
        .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
        .digest('base64url');
      out = { kid, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
    }
  } catch {
    out = null;
  }
  if (kidCache.size > 16) kidCache.clear();
  kidCache.set(material, out);
  return out;
}

function kidOfMaterial(material) {
  return publicOfMaterial(material)?.kid ?? null;
}

function productionMaterial(material) {
  const pub = publicOfMaterial(material);
  return Boolean(pub) && (pub.kid === PRODUCTION_ISSUER_KID || isProductionIssuerPublicKey(pub.jwk));
}

function testKeyOptOut(env, material) {
  if (String(env?.ISSUER_TEST_KEY || '').trim() !== '1') return false;
  return kidOfMaterial(material) != null && !productionMaterial(material);
}

/**
 * @param {Record<string, string|undefined>} [env] defaults to process.env
 * @param {{ nodeEnv?: string|null }} [opts] overrides env.NODE_ENV
 */
export function isProductionProcess(env = process.env, { nodeEnv } = {}) {
  const e = env || {};
  const node = nodeEnv === undefined ? e.NODE_ENV : nodeEnv;
  if (nodeEnvIsProduction(node)) return true;
  if (loadedKid === PRODUCTION_ISSUER_KID) return true;
  const signer = peekIssuerSigner();
  if (signer?.kid === PRODUCTION_ISSUER_KID) return true;
  if (isProductionIssuerPublicKey(signer?.publicJwk)) return true;
  const sources = e === process.env ? [e] : [e, process.env];
  for (const src of sources) {
    const material = keyMaterial(src);
    if (!material) continue;
    if (productionMaterial(material)) return true;
    if (!testKeyOptOut(src, material)) return true;
  }
  return false;
}
