#!/usr/bin/env node
/**
 * version-windows.json helper. No network, no key material read from disk.
 *
 *   node scripts/version-windows.mjs signing-input <doc.json> <kid> <iat-seconds>
 *       Prints the compact JWS signing input (header.payload) for the body.
 *   node scripts/version-windows.mjs assemble <doc.json> <kid> <iat-seconds> <signature-b64url> <out.json>
 *       Writes the document with issuer_signature set, and prints its sha256.
 *   node scripts/version-windows.mjs check [doc.json]
 *       Publish check: exits 1 unless the document parses, matches the sha
 *       pinned in dist/version-windows.js, and is signed by the production
 *       issuer key from the bundled issuer history.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = new URL('..', import.meta.url);

function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(',')}}`;
}
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function bodySha(doc) {
  const { issuer_signature: _s, ...body } = doc;
  return createHash('sha256').update(jcs(body)).digest('hex');
}
function signingInput(doc, kid, iat) {
  const header = { alg: 'ES256', typ: 'chit402-version-windows+jwt', kid };
  const payload = { schema: doc.schema, body_sha256: bodySha(doc), iat: Number(iat) };
  return `${b64(header)}.${b64(payload)}`;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'signing-input') {
  const [file, kid, iat] = args;
  process.stdout.write(signingInput(JSON.parse(readFileSync(file, 'utf8')), kid, iat));
} else if (cmd === 'assemble') {
  const [file, kid, iat, sig, out] = args;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  delete doc.issuer_signature;
  if (!/^[A-Za-z0-9_-]{86}$/.test(sig)) { console.error('signature must be 64 bytes base64url'); process.exit(1); }
  doc.issuer_signature = { alg: 'ES256', kid, jws: `${signingInput(doc, kid, iat)}.${sig}` };
  const bytes = `${JSON.stringify(doc, null, 1)}\n`;
  writeFileSync(out, bytes);
  console.log(createHash('sha256').update(bytes).digest('hex'));
} else if (cmd === 'check') {
  const file = args[0] || new URL('version-windows.json', here);
  const mod = require('../dist/version-windows.js');
  const history = JSON.parse(readFileSync(new URL('issuer-history.snapshot.json', here), 'utf8'));
  const keys = history.entries.filter((e) => e.kid === mod.VERSION_WINDOWS_PRODUCTION_KID).map((e) => ({ kid: e.kid, jwk: e.jwk }));
  const parsed = mod.parseVersionWindows(readFileSync(file, 'utf8'), { keys });
  if (!parsed.ok) { console.error(`version-windows.json: ${parsed.reason}`); process.exit(1); }
  if (parsed.signature !== 'production') {
    console.error(`version-windows.json is not signed by the production issuer key (signature: ${parsed.signature}, kid: ${parsed.signed_kid}). Run the signing ceremony before publishing.`);
    process.exit(1);
  }
  console.log(`version-windows.json ok: production-signed by ${parsed.signed_kid}, ${parsed.windows.size} windows`);
} else {
  console.error('usage: version-windows.mjs signing-input|assemble|check ...');
  process.exit(2);
}
