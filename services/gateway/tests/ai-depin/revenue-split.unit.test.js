/**
 * revenue-split.unit.test.js — token-light USDC revenue split (ADR 0001).
 *
 * Verifies the bucket resolution, validation, Splits v2 config generation, and the
 * exact-sum integer fee split for the USDC-on-Base revenue model that replaces the
 * legacy native-TFUEL CoreRevenueSplitter on the go-forward fee path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOTAL_BPS,
  BUCKETS,
  resolveSplit,
  validateSplit,
  toSplitsV2Config,
  splitFee,
  describeSplit,
} from '../../src/revenue-split.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';

// A fully-addressed env using the default bps (4000/3500/2500).
function envWithAddrs(extra = {}) {
  return {
    REVENUE_TREASURY_ADDRESS: A,
    REVENUE_BUYBACK_ADDRESS: B,
    REVENUE_STAKERS_ADDRESS: C,
    ...extra,
  };
}

describe('resolveSplit — bucket resolution', () => {
  it('uses default bps summing to 10000 when only addresses are set', () => {
    const split = resolveSplit(envWithAddrs());
    assert.equal(split.totalBps, TOTAL_BPS);
    assert.equal(split.buckets.length, BUCKETS.length);
    assert.deepEqual(split.buckets.map((b) => b.bps), [4000, 3500, 2500]);
  });

  it('honors per-bucket bps env overrides', () => {
    const split = resolveSplit(envWithAddrs({
      REVENUE_TREASURY_BPS: '5000',
      REVENUE_BUYBACK_BPS: '3000',
      REVENUE_STAKERS_BPS: '2000',
    }));
    assert.deepEqual(split.buckets.map((b) => b.bps), [5000, 3000, 2000]);
    assert.equal(split.totalBps, TOTAL_BPS);
  });

  it('honors a REVENUE_SPLIT JSON override (address + bps)', () => {
    const split = resolveSplit({
      REVENUE_SPLIT: JSON.stringify({
        treasury: { address: A, bps: 6000 },
        buyback: { address: B, bps: 4000 },
        stakers: { address: C, bps: 0 },
      }),
    });
    assert.equal(split.totalBps, TOTAL_BPS);
    assert.equal(split.buckets.find((b) => b.key === 'treasury').bps, 6000);
    assert.equal(split.buckets.find((b) => b.key === 'stakers').bps, 0);
  });

  it('defaults addresses to null when unset', () => {
    const split = resolveSplit({});
    assert.equal(split.buckets.every((b) => b.address === null), true);
  });
});

describe('validateSplit — invariants', () => {
  it('passes for a valid default split without requiring addresses', () => {
    const errors = validateSplit(resolveSplit(envWithAddrs()));
    assert.deepEqual(errors, []);
  });

  it('flags bps that do not sum to 10000', () => {
    const split = resolveSplit(envWithAddrs({ REVENUE_STAKERS_BPS: '2499' }));
    const errors = validateSplit(split);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /sum to 10000/);
  });

  it('requires valid addresses for non-zero buckets when requireAddresses=true', () => {
    const split = resolveSplit({}); // no addresses
    const errors = validateSplit(split, { requireAddresses: true });
    // treasury + buyback + stakers all non-zero → 3 missing-address errors
    assert.equal(errors.length, 3);
    assert.ok(errors.every((e) => /missing\/invalid address/.test(e)));
  });

  it('does not require an address for a zero-bps bucket', () => {
    const split = resolveSplit({
      REVENUE_SPLIT: JSON.stringify({
        treasury: { address: A, bps: 6000 },
        buyback: { address: B, bps: 4000 },
        stakers: { bps: 0 },
      }),
    });
    const errors = validateSplit(split, { requireAddresses: true });
    assert.deepEqual(errors, []);
  });
});

describe('toSplitsV2Config — deployable Split struct', () => {
  it('builds aligned recipients/allocations with matching totalAllocation', () => {
    const cfg = toSplitsV2Config(resolveSplit(envWithAddrs()));
    assert.deepEqual(cfg.recipients, [A, B, C]);
    assert.deepEqual(cfg.allocations, [4000, 3500, 2500]);
    assert.equal(cfg.totalAllocation, 10000);
    assert.equal(cfg.distributionIncentive, 0);
  });

  it('omits buckets with zero bps or missing address', () => {
    const cfg = toSplitsV2Config(resolveSplit({
      REVENUE_SPLIT: JSON.stringify({
        treasury: { address: A, bps: 7000 },
        buyback: { address: B, bps: 3000 },
        stakers: { bps: 0 }, // no address, zero → omitted
      }),
    }));
    assert.deepEqual(cfg.recipients, [A, B]);
    assert.deepEqual(cfg.allocations, [7000, 3000]);
    assert.equal(cfg.totalAllocation, 10000);
  });

  it('passes through a distribution incentive', () => {
    const cfg = toSplitsV2Config(resolveSplit(envWithAddrs()), { distributionIncentive: 100 });
    assert.equal(cfg.distributionIncentive, 100);
  });
});

describe('splitFee — exact-sum integer split', () => {
  it('splits a fee into parts that sum exactly to the input', () => {
    const split = resolveSplit(envWithAddrs());
    const parts = splitFee('1000000', split); // $1.00 USDC (6dp)
    const sum = parts.reduce((s, p) => s + BigInt(p.amount), 0n);
    assert.equal(sum, 1000000n);
    // 4000/3500/2500 of 1,000,000 = 400000 / 350000 / 250000
    assert.deepEqual(parts.map((p) => p.amount), ['400000', '350000', '250000']);
  });

  it('assigns flooring remainder to the last bucket (still exact)', () => {
    const split = resolveSplit(envWithAddrs());
    const parts = splitFee('1', split); // 1 unit — indivisible
    const sum = parts.reduce((s, p) => s + BigInt(p.amount), 0n);
    assert.equal(sum, 1n);
    // treasury floor(1*4000/10000)=0, buyback floor(1*3500/10000)=0, stakers remainder=1
    assert.deepEqual(parts.map((p) => p.amount), ['0', '0', '1']);
  });

  it('holds the exact-sum invariant across many amounts and splits', () => {
    const splits = [
      resolveSplit(envWithAddrs()),
      resolveSplit(envWithAddrs({ REVENUE_TREASURY_BPS: '3333', REVENUE_BUYBACK_BPS: '3333', REVENUE_STAKERS_BPS: '3334' })),
    ];
    const amounts = ['0', '1', '7', '10000', '999999', '123456789'];
    for (const split of splits) {
      for (const amt of amounts) {
        const parts = splitFee(amt, split);
        const sum = parts.reduce((s, p) => s + BigInt(p.amount), 0n);
        assert.equal(sum, BigInt(amt), `sum mismatch for amt=${amt}`);
      }
    }
  });
});

describe('describeSplit — transparency surface', () => {
  it('reports the model and per-bucket pct for receipts/telemetry', () => {
    const d = describeSplit(resolveSplit(envWithAddrs()));
    assert.equal(d.model, 'usdc-base-splits-v2');
    assert.equal(d.totalBps, TOTAL_BPS);
    assert.deepEqual(d.buckets.map((b) => b.pct), [40, 35, 25]);
  });
});
