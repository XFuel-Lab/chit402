import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { receiptBinding, rotationLogs, ROTATION_TOPIC } from '../../deploy/chit-simple/sepolia-pack/check-deploy.mjs';

const require = createRequire(import.meta.url);
const { PATTERNS, loadFixture, packFiles, keptSources, withoutKeptLines, assertReadme } = require('./pack-scan-lib.cjs');

function assertReceipt(assert) {
  const addr = `0x${'11'.repeat(20)}`;
  const other = `0x${'22'.repeat(20)}`;
  assert.ok(/^receipt status /.test(receiptBinding({ status: '0x0', contractAddress: addr }, addr)), 'failed receipt');
  assert.ok(receiptBinding({ status: '0x1', contractAddress: addr }, addr) === '', 'successful receipt');
  assert.ok(receiptBinding({ status: 1, contractAddress: other }, addr) !== '', 'wrong contract address');
  const kept = rotationLogs({
    logs: [
      { address: other, topics: [ROTATION_TOPIC], data: '0x' },
      { address: addr, topics: [ROTATION_TOPIC], data: '0x' },
    ],
  }, addr);
  assert.ok(kept.length === 1 && kept[0].address === addr, 'rotation log is filtered by emitter');
}

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
  assertReadme(assert);
  assertReceipt(assert);
  process.stdout.write('step 7 import: kept\n');
  for (const file of packFiles()) {
    const src = withoutKeptLines(readFileSync(file, 'utf8'));
    for (const pattern of PATTERNS) {
      assert.ok(!pattern.re.test(src), `${pattern.msg} in ${file}`);
    }
  }
  process.stdout.write('pack scan: clean\n');
}

test('the deploy pack rejects key material and unknown 64-hex strings', () => {
  exercise();
});
