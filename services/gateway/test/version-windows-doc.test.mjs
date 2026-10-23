import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { versionWindowsBytes, productionKeys, canonical, VERSION_WINDOWS_PRODUCTION_KID } from '../src/version-windows-doc.js';

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const otherJwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
const body = {
  schema: 'chit402.version_windows.v1',
  log_grace_seconds: 1209600,
  windows: [{ id: 'pv10', not_before: '2026-10-05T08:49:28Z', not_after: null, floor: false }],
};

function doc({ kid = VERSION_WINDOWS_PRODUCTION_KID, typ = 'chit402-version-windows+jwt', bodyHash, payloadSchema = 'chit402.version_windows.v1', edit = null } = {}) {
  const header = { alg: 'ES256', typ, kid };
  const payload = { schema: payloadSchema, body_sha256: bodyHash ?? createHash('sha256').update(canonical(body)).digest('hex'), iat: 1792674000 };
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const d = { ...body, issuer_signature: { alg: 'ES256', kid, jws: `${input}.${sig}` } };
  if (edit) edit(d);
  return JSON.stringify(d, null, 2);
}
function file(text) {
  const p = join(mkdtempSync(join(tmpdir(), 'vwd-')), 'version-windows.json');
  writeFileSync(p, text);
  return p;
}
const keys = [jwk];

// Flip one bit of a decoded signature byte and re-encode. Editing the last
// base64url character is not reliable: for a 64-byte signature it carries
// only 2 data bits, so some edits change only padding bits and decode to the
// same signature.
function flipSignatureBit(jws) {
  const [h, p, s] = jws.split('.');
  const raw = Buffer.from(s, 'base64url');
  const edited = Buffer.from(raw);
  edited[32] ^= 0x01;
  const out = edited.toString('base64url');
  assert.notDeepEqual(Buffer.from(out, 'base64url'), raw, 'the edit changes the decoded signature');
  return `${h}.${p}.${out}`;
}

test('serves the exact bytes of a document whose production signature verifies', () => {
  const text = doc();
  assert.equal(versionWindowsBytes(file(text), { keys }), text);
});

test('the signature is verified, not only the kid fields', () => {
  assert.equal(versionWindowsBytes(file(doc()), { keys: [otherJwk] }), null, 'wrong key');
  assert.equal(versionWindowsBytes(file(doc()), { keys: [] }), null, 'no key');
  assert.equal(versionWindowsBytes(file(doc({ edit: (d) => { d.log_grace_seconds = 1; } })), { keys }), null, 'body edited after signing');
  assert.equal(versionWindowsBytes(file(doc({ edit: (d) => { d.issuer_signature.jws = flipSignatureBit(d.issuer_signature.jws); } })), { keys }), null, 'signature bytes edited');
  assert.equal(versionWindowsBytes(file(doc({ bodyHash: 'ab'.repeat(32) })), { keys }), null, 'payload hash is not the body');
  assert.equal(versionWindowsBytes(file(doc({ payloadSchema: 'x' })), { keys }), null, 'payload schema');
});

test('a test-signed, wrong-typ, unreadable or missing document is not served', () => {
  assert.equal(versionWindowsBytes(file(doc({ kid: 'test-version-windows-x' })), { keys }), null);
  assert.equal(versionWindowsBytes(file(doc({ typ: 'JWT' })), { keys }), null);
  assert.equal(versionWindowsBytes(file('{'), { keys }), null);
  assert.equal(versionWindowsBytes(join(tmpdir(), 'nope', 'version-windows.json'), { keys }), null);
});

test('the production key comes from the bundled issuer history', () => {
  const k = productionKeys();
  assert.equal(k.length, 1);
  assert.equal(k[0].crv, 'P-256');
});

test('the copy in this checkout is served only once it is production-signed', () => {
  const local = JSON.parse(readFileSync(new URL('../../../packages/verify/version-windows.json', import.meta.url), 'utf8'));
  const prod = local.issuer_signature?.kid === VERSION_WINDOWS_PRODUCTION_KID;
  assert.equal(versionWindowsBytes() !== null, prod);
  if (!prod) assert.equal(versionWindowsBytes(), null);
});
