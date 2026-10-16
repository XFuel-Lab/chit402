/**
 * Dry run for an issuer KMS key.
 * Prints the kid and PASS or FAIL. Does not print the signature or the key.
 *
 *   ISSUER_SIGNER=kms ISSUER_KMS_KEY_ID=… ISSUER_KMS_REGION=… ISSUER_KID=… \
 *     node scripts/issuer-kms-check.mjs
 */
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { initIssuerSigner } = await import(pathToFileURL(path.join(root, 'services/gateway/src/issuer-signer.js')).href);

const MESSAGE = Buffer.from('chit402-issuer-kms-check');

function finish(kid, ok) {
  if (kid) process.stdout.write(`${kid}\n`);
  process.stdout.write(ok ? 'PASS\n' : 'FAIL\n');
  process.exitCode = ok ? 0 : 1;
}

let kid = '';
try {
  const signer = await initIssuerSigner();
  kid = signer.kid || '';
  if (signer.kind !== 'kms') {
    finish(kid, false);
  } else {
    const sig = await signer.sign(MESSAGE);
    const key = crypto.createPublicKey({ key: signer.publicJwk, format: 'jwk' });
    const ok = crypto.verify('sha256', MESSAGE, { key, dsaEncoding: 'ieee-p1363' }, sig) === true
      && sig.length === 64;
    finish(kid, ok);
  }
} catch {
  finish(kid, false);
}
