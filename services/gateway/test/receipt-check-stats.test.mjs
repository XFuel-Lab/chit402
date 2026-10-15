/**
 * Anonymous hourly counts and the fail-monitor alert.
 * The pasted receipt is not stored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';

const {
  openCheckStats,
  bucketRows,
  evaluateCheckAlert,
  hourStart,
  clampStatsHours,
  resultOfOverall,
} = await import('../src/receipt-check-stats.js');
const { mountReceiptCheck } = await import('../src/receipt-check.js');
const { buildVerifyVerdict, humanVerdictLines } = await import('../../../packages/verify/dist/verdict.js');

const HOUR = 3_600_000;
const MARKER = 'paste-marker-9f3c2a-do-not-store';
const NOW = Date.parse('2026-10-14T18:40:00.000Z');
const CURRENT = hourStart(NOW);

function row(hour, result, reason, client, n) {
  return { hour, result, reason, client, n };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function noMarker(file) {
  for (const path of [file, `${file}-wal`, `${file}-shm`]) {
    if (!existsSync(path)) continue;
    assert.equal(readFileSync(path).includes(Buffer.from(MARKER)), false, path);
  }
}

test('hours are capped at 168 and a bad value is rejected', () => {
  assert.equal(clampStatsHours('24'), 24);
  assert.equal(clampStatsHours('24.9'), 24);
  assert.equal(clampStatsHours(200), 168);
  assert.equal(clampStatsHours(0), null);
  assert.equal(clampStatsHours(-3), null);
  assert.equal(clampStatsHours('nope'), null);
  assert.equal(resultOfOverall('VERIFIED'), 'VERIFIED');
  assert.equal(resultOfOverall('NOT_IN_LOG'), 'INVALID');
  assert.equal(resultOfOverall('COULD_NOT_CHECK'), 'COULD_NOT_CHECK');
});

test('sqlite buckets count result, reason, and client, and drop the pasted input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-stats-'));
  const file = join(dir, 'stats.sqlite');
  const stats = openCheckStats(file);
  const at = Date.parse('2026-10-14T15:20:00.000Z');
  const hour = hourStart(at);
  try {
    stats.record({ at, result: 'VERIFIED', reason: 'none', client: 'web' });
    stats.record({ at, result: 'VERIFIED', reason: 'none', client: 'web' });
    stats.record({ at, result: 'INVALID', reason: 'signature_invalid', client: 'api' });
    stats.record({ at, result: 'INVALID', reason: 'key untrusted', client: 'api' });
    stats.record({ at, result: resultOfOverall('NOT_IN_LOG'), reason: 'not_in_log', client: 'browser' });
    stats.record({ at: at + HOUR, result: 'COULD_NOT_CHECK', reason: 'receipt_unavailable', client: 'web' });
    stats.record({
      at,
      result: 'INVALID',
      reason: `{"note":"${MARKER}"}`,
      client: 'api',
    });
    stats.record({ at, result: 'INVALID', reason: `${MARKER}${'x'.repeat(80)}`, client: 'web' });

    const rows = stats.rowsBetween(at, at + HOUR);
    const buckets = bucketRows(rows);
    assert.equal(buckets.length, 2);
    assert.equal(buckets[0].hour, new Date(hour).toISOString());
    assert.equal(buckets[0].verified, 2);
    assert.equal(buckets[0].invalid, 5);
    assert.equal(buckets[0].could_not_check, 0);
    assert.equal(buckets[0].by_client.web.verified, 2);
    assert.equal(buckets[0].by_client.api.invalid, 4);
    assert.equal(buckets[0].by_client.api.verified, 0);
    assert.equal(buckets[1].could_not_check, 1);
    assert.equal(buckets[1].by_client.web.could_not_check, 1);
    const reasons = buckets[0].by_reason.map((item) => item.reason).sort();
    assert.deepEqual(reasons, ['key_untrusted', 'none', 'not_in_log', 'other', 'other', 'signature_invalid']);
    assert.equal(buckets[0].by_reason.find((item) => item.reason === 'not_in_log').result, 'INVALID');
    assert.equal(buckets[0].by_reason.find((item) => item.reason === 'not_in_log').client, 'api');
    assert.equal(JSON.stringify(buckets).includes(MARKER), false);
  } finally {
    stats.close();
  }
  noMarker(file);
});

test('an hour under 20 checks does not alert', () => {
  const alert = evaluateCheckAlert([
    row(CURRENT, 'VERIFIED', 'none', 'web', 5),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 14),
  ], NOW);
  assert.equal(alert.raised, false);
  assert.equal(alert.checks, 19);
  assert.equal(alert.minimum, 20);
  assert.deepEqual(alert.rules, []);
  assert.equal(alert.hour, new Date(CURRENT).toISOString());
});

test('invalid rate alerts above 25 percent and double the trailing hourly average', () => {
  const rows = [
    row(CURRENT - 2 * HOUR, 'VERIFIED', 'none', 'web', 9),
    row(CURRENT - 2 * HOUR, 'INVALID', 'signature_invalid', 'api', 1),
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'web', 18),
    row(CURRENT - HOUR, 'INVALID', 'signature_invalid', 'api', 2),
    row(CURRENT, 'VERIFIED', 'none', 'web', 14),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 3),
    row(CURRENT, 'INVALID', 'payment_mismatch', 'web', 3),
  ];
  const alert = evaluateCheckAlert(rows, NOW);
  assert.equal(alert.invalid_rate, 0.3);
  assert.equal(alert.invalid_baseline, 0.1);
  assert.equal(alert.raised, true);
  assert.deepEqual(alert.rules, ['invalid_rate']);
  assert.equal(alert.top_reason.share, 0.5);
});

test('exactly 25 percent does not alert', () => {
  const rows = [
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'web', 9),
    row(CURRENT - HOUR, 'INVALID', 'signature_invalid', 'api', 1),
    row(CURRENT, 'VERIFIED', 'none', 'web', 15),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 3),
    row(CURRENT, 'INVALID', 'payment_mismatch', 'web', 2),
  ];
  const alert = evaluateCheckAlert(rows, NOW);
  assert.equal(alert.invalid_rate, 0.25);
  assert.equal(alert.top_reason.share, 0.6);
  assert.equal(alert.raised, false);
  assert.deepEqual(alert.rules, []);
});

test('30 percent against a 20 percent baseline is not double, so the rate rule stays quiet', () => {
  const rows = [
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'api', 16),
    row(CURRENT - HOUR, 'INVALID', 'signature_invalid', 'api', 4),
    row(CURRENT, 'VERIFIED', 'none', 'web', 14),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 3),
    row(CURRENT, 'INVALID', 'payment_mismatch', 'web', 3),
  ];
  const alert = evaluateCheckAlert(rows, NOW);
  assert.equal(alert.invalid_rate, 0.3);
  assert.equal(alert.invalid_baseline, 0.2);
  assert.equal(alert.raised, false);
});

test('exactly double the baseline does not alert', () => {
  const rows = [
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'web', 17),
    row(CURRENT - HOUR, 'INVALID', 'signature_invalid', 'api', 3),
    row(CURRENT, 'VERIFIED', 'none', 'web', 14),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 3),
    row(CURRENT, 'INVALID', 'payment_mismatch', 'web', 3),
  ];
  const alert = evaluateCheckAlert(rows, NOW);
  assert.equal(alert.invalid_baseline, 0.15);
  assert.equal(alert.invalid_rate, 0.3);
  assert.equal(alert.raised, false);
});

test('a zero baseline still alerts when the rate is above 25 percent', () => {
  const rows = [
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'web', 10),
    row(CURRENT, 'VERIFIED', 'none', 'web', 14),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 3),
    row(CURRENT, 'INVALID', 'payment_mismatch', 'web', 3),
  ];
  const alert = evaluateCheckAlert(rows, NOW);
  assert.equal(alert.invalid_baseline, 0);
  assert.deepEqual(alert.rules, ['invalid_rate']);
});

test('could-not-check rate uses the same rule, and empty hours are skipped', () => {
  const rows = [
    row(CURRENT - 5 * HOUR, 'VERIFIED', 'none', 'web', 9),
    row(CURRENT - 5 * HOUR, 'COULD_NOT_CHECK', 'receipt_unavailable', 'api', 1),
    row(CURRENT, 'VERIFIED', 'none', 'web', 14),
    row(CURRENT, 'COULD_NOT_CHECK', 'receipt_unavailable', 'web', 3),
    row(CURRENT, 'COULD_NOT_CHECK', 'log_unreachable', 'api', 3),
  ];
  const alert = evaluateCheckAlert(rows, NOW);
  assert.equal(alert.could_not_check_baseline, 0.1);
  assert.equal(alert.could_not_check_rate, 0.3);
  assert.deepEqual(alert.rules, ['could_not_check_rate']);
});

test('one reason above 60 percent of failures alerts, and exactly 60 percent does not', () => {
  const loud = [
    row(CURRENT - HOUR, 'INVALID', 'signature_invalid', 'api', 8),
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'web', 12),
    row(CURRENT, 'VERIFIED', 'none', 'web', 10),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 7),
    row(CURRENT, 'INVALID', 'payment_mismatch', 'web', 3),
  ];
  const loudAlert = evaluateCheckAlert(loud, NOW);
  assert.equal(loudAlert.invalid_rate, 0.5);
  assert.equal(loudAlert.invalid_baseline, 0.4);
  assert.equal(loudAlert.top_reason.code, 'signature_invalid');
  assert.equal(loudAlert.top_reason.count, 7);
  assert.equal(loudAlert.top_reason.share, 0.7);
  assert.deepEqual(loudAlert.rules, ['reason_share']);

  const even = [
    row(CURRENT - HOUR, 'INVALID', 'signature_invalid', 'api', 8),
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'web', 12),
    row(CURRENT, 'VERIFIED', 'none', 'web', 10),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 6),
    row(CURRENT, 'INVALID', 'payment_mismatch', 'web', 4),
  ];
  const evenAlert = evaluateCheckAlert(even, NOW);
  assert.equal(evenAlert.top_reason.share, 0.6);
  assert.equal(evenAlert.raised, false);
});

test('the latest hour under 20 checks yields to the previous hour that qualifies', () => {
  const rows = [
    row(CURRENT - 2 * HOUR, 'VERIFIED', 'none', 'web', 9),
    row(CURRENT - 2 * HOUR, 'INVALID', 'signature_invalid', 'api', 1),
    row(CURRENT - HOUR, 'VERIFIED', 'none', 'web', 14),
    row(CURRENT - HOUR, 'INVALID', 'signature_invalid', 'api', 3),
    row(CURRENT - HOUR, 'INVALID', 'payment_mismatch', 'web', 3),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 5),
  ];
  const alert = evaluateCheckAlert(rows, NOW);
  assert.equal(alert.hour, new Date(CURRENT - HOUR).toISOString());
  assert.equal(alert.checks, 20);
  assert.equal(alert.invalid_rate, 0.3);
  assert.equal(alert.invalid_baseline, 0.1);
  assert.deepEqual(alert.rules, ['invalid_rate']);
});

test('with no trailing hours the rate rule stays quiet and a dominant reason still alerts', () => {
  const alert = evaluateCheckAlert([
    row(CURRENT, 'VERIFIED', 'none', 'web', 6),
    row(CURRENT, 'INVALID', 'signature_invalid', 'api', 14),
  ], NOW);
  assert.equal(alert.invalid_baseline, null);
  assert.equal(alert.could_not_check_baseline, null);
  assert.deepEqual(alert.rules, ['reason_share']);
  assert.equal(alert.top_reason.code, 'signature_invalid');
});

test('GET /v1/receipts/check/stats returns buckets and an alert, and never the input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-stats-http-'));
  const file = join(dir, 'stats.sqlite');
  const stats = openCheckStats(file);
  const verdict = buildVerifyVerdict({
    version: '0.4.1',
    signatureValid: true,
    signatureChecked: true,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'pass',
    anchor: 'pass',
  });
  const lines = humanVerdictLines(verdict);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  mountReceiptCheck(app, {
    stats,
    now: () => NOW,
    feedbackToken: '',
    check: async () => ({ verdict, lines, report: 'lines' }),
  });
  stats.record({ at: NOW - HOUR, result: 'VERIFIED', reason: 'none', client: 'api' });
  stats.record({ at: NOW - HOUR, result: 'INVALID', reason: 'signature_invalid', client: 'api' });
  for (let i = 0; i < 9; i += 1) {
    stats.record({ at: NOW - HOUR, result: 'VERIFIED', reason: 'none', client: 'web' });
  }
  const { server, base } = await listen(app);
  try {
    const posted = await fetch(`${base}/v1/receipts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: `{"note":"${MARKER}"}`, client: 'web' }),
    });
    assert.equal(posted.status, 200);
    const res = await fetch(`${base}/v1/receipts/check/stats?hours=24`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
    assert.equal(body.hours, 24);
    assert.equal(body.from, new Date(CURRENT - 23 * HOUR).toISOString());
    assert.equal(body.to, new Date(CURRENT).toISOString());
    assert.equal(JSON.stringify(body).includes(MARKER), false);
    const current = body.buckets.find((bucket) => bucket.hour === new Date(CURRENT).toISOString());
    assert.equal(current.verified, 1);
    assert.equal(current.by_client.web.verified, 1);
    assert.equal(current.by_reason.some((item) => item.reason === 'none'), true);
    assert.equal(body.alert.raised, false);
    assert.equal(body.alert.minimum, 20);
    assert.deepEqual(Object.keys(body.alert).sort(), [
      'checks',
      'could_not_check_baseline',
      'could_not_check_rate',
      'hour',
      'invalid_baseline',
      'invalid_rate',
      'minimum',
      'raised',
      'rules',
      'top_reason',
    ]);

    const capped = await fetch(`${base}/v1/receipts/check/stats?hours=999`);
    const cappedBody = await capped.json();
    assert.equal(cappedBody.hours, 168);
    assert.equal(cappedBody.from, new Date(CURRENT - 167 * HOUR).toISOString());

    const bad = await fetch(`${base}/v1/receipts/check/stats?hours=0`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'bad_hours');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    stats.close();
  }
  noMarker(file);
});

test('stats and the check share one per-IP limit', async () => {
  const app = express();
  app.use(express.json());
  const verdict = buildVerifyVerdict({ version: '0.4.1', absentReason: 'receipt_unavailable' });
  mountReceiptCheck(app, {
    maxHits: 1,
    windowMs: 60_000,
    feedbackToken: '',
    stats: openCheckStats(':memory:'),
    check: async () => ({ verdict, lines: humanVerdictLines(verdict), report: 'lines' }),
  });
  const { server, base } = await listen(app);
  try {
    const first = await fetch(`${base}/v1/receipts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96' }),
    });
    const stats = await fetch(`${base}/v1/receipts/check/stats`);
    assert.equal(first.status, 200);
    assert.equal(stats.status, 429);
    assert.equal((await stats.json()).error, 'rate_limit_exceeded');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
