/**
 * Committed guardian set for v11 issuer history.
 *
 * Names below are provisional until PR #485 publishes
 * docs/product/issuer-root.md. They are listed in the #483 body under
 * "for #483/#484/#485".
 *
 * The file is public keys and a threshold. It must not contain a private
 * key. The gateway signing key is never a member. Safe and guardian private
 * keys are not read from the environment, AWS, or CI.
 *
 * guardian_set_hash is SHA-256 of the RFC 8785 bytes of
 * { schema, threshold, guardians }. guardians are sorted by kid. Each jwk
 * is { crv, kty, x, y }.
 */
import fs from 'fs';
import crypto from 'crypto';
import { jcsRfc8785 } from './offer-receipt.js';
import { computeJwkThumbprint, getIssuerPublicKeyJwk } from './issuer-key.js';

export const GUARDIAN_SET_SCHEMA = 'chit402.guardian_set.v1';

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function publicJwk(jwk) {
  return {
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  };
}

/**
 * Object covered by guardian_set_hash. The hash itself is not an input.
 * @param {{ threshold: number, guardians: object[] }} doc
 */
export function guardianSetPreimage(doc) {
  const guardians = [...doc.guardians]
    .map((guardian) => ({
      kid: guardian.kid,
      jwk: publicJwk(guardian.jwk),
    }))
    .sort((left, right) => (left.kid < right.kid ? -1 : left.kid > right.kid ? 1 : 0));
  return {
    schema: GUARDIAN_SET_SCHEMA,
    threshold: doc.threshold,
    guardians,
  };
}

/** Lowercase hex SHA-256 of the RFC 8785 guardian set. */
export function guardianSetHash(doc) {
  return sha256Hex(jcsRfc8785(guardianSetPreimage(doc)));
}

function rejectPrivateMaterial(text, parsed) {
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(text)) {
    const err = new Error('guardian set file contains a private key');
    err.code = 'guardian_key_material';
    throw err;
  }
  const stack = [parsed];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(node, 'd')) {
      const err = new Error('guardian set file contains a private JWK');
      err.code = 'guardian_key_material';
      throw err;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
}

/**
 * Parse a guardian set document. Null when the path is unset.
 * A set path that is missing, private, or not a quorum throws.
 * @param {object} parsed
 */
export function parseGuardianSet(parsed) {
  if (!parsed || parsed.schema !== GUARDIAN_SET_SCHEMA) {
    throw new Error('guardian set schema must be chit402.guardian_set.v1');
  }
  const guardians = Array.isArray(parsed.guardians) ? parsed.guardians : null;
  if (!guardians || guardians.length < 2) {
    throw new Error('guardian set needs at least two public keys');
  }
  const threshold = Number(parsed.threshold);
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > guardians.length) {
    throw new Error('guardian set threshold must be an integer from 2 through the guardian count');
  }
  const normalized = guardians.map((guardian) => {
    const jwk = guardian?.jwk;
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
      throw new Error('each guardian jwk must be a public P-256 key');
    }
    const kid = computeJwkThumbprint(jwk);
    if (guardian.kid !== kid) {
      throw new Error('guardian kid must be the RFC 7638 thumbprint of its jwk');
    }
    return { kid, jwk: publicJwk(jwk) };
  });
  const kids = new Set(normalized.map((guardian) => guardian.kid));
  if (kids.size !== normalized.length) throw new Error('guardian set has a duplicate kid');
  return { schema: GUARDIAN_SET_SCHEMA, threshold, guardians: normalized };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {object|null}
 */
export function readGuardianSet(env = process.env) {
  const file = String(env.ISSUER_GUARDIAN_SET_FILE || '').trim();
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error('ISSUER_GUARDIAN_SET_FILE is not readable');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('ISSUER_GUARDIAN_SET_FILE is not JSON');
  }
  rejectPrivateMaterial(text, parsed);
  return parseGuardianSet(parsed);
}

/** Hash of the configured set, or null when no file is set. */
export function currentGuardianSetHash(env = process.env) {
  const doc = readGuardianSet(env);
  return doc ? guardianSetHash(doc) : null;
}

export function issuerKeyIsGuardian(doc, issuerJwk) {
  if (!doc || !issuerJwk) return false;
  const kid = computeJwkThumbprint(issuerJwk);
  return doc.guardians.some((guardian) => guardian.kid === kid
    || (guardian.jwk.x === issuerJwk.x && guardian.jwk.y === issuerJwk.y));
}

/**
 * The process signing key must not be in the guardian set.
 * No file means there is nothing to reject.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertSigningKeyNotGuardian(env = process.env) {
  const doc = readGuardianSet(env);
  if (!doc) return null;
  const jwk = getIssuerPublicKeyJwk();
  if (issuerKeyIsGuardian(doc, jwk)) {
    const err = new Error('the gateway signing key is a guardian and cannot sign');
    err.code = 'issuer_key_is_guardian';
    throw err;
  }
  return doc;
}
