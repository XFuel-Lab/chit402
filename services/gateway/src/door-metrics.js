import crypto from 'crypto';
import { callerBindingOf, networkFromPaymentRef } from './receipt.js';

/**
 * Private house door-traffic counters from our own stamped receipt snapshots.
 *
 * Ground truth: durable task rows in the gateway task store (the same source as
 * GET /receipt/:taskId and GET /receipt/by-tx). Not a chain indexer; not x402scan.
 *
 * "Door" = USDC x402 settlement on the public chat surfaces (POST /v1/chat/completions,
 * /v1/responses, POST /a2a-message) — tasks stamped by openai-gateway with a
 * persisted issuer_signature.jws and intent.paymentRef.
 *
 * PUBLIC-SAFE: aggregate counts only. No task ids, payer addresses, or tx refs.
 */

const DAY_MS = 24 * 3600 * 1000;
const WINDOW_24H_MS = DAY_MS;
const WINDOW_7D_MS = 7 * DAY_MS;

const COMPLETED_STATUSES = new Set(['completed', 'fee_collected']);
const FAILED_STATUSES = new Set(['failed']);

const DOOR_SOURCES = new Set(['openai-gateway']);

/**
 * @param {object|null|undefined} task
 * @returns {boolean}
 */
export function isDoorTrafficTask(task) {
  if (!task?.taskId) return false;
  const jws = task.issuerSignature?.jws || task.issuer_signature?.jws;
  if (!jws) return false;

  const source = task.meta?.source || task.intent?.sender || null;
  if (!DOOR_SOURCES.has(source)) return false;

  const rail = (task.intent?.paymentRail || '').toLowerCase();
  if (rail !== 'usdc') return false;

  const ref = task.intent?.paymentRef;
  if (!ref || typeof ref !== 'string') return false;

  return true;
}

/**
 * Coarse settlement network bucket for house scoreboard (Solana vs EVM/Base).
 * @param {string|null|undefined} paymentRef
 * @returns {'solana'|'evm'|'unknown'}
 */
export function networkBucketFromPaymentRef(paymentRef) {
  const net = networkFromPaymentRef(paymentRef);
  if (!net) return 'unknown';
  const n = net.toLowerCase();
  if (n === 'solana' || n.startsWith('solana')) return 'solana';
  if (n === 'base' || n === 'base-sepolia' || n.startsWith('eip155')) return 'evm';
  return 'unknown';
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** @param {import('http').IncomingMessage|{ headers?: Record<string, string|string[]|undefined> }} req */
export function extractDoorMetricsToken(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const header = req.headers?.['x-door-metrics-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

/**
 * @param {string|null|undefined} configuredToken
 * @param {string|null|undefined} providedToken
 */
export function doorMetricsAuthResult(configuredToken, providedToken) {
  if (!configuredToken) {
    return {
      ok: false,
      status: 503,
      error: 'disabled',
      message: 'DOOR_METRICS_TOKEN is not configured; endpoint stays off.',
    };
  }
  if (!providedToken) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Provide Authorization: Bearer <DOOR_METRICS_TOKEN> or X-Door-Metrics-Token.',
    };
  }
  if (!timingSafeEqualString(providedToken, configuredToken)) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Invalid door metrics token.',
    };
  }
  return { ok: true };
}

function aggregateWindow(doorTasks, windowMs, now) {
  const byStatus = {};
  const byNetwork = { solana: 0, evm: 0, unknown: 0 };
  let stampedReceipts = 0;
  let completed = 0;
  let failed = 0;
  let inProgress = 0;
  const payers = new Set();

  for (const t of doorTasks) {
    const at = Number(t.createdAt) || 0;
    if (!at || now - at > windowMs) continue;

    stampedReceipts += 1;
    const status = t.status || 'pending';
    byStatus[status] = (byStatus[status] || 0) + 1;

    if (COMPLETED_STATUSES.has(status)) completed += 1;
    else if (FAILED_STATUSES.has(status)) failed += 1;
    else inProgress += 1;

    const payer = callerBindingOf(t).payer_wallet;
    if (payer) payers.add(String(payer).toLowerCase());

    const bucket = networkBucketFromPaymentRef(t.intent?.paymentRef);
    byNetwork[bucket] = (byNetwork[bucket] || 0) + 1;
  }

  return {
    stamped_receipts: stampedReceipts,
    by_status: byStatus,
    outcome: { completed, failed, in_progress: inProgress },
    unique_payer_wallets: payers.size,
    by_network: byNetwork,
  };
}

/**
 * @param {Array<object>} tasks - all task snapshots (e.g. task store allSnapshots())
 * @param {{ now?: number }} [opts]
 */
export function computeDoorMetrics(tasks = [], { now = Date.now() } = {}) {
  const doorTasks = tasks.filter(isDoorTrafficTask);
  return {
    generated_at: new Date(now).toISOString(),
    source: 'receipt_task_store',
    definition: {
      stamped: 'issuer_signature.jws present on durable task snapshot',
      door: 'USDC x402 via openai-gateway (POST /v1, /v1/responses, POST /a2a-message)',
      window_anchor: 'task.createdAt',
    },
    windows: {
      '24h': aggregateWindow(doorTasks, WINDOW_24H_MS, now),
      '7d': aggregateWindow(doorTasks, WINDOW_7D_MS, now),
    },
    totals: {
      door_stamped_all_time: doorTasks.length,
    },
  };
}

export default {
  isDoorTrafficTask,
  computeDoorMetrics,
  networkBucketFromPaymentRef,
  extractDoorMetricsToken,
  doorMetricsAuthResult,
};
