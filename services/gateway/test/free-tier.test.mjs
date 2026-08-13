import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Unmetered by default — that is the state this guard exists to bound.
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.X402_METER_V1 = 'false';
process.env.FREE_TIER_DAILY_COGS_USD = '1';

const {
  dailyLimitBaseUnits, freeTierBucket, checkFreeAllowance,
  recordFreeSpend, freeTierStatus, resetFreeTier, usd,
} = await import('../src/free-tier.js');
const { hashApiKey } = await import('../src/buyer-attr.js');
const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

const USD = 1_000_000n;
const TEST_KEY = 'free-tier-test-key';

let server;
let base;

before(async () => {
  resetHubCatalogCache();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  resetFreeTier();
  process.env.FREE_TIER_DAILY_COGS_USD = '1';
});

// ─── The ceiling itself ───────────────────────────────────────────────────────

test('the default ceiling is a real number, so an unset env var does not uncap us', () => {
  delete process.env.FREE_TIER_DAILY_COGS_USD;
  assert.equal(dailyLimitBaseUnits(), 10n * USD);
});

test('a typo keeps the default rather than silently uncapping the subsidy', () => {
  // The dangerous failure is `FREE_TIER_DAILY_COGS_USD=ten` parsing to NaN and
  // being read as "no limit" — a mistake nobody would notice until the bill.
  process.env.FREE_TIER_DAILY_COGS_USD = 'ten';
  assert.equal(dailyLimitBaseUnits(), 10n * USD);
});

test('only an explicit zero disables enforcement', () => {
  process.env.FREE_TIER_DAILY_COGS_USD = '0';
  assert.equal(dailyLimitBaseUnits(), 0n);
  assert.equal(checkFreeAllowance('key:whoever').enforced, false);
  assert.equal(checkFreeAllowance('key:whoever').allowed, true);
});

test('fractional dollars survive the round-trip to base units', () => {
  process.env.FREE_TIER_DAILY_COGS_USD = '0.25';
  assert.equal(dailyLimitBaseUnits(), 250_000n);
});

// ─── Accrual and the boundary ─────────────────────────────────────────────────

test('spend accumulates until the ceiling, then the caller is cut off', () => {
  const bucket = 'key:abc';
  // Measured GLM-5.2 COGS for an agent-shaped call is ~$0.096, so a $1/day
  // ceiling buys eleven of them: after ten the caller has spent $0.9629 and is
  // still under, and the eleventh is what carries them over.
  const AGENT_CALL = 96_290n;
  for (let i = 0; i < 11; i += 1) {
    assert.equal(checkFreeAllowance(bucket).allowed, true, `call ${i + 1} should be served`);
    recordFreeSpend(bucket, AGENT_CALL);
  }
  const after = checkFreeAllowance(bucket);
  assert.equal(after.allowed, false, 'the twelfth call is over the ceiling');
  assert.equal(after.spent, 11n * AGENT_CALL);
});

test('the ceiling is checked before serving, so a caller can overshoot by one call', () => {
  // Not a bug to fix — a pre-serve check cannot know what the pending call will
  // cost. Asserted so the behaviour is deliberate and does not drift.
  const bucket = 'key:overshoot';
  recordFreeSpend(bucket, 999_999n);
  assert.equal(checkFreeAllowance(bucket).allowed, true, 'one unit under: still served');
  recordFreeSpend(bucket, 5_000_000n);
  assert.equal(checkFreeAllowance(bucket).allowed, false);
  assert.equal(checkFreeAllowance(bucket).spent, 5_999_999n, 'the overshoot is recorded, not clipped');
});

test('callers do not share an allowance', () => {
  recordFreeSpend('key:noisy', 2n * USD);
  assert.equal(checkFreeAllowance('key:noisy').allowed, false);
  assert.equal(checkFreeAllowance('key:quiet').allowed, true);
});

test('an unmeasurable call costs nobody anything', () => {
  // measureCogs returns 0n when the model has no published rate. Charging a
  // guess to a spend ceiling would invent a number; under-counting is the
  // honest direction to be wrong in.
  const bucket = 'key:norate';
  recordFreeSpend(bucket, 0n);
  assert.equal(checkFreeAllowance(bucket).spent, 0n);
});

test('the allowance resets on the UTC day boundary', () => {
  const bucket = 'key:rollover';
  const t = Date.UTC(2026, 7, 13, 23, 59, 0);
  recordFreeSpend(bucket, 5n * USD, t);
  assert.equal(checkFreeAllowance(bucket, t).allowed, false);

  const tomorrow = t + 2 * 60 * 1000;
  assert.equal(checkFreeAllowance(bucket, tomorrow).allowed, true);
  assert.equal(checkFreeAllowance(bucket, tomorrow).spent, 0n);
});

test('retryAfter points at the reset, not an arbitrary backoff', () => {
  const t = Date.UTC(2026, 7, 13, 23, 0, 0);
  const { retryAfterSec, resetAt } = checkFreeAllowance('key:when', t);
  assert.equal(retryAfterSec, 3600);
  assert.equal(resetAt, '2026-08-14T00:00:00.000Z');
});

// ─── Attribution ──────────────────────────────────────────────────────────────

test('the allowance follows the key, not the address', () => {
  const req = { ip: '10.0.0.1' };
  assert.equal(freeTierBucket(req, 'deadbeef'), 'key:deadbeef');
});

test('an unattributed caller falls back to IP rather than one shared bucket', () => {
  assert.equal(freeTierBucket({ ip: '10.0.0.1' }, null), 'ip:10.0.0.1');
  assert.notEqual(freeTierBucket({ ip: '10.0.0.1' }, null), freeTierBucket({ ip: '10.0.0.2' }, null));
});

// ─── Observability ────────────────────────────────────────────────────────────

test('the snapshot answers "what is the free tier costing us today"', () => {
  recordFreeSpend('key:a', 400_000n);
  recordFreeSpend('key:b', 1_500_000n);

  const s = freeTierStatus();
  assert.equal(s.enforced, true);
  assert.equal(s.daily_limit_usd, '1.000000');
  assert.equal(s.callers_today, 2);
  assert.equal(s.cogs_today_usd, '1.900000');
  assert.equal(s.callers_exhausted, 1, 'key:b is over the ceiling');
});

test('the snapshot says so when nothing is capping the spend', () => {
  process.env.FREE_TIER_DAILY_COGS_USD = '0';
  const s = freeTierStatus();
  assert.equal(s.enforced, false);
  assert.equal(s.daily_limit_usd, null);
  assert.match(s.note, /uncapped/);
});

test('usd formatting does not lose sub-cent COGS', () => {
  assert.equal(usd(890n), '0.000890');
  assert.equal(usd(96_290n), '0.096290');
});

// ─── Wired into /v1 ───────────────────────────────────────────────────────────

const chat = (headers = {}) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({
    model: 'theta/qwen3',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 16,
  }),
});

test('an unmetered call is served while the caller is under the ceiling', async () => {
  const res = await chat({ 'x-api-key': TEST_KEY });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.xfuel.payment.rail, 'unmetered');
});

test('an exhausted caller is walled off the free surface', async () => {
  recordFreeSpend(`key:${hashApiKey(TEST_KEY)}`, 2n * USD);

  const res = await chat({ 'x-api-key': TEST_KEY });
  assert.equal(res.status, 402);
  assert.ok(res.headers.get('retry-after'), 'Retry-After tells the caller when it resets');

  const body = await res.json();
  assert.equal(body.error.code, 'free_tier_exhausted');
  assert.equal(body.error.type, 'payment_required');
  // The wall must name the way out, or it reads as an outage.
  assert.match(body.error.message, /metered key/);
  assert.match(body.error.message, /receipts are free/);
});

test('one caller exhausting the free tier does not wall off another', async () => {
  recordFreeSpend(`key:${hashApiKey(TEST_KEY)}`, 2n * USD);

  assert.equal((await chat({ 'x-api-key': TEST_KEY })).status, 402);
  assert.equal((await chat({ 'x-api-key': 'a-different-key' })).status, 200);
});

test('the ceiling can be turned off without touching code', async () => {
  process.env.FREE_TIER_DAILY_COGS_USD = '0';
  recordFreeSpend(`key:${hashApiKey(TEST_KEY)}`, 2n * USD);
  assert.equal((await chat({ 'x-api-key': TEST_KEY })).status, 200);
});
