/**
 * Release gate for chit402-verify and the @xfuel/verify alias.
 * Fails when the versions differ or the alias dependency is a range.
 */
import { readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';

const primary = JSON.parse(readFileSync(new URL('../packages/verify/package.json', import.meta.url), 'utf8'));
const alias = JSON.parse(readFileSync(new URL('../packages/aliases/chit402-verify/package.json', import.meta.url), 'utf8'));

const errors = [];
if (primary.name !== 'chit402-verify') errors.push(`primary name is ${primary.name}`);
if (alias.name !== '@xfuel/verify') errors.push(`alias name is ${alias.name}`);
if (primary.version !== alias.version) errors.push(`versions differ: ${primary.version} vs ${alias.version}`);
const dep = alias.dependencies?.['chit402-verify'];
if (dep !== primary.version) errors.push(`alias dependency must be the exact pin ${primary.version}, got ${dep}`);
if (/[\^~]/.test(String(dep))) errors.push('alias dependency must not use a caret or tilde');
if (primary.publishConfig?.provenance !== true) errors.push('chit402-verify publishConfig.provenance must be true');
if (alias.publishConfig?.provenance !== true) errors.push('@xfuel/verify publishConfig.provenance must be true');
const bins = primary.bin || {};
if (bins['chit402-verify'] == null || bins['xfuel-verify'] == null) {
  errors.push('chit402-verify must ship both chit402-verify and xfuel-verify bins');
}

// The bundled version windows must carry the production issuer signature.
// PR builds ship a test-signed copy; the signing ceremony replaces it.
const PROD_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
try {
  const windows = JSON.parse(readFileSync(new URL('../packages/verify/version-windows.json', import.meta.url), 'utf8'));
  const history = JSON.parse(readFileSync(new URL('../packages/verify/issuer-history.snapshot.json', import.meta.url), 'utf8'));
  const jws = String(windows.issuer_signature?.jws || '');
  const [h, p, sig] = jws.split('.');
  const header = JSON.parse(Buffer.from(h || '', 'base64url').toString('utf8') || '{}');
  const entry = (history.entries || []).find((e) => e.kid === PROD_KID);
  const ok = header.kid === PROD_KID && entry && sig && verify('sha256', Buffer.from(`${h}.${p}`), {
    key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: entry.jwk.x, y: entry.jwk.y }, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }, Buffer.from(sig, 'base64url'));
  if (!ok) errors.push(`packages/verify/version-windows.json is not signed by the production issuer key (kid ${header.kid || 'none'})`);
} catch (err) {
  errors.push(`packages/verify/version-windows.json unreadable: ${err.message}`);
}

if (errors.length) {
  for (const line of errors) console.error(line);
  process.exit(1);
}
console.log(`chit402-verify@${primary.version} alias pin ${dep}`);
