/**
 * Deploy-pack key scan. Collected by the existing globs:
 *   - scripts/hardhat-test-core.cjs (flat test/security/*.test.cjs), which
 *     CI / Core Contract Tests runs on a pull request when test/** changes
 *   - scripts/hardhat-test-all.cjs (every test/*.test.cjs)
 * No workflow change.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { PATTERNS, loadFixture, packFiles, keptSources, withoutKeptLines, assertReadme } = require('../chit-simple/pack-scan-lib.cjs');

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
  process.stdout.write('step 7 import: kept\n');
  for (const file of packFiles()) {
    const src = withoutKeptLines(readFileSync(file, 'utf8'));
    for (const pattern of PATTERNS) {
      assert.ok(!pattern.re.test(src), `${pattern.msg} in ${file}`);
    }
  }
  process.stdout.write('pack scan: clean\n');
}

async function exerciseReceipt() {
  const href = pathToFileURL(path.join(__dirname, '../../deploy/chit-simple/sepolia-pack/check-deploy.mjs')).href;
  const { receiptBinding, rotationLogs, ROTATION_TOPIC } = await import(href);
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

if (typeof describe === 'function') {
  describe('chit anchor deploy pack', function () {
    it('rejects key material and unknown 64-hex strings', async function () {
      exercise();
      await exerciseReceipt();
    });
  });
}

if (require.main === module) exercise();
