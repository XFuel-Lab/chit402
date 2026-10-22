/**
 * Child process for the `library` path: verifyReceipt under the corpus test
 * key and its covering test history. Loaded after tape-preload.mjs, so it
 * makes no network request. Prints one JSON line.
 */
import { readFileSync } from 'node:fs';

const [file, jwksFile, historyFile] = process.argv.slice(2);
const { verifyReceipt } = await import('../../dist/index.js');
const doc = JSON.parse(readFileSync(file, 'utf8'));
const jwks = JSON.parse(readFileSync(jwksFile, 'utf8'));
const issuerHistory = JSON.parse(readFileSync(historyFile, 'utf8'));
let out;
try {
  const r = await verifyReceipt(doc, {
    jwks,
    trustedKids: jwks.keys.map((k) => k.kid),
    issuerHistory,
    checkPayer: false,
    rpcUrl: 'http://127.0.0.1:9',
  });
  out = {
    exit: r.verdict?.exit_code ?? null,
    result: r.verdict?.result ?? null,
    reason: r.verdict?.reason ?? null,
    overall: r.overall,
    checks: r.verdict?.checks ?? null,
  };
} catch (err) {
  out = { exit: null, result: 'threw', reason: String(err?.message || err).slice(0, 120), overall: null, checks: null };
}
process.stdout.write(`${JSON.stringify(out)}\n`);
