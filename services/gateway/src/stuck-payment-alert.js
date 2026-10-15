/**
 * One alert when a pending settle_unconfirmed row is created.
 * At most one detail alert per minute. Further rows in that minute
 * become one summary count. The webhook URL is never written to a log line.
 */
import logger from './logger.js';

const WINDOW_MS = 60_000;

let lastAt = 0;
let extra = 0;
let heldSample = null;
let timer = null;

function sampleOf(fields) {
  const tx = typeof fields.tx === 'string' && fields.tx.length > 0 && fields.tx.length <= 200
    ? fields.tx
    : null;
  const network = fields.network ? String(fields.network).slice(0, 80) : null;
  const amount = fields.amount != null && fields.amount !== '' ? String(fields.amount).slice(0, 40) : null;
  const reason = fields.reason ? String(fields.reason).slice(0, 80) : null;
  return { tx, network, amount, reason };
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

async function writeAlert(sample, count, deps, { summary = false } = {}) {
  const log = deps.logger || logger;
  const configured = deps.webhookUrl !== undefined ? deps.webhookUrl : process.env.ALERT_WEBHOOK_URL;
  const url = typeof configured === 'string' ? configured.trim() : '';
  const body = { ...sample, count };
  log.error(
    {
      alert: 'stuck_payment',
      ...body,
      ...(summary ? { summary: true } : {}),
      ...(url && !summary ? { webhook: 'ALERT_WEBHOOK_URL' } : {}),
    },
    summary ? 'stuck payment summary' : 'stuck payment',
  );
  if (!url || summary) return;
  const post = deps.fetch || fetch;
  try {
    await post(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx: sample.tx, network: sample.network, amount: sample.amount, reason: sample.reason }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    log.error(
      { alert: 'stuck_payment', webhook: 'ALERT_WEBHOOK_URL', webhook_error: 'post_failed' },
      'stuck payment webhook failed',
    );
  }
}

function armSummary(delay) {
  if (timer) return;
  const wait = Math.max(0, delay);
  timer = setTimeout(() => {
    timer = null;
    if (extra <= 0) return;
    const count = extra;
    const sample = heldSample || { tx: null, network: null, amount: null, reason: null };
    extra = 0;
    heldSample = null;
    lastAt = Date.now();
    void writeAlert(sample, count, {}, { summary: true });
  }, wait);
  if (typeof timer.unref === 'function') timer.unref();
}

export function resetStuckPaymentAlertsForTests() {
  clearTimer();
  lastAt = 0;
  extra = 0;
  heldSample = null;
}

/** Emit the held summary without waiting out the minute. Tests use this. */
export function flushStuckPaymentAlert(deps = {}) {
  if (extra <= 0) return null;
  const count = extra;
  const sample = heldSample || { tx: null, network: null, amount: null, reason: null };
  extra = 0;
  heldSample = null;
  clearTimer();
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  lastAt = now;
  return writeAlert(sample, count, deps, { summary: true });
}

export async function alertStuckPayment(fields = {}, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  if (lastAt !== 0 && now - lastAt < WINDOW_MS) {
    extra += 1;
    heldSample = sampleOf(fields);
    if (typeof deps.now !== 'function') armSummary(WINDOW_MS - (now - lastAt));
    return;
  }
  const count = extra + 1;
  extra = 0;
  heldSample = null;
  clearTimer();
  lastAt = now;
  await writeAlert(sampleOf(fields), count, deps, { summary: false });
}
