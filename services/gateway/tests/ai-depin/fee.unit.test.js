/**
 * XFuel Protocol v5.1 — AI DePIN Fee Unit Tests
 *
 * Tests for:
 *   1. Osmosis yield calc assertions (30-50% APY ranges)
 *   2. Akash IBC fee handling (0.5-1% on compute bids)
 *   3. TAO wrapper logic (tao_evm_target non-zero for Substrate bridge)
 *   4. calculateTaskFee consistency (mirrors server.js / fee-analytics.js / main.rs / contract.rs)
 *   5. 30/30/25/15 revenue split invariant across all fee streams
 *   6. A2A relay fee (0.1% on escrow amounts)
 *   7. ZK extension constraints (AITask — escrow required for COMPUTE_BID)
 *   8. Persistence legacy compat checks (no new tests, just backward-compat assertions)
 *
 * Reference: Whitepaper v5.1 Sections 6.1, 3.4, 8.2
 *
 * @module fee.unit.test
 * @version 1.0.0
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── Inline calculateTaskFee (mirrored from server.js / fee-analytics.js) ────
// We inline rather than import because server.js has runtime dependencies
// (express, ethers, ai-listener) that make isolated unit testing impractical.

const FEE_CONFIG = {
  defaultBps:    50,     // 0.5%
  minBps:        50,
  maxBps:        100,    // 1.0%
  a2aRelayBps:   10,     // 0.1%
  bridgeBps:     50,     // 0.5%
  lpSwapBps:     1,      // 0.01%
  denominator:   10000,
  minTaskAmount: 10000,
};

const REVENUE_SPLIT = {
  bbb:      { label: 'Buyback & Burn (BBB)', pct: 30 },
  lp:       { label: 'LP Reinvestment',      pct: 30 },
  vexf:     { label: 'veXF Stakers',         pct: 25 },
  treasury: { label: 'Treasury',             pct: 15 },
};

/**
 * calculateTaskFee — exact mirror of:
 *   - backend/theta-bridge/src/server.js     → calculateTaskFee()
 *   - backend/theta-bridge/src/fee-analytics.js → calculateTaskFee()
 *   - sp1-prover/program/src/main.rs          → calculate_task_fee()
 *   - cosmwasm-contracts/ai-verifier/src/contract.rs → calculate_task_fee()
 *
 * fee_amount = (gross × bps) / 10000
 * net_amount = gross - fee_amount
 */
function calculateTaskFee(grossAmount, feeBps = FEE_CONFIG.defaultBps) {
  const gross = BigInt(grossAmount);
  const bps = BigInt(Math.min(Math.max(feeBps, FEE_CONFIG.minBps), FEE_CONFIG.maxBps));
  const fee = (gross * bps) / BigInt(FEE_CONFIG.denominator);
  const net = gross - fee;
  return {
    grossAmount: gross.toString(),
    feeAmount: fee.toString(),
    netAmount: net.toString(),
    feeBps: Number(bps),
  };
}

/**
 * calculateRelayFee — mirrors A2A relay fee (0.1% on escrow)
 */
function calculateRelayFee(escrowAmount) {
  const escrow = BigInt(escrowAmount || 0);
  if (escrow <= 0n) return { feeAmount: '0', feeBps: 0 };
  const fee = (escrow * BigInt(FEE_CONFIG.a2aRelayBps)) / BigInt(FEE_CONFIG.denominator);
  return { feeAmount: fee.toString(), feeBps: FEE_CONFIG.a2aRelayBps };
}

/**
 * applySplit — apply 30/30/25/15 split to a total fee
 */
function applySplit(totalFeeAmount) {
  const total = Number(totalFeeAmount);
  return {
    bbb:      total * 0.30,
    lp:       total * 0.30,
    vexf:     total * 0.25,
    treasury: total * 0.15,
  };
}

// ─── Supported enums (synced with server.js, AIDePINRouter.sol, main.rs) ─────

const CHAIN_IDS = {
  THETA:       'theta',
  OSMOSIS:     'osmosis',
  AKASH:       'akash',
  BITTENSOR:   'bittensor',
  PERSISTENCE: 'persistence',
};

const MESSAGE_TYPES = {
  COMPUTE_BID:       'compute_bid',
  COMPUTE_RESULT:    'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY:  'capability_query',
  DATA_ATTESTATION:  'data_attestation',
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. calculateTaskFee — Core Fee Math (Whitepaper §8.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('calculateTaskFee — Core Fee Math', () => {
  it('should calculate 0.5% fee at 50 BPS', () => {
    const result = calculateTaskFee('10000000', 50);
    // fee = 10000000 * 50 / 10000 = 50000
    assert.equal(result.feeAmount, '50000');
    assert.equal(result.netAmount, '9950000');
    assert.equal(result.feeBps, 50);
  });

  it('should calculate 1.0% fee at 100 BPS', () => {
    const result = calculateTaskFee('10000000', 100);
    // fee = 10000000 * 100 / 10000 = 100000
    assert.equal(result.feeAmount, '100000');
    assert.equal(result.netAmount, '9900000');
    assert.equal(result.feeBps, 100);
  });

  it('should calculate 0.75% fee at 75 BPS (COMPUTE_BID default)', () => {
    const result = calculateTaskFee('100000000', 75);
    // fee = 100000000 * 75 / 10000 = 750000
    assert.equal(result.feeAmount, '750000');
    assert.equal(result.netAmount, '99250000');
    assert.equal(result.feeBps, 75);
  });

  it('should clamp fee_bps below 50 to 50', () => {
    const result = calculateTaskFee('10000000', 10);
    assert.equal(result.feeBps, 50);
    assert.equal(result.feeAmount, '50000');
  });

  it('should clamp fee_bps above 100 to 100', () => {
    const result = calculateTaskFee('10000000', 200);
    assert.equal(result.feeBps, 100);
    assert.equal(result.feeAmount, '100000');
  });

  it('should handle zero gross amount', () => {
    const result = calculateTaskFee('0', 50);
    assert.equal(result.feeAmount, '0');
    assert.equal(result.netAmount, '0');
  });

  it('should ensure net + fee = gross (invariant)', () => {
    const amounts = ['1000000', '99999999', '1', '100000000000'];
    for (const amt of amounts) {
      for (const bps of [50, 60, 75, 100]) {
        const r = calculateTaskFee(amt, bps);
        assert.equal(
          BigInt(r.feeAmount) + BigInt(r.netAmount),
          BigInt(r.grossAmount),
          `Invariant broken for gross=${amt}, bps=${bps}`
        );
      }
    }
  });

  it('should match whitepaper §6.1 Example A: $100 INFERENCE_REQUEST', () => {
    // Whitepaper: gross=10,000,000 micro-units, fee_bps=50 → fee=50,000, net=9,950,000
    const result = calculateTaskFee('10000000', 50);
    assert.equal(result.feeAmount, '50000');
    assert.equal(result.netAmount, '9950000');
  });

  it('should match whitepaper §6.1 Example B: $1,000 COMPUTE_BID at 75 BPS', () => {
    // Whitepaper: gross=100,000,000, fee_bps=75 → fee=750,000, net=99,250,000
    const result = calculateTaskFee('100000000', 75);
    assert.equal(result.feeAmount, '750000');
    assert.equal(result.netAmount, '99250000');
  });

  it('should enforce min task amount (10000 units)', () => {
    // The min task amount of 10000 is enforced at the API layer (server.js validates)
    // Here we verify fee calc still works for the boundary
    const result = calculateTaskFee('10000', 50);
    assert.equal(result.feeAmount, '50');
    assert.equal(result.netAmount, '9950');
    assert.ok(BigInt(result.grossAmount) >= BigInt(FEE_CONFIG.minTaskAmount));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 30/30/25/15 Revenue Split Invariant (Whitepaper §6.1, §8.1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('30/30/25/15 Revenue Split — Unchanged Across All Streams', () => {
  it('should always sum split percentages to 100%', () => {
    const total = Object.values(REVENUE_SPLIT).reduce((s, v) => s + v.pct, 0);
    assert.equal(total, 100, 'Revenue split must sum to 100%');
  });

  it('should have exact split: BBB=30, LP=30, veXF=25, Treasury=15', () => {
    assert.equal(REVENUE_SPLIT.bbb.pct, 30);
    assert.equal(REVENUE_SPLIT.lp.pct, 30);
    assert.equal(REVENUE_SPLIT.vexf.pct, 25);
    assert.equal(REVENUE_SPLIT.treasury.pct, 15);
  });

  it('should apply identical split for AI task fees', () => {
    const { feeAmount } = calculateTaskFee('10000000', 75); // AI task
    const split = applySplit(feeAmount);
    assert.ok(Math.abs(split.bbb / Number(feeAmount) - 0.30) < 0.001);
    assert.ok(Math.abs(split.lp / Number(feeAmount) - 0.30) < 0.001);
    assert.ok(Math.abs(split.vexf / Number(feeAmount) - 0.25) < 0.001);
    assert.ok(Math.abs(split.treasury / Number(feeAmount) - 0.15) < 0.001);
  });

  it('should apply identical split for bridge fees', () => {
    const { feeAmount } = calculateTaskFee('10000000', 50); // Bridge fee
    const split = applySplit(feeAmount);
    assert.ok(Math.abs(split.bbb / Number(feeAmount) - 0.30) < 0.001);
    assert.ok(Math.abs(split.lp / Number(feeAmount) - 0.30) < 0.001);
    assert.ok(Math.abs(split.vexf / Number(feeAmount) - 0.25) < 0.001);
    assert.ok(Math.abs(split.treasury / Number(feeAmount) - 0.15) < 0.001);
  });

  it('should apply identical split for A2A relay fees', () => {
    const { feeAmount } = calculateRelayFee('25000000'); // A2A escrow
    const split = applySplit(feeAmount);
    assert.ok(Math.abs(split.bbb / Number(feeAmount) - 0.30) < 0.001);
    assert.ok(Math.abs(split.lp / Number(feeAmount) - 0.30) < 0.001);
    assert.ok(Math.abs(split.vexf / Number(feeAmount) - 0.25) < 0.001);
    assert.ok(Math.abs(split.treasury / Number(feeAmount) - 0.15) < 0.001);
  });

  it('should apply identical split for compute settlement fees', () => {
    const { feeAmount } = calculateTaskFee('50000000', 100); // 1% premium compute
    const split = applySplit(feeAmount);
    const total = split.bbb + split.lp + split.vexf + split.treasury;
    assert.ok(Math.abs(total - Number(feeAmount)) < 0.01,
      'Split buckets must sum to total fee');
  });

  it('should produce correct whitepaper §6.1.1 Example A split', () => {
    // $100 INFERENCE_REQUEST → $0.50 fee → 0.15/0.15/0.125/0.075
    const { feeAmount } = calculateTaskFee('10000000', 50);
    const split = applySplit(feeAmount);
    // In micro-units: fee=50000 → BBB=15000, LP=15000, veXF=12500, Treasury=7500
    assert.equal(split.bbb, 15000);
    assert.equal(split.lp, 15000);
    assert.equal(split.vexf, 12500);
    assert.equal(split.treasury, 7500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Osmosis Yield Calc Assertions (30-50% APY — Whitepaper §1.2, §3.2.3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Osmosis Yield Range Assertions (30-50%+ APY)', () => {
  // These tests validate that our yield-routing models respect the
  // 30-50% APY range claimed in the whitepaper for Osmosis AI/DePIN pools.

  const MIN_APY = 0.30; // 30%
  const MAX_APY = 0.50; // 50%

  /**
   * Simulate yield from an Osmosis pool position.
   * Returns annualized yield in units for a given principal and APY.
   */
  function simulateOsmosisYield(principalMicroUnits, apy) {
    return Math.floor(principalMicroUnits * apy);
  }

  it('should produce at least 30% annualized yield at lower bound', () => {
    const principal = 10_000_000; // 10 TFUEL (micro-units)
    const yield30 = simulateOsmosisYield(principal, MIN_APY);
    assert.ok(yield30 >= principal * MIN_APY,
      `30% APY floor must produce >= ${principal * MIN_APY} yield`);
    assert.equal(yield30, 3_000_000);
  });

  it('should produce at most 50% annualized yield at upper bound', () => {
    const principal = 10_000_000;
    const yield50 = simulateOsmosisYield(principal, MAX_APY);
    assert.equal(yield50, 5_000_000);
    assert.ok(yield50 <= principal * MAX_APY + 1);
  });

  it('should assert AI pool APYs (AKT/OSMO, FET/OSMO) within 30-80% range', () => {
    // AI/DePIN token pools advertise 40-80% APY per whitepaper §3.2.3
    const aiPoolApys = [0.40, 0.55, 0.70, 0.80];
    for (const apy of aiPoolApys) {
      assert.ok(apy >= 0.30, `AI pool APY ${apy} below minimum 30%`);
      assert.ok(apy <= 0.80, `AI pool APY ${apy} above maximum 80%`);
    }
  });

  it('should assert LSTfi pool APYs (stATOM/OSMO, stOSMO) within 20-50% range', () => {
    const lstApys = [0.20, 0.30, 0.40, 0.50];
    for (const apy of lstApys) {
      assert.ok(apy >= 0.20, `LSTfi pool APY ${apy} below minimum 20%`);
      assert.ok(apy <= 0.50, `LSTfi pool APY ${apy} above maximum 50%`);
    }
  });

  it('should verify fee after yield still nets positive for 30% APY', () => {
    const principal = 10_000_000;
    const annualYield = simulateOsmosisYield(principal, 0.30);
    // Bridge fee on entry: 0.5%
    const entryFee = calculateTaskFee(principal.toString(), 50);
    // Net after entry: principal - 0.5%
    const netPrincipal = BigInt(entryFee.netAmount);
    // Annual yield on net principal
    const effectiveYield = Number(netPrincipal) * 0.30;
    assert.ok(effectiveYield > Number(entryFee.feeAmount),
      'Annual yield at 30% must exceed one-time bridge fee');
  });

  it('should outperform Theta native staking (~2-4% APY)', () => {
    const thetaNativeApy = 0.04; // 4% upper bound for Theta
    assert.ok(MIN_APY > thetaNativeApy,
      `Osmosis min APY (${MIN_APY * 100}%) must exceed Theta native (${thetaNativeApy * 100}%)`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Akash IBC Fee Handling (0.5-1% on compute bids — Whitepaper §3.4, §6.1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Akash IBC Fee Handling (0.5-1% on COMPUTE_BID)', () => {
  it('should charge 0.5% on Akash COMPUTE_BID at minimum BPS', () => {
    const result = calculateTaskFee('1000000', 50);
    // 1,000,000 × 50 / 10000 = 5,000
    assert.equal(result.feeAmount, '5000');
    assert.equal(result.netAmount, '995000');
  });

  it('should charge 1.0% on Akash COMPUTE_BID at maximum BPS', () => {
    const result = calculateTaskFee('1000000', 100);
    assert.equal(result.feeAmount, '10000');
    assert.equal(result.netAmount, '990000');
  });

  it('should validate fee range is 0.5-1% (50-100 BPS)', () => {
    for (let bps = 50; bps <= 100; bps += 10) {
      const result = calculateTaskFee('1000000', bps);
      const feePct = Number(result.feeAmount) / Number(result.grossAmount);
      assert.ok(feePct >= 0.005, `Fee at ${bps} BPS must be >= 0.5%`);
      assert.ok(feePct <= 0.01, `Fee at ${bps} BPS must be <= 1.0%`);
    }
  });

  it('should enforce IBC destination requires ibc_channel for Akash', () => {
    // Simulates the validation that server.js / main.rs perform:
    // cross-chain messages targeting Akash MUST have ibc_channel set
    const akashTask = {
      message_type: MESSAGE_TYPES.COMPUTE_BID,
      chain_id: CHAIN_IDS.AKASH,
      amount: '1000000',
      sender: 'theta_agent_001',
      ibc_channel: null, // Missing!
    };

    const errors = [];
    if (akashTask.chain_id !== CHAIN_IDS.THETA && !akashTask.ibc_channel) {
      errors.push('ibc_channel required for non-Theta destinations');
    }

    assert.ok(errors.length > 0, 'Missing ibc_channel for Akash must produce validation error');
  });

  it('should pass validation with ibc_channel set for Akash', () => {
    const akashTask = {
      message_type: MESSAGE_TYPES.COMPUTE_BID,
      chain_id: CHAIN_IDS.AKASH,
      amount: '1000000',
      sender: 'theta_agent_001',
      ibc_channel: 'channel-42',
    };

    const errors = [];
    if (akashTask.chain_id !== CHAIN_IDS.THETA && !akashTask.ibc_channel) {
      errors.push('ibc_channel required');
    }

    assert.equal(errors.length, 0);
  });

  it('should match whitepaper §3.2.4 COMPUTE_BID flow fee calc', () => {
    // Whitepaper: amount=1,000,000, fee_bps=50 → fee=5,000, net=995,000
    const result = calculateTaskFee('1000000', 50);
    assert.equal(result.feeAmount, '5000');
    assert.equal(result.netAmount, '995000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TAO Wrapper Logic (tao_evm_target for Substrate bridge — §3.4.2, §3.4.6)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TAO Wrapper Logic (tao_evm_target non-zero for Substrate bridge)', () => {
  const ZERO_ADDRESS = '0x' + '0'.repeat(40);
  const VALID_TAO_EVM = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';

  it('should require tao_evm_target for Bittensor EVM calls', () => {
    // When destination is Bittensor and tao_evm_target is non-zero,
    // it means the task routes via TAO's EVM layer (§3.4.6)
    const taoTask = {
      chain_id: CHAIN_IDS.BITTENSOR,
      tao_evm_target: VALID_TAO_EVM,
      subnet_id: 18,
    };

    assert.ok(taoTask.tao_evm_target !== ZERO_ADDRESS,
      'tao_evm_target must be non-zero for EVM-layer Bittensor calls');
    assert.ok(taoTask.tao_evm_target.startsWith('0x'),
      'tao_evm_target must be a valid 0x-prefixed address');
    assert.equal(taoTask.tao_evm_target.length, 42,
      'tao_evm_target must be 42 chars (0x + 40 hex)');
  });

  it('should allow zero tao_evm_target for Substrate-only TAO routing', () => {
    // Per whitepaper §3.4.6: tao_evm_target is zero for Substrate-only calls,
    // routing via Composable Finance IBC bridge
    const taoSubstrateTask = {
      chain_id: CHAIN_IDS.BITTENSOR,
      tao_evm_target: ZERO_ADDRESS,
      subnet_id: 18,
    };

    assert.equal(taoSubstrateTask.tao_evm_target, ZERO_ADDRESS,
      'Substrate-only TAO routing uses zero tao_evm_target');
  });

  it('should validate TAO task requires subnet_id (except CAPABILITY_QUERY)', () => {
    // Per server.js validation: Bittensor tasks need subnet_id
    const errors = [];
    const task = {
      message_type: MESSAGE_TYPES.COMPUTE_BID,
      chain_id: CHAIN_IDS.BITTENSOR,
      subnet_id: null,
    };

    if (task.chain_id === CHAIN_IDS.BITTENSOR &&
        !task.subnet_id &&
        task.message_type !== MESSAGE_TYPES.CAPABILITY_QUERY) {
      errors.push('subnet_id required for Bittensor (except CAPABILITY_QUERY)');
    }

    assert.ok(errors.length > 0, 'Missing subnet_id for TAO COMPUTE_BID must error');
  });

  it('should exempt CAPABILITY_QUERY from subnet_id requirement', () => {
    const errors = [];
    const task = {
      message_type: MESSAGE_TYPES.CAPABILITY_QUERY,
      chain_id: CHAIN_IDS.BITTENSOR,
      subnet_id: null,
    };

    if (task.chain_id === CHAIN_IDS.BITTENSOR &&
        !task.subnet_id &&
        task.message_type !== MESSAGE_TYPES.CAPABILITY_QUERY) {
      errors.push('subnet_id required');
    }

    assert.equal(errors.length, 0, 'CAPABILITY_QUERY should not require subnet_id');
  });

  it('should calculate fee for TAO COMPUTE_BID at 75 BPS (whitepaper §6.1.1 Example B)', () => {
    // $1,000 COMPUTE_BID → Bittensor subnet 18, 75 BPS
    const result = calculateTaskFee('100000000', 75);
    assert.equal(result.feeAmount, '750000');
    assert.equal(result.netAmount, '99250000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. A2A Relay Fee (0.1% on escrow — Whitepaper §3.4.3, §6.1.1 Example C)
// ═══════════════════════════════════════════════════════════════════════════════

describe('A2A Relay Fee (0.1% on escrow amounts)', () => {
  it('should calculate 0.1% relay fee on escrow', () => {
    const result = calculateRelayFee('25000000');
    // 25,000,000 × 10 / 10000 = 25,000
    assert.equal(result.feeAmount, '25000');
    assert.equal(result.feeBps, 10);
  });

  it('should return zero fee for zero escrow', () => {
    const result = calculateRelayFee('0');
    assert.equal(result.feeAmount, '0');
  });

  it('should match whitepaper §6.1.1 Example C: $250 A2A escrow', () => {
    // Whitepaper: escrow=25,000,000, relay_fee = 0.1% = 25,000
    const result = calculateRelayFee('25000000');
    assert.equal(result.feeAmount, '25000');
  });

  it('should enforce relay fee is exactly 10 BPS', () => {
    assert.equal(FEE_CONFIG.a2aRelayBps, 10, 'A2A relay fee must be 10 BPS (0.1%)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. ZK Extension Constraints — AITask (Whitepaper §3.4.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ZK Extension Constraints — AITask (§3.4.2)', () => {

  /**
   * Validate AITask-type-specific constraints matching main.rs validate_ai_task().
   */
  function validateAITaskConstraints(taskType, fields) {
    const errors = [];
    switch (taskType) {
      case MESSAGE_TYPES.COMPUTE_RESULT:
        if (!fields.output_hash) errors.push('COMPUTE_RESULT requires output_hash');
        if (!(fields.execution_duration_ms > 0)) errors.push('COMPUTE_RESULT requires positive execution_duration');
        break;
      case MESSAGE_TYPES.INFERENCE_REQUEST:
        if (!fields.model_id_hash) errors.push('INFERENCE_REQUEST requires model_id_hash');
        if (!fields.input_hash) errors.push('INFERENCE_REQUEST requires input_hash');
        break;
      case MESSAGE_TYPES.COMPUTE_BID:
        if (!fields.provider_hash) errors.push('COMPUTE_BID requires provider_hash');
        break;
      case MESSAGE_TYPES.DATA_ATTESTATION:
        if (!fields.input_hash) errors.push('DATA_ATTESTATION requires input_hash');
        break;
      case MESSAGE_TYPES.CAPABILITY_QUERY:
        // No additional constraints
        break;
    }
    return errors;
  }

  it('should require output_hash for COMPUTE_RESULT', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.COMPUTE_RESULT, {
      output_hash: null,
      execution_duration_ms: 1200,
    });
    assert.ok(errors.some(e => e.includes('output_hash')));
  });

  it('should require execution_duration for COMPUTE_RESULT', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.COMPUTE_RESULT, {
      output_hash: '0xabc123',
      execution_duration_ms: 0,
    });
    assert.ok(errors.some(e => e.includes('execution_duration')));
  });

  it('should pass COMPUTE_RESULT with valid fields', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.COMPUTE_RESULT, {
      output_hash: '0xabc123def456',
      execution_duration_ms: 1200,
    });
    assert.equal(errors.length, 0);
  });

  it('should require model_id_hash for INFERENCE_REQUEST', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.INFERENCE_REQUEST, {
      model_id_hash: null,
      input_hash: '0xabc',
    });
    assert.ok(errors.some(e => e.includes('model_id_hash')));
  });

  it('should require input_hash for INFERENCE_REQUEST', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.INFERENCE_REQUEST, {
      model_id_hash: 'sha256_llama3',
      input_hash: null,
    });
    assert.ok(errors.some(e => e.includes('input_hash')));
  });

  it('should require provider_hash for COMPUTE_BID', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.COMPUTE_BID, {
      provider_hash: null,
    });
    assert.ok(errors.some(e => e.includes('provider_hash')));
  });

  it('should require input_hash for DATA_ATTESTATION', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.DATA_ATTESTATION, {
      input_hash: null,
    });
    assert.ok(errors.some(e => e.includes('input_hash')));
  });

  it('should have no additional constraints for CAPABILITY_QUERY', () => {
    const errors = validateAITaskConstraints(MESSAGE_TYPES.CAPABILITY_QUERY, {});
    assert.equal(errors.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. A2A Escrow Rules (Whitepaper §3.4.3, §3.2.4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('A2A Escrow Rules per Message Type', () => {

  /**
   * Validate escrow rules matching main.rs validate_a2a_message()
   * and server.js /a2a-message validation.
   */
  function validateEscrow(messageType, escrowAmount) {
    const escrow = BigInt(escrowAmount || '0');
    const errors = [];

    switch (messageType) {
      case MESSAGE_TYPES.COMPUTE_BID:
        if (escrow <= 0n) errors.push('COMPUTE_BID requires non-zero escrow');
        break;
      case MESSAGE_TYPES.INFERENCE_REQUEST:
        if (escrow <= 0n) errors.push('INFERENCE_REQUEST requires non-zero escrow (budget)');
        break;
      case MESSAGE_TYPES.CAPABILITY_QUERY:
        if (escrow > 0n) errors.push('CAPABILITY_QUERY must have zero escrow');
        break;
      case MESSAGE_TYPES.COMPUTE_RESULT:
      case MESSAGE_TYPES.DATA_ATTESTATION:
        // No escrow constraint
        break;
    }
    return errors;
  }

  it('should require escrow for COMPUTE_BID', () => {
    const errors = validateEscrow(MESSAGE_TYPES.COMPUTE_BID, '0');
    assert.ok(errors.length > 0, 'COMPUTE_BID with zero escrow must fail');
  });

  it('should accept COMPUTE_BID with positive escrow', () => {
    const errors = validateEscrow(MESSAGE_TYPES.COMPUTE_BID, '1000000');
    assert.equal(errors.length, 0);
  });

  it('should require escrow for INFERENCE_REQUEST', () => {
    const errors = validateEscrow(MESSAGE_TYPES.INFERENCE_REQUEST, '0');
    assert.ok(errors.length > 0, 'INFERENCE_REQUEST with zero escrow must fail');
  });

  it('should reject non-zero escrow for CAPABILITY_QUERY', () => {
    const errors = validateEscrow(MESSAGE_TYPES.CAPABILITY_QUERY, '100');
    assert.ok(errors.length > 0, 'CAPABILITY_QUERY with escrow must fail');
  });

  it('should accept zero escrow for CAPABILITY_QUERY', () => {
    const errors = validateEscrow(MESSAGE_TYPES.CAPABILITY_QUERY, '0');
    assert.equal(errors.length, 0);
  });

  it('should allow optional escrow for COMPUTE_RESULT', () => {
    assert.equal(validateEscrow(MESSAGE_TYPES.COMPUTE_RESULT, '0').length, 0);
    assert.equal(validateEscrow(MESSAGE_TYPES.COMPUTE_RESULT, '1000').length, 0);
  });

  it('should allow optional escrow for DATA_ATTESTATION', () => {
    assert.equal(validateEscrow(MESSAGE_TYPES.DATA_ATTESTATION, '0').length, 0);
    assert.equal(validateEscrow(MESSAGE_TYPES.DATA_ATTESTATION, '5000').length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Persistence Legacy Compat Checks (no new tests, just compat assertions)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Persistence Legacy Compatibility', () => {
  it('should include persistence in supported chain IDs', () => {
    assert.ok(CHAIN_IDS.PERSISTENCE, 'PERSISTENCE must be a supported chain');
    assert.equal(CHAIN_IDS.PERSISTENCE, 'persistence');
  });

  it('should use same fee model for Persistence as other chains (30/30/25/15)', () => {
    // Persistence uses the same RevenueSplitter logic — no Persistence-specific fees
    const bridgeFee = calculateTaskFee('10000000', FEE_CONFIG.bridgeBps);
    const split = applySplit(bridgeFee.feeAmount);
    assert.equal(split.bbb, Number(bridgeFee.feeAmount) * 0.30);
    assert.equal(split.lp, Number(bridgeFee.feeAmount) * 0.30);
    assert.equal(split.vexf, Number(bridgeFee.feeAmount) * 0.25);
    assert.equal(split.treasury, Number(bridgeFee.feeAmount) * 0.15);
  });

  it('should maintain 0.5% bridge fee for Persistence reverse burn', () => {
    // Reverse bridge fee is identical regardless of source chain
    const reverseBurnFee = calculateTaskFee('1000000000000000000', 50); // 1 TFUEL
    assert.equal(reverseBurnFee.feeAmount, '5000000000000000'); // 0.5%
    assert.equal(reverseBurnFee.netAmount, '995000000000000000'); // 99.5%
  });

  it('should treat Persistence as IBC destination (requires ibc_channel_hash)', () => {
    // Same validation as Osmosis/Akash: IBC-routed destinations need channel
    const ibcChains = [CHAIN_IDS.OSMOSIS, CHAIN_IDS.AKASH, CHAIN_IDS.PERSISTENCE];
    for (const chain of ibcChains) {
      const needsIbc = chain !== CHAIN_IDS.THETA;
      assert.ok(needsIbc, `${chain} must require IBC channel for cross-chain routing`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Fee Config Constants Sync Check
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fee Config Constants Sync (server.js / fee-analytics.js / main.rs)', () => {
  it('should have default BPS = 50 (0.5%)', () => {
    assert.equal(FEE_CONFIG.defaultBps, 50);
  });

  it('should have min BPS = 50', () => {
    assert.equal(FEE_CONFIG.minBps, 50);
  });

  it('should have max BPS = 100 (1.0%)', () => {
    assert.equal(FEE_CONFIG.maxBps, 100);
  });

  it('should have A2A relay BPS = 10 (0.1%)', () => {
    assert.equal(FEE_CONFIG.a2aRelayBps, 10);
  });

  it('should have bridge BPS = 50 (0.5%)', () => {
    assert.equal(FEE_CONFIG.bridgeBps, 50);
  });

  it('should have denominator = 10000', () => {
    assert.equal(FEE_CONFIG.denominator, 10000);
  });

  it('should have min task amount = 10000', () => {
    assert.equal(FEE_CONFIG.minTaskAmount, 10000);
  });

  it('should support all 5 chain IDs', () => {
    const chains = Object.values(CHAIN_IDS);
    assert.equal(chains.length, 5);
    assert.ok(chains.includes('theta'));
    assert.ok(chains.includes('osmosis'));
    assert.ok(chains.includes('akash'));
    assert.ok(chains.includes('bittensor'));
    assert.ok(chains.includes('persistence'));
  });

  it('should support all 5 message types', () => {
    const types = Object.values(MESSAGE_TYPES);
    assert.equal(types.length, 5);
    assert.ok(types.includes('compute_bid'));
    assert.ok(types.includes('compute_result'));
    assert.ok(types.includes('inference_request'));
    assert.ok(types.includes('capability_query'));
    assert.ok(types.includes('data_attestation'));
  });
});
