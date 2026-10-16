/**
 * Pluggable issuer signer. Unset ISSUER_SIGNER and `env` keep the process
 * key. `kms` is opt-in and never falls back to that key.
 */
import crypto from 'node:crypto';
import { KMSClient } from '@aws-sdk/client-kms';
import { initIssuerKey } from './issuer-key.js';
import { createKmsSigner } from './issuer-signer-kms.js';
import { lowS } from './ecdsa-der.js';
import { peekIssuerSigner, setIssuerSigner } from './issuer-signer-state.js';

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function signerMode(env = process.env) {
  const mode = String(env.ISSUER_SIGNER || '').trim() || 'env';
  if (mode !== 'env' && mode !== 'kms') {
    throw coded('unknown issuer signer', 'issuer_signer_unknown');
  }
  return mode;
}

/** Env signer. Same P-256 key and ieee-p1363 encoding as issuer-key.js. */
export function createEnvSigner(env = process.env) {
  const loaded = initIssuerKey();
  const privateKey = loaded.privateKey;
  return {
    kind: 'env',
    kid: loaded.kid,
    publicJwk: {
      kty: loaded.publicKeyJwk.kty,
      crv: loaded.publicKeyJwk.crv,
      x: loaded.publicKeyJwk.x,
      y: loaded.publicKeyJwk.y,
    },
    async sign(input) {
      const message = Buffer.isBuffer(input) ? input : Buffer.from(input);
      const sig = crypto.sign('sha256', message, {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      });
      if (String(env.ISSUER_SIGNER_LOW_S || '').trim() === 'true') return lowS(sig);
      return sig;
    },
  };
}

/**
 * Once per process. A KMS init failure throws and the caller must not listen.
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function initIssuerSigner(env = process.env) {
  const existing = peekIssuerSigner();
  if (existing) return existing;
  const mode = signerMode(env);
  if (mode === 'env') return setIssuerSigner(createEnvSigner(env));
  if (mode !== 'kms') throw coded('unknown issuer signer', 'issuer_signer_unknown');
  const region = String(env.ISSUER_KMS_REGION || '').trim();
  const client = new KMSClient({ region: region || undefined });
  const signer = await createKmsSigner({ client, env });
  return setIssuerSigner(signer);
}

export function getIssuerSigner() {
  const signer = peekIssuerSigner();
  if (!signer) throw coded('issuer signer is not initialised', 'issuer_signer_uninitialized');
  return signer;
}

export function _setIssuerSignerForTest(next) {
  return setIssuerSigner(next);
}
