/**
 * One alert when a pending settle_unconfirmed row is created.
 * The webhook URL is never written to a log line. The env name is.
 */
import logger from './logger.js';

export async function alertStuckPayment(fields = {}, deps = {}) {
  const tx = typeof fields.tx === 'string' && fields.tx.length > 0 && fields.tx.length <= 200
    ? fields.tx
    : null;
  const network = fields.network ? String(fields.network).slice(0, 80) : null;
  const amount = fields.amount != null && fields.amount !== '' ? String(fields.amount).slice(0, 40) : null;
  const reason = fields.reason ? String(fields.reason).slice(0, 80) : null;
  const log = deps.logger || logger;
  const configured = deps.webhookUrl !== undefined ? deps.webhookUrl : process.env.ALERT_WEBHOOK_URL;
  const url = typeof configured === 'string' ? configured.trim() : '';
  const body = { tx, network, amount, reason };
  log.error(
    { alert: 'stuck_payment', ...body, ...(url ? { webhook: 'ALERT_WEBHOOK_URL' } : {}) },
    'stuck payment',
  );
  if (!url) return;
  const post = deps.fetch || fetch;
  try {
    await post(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    log.error(
      { alert: 'stuck_payment', webhook: 'ALERT_WEBHOOK_URL', webhook_error: 'post_failed' },
      'stuck payment webhook failed',
    );
  }
}
