import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';

const {
  rollingEnabled, maxUnsettledBaseUnits, payerBucket, getPending, recordPending,
  markSettled, markSettleFailed, decideRolling, rollingDecision, rollingStatus,
  resetRollingSettlement,
} = await import('../src/rolling-settlement.js');
const { quoteUsage, quoteTask } = await import('../src/pricing.js');

const USD = 1_000_000n;
const PAYER = 'key:abc123';

beforeEach(() => {
  resetRollingSettlement();
  delete process.env.X402_ROLLING_SETTLEMENT;
  delete process.env.X402_ROLLING_MAX_UNSETTLED_USD;
  delete process.env.X402_USDC_FLOOR;
});

// ─── Pricing measured usage ───────────────────────────────────────────────────

test('measured pricing charges what ran, not the max_tokens ceiling', () => {
  // The whole point of the change, in one assertion. A caller asking for a
  // 20k-token ceiling and using 1k of it is quoted 15x what the call cost.
  process.env.X402_USDC_FLOOR = '0';
  const body = {
    model_id: 'zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'x'.repeat(4000) }], // ~1000 tokens
    max_tokens: 20_000,
  };
  const ceiling = BigInt(quoteTask(body, {}).amount);
  const measured = BigInt(quoteUsage(
    { prompt_tokens: 1000, completion_tokens: 1000 },
    'zai-org/GLM-5.2',
    {},
  ).amount);

  assert.equal(measured, 12_000n);   // 1000*$3/M + 1000*$9/M
  assert.equal(ceiling, 183_000n);   // 1000*$3/M + 20000*$9/M
  assert.ok(ceiling / measured >= 15n, `expected >=15x overcharge, got ${ceiling}/${measured}`);
});

test('the floor still applies, because settlement itself costs a facilitator fee', () => {
  const q = quoteUsage({ prompt_tokens: 5, completion_tokens: 5 }, null, {});
  assert.equal(q.amount, '10000'); // $0.01 floor, not 3 base units
  assert.equal(q.floor_applied, true);
});

test('reasoning tokens are not billed twice', () => {
  // Providers fold reasoning into completion_tokens. Adding it again would
  // double-charge every reasoning model, which is most of the agent catalogue.
  process.env.X402_USDC_FLOOR = '0';
  const a = quoteUsage({ prompt_tokens: 0, completion_tokens: 1000, reasoning_tokens: 800 }, 'zai-org/GLM-5.2', {});
  const b = quoteUsage({ prompt_tokens: 0, completion_tokens: 1000 }, 'zai-org/GLM-5.2', {});
  assert.equal(a.amount, b.amount);
});

test('measured pricing uses the resolved model, so GLM does not price as Llama', () => {
  process.env.X402_USDC_FLOOR = '0';
  const usage = { prompt_tokens: 10_000, completion_tokens: 1_000 };
  const glm = BigInt(quoteUsage(usage, 'akash/zai-org/GLM-5.2', {}).amount);
  const dflt = BigInt(quoteUsage(usage, 'akash/meta-llama/Llama-3.3-70B-Instruct', {}).amount);
  assert.equal(glm, 39_000n); // 10k*$3/M + 1k*$9/M
  assert.equal(dflt, 3_900n); // 10k*$0.30/M + 1k*$0.90/M
  assert.equal(glm, dflt * 10n);
});

// ─── The flag and the exposure ceiling ───────────────────────────────────────

test('rolling settlement is off unless explicitly enabled', () => {
  assert.equal(rollingEnabled(), false);
  process.env.X402_ROLLING_SETTLEMENT = 'true';
  assert.equal(rollingEnabled(), true);
});

test('the unsettled ceiling defaults to a real number and survives a typo', () => {
  assert.equal(maxUnsettledBaseUnits(), 1n * USD);
  process.env.X402_ROLLING_MAX_UNSETTLED_USD = 'one';
  assert.equal(maxUnsettledBaseUnits(), 1n * USD);
});

test('payers are keyed on the API key, falling back to IP', () => {
  // The first call has no payment header and therefore no wallet, so the debt
  // cannot be keyed on the payer's address.
  assert.equal(payerBucket({}, 'hash1'), 'key:hash1');
  assert.equal(payerBucket({ ip: '1.2.3.4' }, null), 'ip:1.2.3.4');
  assert.equal(payerBucket({}, null), 'anon');
});

// ─── Ordering rules ──────────────────────────────────────────────────────────

test('nothing owed and a small call: serve it free', () => {
  const d = decideRolling({ pending: null, hasPayment: false, ceiling: 5_000n, maxUnsettled: 1n * USD });
  assert.equal(d.action, 'serve_free');
});

test('nothing owed but a call too large to front: demand prepayment', () => {
  // Without this, a fresh key's first request could be a 200k-token job served
  // free, with nothing to collect against afterwards.
  const d = decideRolling({ pending: null, hasPayment: false, ceiling: 5n * USD, maxUnsettled: 1n * USD });
  assert.equal(d.action, 'prepay');
  assert.equal(d.reason, 'first_call_exceeds_unsettled_ceiling');
});

test('a zero ceiling opts out of the exposure guard entirely', () => {
  const d = decideRolling({ pending: null, hasPayment: false, ceiling: 999n * USD, maxUnsettled: 0n });
  assert.equal(d.action, 'serve_free');
});

test('a debt owed and no payment: challenge for the previous call exactly', () => {
  const d = decideRolling({
    pending: { amount: '12345' }, hasPayment: false, ceiling: 1n, maxUnsettled: 1n * USD,
  });
  assert.equal(d.action, 'settle_first');
  assert.equal(d.amount, '12345');
});

test('a debt owed with payment present: settle it, then serve', () => {
  const d = decideRolling({
    pending: { amount: '12345' }, hasPayment: true, ceiling: 1n, maxUnsettled: 1n * USD,
  });
  assert.equal(d.action, 'settle_then_serve');
  assert.equal(d.amount, '12345');
});

test('a payment arriving with nothing owed is accepted, not rejected', () => {
  // A restart forgives debts. A client mid-handshake must not get an error for
  // paying something we have forgotten about.
  const d = decideRolling({ pending: null, hasPayment: true, ceiling: 1n, maxUnsettled: 1n * USD });
  assert.equal(d.action, 'settle_then_serve');
  assert.equal(d.amount, '0');
});

// ─── The ledger lifecycle ────────────────────────────────────────────────────

test('a served call becomes the next request\'s charge, and settling clears it', () => {
  process.env.X402_USDC_FLOOR = '0';
  assert.equal(getPending(PAYER), null);

  const pending = recordPending(PAYER, {
    usage: { prompt_tokens: 1000, completion_tokens: 1000 },
    model: 'zai-org/GLM-5.2',
    taskId: 'task-1',
  });
  assert.equal(pending.amount, '12000');
  assert.equal(pending.taskId, 'task-1');

  // Next request is challenged for exactly that figure.
  const decision = rollingDecision({ payerId: PAYER, priceBody: {}, hasPayment: false });
  assert.equal(decision.action, 'settle_first');
  assert.equal(decision.amount, '12000');

  const cleared = markSettled(PAYER);
  assert.equal(cleared.amount, '12000');
  assert.equal(getPending(PAYER), null);
});

test('a failed settlement keeps the debt so the next request is challenged again', () => {
  process.env.X402_USDC_FLOOR = '0';
  recordPending(PAYER, { usage: { prompt_tokens: 1000, completion_tokens: 1000 }, model: 'zai-org/GLM-5.2' });
  const still = markSettleFailed(PAYER, 'insufficient_funds');
  assert.equal(still.amount, '12000');
  assert.equal(still.attempts, 1);
  assert.equal(getPending(PAYER).amount, '12000');
});

test('two pending charges for one payer keeps the larger rather than losing the debt', () => {
  process.env.X402_USDC_FLOOR = '0';
  recordPending(PAYER, { usage: { prompt_tokens: 1000, completion_tokens: 1000 }, model: 'zai-org/GLM-5.2' });
  recordPending(PAYER, { usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'zai-org/GLM-5.2' });
  assert.equal(getPending(PAYER).amount, '12000');
});

test('debts are tracked per payer, not globally', () => {
  process.env.X402_USDC_FLOOR = '0';
  recordPending('key:a', { usage: { prompt_tokens: 1000, completion_tokens: 0 }, model: 'zai-org/GLM-5.2' });
  assert.equal(getPending('key:b'), null);
  assert.equal(getPending('key:a').amount, '3000');
});

// ─── Visibility ──────────────────────────────────────────────────────────────

test('status reports uncollected money, which is the number that matters', () => {
  process.env.X402_USDC_FLOOR = '0';
  process.env.X402_ROLLING_SETTLEMENT = 'true';
  recordPending('key:a', { usage: { prompt_tokens: 1000, completion_tokens: 1000 }, model: 'zai-org/GLM-5.2' });
  recordPending('key:b', { usage: { prompt_tokens: 1000, completion_tokens: 1000 }, model: 'zai-org/GLM-5.2' });
  markSettled('key:b');

  const s = rollingStatus();
  assert.equal(s.enabled, true);
  assert.equal(s.payers_owing, 1);
  assert.equal(s.settled_calls, 1);
  assert.equal(s.unsettled_usd, '0.012000');
});

test('status says so plainly when the feature is off', () => {
  const s = rollingStatus();
  assert.equal(s.enabled, false);
  assert.match(s.note, /Disabled/);
});
