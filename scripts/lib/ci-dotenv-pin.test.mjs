/**
 * The root "Pin tests on dotenv 18" CI step keeps its integrity pin.
 *
 * .github/workflows/test.yml fetches the dotenv 18.0.9 tarball and must
 * check it against the literal sha512 before installing it. This scan fails
 * if the literal hash, the compare-and-exit-1 line, or their order before the
 * install goes away. It is a source tripwire on one workflow step, not a
 * proof of what CI runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'test.yml');
const SHA512 = '3fVOW4cB02R066PUSwn8O4TJyz9NckQl7F81blIbaq9jKBm2tSmOKky7ZHIXzGvkVPXCSn6jkpziBPZdGFs8Tw==';

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The run block of the named step, up to the next step or job. */
function stepBlock(src, name) {
  const start = src.indexOf(`- name: ${name}`);
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.search(/\n\s*- (name|uses):|\n {2}[A-Za-z0-9_-]+:\n/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const src = fs.readFileSync(WORKFLOW, 'utf8');
const step = stepBlock(src, 'Pin tests on dotenv 18');

test('the dotenv 18 pin step exists in test.yml', () => {
  assert.ok(step !== null, 'test.yml has no "Pin tests on dotenv 18" step');
});

test('the step keeps the literal sha512 for dotenv-18.0.9.tgz', () => {
  const want = new RegExp(`^\\s*want="${escape(SHA512)}"\\s*$`, 'm');
  assert.ok(want.test(step || ''), 'the want="<sha512>" line with the literal 18.0.9 hash is missing or changed');
});

test('the step compares the hash and exits 1 on a mismatch', () => {
  const compare = /^\s*if \[ "\$got" != "\$want" \]; then [^\n]*\bexit 1; fi\s*$/m;
  assert.ok(compare.test(step || ''), 'the if [ "$got" != "$want" ]; then ... exit 1; fi line is missing or changed');
  const hash = /got="\$\(openssl dgst -sha512 -binary "\$RUNNER_TEMP\/dotenv-18\.0\.9\.tgz" \| base64 -w0\)"/;
  assert.ok(hash.test(step || ''), 'got= no longer hashes the downloaded tarball with sha512');
});

test('the hash check runs before the tarball is installed', () => {
  const s = step || '';
  const check = s.search(/if \[ "\$got" != "\$want" \]/);
  const install = s.search(/npm install [^\n]*dotenv-18\.0\.9\.tgz/);
  assert.ok(check >= 0 && install >= 0 && check < install, 'the sha512 check must come before npm install of the tarball');
});

test('the step checks the installed version is exactly 18.0.9', () => {
  assert.ok(/v !== '18\.0\.9'/.test(step || ''), "the installed dotenv version check (=== '18.0.9') is missing");
});
