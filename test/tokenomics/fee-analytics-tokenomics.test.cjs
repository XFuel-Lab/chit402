/**
 * Fee Analytics — Tokenomics Sensitivity & Dilution Tests
 *
 * Validates sensitivitySweep() and dilutionModel() against whitepaper
 * anchor data and expected economic behavior.
 *
 * Run: node test/tokenomics/fee-analytics-tokenomics.test.cjs
 */

const assert = require('assert');

// Dynamic import of ESM module
async function loadModule() {
  const mod = await import('../../backend/theta-bridge/src/fee-analytics.js');
  return mod;
}

async function runTests() {
  const {
    calculateTaskFee,
    applySplit,
    sensitivitySweep,
    dilutionModel,
    FEE_CONFIG,
    REVENUE_SPLIT,
  } = await loadModule();

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    }
  }

  console.log('\nFee Analytics — Tokenomics Tests\n');

  // ── Test 1: Whitepaper anchor ($5M TVL = ~$120K annual) ────────────────

  test('Base case matches whitepaper: $5M TVL ≈ $120K annual revenue', () => {
    const sweep = sensitivitySweep({
      aiShares:  [0.6],
      tvlLevels: [5_000_000],
      bpsLevels: [50],
    });

    const row = sweep.rows[0];
    assert.ok(row, 'Should produce at least one row');
    assert.strictEqual(row.tvl, 5_000_000, 'TVL should be $5M');
    assert.strictEqual(row.feeBps, 50, 'Fee should be 50 BPS');

    // Whitepaper: $5M TVL → $2M monthly vol → $10K monthly fees → $120K annual
    // Model includes additive A2A relay fees, so expect slightly above $10K
    assert.ok(row.monthlyFees >= 10_000, `Monthly fees ${row.monthlyFees} should be >= $10K`);
    assert.ok(row.monthlyFees <= 11_000, `Monthly fees ${row.monthlyFees} should be <= $11K (within 10% of whitepaper)`);
    assert.ok(row.annualFees >= 120_000, `Annual fees ${row.annualFees} should be >= $120K`);
    assert.ok(row.annualFees <= 132_000, `Annual fees ${row.annualFees} should be <= $132K (within 10%)`);

    // Revenue split validation
    const bbbPct = row.monthlyBBB / row.monthlyFees;
    assert.ok(Math.abs(bbbPct - 0.30) < 0.01, `BBB should be 30% of fees, got ${(bbbPct * 100).toFixed(1)}%`);
    const veXFPct = row.monthlyVeXF / row.monthlyFees;
    assert.ok(Math.abs(veXFPct - 0.25) < 0.01, `veXF should be 25% of fees, got ${(veXFPct * 100).toFixed(1)}%`);
    const treasuryPct = row.monthlyTreasury / row.monthlyFees;
    assert.ok(Math.abs(treasuryPct - 0.15) < 0.01, `Treasury should be 15% of fees, got ${(treasuryPct * 100).toFixed(1)}%`);
  });

  // ── Test 2: Dilution model deflation stays bounded ─────────────────────

  test('Dilution model: 3-year BBB burn deflates <15%, multiplier capped at 3x', () => {
    const model = dilutionModel({
      initialSupply: 1_000_000_000,
      monthlyVolume: 2_000_000,
      feeBps: 50,
      xfPrice: 0.001,
      veXFLockedPct: 15,
      years: 3,
      maxMultiplier: 3,
    });

    const final = model.summary;

    // Deflation should be meaningful but bounded
    assert.ok(final.deflationPct > 0, 'Should have positive deflation');
    assert.ok(final.deflationPct < 15, `Deflation ${final.deflationPct}% should be < 15% over 3 years at base volume`);

    // Supply should decrease
    assert.ok(final.finalSupply < 1_000_000_000, 'Final supply should be less than initial');
    assert.ok(final.totalBurned > 0, 'Should have burned tokens');

    // Multiplier should be > 1 but capped at 3
    assert.ok(final.finalMultiplier >= 1.0, 'Multiplier should be >= 1.0');
    assert.ok(final.finalMultiplier <= 3.0, `Multiplier ${final.finalMultiplier} should be <= 3.0 (cap)`);

    // Cumulative revenue over 3 years should match expectation
    // $10K/mo * 36 months = $360K
    assert.ok(final.cumulativeRevenue >= 350_000, `Cumulative revenue ${final.cumulativeRevenue} should be >= $350K`);
    assert.ok(final.cumulativeRevenue <= 370_000, `Cumulative revenue ${final.cumulativeRevenue} should be <= $370K`);

    // veXF yield should be positive and reasonable
    assert.ok(final.year1VeXFYield > 0, 'Year 1 veXF yield should be positive');
    assert.ok(final.year3VeXFYield > final.year1VeXFYield, 'veXF yield should increase over time (deflation effect)');

    // Monthly detail should have correct length
    assert.strictEqual(model.months.length, 36, 'Should have 36 months for 3-year model');

    // Treasury spend sweep should have 4 scenarios
    assert.strictEqual(model.treasurySpendSweep.length, 4, 'Treasury spend sweep should have 4 rates');
  });

  // ── Test 3: Bear scenario resilience and sweep dimensions ──────────────

  test('Bear scenario: 60% volume drop produces resilience score and sweep is correct size', () => {
    const sweep = sensitivitySweep();

    // Verify sweep dimensions: 20 TVL * 6 AI * 20 BPS = 2400 scenarios
    assert.strictEqual(sweep.rows.length, 2400, `Should have 2400 scenarios, got ${sweep.rows.length}`);

    // Base case should exist
    assert.ok(sweep.baseCase, 'Base case ($5M TVL, 60% AI, 50 BPS) should exist');

    // Bear scenario
    const bear = sweep.bearScenario;
    assert.strictEqual(bear.volumeDropPct, 60, 'Volume drop should be 60%');
    assert.ok(bear.resilienceScore > 0, 'Resilience score should be positive');
    assert.ok(bear.resilienceScore <= 100, 'Resilience score should be <= 100');

    // With a 60% crash, 40% of revenue survives → resilience ≈ 40%
    assert.strictEqual(bear.resilienceScore, 40, `Resilience score should be 40% (proportional), got ${bear.resilienceScore}%`);

    // Bear monthly fees should be 40% of base
    const expectedBearFees = sweep.baseCase.monthlyFees * 0.4;
    assert.ok(
      Math.abs(bear.bearMonthlyFees - expectedBearFees) < 1,
      `Bear fees ${bear.bearMonthlyFees} should be 40% of base ${sweep.baseCase.monthlyFees}`
    );

    // Summary ranges
    assert.deepStrictEqual(sweep.summary.tvlRange, [5_000_000, 100_000_000], 'TVL range should be $5M-$100M');
    assert.deepStrictEqual(sweep.summary.aiRange, [0.3, 0.8], 'AI range should be 30-80%');
  });

  // ── Results ────────────────────────────────────────────────────────────

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
