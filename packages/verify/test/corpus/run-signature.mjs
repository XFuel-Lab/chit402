/**
 * Child process for the `signature` path: verifyIssuerSignature on a
 * detached receipt with the corpus test key. Used by the gate 8 cases,
 * which check which field list a version signs, not a full verdict.
 * Prints one JSON line. exit 0 here means only that the signature verifies.
 */
import { readFileSync } from 'node:fs';

const [file, jwksFile] = process.argv.slice(2);
const { verifyIssuerSignature } = await import('../../dist/index.js');
const doc = JSON.parse(readFileSync(file, 'utf8'));
const jwk = JSON.parse(readFileSync(jwksFile, 'utf8')).keys[0];
let out;
try {
  const r = verifyIssuerSignature(doc, jwk);
  out = {
    exit: r.valid ? 0 : 1,
    result: r.valid ? 'signature_valid' : 'signature_invalid',
    reason: r.reason ?? null,
    checks: { signature: r.valid ? 'pass' : 'fail' },
    cause: r.valid ? 'signature_valid' : (r.reason || 'signature_invalid'),
  };
} catch (err) {
  out = { exit: null, result: 'threw', reason: String(err?.message || err).slice(0, 120), checks: null, cause: 'threw' };
}
process.stdout.write(`${JSON.stringify(out)}\n`);
