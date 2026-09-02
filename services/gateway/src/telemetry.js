import { proofOutcomeOf } from './receipt.js';
import { aggregateUsage } from './usage.js';

/**
 * Usage telemetry — aggregate, public-safe network stats derived from the durable
 * task snapshots (see task-store.js). Because tasks are persisted, these numbers
 * survive restarts and reflect real historical activity — the basis for a launch
 * "network activity" flex and a tiny internal dashboard.
 *
 * PUBLIC-SAFE by design: only counts and per-rail summed amounts. No task ids, no
 * senders, no model output, no proof bytes. Fees are summed PER RAIL (never across
 * rails) since USDC (6dp) and TFUEL (18dp) are different units.
 */

const DAY_MS = 24 * 3600 * 1000;

/** Safe BigInt add of a base-unit string; ignores non-numeric values. */
function addBig(acc, v) {
  try {
    return acc + BigInt(String(v ?? '0').trim() || '0');
  } catch {
    return acc; // skip malformed amounts rather than throw
  }
}

function railOf(task) {
  const r = (task.intent?.paymentRail || 'tfuel').toLowerCase();
  return r === 'usdc' ? 'usdc' : 'tfuel';
}

const SETTLED_STATUSES = new Set(['completed', 'fee_collected']);

/**
 * Money figures are only summed from tasks created at or after this instant.
 *
 * Before the settled-gross fix, `payment.gross_amount` came from a buyer-declared
 * `amount` rather than what x402 actually collected, and our own flagship demo
 * declared $1.00 while paying $0.01. Every fee derived from those rows is ~100x
 * over, which made the headline "USDC fees" figure unusable — and it is the one
 * number that must never be overstated.
 *
 * Windowing rather than backfilling: the settled amount for a historical row
 * cannot always be recovered, and inventing one would be the same class of error.
 * Counts still include every task; only the money is windowed, and the excluded
 * rows are reported rather than quietly dropped.
 *
 * The default is deliberately a few hours later than the fix, so the boundary
 * errs towards under-reporting our own revenue.
 */
const DEFAULT_FEE_TRUST_FROM = '2026-08-12T00:00:00Z';

function feeTrustFrom(override) {
  const raw = override || process.env.STATS_FEE_TRUST_FROM || DEFAULT_FEE_TRUST_FROM;
  if (raw === 'all') return 0; // opt out — accepts the inflated history
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Date.parse(DEFAULT_FEE_TRUST_FROM);
}

/**
 * Aggregate a list of task snapshots into public-safe usage stats.
 * @param {Array<Object>} tasks
 * @param {{ now?: number, apiKeyHash?: string|null, feeTrustFrom?: string }} [opts]
 *   When `apiKeyHash` is set, only tasks stamped with that buyer hash are counted
 *   (Private Spend buyer-only analytics). Public `/stats` omits this filter.
 *   `feeTrustFrom` overrides the money cutoff ('all' to sum every row).
 */
export function computeUsageStats(
  tasks = [],
  { now = Date.now(), apiKeyHash = null, feeTrustFrom: trustOverride = null } = {},
) {
  const byStatus = {};
  const byMessageType = {};
  const byProvider = {};
  const proofs = { valid: 0, regenerable: 0, pending: 0, invalid: 0 };
  const rails = {
    usdc: { count: 0, gross: 0n, fee: 0n, net: 0n },
    tfuel: { count: 0, gross: 0n, fee: 0n, net: 0n },
  };

  let last24h = 0;
  let last7d = 0;
  let settled = 0;
  let firstSeen = null;
  let lastSeen = null;
  let privateSpendTasks = 0;
  let paidTasks7d = 0;
  let usdcFees7d = 0n;
  let usdcPaidTasks7d = 0;
  let excludedFromMoney = 0;

  const wantHash = apiKeyHash ? String(apiKeyHash).toLowerCase() : null;
  const trustFrom = feeTrustFrom(trustOverride);

  for (const t of tasks) {
    if (!t || !t.taskId) continue;
    if (wantHash) {
      const h = (t.meta?.apiKeyHash || '').toLowerCase();
      if (h !== wantHash) continue;
    }

    const status = t.status || 'pending';
    byStatus[status] = (byStatus[status] || 0) + 1;

    const mt = t.intent?.type || 'unknown';
    byMessageType[mt] = (byMessageType[mt] || 0) + 1;

    const provider = t.meta?.provider || t.routedTo || 'unrouted';
    byProvider[provider] = (byProvider[provider] || 0) + 1;

    const outcome = proofOutcomeOf(t);
    if (proofs[outcome] != null) proofs[outcome] += 1;

    const rail = railOf(t);
    const r = rails[rail];
    const createdAt = Number(t.createdAt) || 0;
    // A task with no timestamp cannot be placed relative to the fix, so it is
    // treated as untrusted for money.
    const moneyTrusted = createdAt >= trustFrom;
    r.count += 1;
    if (moneyTrusted) {
      r.gross = addBig(r.gross, t.intent?.amount);
      r.fee = addBig(r.fee, t.feeAmount);
      r.net = addBig(r.net, t.netAmount);
    } else {
      excludedFromMoney += 1;
    }

    if (SETTLED_STATUSES.has(status)) settled += 1;
    if (t.meta?.privateSpend || t.meta?.privacyMode === 'vendor_blind') privateSpendTasks += 1;

    const created = Number(t.createdAt) || 0;
    if (created) {
      if (now - created <= DAY_MS) last24h += 1;
      if (now - created <= 7 * DAY_MS) {
        last7d += 1;
        // North-star: paid (settled) tasks in the last 7 days
        if (SETTLED_STATUSES.has(status)) {
          paidTasks7d += 1;
          if (rail === 'usdc') {
            usdcPaidTasks7d += 1;
            if (moneyTrusted) usdcFees7d = addBig(usdcFees7d, t.feeAmount);
          }
        }
      }
      if (firstSeen == null || created < firstSeen) firstSeen = created;
    }
    const updated = Number(t.updatedAt) || created;
    if (updated && (lastSeen == null || updated > lastSeen)) lastSeen = updated;
  }

  const filtered = wantHash
    ? tasks.filter((t) => t && t.taskId && (t.meta?.apiKeyHash || '').toLowerCase() === wantHash)
    : tasks.filter((t) => t && t.taskId);
  const total = filtered.length;
  const provenPct = total ? Math.round((proofs.valid / total) * 1000) / 10 : 0;

  const railOut = {};
  for (const [k, v] of Object.entries(rails)) {
    railOut[k] = {
      count: v.count,
      gross_amount: v.gross.toString(),
      fee_amount: v.fee.toString(),
      net_amount: v.net.toString(),
    };
  }

  const out = {
    generated_at: new Date(now).toISOString(),
    window: 'all-time',
    scope: wantHash ? 'buyer' : 'network',
    tasks: {
      total,
      settled,
      by_status: byStatus,
      by_message_type: byMessageType,
      by_provider: byProvider,
      private_spend: privateSpendTasks,
    },
    payments: {
      by_rail: railOut,
      // Say what was left out rather than presenting a silently filtered total.
      fee_basis: {
        trusted_from: new Date(trustFrom).toISOString(),
        excluded_tasks: excludedFromMoney,
        note: excludedFromMoney
          ? 'Amounts exclude tasks created before gross was derived from the settled '
            + 'x402 payment; those rows report a buyer-declared gross and overstate fees.'
          : 'All tasks post-date the settled-gross fix.',
      },
    },
    // Provider-reported and estimated token counts stay separate — averaging a
    // guess into a measurement is how you end up pricing against fiction.
    tokens: aggregateUsage(filtered),
    proofs: { ...proofs, proven_pct: provenPct },
    activity: {
      last_24h: last24h,
      last_7d: last7d,
      first_seen: firstSeen ? new Date(firstSeen).toISOString() : null,
      last_seen: lastSeen ? new Date(lastSeen).toISOString() : null,
    },
    // Founder north-star (Sprint 3): paid tasks / week + USDC fees
    north_star: {
      paid_tasks_7d: paidTasks7d,
      usdc_paid_tasks_7d: usdcPaidTasks7d,
      usdc_fees_7d: usdcFees7d.toString(),
    },
  };
  return out;
}

// ─── HTML dashboard ────────────────────────────────────────────────────────────

function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function kvRows(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return '<div class="row"><span class="muted">—</span></div>';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)
    .join('');
}

function stat(label, value, sub = '') {
  return `<div class="stat"><div class="num">${esc(value)}</div><div class="lbl">${esc(label)}</div>${
    sub ? `<div class="sub">${esc(sub)}</div>` : ''
  }</div>`;
}

/** Render a small, standalone, dark usage dashboard. */
export function renderStatsHtml(stats) {
  const t = stats.tasks;
  const p = stats.proofs;
  const usdc = stats.payments.by_rail.usdc;
  const tfuel = stats.payments.by_rail.tfuel;
  // USDC is 6dp — show a friendly dollar figure alongside base units.
  const usdcDollars = (Number(usdc.fee_amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const ns = stats.north_star || { paid_tasks_7d: 0, usdc_paid_tasks_7d: 0, usdc_fees_7d: '0' };
  const feeBasis = stats.payments.fee_basis || { excluded_tasks: 0, note: '' };
  const usdcFees7dDollars = (Number(ns.usdc_fees_7d) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chit · network activity</title>
  <meta name="robots" content="noindex" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0b0e14; color: #e6e9ef; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .wrap { max-width: 820px; margin: 0 auto; padding: 32px 20px 64px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 8px; flex-wrap: wrap; }
    .brand { font-weight: 700; font-size: 18px; } .brand span { color: #6ea8fe; }
    .gen { font-size: 12px; color: #6b7488; }
    h1 { font-size: 14px; font-weight: 600; color: #aab2c0; margin: 4px 0 20px; letter-spacing: .3px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 8px; }
    .stat { background: #131824; border: 1px solid #222a3a; border-radius: 12px; padding: 16px 18px; }
    .stat .num { font-size: 26px; font-weight: 700; color: #fff; }
    .stat .lbl { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: #8b95a7; margin-top: 4px; }
    .stat .sub { font-size: 12px; color: #6ee7a8; margin-top: 4px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 12px; }
    .card { background: #131824; border: 1px solid #222a3a; border-radius: 12px; padding: 16px 18px; }
    .card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #8b95a7; margin: 0 0 10px; font-weight: 600; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-top: 1px solid #1b2231; }
    .row:first-of-type { border-top: 0; }
    .k { color: #8b95a7; } .v { color: #e6e9ef; font-variant-numeric: tabular-nums; }
    .muted { color: #6b7488; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
    footer { margin-top: 28px; font-size: 12px; color: #6b7488; text-align: center; }
    footer a { color: #7a869c; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">Chit<span>·</span>activity</div>
      <div class="gen">as of ${esc(stats.generated_at)}</div>
    </header>
    <h1>Verifiable settlement for AI compute — live network activity</h1>

    <div class="grid">
      ${stat('Paid tasks (7d)', ns.paid_tasks_7d, 'north-star')}
      ${stat('USDC fees (7d)', `$${usdcFees7dDollars}`, `${ns.usdc_paid_tasks_7d} USDC tasks`)}
      ${stat('Tasks total', t.total)}
      ${stat('Settled', t.settled)}
      ${stat('Proven', p.valid, `${p.proven_pct}% of all tasks`)}
      ${stat('Last 24h', stats.activity.last_24h)}
    </div>

    <div class="cards">
      <div class="card"><h2>By status</h2>${kvRows(t.by_status)}</div>
      <div class="card"><h2>By provider</h2>${kvRows(t.by_provider)}</div>
      <div class="card"><h2>By task type</h2>${kvRows(t.by_message_type)}</div>
      <div class="card">
        <h2>Proof outcomes</h2>
        <div class="row"><span class="k">valid</span><span class="v">${esc(p.valid)}</span></div>
        <div class="row"><span class="k">regenerable</span><span class="v">${esc(p.regenerable)}</span></div>
        <div class="row"><span class="k">pending</span><span class="v">${esc(p.pending)}</span></div>
        <div class="row"><span class="k">invalid</span><span class="v">${esc(p.invalid)}</span></div>
      </div>
      <div class="card">
        <h2>USDC rail (x402)</h2>
        <div class="row"><span class="k">tasks</span><span class="v">${esc(usdc.count)}</span></div>
        <div class="row"><span class="k">fees (base units)</span><span class="v">${esc(usdc.fee_amount)}</span></div>
        <div class="row"><span class="k">fees (~USDC)</span><span class="v">$${esc(usdcDollars)}</span></div>
        ${feeBasis.excluded_tasks
          ? `<div class="row"><span class="k">excluded (pre-fix)</span><span class="v">${esc(feeBasis.excluded_tasks)}</span></div>`
          : ''}
      </div>
      <div class="card">
        <h2>TFUEL rail</h2>
        <div class="row"><span class="k">tasks</span><span class="v">${esc(tfuel.count)}</span></div>
        <div class="row"><span class="k">fees (wei)</span><span class="v">${esc(tfuel.fee_amount)}</span></div>
      </div>
    </div>

    <footer>
      Aggregate, public-safe stats — no task ids, senders, or outputs.
      Machine-readable: <a href="?format=json">JSON</a>. Signed receipt: model, hub, cost.
    </footer>
  </div>
</body>
</html>`;
}

export default { computeUsageStats, renderStatsHtml };
