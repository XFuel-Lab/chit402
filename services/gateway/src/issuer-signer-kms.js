/**
 * Opt-in KMS issuer signer. Never falls back to the env key.
 * Signatures are low-S, 64-byte JOSE (r || s), and self-verified before return.
 */
import crypto from 'node:crypto';
import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { computeJwkThumbprint } from './issuer-key.js';
import { derToJose, lowS } from './ecdsa-der.js';

const RAW_LIMIT = 4096;

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function timeoutMs(env) {
  const n = Number(env.ISSUER_KMS_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 3000;
}

function requireConfig(env) {
  const keyId = String(env.ISSUER_KMS_KEY_ID || '').trim();
  const region = String(env.ISSUER_KMS_REGION || '').trim();
  if (!keyId || !region) throw coded('issuer kms config is incomplete', 'issuer_kms_config');
  return { keyId, region };
}

function publicJwkFromSpki(der) {
  const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw coded('issuer kms key is not P-256', 'issuer_key_type');
  }
  return {
    key,
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  };
}

function assertPublicKey(out, env) {
  if (out?.KeySpec !== 'ECC_NIST_P256') throw coded('issuer kms key spec', 'issuer_key_type');
  if (out?.KeyUsage !== 'SIGN_VERIFY') throw coded('issuer kms key usage', 'issuer_key_type');
  const algs = out?.SigningAlgorithms || [];
  const list = Array.isArray(algs) ? algs : [...algs];
  if (!list.includes('ECDSA_SHA_256')) throw coded('issuer kms signing algorithm', 'issuer_key_type');
  const der = Buffer.from(out.PublicKey || []);
  const { key, publicJwk } = publicJwkFromSpki(der);
  const kid = computeJwkThumbprint(publicJwk);
  const configured = String(env.ISSUER_KID || '').trim();
  const production = env.NODE_ENV !== 'test' && env.NODE_ENV !== 'development';
  if (production && !configured) throw coded('issuer kid does not match the configured kid', 'issuer_kid_mismatch');
  if (configured && kid !== configured) throw coded('issuer kid does not match the configured kid', 'issuer_kid_mismatch');
  return { key, publicJwk, kid };
}

function unavailable() {
  return coded('issuer sign unavailable', 'issuer_sign_unavailable');
}

function invalid() {
  return coded('issuer sign invalid', 'issuer_sign_invalid');
}

function isThrottle(err) {
  const name = String(err?.name || err?.Code || err?.code || '');
  if (/Throttl|TooManyRequests|LimitExceeded/i.test(name)) return true;
  const status = err?.$metadata?.httpStatusCode;
  return status === 429;
}

function isTimeout(err) {
  const name = String(err?.name || '');
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (err?.code === 'ABORT_ERR') return true;
  return false;
}

/**
 * @param {{ client: { send: Function }, env?: NodeJS.ProcessEnv }} opts
 */
export async function createKmsSigner({ client, env = process.env } = {}) {
  if (!client || typeof client.send !== 'function') {
    throw coded('issuer kms client is missing', 'issuer_kms_config');
  }
  const { keyId } = requireConfig(env);
  const ms = timeoutMs(env);
  let pub;
  try {
    pub = await client.send(new GetPublicKeyCommand({ KeyId: keyId }), {
      abortSignal: AbortSignal.timeout(ms),
    });
  } catch (err) {
    if (err?.code === 'issuer_key_type' || err?.code === 'issuer_kid_mismatch' || err?.code === 'issuer_kms_config') {
      throw err;
    }
    throw unavailable();
  }
  let material;
  try {
    material = assertPublicKey(pub, env);
  } catch (err) {
    if (err?.code === 'issuer_key_type' || err?.code === 'issuer_kid_mismatch') throw err;
    throw coded('issuer kms key is not P-256', 'issuer_key_type');
  }
  return {
    kind: 'kms',
    kid: material.kid,
    publicJwk: material.publicJwk,
    async sign(input, { signal = null } = {}) {
      const message = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
      const digest = message.length > RAW_LIMIT;
      const payload = digest ? crypto.createHash('sha256').update(message).digest() : message;
      let out;
      try {
        out = await client.send(new SignCommand({
          KeyId: keyId,
          Message: payload,
          MessageType: digest ? 'DIGEST' : 'RAW',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }), { abortSignal: signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms) });
      } catch (err) {
        if (isTimeout(err) || isThrottle(err)) throw unavailable();
        throw unavailable();
      }
      let jose;
      try {
        jose = lowS(derToJose(Buffer.from(out?.Signature || [])));
      } catch {
        throw invalid();
      }
      let ok = false;
      try {
        ok = crypto.verify('sha256', message, {
          key: material.key,
          dsaEncoding: 'ieee-p1363',
        }, jose);
      } catch {
        ok = false;
      }
      if (!ok) throw invalid();
      return jose;
    },
  };
}
