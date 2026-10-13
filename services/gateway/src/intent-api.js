/**
 * Intent routes.
 *
 * POST /intent issues chit402.intent.v1.
 * POST /intent/:id/settle mints one v12 receipt per use. Minting is off
 * unless RECEIPT_V12_MINT=true outside production.
 * GET /intent/:id is public. An intent with no receipt is the same generic
 * 404 as an unknown id. The body does not echo the path.
 */
import {
  issueIntent,
  parseV12Uuid,
  publicIntentShell,
  settleIntent,
} from './intent-record.js';
import { openIntentStore, resolveIntentStorePath } from './intent-store.js';

const NOT_FOUND_BODY = '{"error":"not_found"}';

function sendHidden(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.status(404);
  return res.end(NOT_FOUND_BODY);
}

function sendJson(res, status, body) {
  res.set('Cache-Control', 'private, no-store');
  return res.status(status).json(body);
}

/**
 * @param {import('express').Express} app
 * @param {{ rateLimit?: Function, store?: ReturnType<typeof openIntentStore> }} [opts]
 */
export function registerIntentRoutes(app, { rateLimit = (_req, _res, next) => next(), store = null } = {}) {
  let grants = store;
  const db = () => {
    if (!grants) grants = openIntentStore(resolveIntentStorePath());
    return grants;
  };

  app.post('/intent', rateLimit, (req, res) => {
    try {
      const result = issueIntent(db(), req.body || {});
      if (!result.ok && result.error === 'not_found') return sendHidden(res);
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.body);
    } catch {
      return sendJson(res, 500, { error: 'internal' });
    }
  });

  app.post('/intent/:id/settle', rateLimit, (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = settleIntent(db(), { ...body, intent_id: req.params.id });
      if (!result.ok && (result.status === 404 || result.error === 'not_found')) return sendHidden(res);
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.body);
    } catch {
      return sendJson(res, 500, { error: 'internal' });
    }
  });

  app.get('/intent/:id', rateLimit, (req, res) => {
    try {
      const parsed = parseV12Uuid(req.params.id);
      if (!parsed) return sendHidden(res);
      const grant = db().getGrant(parsed.uuid);
      const links = grant ? db().receiptsFor(parsed.uuid) : [];
      if (!grant || links.length === 0) return sendHidden(res);
      const link = links[links.length - 1];
      return sendJson(res, 200, publicIntentShell(grant.record, {
        receiptId: link.receiptId,
        useIndex: link.useIndex,
      }));
    } catch {
      return sendJson(res, 500, { error: 'internal' });
    }
  });

  return grants;
}
