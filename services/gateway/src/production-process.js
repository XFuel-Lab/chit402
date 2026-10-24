/**
 * One answer to "is this the production process?".
 *
 * NODE_ENV alone is not enough: a host that loads the production issuer key
 * with NODE_ENV=development would otherwise switch off every production-only
 * gate. So the process also counts as production when:
 *   - the loaded issuer key (sync key, active signer, or the key material in
 *     ISSUER_PRIVATE_KEY) is a production key, by kid or by public key x/y, or
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

/**
 * A JWK coordinate as its 32-byte big-endian value, or null. Accepts the
 * base64url and standard alphabets, with or without padding, and extra
 * leading zero bytes, so every spelling of one point compares equal.
 */
function coordBytes(v) {
  if (typeof v !== 'string' || v.trim() === '') return null;
  let b = Buffer.from(v.trim(), 'base64');
  while (b.length > 32 && b[0] === 0) b = b.subarray(1);
  if (b.length > 32 || b.length === 0) return null;
  if (b.length < 32) b = Buffer.concat([Buffer.alloc(32 - b.length), b]);
  return b;
}

function isP256(crv) {
  return crv == null || String(crv).trim().toUpperCase() === 'P-256';
}

/** Same curve point (decoded 32-byte x and y), ignoring kid and any other label. */
function samePoint(a, b) {
  if (!a || !b || !isP256(a.crv) || !isP256(b.crv)) return false;
  const ax = coordBytes(a.x);
  const ay = coordBytes(a.y);
  const bx = coordBytes(b.x);
  const by = coordBytes(b.y);
  return Boolean(ax && ay && bx && by) && ax.equals(bx) && ay.equals(by);
}

/**
 * True when `jwk` is the public key of any production issuer key, by x/y,
 * whatever kid it is labelled with. `extra` adds more keys to match (for
 * example issuer history entries from ISSUER_HISTORY_EXTRA).
 * @param {{ x?: string, y?: string, crv?: string }|null|undefined} jwk
 * @param {Array<{ x?: string, y?: string, crv?: string }>} [extra]
 */
/** Whether a JWK carries two coordinates that decode to 32-byte values. */
export function wellFormedPublicJwk(jwk) {
  return Boolean(jwk && typeof jwk === 'object' && isP256(jwk.crv) && coordBytes(jwk.x) && coordBytes(jwk.y));
}

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

/** The kid issuer-key recorded for the key it loaded, or null. */
export function loadedIssuerKid() {
  return loadedKid;
}

/** RFC 7638 kid of base64 PEM issuer key material, or null when it does not parse. */
export function issuerMaterialKid(material) {
  const m = material == null ? '' : String(material).trim();
  return m ? kidOfMaterial(m) : null;
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
  if (isProductionIssuerPublicKey(signer?.publicJwk)) return true;
  // An active KMS signer is production unless it is a known test key under the opt-out.
  if (signer?.kind === 'kms' && !(optedOut(process.env) && testIssuerKids().has(signer.kid))) return true;
  const sources = e === process.env ? [e] : [e, process.env];
  for (const src of sources) {
    const material = keyMaterial(src);
    if (material && productionMaterial(material)) return true;
    const signals = keySignals(src);
    if (signals.length === 0) continue;
    if (signals.includes(PRODUCTION_ISSUER_KID)) return true;
    const kids = testIssuerKids();
    if (!optedOut(src) || !signals.every((kid) => kid != null && kids.has(kid))) return true;
  }
  return false;
}
