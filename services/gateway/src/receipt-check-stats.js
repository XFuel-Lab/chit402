/**
 * Anonymous hourly counts for the free receipt check.
 * Rows are result, reason code, and client. The pasted receipt is not stored.
 */
import Database from 'better-sqlite3';

// VERIFIED_PUBLIC (0.4.6) has its own bucket: the public scope is never counted as a holder VERIFIED.
export const CHECK_RESULTS = ['VERIFIED', 'VERIFIED_PUBLIC', 'INVALID', 'COULD_NOT_CHECK'];
export const STATS_MAX_HOURS = 168;
export const STATS_DEFAULT_HOURS = 24;
export const ALERT_MIN_CHECKS = 20;
export const ALERT_RATE = 0.25;
export const ALERT_RATE_MULTIPLE = 2;
export const ALERT_REASON_SHARE = 0.6;
export const TRAILING_HOURS = 168;
const RETAIN_HOURS = 336;
const HOUR_MS = 3_600_000;

export function hourStart(ms) {
  return Math.floor(Number(ms) / HOUR_MS) * HOUR_MS;
}

export function clampStatsHours(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(STATS_MAX_HOURS, Math.floor(n));
}

export function normalizeClient(value) {
  return value === 'web' ? 'web' : 'api';
}

export function resultOfOverall(overall) {
  // VERIFIED_PUBLIC (0.4.6) is exit 0 with a narrower scope. Its own bucket,
  // neither a holder VERIFIED nor a could-not-check.
  if (overall === 'VERIFIED') return 'VERIFIED';
  if (overall === 'VERIFIED_PUBLIC') return 'VERIFIED_PUBLIC';
  if (overall === 'INVALID' || overall === 'NOT_IN_LOG') return 'INVALID';
  return 'COULD_NOT_CHECK';
}

function reasonCode(reason) {
  const raw = String(reason || 'none').trim();
  if (!raw || raw.length > 64) return 'other';
  if (!/^[A-Za-z0-9_.: -]+$/.test(raw)) return 'other';
  return raw.replace(/ /g, '_');
}

const openStats = new Map();

export function openCheckStats(file) {
  const key = file === ':memory:' ? '' : String(file);
  if (key && openStats.has(key)) return openStats.get(key);
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipt_check_hours (
      hour INTEGER NOT NULL,
      result TEXT NOT NULL,
      reason TEXT NOT NULL,
      client TEXT NOT NULL,
      n INTEGER NOT NULL,
      PRIMARY KEY (hour, result, reason, client)
    )
  `);
  const upsert = db.prepare(`
    INSERT INTO receipt_check_hours (hour, result, reason, client, n)
    VALUES (@hour, @result, @reason, @client, 1)
    ON CONFLICT(hour, result, reason, client) DO UPDATE SET n = n + 1
  `);
  const read = db.prepare(`
    SELECT hour, result, reason, client, n
    FROM receipt_check_hours
    WHERE hour >= ? AND hour <= ?
    ORDER BY hour ASC
  `);
  const dropOld = db.prepare('DELETE FROM receipt_check_hours WHERE hour < ?');
  const api = {
    path: String(file),
    record({ at = Date.now(), result, reason, client }) {
      const hour = hourStart(at);
      const safeResult = CHECK_RESULTS.includes(result) ? result : 'COULD_NOT_CHECK';
      upsert.run({
        hour,
        result: safeResult,
        reason: reasonCode(reason),
        client: normalizeClient(client),
      });
      dropOld.run(hour - RETAIN_HOURS * HOUR_MS);
    },
    rowsBetween(start, end) {
      return read.all(hourStart(start), hourStart(end));
    },
    close() {
      if (key) openStats.delete(key);
      db.close();
    },
  };
  if (key) openStats.set(key, api);
  return api;
}

function sum(rows, pick = () => true) {
  let n = 0;
  for (const row of rows) {
    if (pick(row)) n += Number(row.n) || 0;
  }
  return n;
}

export function maskCount(n) {
  const value = Number(n) || 0;
  return value < 3 ? '<3' : value;
}

function maskTrio(row) {
  return {
    verified: maskCount(row?.verified),
    verified_public: maskCount(row?.verified_public),
    invalid: maskCount(row?.invalid),
    could_not_check: maskCount(row?.could_not_check),
  };
}

/** Public stats hide counts of 0, 1, and 2. Alert math stays on the raw rows. */
export function maskPublicStats(buckets, alert) {
  return {
    buckets: (buckets || []).map((bucket) => ({
      hour: bucket.hour,
      ...maskTrio(bucket),
      by_client: {
        web: maskTrio(bucket.by_client?.web),
        api: maskTrio(bucket.by_client?.api),
      },
      by_reason: (bucket.by_reason || []).map((item) => ({
        result: item.result,
        reason: item.reason,
        client: item.client,
        count: maskCount(item.count),
      })),
    })),
    alert: {
      ...alert,
      checks: maskCount(alert?.checks),
      top_reason: alert?.top_reason
        ? { ...alert.top_reason, count: maskCount(alert.top_reason.count) }
        : null,
    },
  };
}

export function bucketRows(rows) {
  const byHour = new Map();
  for (const row of rows) {
    const hour = hourStart(row.hour);
    if (!byHour.has(hour)) byHour.set(hour, []);
    byHour.get(hour).push(row);
  }
  return [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, list]) => {
    const empty = () => ({ verified: 0, verified_public: 0, invalid: 0, could_not_check: 0 });
    const byClient = { web: empty(), api: empty() };
    const byReason = [];
    for (const row of list) {
      const count = Number(row.n) || 0;
      const key = row.result === 'VERIFIED'
        ? 'verified'
        : row.result === 'VERIFIED_PUBLIC'
          ? 'verified_public'
          : row.result === 'INVALID'
            ? 'invalid'
            : 'could_not_check';
      const client = normalizeClient(row.client);
      byClient[client][key] += count;
      byReason.push({
        result: row.result,
        reason: row.reason,
        client,
        count,
      });
    }
    return {
      hour: new Date(hour).toISOString(),
      verified: byClient.web.verified + byClient.api.verified,
      verified_public: byClient.web.verified_public + byClient.api.verified_public,
      invalid: byClient.web.invalid + byClient.api.invalid,
      could_not_check: byClient.web.could_not_check + byClient.api.could_not_check,
      by_client: byClient,
      by_reason: byReason,
    };
  });
}

/**
 * Alert on the latest hour that has at least 20 checks.
 * A rate alerts when it is above 25% and more than double the mean
 * hourly rate over the previous 168 hours that had any checks.
 * A reason alerts when it is more than 60% of that hour's failures.
 */
export function evaluateCheckAlert(rows, now = Date.now()) {
  const current = hourStart(now);
  const grouped = new Map();
  for (const row of rows) {
    const hour = hourStart(row.hour);
    if (hour > current) continue;
    if (!grouped.has(hour)) grouped.set(hour, []);
    grouped.get(hour).push(row);
  }
  const eligible = [...grouped.entries()]
    .map(([hour, list]) => ({ hour, list, checks: sum(list) }))
    .filter((slot) => slot.checks >= ALERT_MIN_CHECKS)
    .sort((a, b) => b.hour - a.hour);
  const chosen = eligible[0] || null;
  const currentRows = grouped.get(current) || [];
  const base = {
    raised: false,
    hour: chosen ? new Date(chosen.hour).toISOString() : new Date(current).toISOString(),
    checks: chosen ? chosen.checks : sum(currentRows),
    minimum: ALERT_MIN_CHECKS,
    invalid_rate: 0,
    could_not_check_rate: 0,
    invalid_baseline: null,
    could_not_check_baseline: null,
    rules: [],
    top_reason: null,
  };
  if (!chosen) return base;

  const invalid = sum(chosen.list, (row) => row.result === 'INVALID');
  const couldNot = sum(chosen.list, (row) => row.result === 'COULD_NOT_CHECK');
  const failures = invalid + couldNot;
  const invalidRate = chosen.checks ? invalid / chosen.checks : 0;
  const couldRate = chosen.checks ? couldNot / chosen.checks : 0;
  const trailStart = chosen.hour - TRAILING_HOURS * HOUR_MS;
  const trail = [];
  for (const [hour, list] of grouped) {
    if (hour < trailStart || hour >= chosen.hour) continue;
    const checks = sum(list);
    if (checks < 1) continue;
    trail.push({
      invalid: sum(list, (row) => row.result === 'INVALID') / checks,
      could: sum(list, (row) => row.result === 'COULD_NOT_CHECK') / checks,
    });
  }
  const mean = (pick) => (trail.length
    ? trail.reduce((total, slot) => total + pick(slot), 0) / trail.length
    : null);
  const invalidBaseline = mean((slot) => slot.invalid);
  const couldBaseline = mean((slot) => slot.could);
  const rules = [];
  if (
    invalidBaseline != null
    && invalidRate > ALERT_RATE_MULTIPLE * invalidBaseline
    && invalidRate > ALERT_RATE
  ) rules.push('invalid_rate');
  if (
    couldBaseline != null
    && couldRate > ALERT_RATE_MULTIPLE * couldBaseline
    && couldRate > ALERT_RATE
  ) rules.push('could_not_check_rate');

  const byReason = new Map();
  for (const row of chosen.list) {
    if (row.result === 'VERIFIED' || row.result === 'VERIFIED_PUBLIC') continue;
    byReason.set(row.reason, (byReason.get(row.reason) || 0) + (Number(row.n) || 0));
  }
  let top = null;
  for (const [code, count] of byReason) {
    const share = failures ? count / failures : 0;
    if (!top || share > top.share) top = { code, count, share };
  }
  if (top && failures > 0 && top.share > ALERT_REASON_SHARE) rules.push('reason_share');

  return {
    raised: rules.length > 0,
    hour: new Date(chosen.hour).toISOString(),
    checks: chosen.checks,
    minimum: ALERT_MIN_CHECKS,
    invalid_rate: invalidRate,
    could_not_check_rate: couldRate,
    invalid_baseline: invalidBaseline,
    could_not_check_baseline: couldBaseline,
    rules,
    top_reason: top,
  };
}
