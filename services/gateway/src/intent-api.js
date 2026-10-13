/**
 * Intent routes.
 *
 * POST /intent is compiled off (INTENT_ISSUE_COMPILED). It is not in llms.txt.
 * POST /intent/:id/settle mints one v12 receipt per use only when the test
 * mint gate is on, and only for a #520-confirmed payment.
 * GET /intent/:id is public. An intent with no receipt is the same generic
 * 404 as an unknown id. The body does not echo the path.
 */
import {
  intentIssueEnabled,
  issueIntent,
  parseV12Uuid,
  publicIntentShell,
  settleIntent,
  v12MintEnabled,
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
 * @param {{ rateLimit?: Function, store?: ReturnType<typeof openIntentStore>, payment?: object }} [opts]
 */
export function registerIntentRoutes(app, { rateLimit = (_req, _res, next) => next(), store = null, payment = null } = {}) {
  let grants = store;
  const db = () => {
    if (!grants) grants = openIntentStore(resolveIntentStorePath());
    return grants;
  };

  app.post('/intent', rateLimit, (req, res) => {
    // INTENT_ISSUE_COMPILED is false, so this does not sign in prod or in tests.
    if (!intentIssueEnabled() || !v12MintEnabled()) return sendHidden(res);
    try {
      const result = issueIntent(db(), req.body || {});
      if (!result.ok && result.error === 'not_found') return sendHidden(res);
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.body);
    } catch {
      return sendJson(res, 500, { error: 'internal' });
    }
  });

  app.post('/intent/:id/settle', rateLimit, async (req, res) => {
    try {
      if (!v12MintEnabled()) return sendHidden(res);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await settleIntent(db(), {
        intent_id: req.params.id,
        payment_header: typeof body.payment_header === 'string' ? body.payment_header : null,
        nonce: typeof body.nonce === 'string' ? body.nonce : null,
      }, process.env, payment || {});
      if (!result.ok && (result.status === 404 || result.status === 403 || result.error === 'not_found' || result.error === 'v12_mint_disabled')) {
        return sendHidden(res);
      }
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
