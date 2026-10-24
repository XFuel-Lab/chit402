/**
 * One answer to "is this the production process?".
 *
 * NODE_ENV alone is not enough: a host that loads the production issuer key
 * with NODE_ENV=development would otherwise switch off every production-only
 * gate. So the process also counts as production when:
 *   - the loaded issuer kid (sync key, active signer, or the key material in
 *     ISSUER_PRIVATE_KEY) is the published production kid, or
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

/** RFC 7638 kid of base64 PEM key material, or null when it does not parse. */
function kidOfMaterial(material) {
  if (kidCache.has(material)) return kidCache.get(material);
  let kid = null;
  try {
    const pem = Buffer.from(material, 'base64').toString('utf8');
    const jwk = crypto.createPublicKey(crypto.createPrivateKey({ key: pem, format: 'pem' })).export({ format: 'jwk' });
    if (jwk.kty === 'EC' && jwk.x && jwk.y) {
      kid = crypto.createHash('sha256')
        .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
        .digest('base64url');
    }
  } catch {
    kid = null;
  }
  if (kidCache.size > 16) kidCache.clear();
  kidCache.set(material, kid);
  return kid;
}

function testKeyOptOut(env, material) {
  if (String(env?.ISSUER_TEST_KEY || '').trim() !== '1') return false;
  const kid = kidOfMaterial(material);
  return kid != null && kid !== PRODUCTION_ISSUER_KID;
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
  if (peekIssuerSigner()?.kid === PRODUCTION_ISSUER_KID) return true;
  const sources = e === process.env ? [e] : [e, process.env];
  for (const src of sources) {
    const material = keyMaterial(src);
    if (!material) continue;
    if (kidOfMaterial(material) === PRODUCTION_ISSUER_KID) return true;
    if (!testKeyOptOut(src, material)) return true;
  }
  return false;
}
