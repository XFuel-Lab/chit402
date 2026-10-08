/**
 * HTTP routes for the verified bid board and inbound job receipts.
 */

import { STAMP_FEE_UNITS } from './pricing.js';
import config from './config.js';
import { isBindingRefusal, paymentErrorStatus, bindingEnforced, samePayee } from './x402-flags.js';
import { claimFromRequest } from './agent-book.js';
import {
  authorizeInbound,
  awardBoardBid,
  challengeBoardJob,
  createBoardJob,
  deliverBoardJob,
  getAgentRecord,
  getBoardJob,
  ingestExternalCompletion,
  listBoardJobs,
  payBoardJob,
  placeBoardBid,
  revealBoardJob,
} from './board-jobs.js';
import { houseAgentIdsFromEnv, resolveBoardActor, suspendedAgentIdsFromEnv } from './board-posts.js';

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
      ...(result.body && typeof result.body === 'object' ? result.body : {}),
      error: result.error,
      message: result.message,
      winner_settled: result.winner_settled === true ? true : undefined,
    });
  }
  return res.status(result?.status || 500).json(
    result?.body || {
      error: result?.error || 'internal',
      ...(result?.code ? { code: result.code } : {}),
      message: result?.message || 'Board job failed',
    },
  );
}

function paymentHeaderPresent(req) {
  const headers = req.headers || {};
  return Boolean(headers['payment-signature'] || headers['x-payment'] || headers['PAYMENT-SIGNATURE']);
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerBoardJobRoutes(app, deps) {
  const {
    jobs,
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
    chitPayTo,
    persistTask,
    signingSecret,
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
      return { ok: false, status: 503, error: 'stamp_unavailable', message: 'x402 is disabled; the $0.002 board stamp cannot be collected' };
    }
    const baseUrl = baseUrlFor(req);
    const resource = `${String(baseUrl || '').replace(/\/$/, '')}${req.path || '/v1/board/jobs'}`;
    const decision = await runX402Handshake(req, {
      taskId: `board-${purpose}-${req.id || Date.now()}`,
      amount: String(STAMP_FEE_UNITS),
      baseUrl,
      resource,
      body: {},
    });
    if (decision.kind === 'challenge') {
      return { ok: false, status: 402, error: 'stamp_payment_required', message: STAMP_DUE, challenge: decision.body };
    }
    if (decision.kind !== 'settled' || (bindingEnforced(config.x402) && decision.confirmed !== true)) {
      const code = decision.code || decision.reason;
      if (isBindingRefusal(code)) {
        return { ok: false, status: paymentErrorStatus(code), error: code, code };
      }
      return { ok: false, status: 402, error: 'stamp_payment_required', code: 'verify_failed' };
    }
    let paid = 0n;
    try { paid = BigInt(String(decision.settledAmount)); } catch { paid = 0n; }
    const house = config.x402?.payTo;
    const solHouse = config.x402?.solana?.payTo;
    const payeeOk = (house && samePayee(decision.payTo, house)) || (solHouse && decision.payTo === solHouse);
    if (paid < BigInt(STAMP_FEE_UNITS) || !payeeOk) {
      return { ok: false, status: 402, error: 'stamp_underpaid', code: 'stamp_underpaid' };
    }
    if (typeof setPaymentHeaders === 'function') {
      setPaymentHeaders(res, {
        ref: decision.paymentRef,
        payer: decision.payerWallet || null,
        resourceUrl: resource,
      });
    }
    return { ok: true, waived: false, settlement: { paymentRef: decision.paymentRef, amount: String(decision.settledAmount), payer: decision.payerWallet || null } };
  }

  function jobDeps(req, actor, extra = {}) {
    return {
      jobs,
      posts,
      ledger,
      registry,
      actor,
      houseAgentIds: houseAgentIdsFromEnv(),
      suspendedAgentIds: suspendedAgentIdsFromEnv(),
      baseUrl: baseUrlFor(req),
      reqHost: typeof req.get === 'function' ? req.get('host') : null,
      chitPayTo: typeof chitPayTo === 'function' ? chitPayTo() : chitPayTo,
      persistTask,
      signingSecret,
      ...extra,
    };
  }

  function requireJobs(res) {
    if (jobs) return true;
    res.status(503).json({ error: 'jobs_unavailable', message: 'The bid board is not configured' });
    return false;
  }

  async function settleLeg(req, spec) {
    if (typeof deps.settleLeg === 'function') return deps.settleLeg(spec);
    if (!x402Enabled || typeof runX402Handshake !== 'function') {
      return { ok: false, status: 503, error: 'payment_unavailable', message: 'x402 is disabled; the job cannot be paid' };
    }
    const headers = { ...(req.headers || {}) };
    if (spec.challengeOnly) {
      delete headers['payment-signature'];
      delete headers['x-payment'];
      delete headers['PAYMENT-SIGNATURE'];
    }
    const shadow = {
      headers,
      body: {},
      path: req.path,
      id: req.id,
      params: req.params,
      get(name) {
        const key = String(name || '').toLowerCase();
        if (key === 'host' && typeof req.get === 'function') return req.get('host');
        return headers[key];
      },
    };
    const baseUrl = baseUrlFor(req);
    const resource = `${String(baseUrl || '').replace(/\/$/, '')}${req.path || ''}`;
    const decision = await runX402Handshake(shadow, {
      taskId: `board-job-${spec.leg}-${req.params?.id || 'pay'}`,
      amount: String(spec.amount),
      payTo: spec.payTo,
      expectedPayer: spec.expectedPayer,
      baseUrl,
      resource,
      body: {},
      evmOnly: true,
      strictTaskId: true,
    });
    if (decision.kind === 'challenge') {
      return {
        ok: false,
        status: 402,
        error: spec.leg === 'fee' ? 'fee_payment_required' : 'job_payment_required',
        message: spec.leg === 'fee'
          ? 'Pay the Chit fee leg (stamp plus 1%). payTo is the Chit treasury.'
          : 'Pay the bid price. payTo is the winner wallet. Chit does not hold this payment.',
        challenge: decision.body,
      };
    }
    if (decision.kind !== 'settled' || (bindingEnforced(config.x402) && decision.confirmed !== true)) {
      const code = decision.code || decision.reason;
      if (isBindingRefusal(code)) {
        return { ok: false, status: paymentErrorStatus(code), error: code, code };
      }
      return { ok: false, status: 402, error: 'job_payment_required', code: 'verify_failed' };
    }
    let legPaid = 0n;
    try { legPaid = BigInt(String(decision.settledAmount)); } catch { legPaid = 0n; }
    if (legPaid < BigInt(String(spec.amount)) || !samePayee(decision.payTo, spec.payTo)) {
      return { ok: false, status: 402, error: 'stamp_underpaid', code: 'stamp_underpaid' };
    }
    if (spec.expectedPayer && !samePayee(decision.payerWallet, spec.expectedPayer)) {
      return { ok: false, status: 403, error: 'payer_mismatch', code: 'payer_mismatch' };
    }
    if (req.res && typeof setPaymentHeaders === 'function') {
      setPaymentHeaders(req.res, {
        ref: decision.paymentRef,
        payer: decision.payerWallet || null,
        resourceUrl: resource,
      });
    }
    return {
      ok: true,
      settlement: {
        paymentRef: decision.paymentRef,
        amount: String(decision.settledAmount),
        payer: decision.payerWallet || null,
        payTo: decision.payTo || spec.payTo,
      },
    };
  }

app.post('/v1/board/jobs', async (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      const result = await createBoardJob(req.body || {}, jobDeps(req, actor.ok ? actor.identity : null, {
        ensureStamp: () => ensureStamp(req, res, apiKey, 'job'),
      }));
      if (result.ok && apiKey && result.body && typeof commitStampWaiver === 'function') {
        const waiver = typeof peekStampWaiver === 'function' ? peekStampWaiver(apiKey) : { eligible: false };
        if (waiver.eligible) commitStampWaiver(apiKey);
      }
      return sendResult(res, result);
    } catch (err) {
      return res.status(500).json({ error: 'internal', message: 'Board job post failed' });
    }
  });

  app.get('/v1/board/jobs', (req, res) => {
    try {
      if (!requireJobs(res)) return;
      return sendResult(res, listBoardJobs(req.query || {}, { jobs }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board job list failed' });
    }
  });

  app.get('/v1/board/jobs/:id', (req, res) => {
    try {
      if (!requireJobs(res)) return;
      return sendResult(res, getBoardJob(req.params.id, { jobs }));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board job read failed' });
    }
  });

  app.post('/v1/board/jobs/:id/bid', async (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const apiKey = apiKeyOf(req);
      const actor = actorOf(req);
      if (!isDemoKey(apiKey) && !actor.ok) return sendResult(res, actor);
      const result = await placeBoardBid(req.params.id, req.body || {}, jobDeps(req, actor.ok ? actor.identity : null, {
        ensureStamp: () => ensureStamp(req, res, apiKey, 'bid'),
      }));
      return sendResult(res, result);
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board bid failed' });
    }
  });

  app.post('/v1/board/jobs/:id/pick', (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const actor = actorOf(req);
      if (!actor.ok) return sendResult(res, actor);
      return sendResult(res, awardBoardBid(req.params.id, req.body || {}, jobDeps(req, actor.identity)));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board award failed' });
    }
  });

  app.post('/v1/board/jobs/:id/deliver', (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const actor = actorOf(req);
      if (!actor.ok) return sendResult(res, actor);
      return sendResult(res, deliverBoardJob(req.params.id, req.body || {}, jobDeps(req, actor.identity)));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board deliver failed' });
    }
  });

  app.post('/v1/board/jobs/:id/pay', async (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const actor = actorOf(req);
      if (!actor.ok) return sendResult(res, actor);
      req.res = res;
      const result = await payBoardJob(req.params.id, jobDeps(req, actor.identity, {
        settleLeg: (spec) => settleLeg(req, spec),
      }));
      return sendResult(res, result);
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board pay failed' });
    }
  });

  app.post('/v1/board/jobs/:id/reveal', (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const actor = actorOf(req);
      if (!actor.ok) return sendResult(res, actor);
      return sendResult(res, revealBoardJob(req.params.id, req.body || {}, jobDeps(req, actor.identity)));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board reveal failed' });
    }
  });

  app.post('/v1/board/jobs/:id/challenge', (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const actor = actorOf(req);
      if (!actor.ok) return sendResult(res, actor);
      return sendResult(res, challengeBoardJob(req.params.id, jobDeps(req, actor.identity)));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Board challenge failed' });
    }
  });

  app.get('/v1/agents/:agent_id/record', (req, res) => {
    try {
      if (typeof deps.gateAgentRecord === 'function') return deps.gateAgentRecord(req, res);
      if (!requireJobs(res)) return;
      const actor = actorOf(req);
      return sendResult(res, getAgentRecord(req.params.agent_id, req.query || {}, jobDeps(req, actor.ok ? actor.identity : null)));
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Record card failed' });
    }
  });

  app.post('/v1/board/inbound/completions', (req, res) => {
    try {
      if (!requireJobs(res)) return;
      const header = req.headers['x-chit-board-inbound']
        || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const result = ingestExternalCompletion(req.body || {}, jobDeps(req, null, {
        inboundAuth: authorizeInbound(header),
      }));
      return sendResult(res, result);
    } catch {
      return res.status(500).json({ error: 'internal', message: 'Inbound completion failed' });
    }
  });
}

