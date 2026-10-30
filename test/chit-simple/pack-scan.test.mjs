import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PATTERNS, loadFixture, packFiles, keptSources } = require('./pack-scan-lib.cjs');

function exercise() {
  for (const pattern of PATTERNS) {
    const src = loadFixture(pattern.id);
    assert.ok(pattern.re.test(src), pattern.msg);
    process.stdout.write(`planted ${pattern.id}: rejected\n`);
  }
  const kept = keptSources();
  for (const [name, src] of Object.entries(kept)) {
    for (const pattern of PATTERNS) {
      assert.ok(!pattern.re.test(src), `${pattern.msg} matched ${name}`);
    }
    process.stdout.write(`kept ${name}\n`);
  }
  for (const file of packFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const pattern of PATTERNS) {
      assert.ok(!pattern.re.test(src), `${pattern.msg} in ${file}`);
    }
  }
  process.stdout.write('pack scan: clean\n');
}

test('the deploy pack rejects key material and unknown 64-hex strings', () => {
  exercise();
});
