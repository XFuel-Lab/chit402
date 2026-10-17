/**
 * Dry run for an issuer KMS key.
 * Prints three lines: the kid, the JWKS result, and PASS or FAIL <code>.
 * Does not print the signature, the key, env values, or error messages.
 *
 * ISSUER_JWKS_URL must be https. http is accepted only for 127.0.0.1 or
 * localhost when NODE_ENV is test. Redirects are refused.
 *
 *   ISSUER_SIGNER=kms ISSUER_KMS_KEY_ID=… ISSUER_KMS_REGION=… ISSUER_KID=… \
 *   ISSUER_JWKS_URL=https://api.chit402.com/.well-known/jwks.json \
 *     node scripts/issuer-kms-check.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initIssuerSigner } from '../services/gateway/src/issuer-signer.js';

export const CHECK_MESSAGE = Buffer.from('chit402-issuer-kms-check');

const JWKS_TIMEOUT_MS = 5000;
const CODE_RE = /^[a-z0-9_]{1,64}$/;

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function failCode(err) {
  const code = typeof err?.code === 'string' ? err.code : '';
  return CODE_RE.test(code) ? code : 'error';
}

function asSignature(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  return Buffer.alloc(0);
}

function verifies(jwk, sig) {
  if (!jwk || sig.length !== 64 || !jwk.x || !jwk.y) return false;
  try {
    const key = crypto.createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
      format: 'jwk',
    });
    return crypto.verify(
      'sha256',
      CHECK_MESSAGE,
      { key, dsaEncoding: 'ieee-p1363' },
      sig,
    ) === true;
  } catch {
    return false;
  }
}

/**
 * https only. http is limited to 127.0.0.1 and localhost while NODE_ENV is test.
 * @param {string} raw
 * @param {NodeJS.ProcessEnv} env
 */
function assertJwksUrl(raw, env) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw coded('jwks url rejected', 'jwks_url');
  }
  if (url.protocol === 'https:') return;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const inTest = String(env?.NODE_ENV || '').trim().toLowerCase() === 'test';
  if (url.protocol === 'http:' && loopback && inTest) return;
  throw coded('jwks url rejected', 'jwks_url');
}

/**
 * One GET. No body. Redirects are an error. A transport or HTTP failure is jwks_unavailable.
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 */
async function readJwks(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
    });
  } catch {
    throw coded('jwks fetch failed', 'jwks_unavailable');
  }
  if (!res || res.ok !== true || res.redirected === true) {
    throw coded('jwks fetch failed', 'jwks_unavailable');
  }
  try {
    return await res.json();
  } catch {
    throw coded('jwks fetch failed', 'jwks_unavailable');
  }
}

/**
 * Exactly one key with this kid, and that key's x and y match the signer.
 * The test signature must also verify under the JWKS key.
 */
async function assertJwks({ url, fetchImpl, kid, publicJwk, sig }) {
  const body = await readJwks(url, fetchImpl);
  const keys = body && Array.isArray(body.keys) ? body.keys : [];
  const found = keys.filter((key) => key && key.kid === kid);
  if (found.length !== 1) throw coded('jwks mismatch', 'jwks_mismatch');
  const key = found[0];
  if (key.x !== publicJwk.x || key.y !== publicJwk.y) throw coded('jwks mismatch', 'jwks_mismatch');
  if (!verifies(key, sig)) throw coded('jwks mismatch', 'jwks_mismatch');
}

function jwksWord(code) {
  if (code === 'jwks_mismatch') return 'mismatch';
  if (code === 'jwks_unavailable' || code === 'jwks_url') return 'unavailable';
  return '';
}

function writeResult(kid, jwks, ok, code) {
  const status = ok ? 'PASS' : `FAIL ${code}`;
  process.stdout.write(`kid ${kid}\njwks ${jwks}\n${status}\n`);
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, signer?: { kind?: string, kid?: string, publicJwk?: { x?: string, y?: string }, sign?: (input: Buffer) => Promise<Buffer> } }} [opts]
 * @returns {Promise<{ exitCode: number, kid: string, jwks: string, ok: boolean, code: string }>}
 */
export async function runIssuerKmsCheck({ env = process.env, fetchImpl = globalThis.fetch, signer } = {}) {
  let kid = '';
  let jwks = 'skipped';
  try {
    const source = env || {};
    if (String(source.ISSUER_SIGNER || '').trim() !== 'kms') throw coded('not kms', 'not_kms');
    const active = signer || await initIssuerSigner(source);
    if (!active || active.kind !== 'kms') throw coded('not kms', 'not_kms');
    kid = String(active.kid || '');
    const sig = asSignature(await active.sign(CHECK_MESSAGE));
    if (!verifies(active.publicJwk, sig)) throw coded('issuer sign invalid', 'issuer_sign_invalid');
    const jwksUrl = String(source.ISSUER_JWKS_URL || '').trim();
    if (jwksUrl) {
      assertJwksUrl(jwksUrl, source);
      await assertJwks({
        url: jwksUrl,
        fetchImpl,
        kid,
        publicJwk: active.publicJwk,
        sig,
      });
      jwks = 'match';
    }
    writeResult(kid, jwks, true, '');
    return { exitCode: 0, kid, jwks, ok: true, code: '' };
  } catch (err) {
    const code = failCode(err);
    const word = jwksWord(code);
    if (word) jwks = word;
    writeResult(kid, jwks, false, code);
    return { exitCode: 1, kid, jwks, ok: false, code };
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  runIssuerKmsCheck()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
