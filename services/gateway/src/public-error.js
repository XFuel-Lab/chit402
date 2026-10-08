/**
 * Public 500 body. Detail stays in the server log.
 * Shape matches the public-surface helper: { error: 'internal', code }.
 */
import logger from './logger.js';

export function sendPublicInternal(res, err, label, code, req) {
  logger.error(
    { err: err?.message || String(err || ''), code, reqId: req?.id || null },
    label || 'internal',
  );
  if (res && typeof res.status === 'function') {
    return res.status(500).json({ error: 'internal', code: String(code || 'internal') });
  }
  return { error: 'internal', code: String(code || 'internal') };
}
