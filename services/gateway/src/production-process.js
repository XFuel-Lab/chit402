/**
 * One answer to "is this the production process?".
 *
 * NODE_ENV alone is not enough: a host that loads the production issuer key
 * with NODE_ENV=development would otherwise switch off every production-only
 * gate. So the process also counts as production when:
 *   - the loaded issuer kid (sync key, active signer, or the key material in
 *     ISSUER_PRIVATE_KEY) is the published production kid, or
 *   - ISSUER_PRIVATE_KEY, ISSUER_KID or ISSUER_KMS_KEY_ID is set, or
 *     ISSUER_SIGNER=kms, or the active signer is KMS.
 *
 * Test and development runs set ISSUER_TEST_KEY=1. That opt-out applies only
 * when NODE_ENV is test or development AND every key signal is one of the
 * known test keys (TEST_ISSUER_KEY_SEEDS, matched by thumbprint). It can never
 * downgrade the production key, or a new production key after a rotation.
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

/**
 * Public seeds of the known test issuer keys. Each key's private scalar is
 * sha256(seed), so anyone can derive it: these keys are never secrets and
 * never trusted outside tests. ISSUER_TEST_KEY=1 opts out ONLY these keys,
 * by thumbprint, so a new production key (after a rotation) can never be
 * opted out. Tests get them from test/helpers/test-issuer-keys.mjs.
 */
export const TEST_ISSUER_KEY_SEEDS = Object.freeze([
  'chit402 synthetic receipt fixture key v1',
  ...Array.from({ length: 64 }, (_, i) => `chit402 test issuer key ${i}`),
]);

function kidOfSeed(seed) {
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(crypto.createHash('sha256').update(seed, 'utf8').digest());
    const point = ecdh.getPublicKey();
    const x = point.subarray(1, 33).toString('base64url');
    const y = point.subarray(33, 65).toString('base64url');
    return crypto.createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x, y })).digest('base64url');
  } catch {
    return null;
  }
}

/** Fixed test keys committed as PEM in tests (thumbprints). test/issuer-signer-env.test.mjs PEM_B64. */
const FIXED_TEST_ISSUER_KIDS = Object.freeze(['SntmeWeiJnAQaLFnEakWcSdDWObImZ_26zQWU6Bir0E']);

let testKids = null;

/** Thumbprints (kids) of the known test issuer keys. */
export function testIssuerKids() {
  if (!testKids) {
    testKids = new Set([...TEST_ISSUER_KEY_SEEDS.map(kidOfSeed).filter(Boolean), ...FIXED_TEST_ISSUER_KIDS]);
    testKids.delete(PRODUCTION_ISSUER_KID);
  }
  return testKids;
}

function optedOut(env) {
  return String(env?.ISSUER_TEST_KEY || '').trim() === '1';
}

function trimmed(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}

/**
 * The issuer key signals one env carries, as kids (null when the kid is not
 * known yet). Any signal makes the process production unless ISSUER_TEST_KEY=1
 * and every signal is a known test kid.
 */
function keySignals(env) {
  const signals = [];
  const material = keyMaterial(env);
  if (material) signals.push(kidOfMaterial(material));
  const configuredKid = trimmed(env?.ISSUER_KID);
  if (configuredKid) signals.push(configuredKid);
  const kms = String(env?.ISSUER_SIGNER || '').trim().toLowerCase() === 'kms' || trimmed(env?.ISSUER_KMS_KEY_ID);
  if (kms) {
    const signer = peekIssuerSigner();
    signals.push(signer?.kind === 'kms' ? signer.kid || null : configuredKid);
  }
  return signals;
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
  // An active KMS signer is production unless it is a known test key under the opt-out.
  if (signer?.kind === 'kms' && !(optedOut(process.env) && testIssuerKids().has(signer.kid))) return true;
  const sources = e === process.env ? [e] : [e, process.env];
  for (const src of sources) {
    const signals = keySignals(src);
    if (signals.length === 0) continue;
    if (signals.includes(PRODUCTION_ISSUER_KID)) return true;
    const kids = testIssuerKids();
    if (!optedOut(src) || !signals.every((kid) => kid != null && kids.has(kid))) return true;
  }
  return false;
}
