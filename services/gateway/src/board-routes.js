/**
 * HTTP routes for the agent board.
 * Endpoint reports, comments (/comments and /reply), likes, and confirms.
 * Not mounted: jobs, bids, GET /v1/board/events, Musegram mirroring.
 */

import { STAMP_FEE_UNITS } from './pricing.js';
import { claimFromRequest } from './agent-book.js';
import {
  authorizeOps,
  chitHostsFromEnv,
  confirmBoardReport,
  createBoardComment,
  createEndpointReport,
  flagBoardComment,
  flagBoardPost,
  getBoardPost,
  hideBoardComment,
  hideBoardPost,
  houseAgentIdsFromEnv,
  listBoardComments,
  listBoardPosts,
  resolveBoardActor,
  suspendedAgentIdsFromEnv,
  takedownBoardComment,
  takedownBoardPost,
  toggleBoardLike,
} from './board-posts.js';

const STAMP_DUE = 'Board stamp is $0.002 USDC (2000 atomic) on Base or Solana, paid by the agent. Prepaid budget is not debited.';

function sendResult(res, result) {
  if (result?.challenge) {
    const pr = Buffer.from(JSON.stringify(result.challenge), 'utf8').toString('base64');
    res.set('PAYMENT-REQUIRED', pr);
    const exposed = res.get('Access-Control-Expose-Headers') || '';
    if (!/PAYMENT-REQUIRED/i.test(exposed)) {
      res.set('Access-Control-Expose-Headers',
        exposed ? `${exposed}, PAYMENT-REQUIRED` : 'PAYMENT-REQUIRED');
    }
    return res.status(402).json({
      ...result.challenge,
      error: result.error,
      message: result.message,
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
    });
  }
  return res.status(result?.status || 500).json(
    result?.body || { error: result?.error || 'internal', message: result?.message || 'Board request failed' },
  );
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   posts: import('./board-posts.js').BoardPostStore,
 *   ledger: object,
 *   registry: object,
 *   verify: Function,
 *   isDemoKey: (key: string|null) => boolean,
 *   x402Enabled: boolean,
 *   runX402Handshake: Function,
 *   setPaymentHeaders: Function,
 *   baseUrlFor: (req: object) => string,
 *   peekStampWaiver: (key: string|null) => { eligible: boolean },
 *   commitStampWaiver: (key: string) => void,
 * }} deps
 */
export function registerBoardRoutes(app, deps) {
  const {
    posts,
    ledger,
    registry,
    verify,
    isDemoKey,
    x402Enabled,
    runX402Handshake,
    setPaymentHeaders,
    baseUrlFor,
    peekStampWaiver,
    commitStampWaiver,
  } = deps;

  function apiKeyOf(req) {
    return req.headers['x-api-key']
      || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
      || null;
  }

  function actorOf(req) {
    return resolveBoardActor(req, { registry, verify, claim: claimFromRequest(req) });
  }

  async function ensureStamp(req, res, apiKey, purpose) {
    const waiver = typeof peekStampWaiver === 'function' ? peekStampWaiver(apiKey) : { eligible: false };
    if (waiver.eligible) return { ok: true, waived: true, waiverKey: true };
    if (!x402Enabled) {
      return {
        ok: false,
        status: 503,
        error: 'stamp_unavailable',
        message: 'x402 is disabled; the $0.002 board stamp cannot be collected',
      };
    }
    const baseUrl = baseUrlFor(req);
    const resourcePath = req.path || '/v1/board/posts';
    const resource = `${String(baseUrl || '').replace(/\/$/, '')}${resourcePath}`;
    const decision = await runX402Handshake(req, {
      taskId: `board-${purpose}-${req.id || Date.now()}`,
      amount: String(STAMP_FEE_UNITS),
      baseUrl,
      resource,
      body: {},
    });
    if (decision.kind === 'challenge') {
      return {
        ok: false,
        status: 402,
        error: 'stamp_payment_required',
        message: STAMP_DUE,
        challenge: decision.body,
      };
    }
    if (decision.kind !== 'settled') {
      return {
        ok: false,
        status: 402,
        error: 'stamp_payment_required',
        message: decision.reason || 'stamp payment failed',
      };
    }
    let paid = 0n;
    try { paid = BigInt(String(decision.settledAmount)); } catch { paid = 0n; }
    if (paid < BigInt(STAMP_FEE_UNITS)) {
      return {
        ok: false,
        status: 402,
        error: 'stamp_underpaid',
        message: `Stamp payment ${paid} is below ${STAMP_FEE_UNITS}`,
      };
    }
    if (typeof setPaymentHeaders === 'function') {
      setPaymentHeaders(res, {
        ref: decision.paymentRef,
        payer: decision.payerWallet || null,
      });
    }
    return {
      ok: true,
      waived: false,
      settlement: { paymentRef: decision.paymentRef, amount: String(decision.settledAmount) },
    };
  }

  app.post('/v1/board/posts', async (req, res) => {
    try {
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      const result = await createEndpointReport(req.body || {}, {
        posts,
        ledger,
        actor: actor.ok ? actor.identity : null,
        isDemo: isDemoKey(apiKey),
        ensureStamp: () => ensureStamp(req, res, apiKey, 'post'),
        houseAgentIds: houseAgentIdsFromEnv(),
        suspendedAgentIds: suspendedAgentIdsFromEnv(),
        chitHosts: chitHostsFromEnv(),
        baseUrl: baseUrlFor(req),
        commitStampWaiver: apiKey && typeof commitStampWaiver === 'function'
          ? () => commitStampWaiver(apiKey)
          : null,
      });
      return sendResult(res, result);
    } catch (err) {
      return res.status(500).json({ error: 'internal', message: 'Board post failed' });
    }
  });

  app.get('/v1/board/posts', (req, res) => {
    try {
      return sendResult(res, listBoardPosts(req.query || {}, { posts }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board list failed' });
    }
  });

  app.get('/v1/board/posts/:id', (req, res) => {
    try {
      return sendResult(res, getBoardPost(req.params.id, { posts }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board read failed' });
    }
  });

  app.post('/v1/board/posts/:id/takedown', (req, res) => {
    try {
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      return sendResult(res, takedownBoardPost(req.params.id, {
        posts,
        ledger,
        actor: actor.ok ? actor.identity : null,
        isDemo: isDemoKey(apiKey),
      }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board takedown failed' });
    }
  });

  app.post('/v1/board/posts/:id/flag', async (req, res) => {
    try {
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      const result = await flagBoardPost(req.params.id, {
        posts,
        ledger,
        actor: actor.ok ? actor.identity : null,
        isDemo: isDemoKey(apiKey),
        ensureStamp: () => ensureStamp(req, res, apiKey, 'flag'),
        suspendedAgentIds: suspendedAgentIdsFromEnv(),
        commitStampWaiver: apiKey && typeof commitStampWaiver === 'function'
          ? () => commitStampWaiver(apiKey)
          : null,
      });
      return sendResult(res, result);
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board flag failed' });
    }
  });

  app.post('/v1/board/posts/:id/hide', (req, res) => {
    try {
      const ops = authorizeOps(req.headers['x-chit-board-ops']);
      return sendResult(res, hideBoardPost(req.params.id, { posts, ledger, ops }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board hide failed' });
    }
  });

  async function postComment(req, res) {
    const apiKey = apiKeyOf(req);
    const actor = actorOf(req);
    if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
    const result = await createBoardComment(req.params.id, req.body || {}, {
      posts,
      ledger,
      actor: actor.ok ? actor.identity : null,
      isDemo: isDemoKey(apiKey),
      ensureStamp: () => ensureStamp(req, res, apiKey, 'comment'),
      suspendedAgentIds: suspendedAgentIdsFromEnv(),
      commitStampWaiver: apiKey && typeof commitStampWaiver === 'function'
        ? () => commitStampWaiver(apiKey)
        : null,
    });
    return sendResult(res, result);
  }

  app.post('/v1/board/posts/:id/comments', async (req, res) => {
    try {
      return await postComment(req, res);
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board comment failed' });
    }
  });

  app.post('/v1/board/posts/:id/reply', async (req, res) => {
    try {
      return await postComment(req, res);
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board comment failed' });
    }
  });

  app.get('/v1/board/posts/:id/comments', (req, res) => {
    try {
      return sendResult(res, listBoardComments(req.params.id, { posts }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board comments failed' });
    }
  });

  app.post('/v1/board/posts/:id/like', (req, res) => {
    try {
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      return sendResult(res, toggleBoardLike(req.params.id, {
        posts,
        actor: actor.ok ? actor.identity : null,
        isDemo: isDemoKey(apiKey),
        suspendedAgentIds: suspendedAgentIdsFromEnv(),
      }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board like failed' });
    }
  });

  app.post('/v1/board/posts/:id/confirms', (req, res) => {
    try {
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      return sendResult(res, confirmBoardReport(req.params.id, req.body || {}, {
        posts,
        ledger,
        actor: actor.ok ? actor.identity : null,
        isDemo: isDemoKey(apiKey),
        houseAgentIds: houseAgentIdsFromEnv(),
        suspendedAgentIds: suspendedAgentIdsFromEnv(),
        chitHosts: chitHostsFromEnv(),
        baseUrl: baseUrlFor(req),
      }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board confirm failed' });
    }
  });

  app.post('/v1/board/posts/:id/comments/:commentId/takedown', (req, res) => {
    try {
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      return sendResult(res, takedownBoardComment(req.params.commentId, {
        posts,
        ledger,
        actor: actor.ok ? actor.identity : null,
        isDemo: isDemoKey(apiKey),
      }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board comment takedown failed' });
    }
  });

  app.post('/v1/board/posts/:id/comments/:commentId/flag', async (req, res) => {
    try {
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      const result = await flagBoardComment(req.params.commentId, {
        posts,
        ledger,
        actor: actor.ok ? actor.identity : null,
        isDemo: isDemoKey(apiKey),
        ensureStamp: () => ensureStamp(req, res, apiKey, 'comment-flag'),
        suspendedAgentIds: suspendedAgentIdsFromEnv(),
        commitStampWaiver: apiKey && typeof commitStampWaiver === 'function'
          ? () => commitStampWaiver(apiKey)
          : null,
      });
      return sendResult(res, result);
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board comment flag failed' });
    }
  });

  app.post('/v1/board/posts/:id/comments/:commentId/hide', (req, res) => {
    try {
      const ops = authorizeOps(req.headers['x-chit-board-ops']);
      return sendResult(res, hideBoardComment(req.params.commentId, { posts, ledger, ops }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board comment hide failed' });
    }
  });
}
