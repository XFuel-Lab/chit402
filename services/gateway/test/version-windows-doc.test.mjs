import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { versionWindowsBytes, VERSION_WINDOWS_PRODUCTION_KID } from '../src/version-windows-doc.js';

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
function doc(kid, typ = 'chit402-version-windows+jwt') {
  return JSON.stringify({
    schema: 'chit402.version_windows.v1',
    windows: [],
    log_grace_seconds: 0,
    issuer_signature: { alg: 'ES256', kid, jws: `${b64({ alg: 'ES256', typ, kid })}.${b64({})}.sig` },
  });
}
function file(text) {
  const p = join(mkdtempSync(join(tmpdir(), 'vwd-')), 'version-windows.json');
  writeFileSync(p, text);
  return p;
}

test('serves the exact bytes of a production-signed document', () => {
  const text = doc(VERSION_WINDOWS_PRODUCTION_KID);
  assert.equal(versionWindowsBytes(file(text)), text);
});

test('a test-signed, wrong-typ, unreadable or missing document is not served', () => {
  assert.equal(versionWindowsBytes(file(doc('test-version-windows-x'))), null);
  assert.equal(versionWindowsBytes(file(doc(VERSION_WINDOWS_PRODUCTION_KID, 'JWT'))), null);
  assert.equal(versionWindowsBytes(file('{')), null);
  assert.equal(versionWindowsBytes(join(tmpdir(), 'nope', 'version-windows.json')), null);
});

test('the copy in this checkout is served only once it is production-signed', async () => {
  const { readFileSync } = await import('node:fs');
  const local = JSON.parse(readFileSync(new URL('../../../packages/verify/version-windows.json', import.meta.url), 'utf8'));
  const prod = local.issuer_signature?.kid === VERSION_WINDOWS_PRODUCTION_KID;
  assert.equal(versionWindowsBytes() !== null, prod);
});
