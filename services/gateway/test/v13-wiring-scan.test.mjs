/**
 * Source scans for the v13 wiring. Each pattern is its own boolean.
 * This file is not part of the mutant score.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const FILES = [
  'services/gateway/src/v13-flags.js',
  'services/gateway/src/v13-issue.js',
  'services/chit-sealer/anchor-mainnet.js',
  'services/chit-sealer/mainnet-pin.js',
  'services/chit-sealer/fixtures/mainnet-operator-pin.json',
  'deploy/chit-simple/mainnet-pack/expected-runtime.json',
  'deploy/chit-simple/mainnet-pack/check-deploy.mjs',
  'deploy/chit-simple/mainnet-pack/DeployChitAnchor.s.sol',
];

const PATTERNS = [
  'arn:aws:kms:',
  '@aws-sdk',
  'PRIVATE_KEY',
  'BEGIN EC PRIVATE',
];

for (const file of FILES) {
  test(`scan ${file}`, () => {
    const src = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    assert.equal(src.includes(PATTERNS[0]), false);
    assert.equal(src.includes(PATTERNS[1]), false);
    assert.equal(src.includes(PATTERNS[2]), false);
    assert.equal(src.includes(PATTERNS[3]), false);
  });
}
