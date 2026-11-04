/**
 * The eip712 directory is a byte-for-byte copy of a75d5ce2.
 * A rebase onto #687 drops this copy. Until then any drift fails here.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../eip712');
const PINNED = {
  'domain.mjs': 'cab2b24de9d70ddb404ba7e7c382641816907b90910657201e9889dc78142112',
  'eip712.test.mjs': '2fd806516d59a5b231bda553a878f1369531f32d076b8e86b14ac27ab79087cc',
  'index.mjs': '7679dc79cdf323bad79dafdeee200f4da4e455aa4ed131f77c40cc3390d8c5fa',
  'key-hash.mjs': '1aaa43f39d11c7817c0049b6c9a5aeb31e0768964f303244b79d2048f7445e1f',
  'possession.mjs': '2d0ec851879b96a4df1238c75cf7f65aa9edbf09be4a9cb5ecc9706fd6d8523f',
  'registry.mjs': '616d9a0b12fb98b2e3151a84547606bfced928e10716d8d411e945dfcf14c945',
  'rev5.test.mjs': '3f93b9cf6985de5f21bc3949fad558e743874cd176ec120d30c113b81e38affd',
  'sigma-range.mjs': '0d12721c23148fa483317926c754410bc37a5a95ba35be025927c60d6d4b9df5',
  'slots.mjs': '43327e0c2a3dac520d2c91ab40ce683bae86ff3f22cf7352c0ccad33b51aed9f',
  'time.mjs': '5c56ee98d41971601729b595ae2850ba9a1193163227067831be8b92a327d51b',
  'vectors/eip712.json': 'd60622267711edf9d6d188fbf879bcc89ad3f05a3d8089f3bffe1e8d97277350',
  'vectors/pop.json': '8ff1a07f30f879a9e18597a6e9688461703622659b434460f9d6ef4fc094e8b7',
};

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...filesUnder(abs));
    else out.push(relative(ROOT, abs));
  }
  return out;
}

test('vendored eip712 matches a75d5ce2 byte for byte', () => {
  const found = filesUnder(ROOT).sort();
  assert.deepEqual(found, Object.keys(PINNED).sort());
  for (const name of found) {
    const digest = createHash('sha256').update(readFileSync(join(ROOT, name))).digest('hex');
    assert.equal(digest, PINNED[name], name);
  }
});
