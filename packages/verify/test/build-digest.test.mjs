import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeVerifierSourceDigest } from '../scripts/build-digest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('BUILD_DIGEST.txt matches the source recipe', () => {
  const published = fs.readFileSync(path.join(root, 'BUILD_DIGEST.txt'), 'utf8').trim();
  assert.match(published, /^[0-9a-f]{64}$/);
  assert.equal(computeVerifierSourceDigest(), published);
});
