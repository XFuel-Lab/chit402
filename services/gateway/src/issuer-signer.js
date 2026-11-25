/**
 * Pluggable issuer signer. Unset ISSUER_SIGNER and `env` keep the process
 * key. `kms` is opt-in and never falls back to that key. KMS boot requires
 * the static AWS access-key pair and does not use the default credential chain.
 * A non-empty session token is passed with that pair and is never logged.
 */
import crypto from 'node:crypto';
import { initIssuerKey } from './issuer-key.js';
import { createKmsSigner, timeoutMs } from './issuer-signer-kms.js';
import { createIssuerKmsClient } from './issuer-kms-client.js';
import { lowS } from './ecdsa-der.js';
import { assertSignerInput } from './issuer-signer-guard.js';
import { peekIssuerSigner, setIssuerSigner } from './issuer-signer-state.js';

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Code only. The message is fixed. Values passed in are not logged. */
export function logIssuerSignerBootRefusal(err, log) {
  log.error({ code: err.code }, 'issuer signer boot refused');
}

function trimmedPairValue(env, name) {
  const raw = env == null ? undefined : env[name];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function explicitIssuerCredentials(env) {
  const accessKeyId = trimmedPairValue(env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = trimmedPairValue(env, 'AWS_SECRET_ACCESS_KEY');
  if (accessKeyId == null || secretAccessKey == null) {
    throw coded('issuer credentials missing', 'issuer_creds_missing');
  }
  const credentials = { accessKeyId, secretAccessKey };
  const sessionToken = trimmedPairValue(env, 'AWS_SESSION_TOKEN');
  if (sessionToken != null) credentials.sessionToken = sessionToken;
  return credentials;
}

async function logBootRefusal(err) {
  try {
    const { default: log } = await import('./logger.js');
    logIssuerSignerBootRefusal(err, log);
  } catch {
    // The original refusal is what boot must surface.
  }
}

function withIssuerInitTimeout(ms, fn) {
  let timer;
  let settled = false;
  const work = Promise.resolve().then(fn);
  return new Promise((resolve, reject) => {
    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value);
    };
    timer = setTimeout(() => {
      finish(false, coded('issuer sign unavailable', 'issuer_sign_unavailable'));
    }, ms);
    work.then((value) => finish(true, value), (err) => finish(false, err));
  });
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
    async sign(input, opts) {
      const message = Buffer.isBuffer(input) ? input : Buffer.from(input);
      assertSignerInput(message, opts);
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
 * `deps.clientFactory` is a test seam. Production passes none.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ clientFactory?: Function }} [deps]
 */
export async function initIssuerSigner(env = process.env, deps = {}) {
  const existing = peekIssuerSigner();
  if (existing) return existing;
  const mode = signerMode(env);
  if (mode === 'env') return setIssuerSigner(createEnvSigner(env));
  if (mode !== 'kms') throw coded('unknown issuer signer', 'issuer_signer_unknown');
  const ms = timeoutMs(env);
  let signer;
  try {
    signer = await withIssuerInitTimeout(ms, async () => {
      const credentials = explicitIssuerCredentials(env);
      const region = String(env.ISSUER_KMS_REGION || '').trim();
      const factory = deps && typeof deps.clientFactory === 'function'
        ? deps.clientFactory
        : createIssuerKmsClient;
      const client = await factory({ region, credentials });
      return createKmsSigner({ client, env });
    });
  } catch (err) {
    if (err && (err.code === 'issuer_creds_missing' || err.code === 'issuer_sign_unavailable')) {
      await logBootRefusal(err);
    }
    throw err;
  }
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
