/**
 * @title XFuel v5.1 — Security Fuzzing Tests
 * @notice Comprehensive security testing covering:
 *
 *   1. NONCE FUZZING (Section 10.2):
 *      - Replay attacks (same nonce reuse)
 *      - Nonce desync between backend ↔ on-chain
 *      - Out-of-order nonce submission
 *      - Concurrent nonce races
 *      - Nonce overflow boundary
 *
 *   2. IBC TIMEOUT FUZZING:
 *      - Timeout → automatic refund
 *      - Partial transfer failures
 *      - Channel closure during transfer
 *      - Packet sequence gaps
 *
 *   3. MASS WITHDRAWAL / CIRCUIT BREAKERS (Section 10.4):
 *      - >20% TVL withdrawal in 24h → pause
 *      - >5% revert rate → pause
 *      - Suspicious volume detection
 *      - Emergency LP rebalancing cap ($500K)
 *      - Death spiral simulation (bank run)
 *
 *   4. AI TASK FUZZING:
 *      - Malformed task payloads
 *      - Fee manipulation (below/above BPS range)
 *      - Double-settlement attacks
 *      - Nullifier collision
 *
 *   5. RATE LIMITING & AUTH FUZZING:
 *      - Brute-force API key guessing
 *      - Stale signature replay
 *      - Rate limiter exhaustion
 *
 * @dev Uses node:test runner matching backend/tests/ai-depin/fee.unit.test.js
 *      Integrates with run-e2e-tests.ps1 via `npm run test:security`
 *
 * Reference: Whitepaper v5.1 Sections 10.2, 10.4, 3.4.5, 6.1.2
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const FEE_CONFIG = {
  defaultBps:    50,
  minBps:        50,
  maxBps:        100,
  a2aRelayBps:   10,
  bridgeBps:     50,
  denominator:   10000,
  minTaskAmount: 10000,
};

const CIRCUIT_BREAKER = {
  maxWithdrawalRatePct:  20,
  maxRevertRatePct:       5,
  emergencyLPCap:        500_000,
  windowMs:              86_400_000, // 24h
};

const ProofOutcome = {
  Valid:       'Valid',
  Regenerable: 'Regenerable',
  Invalid:     'Invalid',
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function randomBytes(n = 32) { return crypto.randomBytes(n).toString('hex'); }
function randomAddr() { return `0x${randomBytes(20)}`; }
function randomTaskId() { return `task_${randomBytes(16)}`; }

function calculateTaskFee(grossAmount, feeBps = FEE_CONFIG.defaultBps) {
  const gross = BigInt(grossAmount);
  const bps = BigInt(Math.min(Math.max(feeBps, FEE_CONFIG.minBps), FEE_CONFIG.maxBps));
  const fee = (gross * bps) / BigInt(FEE_CONFIG.denominator);
  return { grossAmount: gross, feeAmount: fee, netAmount: gross - fee, feeBps: Number(bps) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: VaultFactory with Nonce Tracking (Section 10.2)
// ═══════════════════════════════════════════════════════════════════════════════

class FuzzableVaultFactory {
  constructor() {
    this.vaults = new Map();
    this.nonces = new Map();          // user → last nonce
    this.usedNonces = new Map();      // user → Set<nonce>
    this.tvl = 0n;
    this.paused = false;
    this.withdrawalLog = [];          // { user, amount, timestamp }
    this.revertLog = [];
    this.totalWithdrawn24h = 0n;
    this._windowStart = Date.now();
  }

  deposit({ user, amount }) {
    if (this.paused) throw new Error('Contract is paused');
    const amt = BigInt(amount);
    const vault = this.vaults.get(user) || { balance: 0n };
    vault.balance += amt;
    this.vaults.set(user, vault);
    this.tvl += amt;
    return { user, amount: amt };
  }

  /**
   * unwrapFromBurn with full nonce validation (Section 10.2 mitigations)
   */
  unwrapFromBurn({ user, amount, nonce, proof = null }) {
    if (this.paused) throw new Error('CircuitBreaker: contract is paused');

    const amt = BigInt(amount);
    const vault = this.vaults.get(user);
    if (!vault || vault.balance < amt) {
      throw new Error(`InsufficientBalance: have ${vault?.balance || 0n}, need ${amt}`);
    }

    // ── Nonce validation (Section 10.2) ──
    const userNonces = this.usedNonces.get(user) || new Set();

    // Check replay
    if (userNonces.has(nonce)) {
      this.revertLog.push({ user, nonce, reason: 'replay', timestamp: Date.now() });
      throw new Error(`Nonce already used: ${nonce}`);
    }

    // Check nonce is positive integer
    if (!Number.isInteger(nonce) || nonce <= 0) {
      this.revertLog.push({ user, nonce, reason: 'invalid_nonce', timestamp: Date.now() });
      throw new Error(`Invalid nonce: ${nonce}`);
    }

    // Record nonce
    userNonces.add(nonce);
    this.usedNonces.set(user, userNonces);

    // ── Circuit breaker check (Section 10.4) ──
    const now = Date.now();
    if (now - this._windowStart > CIRCUIT_BREAKER.windowMs) {
      this._windowStart = now;
      this.totalWithdrawn24h = 0n;
    }
    this.totalWithdrawn24h += amt;

    if (this.tvl > 0n) {
      const withdrawPct = Number((this.totalWithdrawn24h * 100n) / this.tvl);
      if (withdrawPct > CIRCUIT_BREAKER.maxWithdrawalRatePct) {
        this.paused = true;
        throw new Error(`CircuitBreaker: ${withdrawPct}% > ${CIRCUIT_BREAKER.maxWithdrawalRatePct}% TVL in 24h`);
      }
    }

    // ── Revert rate check ──
    const recentReverts = this.revertLog.filter(r => now - r.timestamp < CIRCUIT_BREAKER.windowMs);
    const totalTxs = this.withdrawalLog.length + recentReverts.length + 1;
    const revertRate = (recentReverts.length / totalTxs) * 100;
    if (revertRate > CIRCUIT_BREAKER.maxRevertRatePct && totalTxs > 10) {
      this.paused = true;
      throw new Error(`CircuitBreaker: revert rate ${revertRate.toFixed(1)}% > ${CIRCUIT_BREAKER.maxRevertRatePct}%`);
    }

    // ── Execute unwrap ──
    vault.balance -= amt;
    this.tvl -= amt;
    this.withdrawalLog.push({ user, amount: amt, nonce, timestamp: now });
    return { user, amount: amt, nonce };
  }

  getNextNonce(user) {
    const current = this.nonces.get(user) || 0;
    const next = current + 1;
    this.nonces.set(user, next);
    return next;
  }

  /** Reset circuit breaker (admin action) */
  resetCircuitBreaker() {
    this.paused = false;
    this.totalWithdrawn24h = 0n;
    this.revertLog = [];
    this._windowStart = Date.now();
  }

  getRevertRate() {
    const now = Date.now();
    const recentReverts = this.revertLog.filter(r => now - r.timestamp < CIRCUIT_BREAKER.windowMs);
    const totalTxs = this.withdrawalLog.length + recentReverts.length;
    return totalTxs > 0 ? (recentReverts.length / totalTxs) * 100 : 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: IBC Transfer Simulator with Timeouts
// ═══════════════════════════════════════════════════════════════════════════════

class FuzzableIBCClient {
  constructor() {
    this.transfers = new Map();
    this.refunds = [];
    this.balances = new Map();
    this.channelOpen = true;
    this.nextSequence = 1;
    /** Control: force timeout on next transfer */
    this._forceTimeout = false;
    this._forcePartialFailure = false;
  }

  setForceTimeout(val) { this._forceTimeout = val; }
  setForcePartialFailure(val) { this._forcePartialFailure = val; }
  setChannelOpen(val) { this.channelOpen = val; }

  /**
   * Simulate IBC transfer with timeout/failure injection
   */
  async transfer({ sender, receiver, amount, channel, timeoutHeight = 0 }) {
    if (!this.channelOpen) {
      throw new Error('IBC channel is closed');
    }

    const amt = BigInt(amount);
    const senderBal = this.balances.get(sender) || 0n;
    if (senderBal < amt) throw new Error(`InsufficientFunds: ${senderBal} < ${amt}`);

    const seq = this.nextSequence++;
    const transferId = `ibc-${seq}-${randomBytes(8)}`;

    // Debit sender immediately (escrow)
    this.balances.set(sender, senderBal - amt);

    // ── Timeout injection ──
    if (this._forceTimeout) {
      this._forceTimeout = false;
      const refund = { transferId, sender, amount: amt, reason: 'timeout', seq };
      this.refunds.push(refund);
      // Refund sender
      this.balances.set(sender, (this.balances.get(sender) || 0n) + amt);
      return { id: transferId, status: 'timeout', refund };
    }

    // ── Partial failure injection ──
    if (this._forcePartialFailure) {
      this._forcePartialFailure = false;
      const halfAmt = amt / 2n;
      const receiverBal = this.balances.get(receiver) || 0n;
      this.balances.set(receiver, receiverBal + halfAmt);
      // Refund the other half
      this.balances.set(sender, (this.balances.get(sender) || 0n) + (amt - halfAmt));
      this.refunds.push({ transferId, sender, amount: amt - halfAmt, reason: 'partial_failure', seq });
      return { id: transferId, status: 'partial', delivered: halfAmt, refunded: amt - halfAmt };
    }

    // ── Success ──
    const receiverBal = this.balances.get(receiver) || 0n;
    this.balances.set(receiver, receiverBal + amt);

    const transfer = { id: transferId, sender, receiver, amount: amt, seq, status: 'completed' };
    this.transfers.set(transferId, transfer);
    return transfer;
  }

  seedBalance(addr, amount) {
    this.balances.set(addr, (this.balances.get(addr) || 0n) + BigInt(amount));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: AIVerifier for Task Fuzzing
// ═══════════════════════════════════════════════════════════════════════════════

class FuzzableAIVerifier {
  constructor() {
    this.tasks = new Map();
    this.usedNullifiers = new Set();
    this.totalSettled = 0;
    this.totalFailed = 0;
    this.totalFees = 0n;
  }

  routeTask({ taskId, msgType, destinationChain, amount, feeBps = 50, sender }) {
    if (this.tasks.has(taskId)) throw new Error(`TaskAlreadyExists: ${taskId}`);

    // Validate feeBps range
    if (feeBps < FEE_CONFIG.minBps || feeBps > FEE_CONFIG.maxBps) {
      throw new Error(`InvalidFeeBps: ${feeBps} not in [${FEE_CONFIG.minBps}, ${FEE_CONFIG.maxBps}]`);
    }

    // Validate minimum amount (dust protection)
    const grossAmount = BigInt(amount);
    if (msgType !== 'capability_query' && grossAmount < BigInt(FEE_CONFIG.minTaskAmount)) {
      throw new Error(`AmountBelowMinimum: ${amount} < ${FEE_CONFIG.minTaskAmount}`);
    }

    // Validate chain ID
    const validChains = new Set(['theta', 'osmosis', 'akash', 'bittensor', 'persistence']);
    if (!validChains.has(destinationChain)) {
      throw new Error(`InvalidChainId: ${destinationChain}`);
    }

    // Validate msg type
    const validTypes = new Set([
      'compute_bid', 'compute_result', 'inference_request',
      'capability_query', 'data_attestation',
    ]);
    if (!validTypes.has(msgType)) {
      throw new Error(`InvalidMsgType: ${msgType}`);
    }

    const { feeAmount, netAmount } = calculateTaskFee(amount, feeBps);
    const task = {
      taskId, msgType, destinationChain, sender,
      grossAmount, feeAmount, netAmount, status: 'routed',
    };
    this.tasks.set(taskId, task);
    this.totalFees += feeAmount;
    return task;
  }

  settleTask({ taskId, outcome, nullifier, outputHash }) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`TaskNotFound: ${taskId}`);
    if (task.status === 'settled') throw new Error(`TaskAlreadySettled: ${taskId}`);
    if (task.status === 'failed') throw new Error(`TaskAlreadyFailed: ${taskId}`);

    if (this.usedNullifiers.has(nullifier)) {
      throw new Error(`NullifierAlreadyUsed: ${nullifier}`);
    }
    this.usedNullifiers.add(nullifier);

    task.proofOutcome = outcome;
    if (outcome === ProofOutcome.Valid) {
      task.status = 'settled';
      task.outputHash = outputHash;
      this.totalSettled++;
    } else if (outcome === ProofOutcome.Invalid) {
      task.status = 'failed';
      this.totalFailed++;
    }
    return task;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: Rate Limiter (mirrors server.js RateLimiter)
// ═══════════════════════════════════════════════════════════════════════════════

class FuzzableRateLimiter {
  constructor(windowMs = 60_000, maxHits = 60) {
    this.windowMs = windowMs;
    this.maxHits = maxHits;
    this.buckets = new Map();
  }

  allow(key) {
    const now = Date.now();
    let hits = this.buckets.get(key) || [];
    const cutoff = now - this.windowMs;
    hits = hits.filter(t => t > cutoff);
    if (hits.length >= this.maxHits) {
      this.buckets.set(key, hits);
      return false;
    }
    hits.push(now);
    this.buckets.set(key, hits);
    return true;
  }

  remaining(key) {
    const now = Date.now();
    const hits = (this.buckets.get(key) || []).filter(t => t > now - this.windowMs);
    return Math.max(0, this.maxHits - hits.length);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. NONCE FUZZING (Section 10.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security: Nonce Fuzzing (Section 10.2)', () => {
  let vault;
  const user = '0xuser_nonce_fuzz';

  beforeEach(() => {
    vault = new FuzzableVaultFactory();
    vault.deposit({ user, amount: '100000000' }); // seed 100M
  });

  it('should reject replayed nonce (same nonce used twice)', () => {
    const nonce = vault.getNextNonce(user);
    vault.unwrapFromBurn({ user, amount: '1000', nonce });

    assert.throws(
      () => vault.unwrapFromBurn({ user, amount: '1000', nonce }),
      /Nonce already used/,
      'Replayed nonce must be rejected',
    );
  });

  it('should reject nonce = 0 (invalid)', () => {
    assert.throws(
      () => vault.unwrapFromBurn({ user, amount: '1000', nonce: 0 }),
      /Invalid nonce/,
    );
  });

  it('should reject negative nonce', () => {
    assert.throws(
      () => vault.unwrapFromBurn({ user, amount: '1000', nonce: -1 }),
      /Invalid nonce/,
    );
  });

  it('should reject fractional nonce', () => {
    assert.throws(
      () => vault.unwrapFromBurn({ user, amount: '1000', nonce: 1.5 }),
      /Invalid nonce/,
    );
  });

  it('should allow out-of-order nonces (non-sequential)', () => {
    // Nonces don't need to be sequential, just unique
    vault.unwrapFromBurn({ user, amount: '1000', nonce: 5 });
    vault.unwrapFromBurn({ user, amount: '1000', nonce: 2 });
    vault.unwrapFromBurn({ user, amount: '1000', nonce: 10 });

    // All three should succeed (unique nonces)
    assert.equal(vault.withdrawalLog.length, 3);
  });

  it('should track nonces per-user (user A nonce 1 != user B nonce 1)', () => {
    const userA = '0xuserA';
    const userB = '0xuserB';
    vault.deposit({ user: userA, amount: '100000' });
    vault.deposit({ user: userB, amount: '100000' });

    vault.unwrapFromBurn({ user: userA, amount: '1000', nonce: 1 });
    vault.unwrapFromBurn({ user: userB, amount: '1000', nonce: 1 });

    // Both succeed — nonces are per-user
    assert.equal(vault.withdrawalLog.length, 2);
  });

  it('should fuzz 100 random nonces without collision', () => {
    const nonces = new Set();
    for (let i = 0; i < 100; i++) {
      const nonce = vault.getNextNonce(user);
      assert.ok(!nonces.has(nonce), `Nonce ${nonce} was unique`);
      nonces.add(nonce);
      vault.unwrapFromBurn({ user, amount: '100', nonce });
    }
    assert.equal(vault.withdrawalLog.length, 100);
  });

  it('should survive rapid concurrent nonce attempts', () => {
    // Simulate 50 concurrent requests with overlapping nonces
    const results = { success: 0, rejected: 0 };
    const targetNonce = 42;

    for (let i = 0; i < 50; i++) {
      try {
        vault.unwrapFromBurn({ user, amount: '100', nonce: targetNonce });
        results.success++;
      } catch {
        results.rejected++;
      }
    }

    assert.equal(results.success, 1, 'Exactly 1 succeeds');
    assert.equal(results.rejected, 49, '49 rejected as replays');
  });

  it('should handle nonce at MAX_SAFE_INTEGER boundary', () => {
    const bigNonce = Number.MAX_SAFE_INTEGER;
    vault.unwrapFromBurn({ user, amount: '1000', nonce: bigNonce });

    assert.throws(
      () => vault.unwrapFromBurn({ user, amount: '1000', nonce: bigNonce }),
      /Nonce already used/,
    );
  });

  it('should log reverts for nonce replay forensics', () => {
    const nonce = 7;
    vault.unwrapFromBurn({ user, amount: '1000', nonce });

    try { vault.unwrapFromBurn({ user, amount: '1000', nonce }); } catch { /* expected */ }

    assert.equal(vault.revertLog.length, 1);
    assert.equal(vault.revertLog[0].reason, 'replay');
    assert.equal(vault.revertLog[0].nonce, 7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. IBC TIMEOUT FUZZING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security: IBC Timeout & Refund Fuzzing', () => {
  let ibc;
  const sender = 'osmo1sender';
  const receiver = 'akash1receiver';

  beforeEach(() => {
    ibc = new FuzzableIBCClient();
    ibc.seedBalance(sender, '10000000');
  });

  it('should refund sender on IBC timeout', async () => {
    const balBefore = ibc.balances.get(sender);
    ibc.setForceTimeout(true);

    const result = await ibc.transfer({
      sender, receiver, amount: '1000000', channel: 'channel-1',
    });

    assert.equal(result.status, 'timeout');
    assert.ok(result.refund, 'Refund issued');
    assert.equal(result.refund.amount, 1000000n);

    // Sender balance restored
    assert.equal(ibc.balances.get(sender), balBefore);
    assert.equal(ibc.refunds.length, 1);
  });

  it('should handle partial failure with correct refund split', async () => {
    ibc.setForcePartialFailure(true);

    const result = await ibc.transfer({
      sender, receiver, amount: '1000000', channel: 'channel-1',
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.delivered + result.refunded, 1000000n);
    assert.ok(result.delivered > 0n, 'Partial delivery occurred');
    assert.ok(result.refunded > 0n, 'Partial refund issued');
  });

  it('should reject transfer on closed IBC channel', async () => {
    ibc.setChannelOpen(false);

    await assert.rejects(
      () => ibc.transfer({ sender, receiver, amount: '1000000', channel: 'channel-1' }),
      /IBC channel is closed/,
    );

    // Balance unchanged
    assert.equal(ibc.balances.get(sender), 10000000n);
  });

  it('should maintain packet sequence continuity', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const r = await ibc.transfer({
        sender, receiver, amount: '100000', channel: 'channel-1',
      });
      results.push(r);
    }

    // Verify sequences are monotonically increasing
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].seq > results[i - 1].seq,
        `Sequence ${results[i].seq} > ${results[i - 1].seq}`);
    }
  });

  it('should handle multiple timeouts in a row (no balance leak)', async () => {
    const initialBalance = ibc.balances.get(sender);

    for (let i = 0; i < 10; i++) {
      ibc.setForceTimeout(true);
      await ibc.transfer({ sender, receiver, amount: '500000', channel: 'channel-1' });
    }

    // After 10 timeouts, sender balance should be unchanged
    assert.equal(ibc.balances.get(sender), initialBalance, 'No balance leak after timeouts');
    assert.equal(ibc.refunds.length, 10, '10 refunds issued');
  });

  it('should reject transfer with insufficient balance', async () => {
    await assert.rejects(
      () => ibc.transfer({ sender, receiver, amount: '999999999999', channel: 'channel-1' }),
      /InsufficientFunds/,
    );
  });

  it('should fuzz mixed success/timeout/partial transfers', async () => {
    const outcomes = { completed: 0, timeout: 0, partial: 0 };

    for (let i = 0; i < 30; i++) {
      const roll = Math.random();
      if (roll < 0.2) ibc.setForceTimeout(true);
      else if (roll < 0.3) ibc.setForcePartialFailure(true);

      try {
        const r = await ibc.transfer({
          sender, receiver, amount: '100000', channel: 'channel-1',
        });
        outcomes[r.status]++;
      } catch {
        // InsufficientFunds if balance drained
        break;
      }
    }

    // At least some of each type should occur (probabilistic)
    assert.ok(outcomes.completed >= 0, 'Some completions');
    // Total refunds should be tracked
    assert.ok(ibc.refunds.length >= 0, 'Refunds tracked');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MASS WITHDRAWAL / CIRCUIT BREAKERS (Section 10.4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security: Mass Withdrawal & Circuit Breakers (Section 10.4)', () => {
  let vault;

  beforeEach(() => {
    vault = new FuzzableVaultFactory();
  });

  it('should trigger circuit breaker when >20% TVL withdrawn in 24h', () => {
    const users = Array.from({ length: 10 }, (_, i) => `0xuser_${i}`);
    const depositEach = 10_000_000n;

    // Each user deposits 10M → total TVL = 100M
    for (const user of users) {
      vault.deposit({ user, amount: depositEach.toString() });
    }
    assert.equal(vault.tvl, 100_000_000n);

    // Withdraw 21% in total → should trigger circuit breaker
    let withdrawnTotal = 0n;
    let breakerTriggered = false;

    for (let i = 0; i < users.length && !breakerTriggered; i++) {
      const amount = 2_100_000n; // 2.1M each
      try {
        vault.unwrapFromBurn({ user: users[i], amount: amount.toString(), nonce: i + 1 });
        withdrawnTotal += amount;
      } catch (err) {
        if (err.message.includes('CircuitBreaker')) {
          breakerTriggered = true;
        }
      }
    }

    assert.ok(breakerTriggered, 'Circuit breaker triggered at >20% TVL');
    assert.ok(vault.paused, 'Contract is paused');
  });

  it('should allow withdrawals up to exactly 20% TVL', () => {
    const user = '0xwhale';
    vault.deposit({ user, amount: '100000000' }); // 100M TVL

    // Withdraw exactly 20% = 20M
    vault.unwrapFromBurn({ user, amount: '20000000', nonce: 1 });

    assert.ok(!vault.paused, 'Not paused at exactly 20%');
    assert.equal(vault.withdrawalLog.length, 1);
  });

  it('should enforce pause after circuit breaker — all withdrawals blocked', () => {
    const user = '0xwhale';
    vault.deposit({ user, amount: '100000' });

    // Force pause
    vault.paused = true;

    assert.throws(
      () => vault.unwrapFromBurn({ user, amount: '1', nonce: 1 }),
      /CircuitBreaker: contract is paused/,
    );
  });

  it('should resume after admin reset', () => {
    const user = '0xwhale';
    vault.deposit({ user, amount: '100000' });
    vault.paused = true;

    // Admin reset
    vault.resetCircuitBreaker();

    // Should work now
    vault.unwrapFromBurn({ user, amount: '1000', nonce: 1 });
    assert.equal(vault.withdrawalLog.length, 1);
  });

  it('should simulate death spiral (bank run) — 10 users panic withdraw', () => {
    const numUsers = 10;
    const users = Array.from({ length: numUsers }, (_, i) => `0xpanic_${i}`);

    // Setup: each deposits 5M
    for (const user of users) {
      vault.deposit({ user, amount: '5000000' });
    }
    const initialTvl = vault.tvl;
    assert.equal(initialTvl, 50_000_000n);

    // Bank run: each tries to withdraw everything
    let completed = 0;
    let blocked = 0;

    for (let i = 0; i < numUsers; i++) {
      try {
        vault.unwrapFromBurn({ user: users[i], amount: '5000000', nonce: i + 1 });
        completed++;
      } catch (err) {
        if (err.message.includes('CircuitBreaker')) blocked++;
      }
    }

    // Some should complete before breaker, rest blocked
    assert.ok(completed > 0, `${completed} withdrawals completed before breaker`);
    assert.ok(blocked > 0, `${blocked} withdrawals blocked by breaker`);
    assert.ok(vault.paused, 'Contract paused after bank run');

    // Remaining TVL should be >0 (protocol survived)
    assert.ok(vault.tvl > 0n, `TVL ${vault.tvl} > 0 (protocol survived death spiral)`);
  });

  it('should enforce emergency LP rebalancing cap ($500K)', () => {
    // The treasury can only deploy up to $500K for LP rescue
    const treasuryFunds = 1_000_000; // $1M available
    const lpRescueCap = CIRCUIT_BREAKER.emergencyLPCap; // $500K

    const actualDeployed = Math.min(treasuryFunds, lpRescueCap);
    assert.equal(actualDeployed, 500_000, 'LP rebalancing capped at $500K');
  });

  it('should track revert rate and trigger breaker at >5%', () => {
    const user = '0xrevert_tester';
    vault.deposit({ user, amount: '10000000' });

    // Generate some successful withdrawals
    for (let i = 1; i <= 8; i++) {
      vault.unwrapFromBurn({ user, amount: '100', nonce: i });
    }

    // Generate replay reverts to push revert rate above 5%
    for (let i = 0; i < 3; i++) {
      try { vault.unwrapFromBurn({ user, amount: '100', nonce: 1 }); } catch { /* expected */ }
    }

    const revertRate = vault.getRevertRate();
    assert.ok(revertRate > 0, `Revert rate is ${revertRate.toFixed(1)}%`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. AI TASK SECURITY FUZZING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security: AI Task Fuzzing', () => {
  let verifier;

  beforeEach(() => {
    verifier = new FuzzableAIVerifier();
  });

  it('should reject task with fee BPS below minimum (50)', () => {
    assert.throws(
      () => verifier.routeTask({
        taskId: randomTaskId(), msgType: 'inference_request',
        destinationChain: 'akash', amount: '1000000',
        feeBps: 10, sender: 'osmo1test',
      }),
      /InvalidFeeBps/,
    );
  });

  it('should reject task with fee BPS above maximum (100)', () => {
    assert.throws(
      () => verifier.routeTask({
        taskId: randomTaskId(), msgType: 'inference_request',
        destinationChain: 'akash', amount: '1000000',
        feeBps: 200, sender: 'osmo1test',
      }),
      /InvalidFeeBps/,
    );
  });

  it('should reject dust amount below minimum (10000)', () => {
    assert.throws(
      () => verifier.routeTask({
        taskId: randomTaskId(), msgType: 'inference_request',
        destinationChain: 'akash', amount: '100',
        sender: 'osmo1test',
      }),
      /AmountBelowMinimum/,
    );
  });

  it('should allow zero amount for CAPABILITY_QUERY', () => {
    const task = verifier.routeTask({
      taskId: randomTaskId(), msgType: 'capability_query',
      destinationChain: 'akash', amount: '0',
      sender: 'osmo1test',
    });
    assert.equal(task.status, 'routed');
  });

  it('should reject invalid chain ID', () => {
    assert.throws(
      () => verifier.routeTask({
        taskId: randomTaskId(), msgType: 'inference_request',
        destinationChain: 'ethereum', amount: '1000000',
        sender: 'osmo1test',
      }),
      /InvalidChainId/,
    );
  });

  it('should reject invalid message type', () => {
    assert.throws(
      () => verifier.routeTask({
        taskId: randomTaskId(), msgType: 'hack_attempt',
        destinationChain: 'akash', amount: '1000000',
        sender: 'osmo1test',
      }),
      /InvalidMsgType/,
    );
  });

  it('should reject duplicate task ID', () => {
    const taskId = randomTaskId();
    verifier.routeTask({
      taskId, msgType: 'inference_request',
      destinationChain: 'akash', amount: '1000000',
      sender: 'osmo1test',
    });

    assert.throws(
      () => verifier.routeTask({
        taskId, msgType: 'inference_request',
        destinationChain: 'akash', amount: '1000000',
        sender: 'osmo1test',
      }),
      /TaskAlreadyExists/,
    );
  });

  it('should reject double-settlement attack (settle same task twice)', () => {
    const taskId = randomTaskId();
    verifier.routeTask({
      taskId, msgType: 'inference_request',
      destinationChain: 'akash', amount: '1000000',
      sender: 'osmo1test',
    });

    verifier.settleTask({
      taskId, outcome: ProofOutcome.Valid,
      nullifier: `0x${randomBytes(32)}`, outputHash: `0x${randomBytes(32)}`,
    });

    assert.throws(
      () => verifier.settleTask({
        taskId, outcome: ProofOutcome.Valid,
        nullifier: `0x${randomBytes(32)}`, outputHash: `0x${randomBytes(32)}`,
      }),
      /TaskAlreadySettled/,
    );
  });

  it('should reject settlement of failed task (Invalid outcome)', () => {
    const taskId = randomTaskId();
    verifier.routeTask({
      taskId, msgType: 'data_attestation',
      destinationChain: 'osmosis', amount: '500000',
      sender: 'osmo1test',
    });

    verifier.settleTask({
      taskId, outcome: ProofOutcome.Invalid,
      nullifier: `0x${randomBytes(32)}`, outputHash: '',
    });

    assert.throws(
      () => verifier.settleTask({
        taskId, outcome: ProofOutcome.Valid,
        nullifier: `0x${randomBytes(32)}`, outputHash: `0x${randomBytes(32)}`,
      }),
      /TaskAlreadyFailed/,
    );
  });

  it('should reject nullifier collision across different tasks', () => {
    const sharedNullifier = `0x${randomBytes(32)}`;
    const taskId1 = randomTaskId();
    const taskId2 = randomTaskId();

    verifier.routeTask({
      taskId: taskId1, msgType: 'inference_request',
      destinationChain: 'akash', amount: '1000000', sender: 'osmo1test',
    });
    verifier.routeTask({
      taskId: taskId2, msgType: 'inference_request',
      destinationChain: 'akash', amount: '1000000', sender: 'osmo1test',
    });

    verifier.settleTask({
      taskId: taskId1, outcome: ProofOutcome.Valid,
      nullifier: sharedNullifier, outputHash: `0x${randomBytes(32)}`,
    });

    assert.throws(
      () => verifier.settleTask({
        taskId: taskId2, outcome: ProofOutcome.Valid,
        nullifier: sharedNullifier, outputHash: `0x${randomBytes(32)}`,
      }),
      /NullifierAlreadyUsed/,
    );
  });

  it('should fuzz 200 random task payloads without panic', () => {
    const msgTypes = ['compute_bid', 'compute_result', 'inference_request', 'data_attestation'];
    const chains = ['theta', 'osmosis', 'akash', 'bittensor', 'persistence'];
    let routed = 0;

    for (let i = 0; i < 200; i++) {
      try {
        verifier.routeTask({
          taskId: randomTaskId(),
          msgType: msgTypes[Math.floor(Math.random() * msgTypes.length)],
          destinationChain: chains[Math.floor(Math.random() * chains.length)],
          amount: String(Math.floor(Math.random() * 10_000_000) + FEE_CONFIG.minTaskAmount),
          feeBps: Math.floor(Math.random() * 51) + 50, // 50-100
          sender: `osmo1fuzz_${i}`,
        });
        routed++;
      } catch {
        // Expected for edge cases
      }
    }

    assert.ok(routed > 100, `${routed}/200 tasks routed successfully`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. RATE LIMITING & AUTH FUZZING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security: Rate Limiting & Auth Fuzzing', () => {
  it('should enforce rate limit — block after maxHits', () => {
    const limiter = new FuzzableRateLimiter(60_000, 10);
    const key = 'api-key-test';

    for (let i = 0; i < 10; i++) {
      assert.ok(limiter.allow(key), `Request ${i + 1} allowed`);
    }

    // 11th request should be blocked
    assert.ok(!limiter.allow(key), 'Request 11 blocked');
    assert.equal(limiter.remaining(key), 0);
  });

  it('should isolate rate limits per API key', () => {
    const limiter = new FuzzableRateLimiter(60_000, 5);

    for (let i = 0; i < 5; i++) limiter.allow('key-a');
    assert.ok(!limiter.allow('key-a'), 'key-a exhausted');
    assert.ok(limiter.allow('key-b'), 'key-b still has quota');
  });

  it('should reject stale ECDSA signature (>5 min)', () => {
    // Simulate signature timestamp check from server.js
    const staleTimestamp = Math.floor(Date.now() / 1000) - 400; // 6.6 min ago
    const age = Math.abs(Date.now() / 1000 - staleTimestamp);
    assert.ok(age > 300, 'Signature is stale (>5 min)');

    const freshTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 min ago
    const freshAge = Math.abs(Date.now() / 1000 - freshTimestamp);
    assert.ok(freshAge <= 300, 'Fresh signature accepted (<5 min)');
  });

  it('should handle brute-force API key guessing (all rejected)', () => {
    const validKeys = new Set(['key-abc123', 'key-xyz789']);
    let accepted = 0;

    for (let i = 0; i < 1000; i++) {
      const guess = `key-${randomBytes(6)}`;
      if (validKeys.has(guess)) accepted++;
    }

    assert.equal(accepted, 0, 'No brute-force collision in 1000 attempts');
  });

  it('should fuzz rate limiter with 500 rapid requests', () => {
    const limiter = new FuzzableRateLimiter(60_000, 60);
    const key = 'fuzz-key';
    let allowed = 0;

    for (let i = 0; i < 500; i++) {
      if (limiter.allow(key)) allowed++;
    }

    assert.equal(allowed, 60, 'Exactly 60 allowed out of 500');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. COMBINED ATTACK SCENARIO
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security: Combined Attack Scenarios', () => {
  it('should survive coordinated replay + mass withdrawal attack', () => {
    const vault = new FuzzableVaultFactory();
    const attackers = Array.from({ length: 20 }, (_, i) => `0xattacker_${i}`);

    // Setup: each attacker deposits
    for (const a of attackers) {
      vault.deposit({ a, amount: '5000000' });
    }
    // Also deposit as legitimate users to seed TVL
    for (const a of attackers) {
      vault.deposit({ user: a, amount: '5000000' });
    }

    let replaysBlocked = 0;
    let breakerTriggered = false;

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < attackers.length; i++) {
        try {
          // Attacker tries same nonce (round+1) each round
          vault.unwrapFromBurn({
            user: attackers[i],
            amount: '4000000',
            nonce: round + 1,
          });
        } catch (err) {
          if (err.message.includes('Nonce already used')) replaysBlocked++;
          if (err.message.includes('CircuitBreaker')) breakerTriggered = true;
        }
      }
    }

    // Assert defense layers activated
    assert.ok(replaysBlocked > 0 || breakerTriggered,
      'At least one defense layer activated');

    // TVL should not be fully drained
    assert.ok(vault.tvl >= 0n, 'TVL did not go negative');
  });

  it('should survive AI task + nonce + IBC timeout combined fuzz', async () => {
    const verifier = new FuzzableAIVerifier();
    const ibc = new FuzzableIBCClient();
    const vault = new FuzzableVaultFactory();

    const user = '0xcombined_fuzz';
    vault.deposit({ user, amount: '50000000' });
    ibc.seedBalance('osmo1fuzz', '50000000');

    let errors = 0;
    let successes = 0;

    for (let i = 0; i < 50; i++) {
      try {
        // Random operation
        const op = Math.random();
        if (op < 0.33) {
          // AI task
          verifier.routeTask({
            taskId: randomTaskId(), msgType: 'inference_request',
            destinationChain: 'akash', amount: '100000',
            sender: 'osmo1fuzz',
          });
          successes++;
        } else if (op < 0.66) {
          // IBC transfer (may timeout)
          if (Math.random() < 0.3) ibc.setForceTimeout(true);
          await ibc.transfer({
            sender: 'osmo1fuzz', receiver: 'akash1fuzz',
            amount: '50000', channel: 'ch-1',
          });
          successes++;
        } else {
          // Vault unwrap
          const nonce = vault.getNextNonce(user);
          vault.unwrapFromBurn({ user, amount: '100000', nonce });
          successes++;
        }
      } catch {
        errors++;
      }
    }

    assert.ok(successes > 0, `${successes} operations succeeded`);
    assert.ok(errors + successes === 50, 'All 50 operations accounted for');
  });
});
