/**
 * Deploy-pack key scan. Collected by the existing globs:
 *   - scripts/hardhat-test-core.cjs (flat test/security/*.test.cjs), which
 *     CI / Core Contract Tests runs on a pull request when test/** changes
 *   - scripts/hardhat-test-all.cjs (every test/*.test.cjs)
 * No workflow change.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { PATTERNS, loadFixture, packFiles, keptSources } = require('../chit-simple/pack-scan-lib.cjs');

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

if (typeof describe === 'function') {
  describe('chit anchor deploy pack', function () {
    it('rejects key material and unknown 64-hex strings', function () {
      exercise();
    });
  });
}

if (require.main === module) exercise();
