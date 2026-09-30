import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { AgentRegistry } from '../src/agent-registry.js';
import { UsageSettledLedger, entryQualifiesForCap, BOOK_EVIDENCE, deriveEvidence } from '../src/usage-settled.js';
import { bindBookVerifier } from '../src/agent-book.js';
import { BoardJobStore, JOB_BUDGET_MAX, authorizeInbound, awardBoardBid, buildJobPayoutReceipt, challengeBoardJob, createBoardJob, deliverBoardJob, feeLegAmount, getAgentRecord, getBoardJob, ingestExternalCompletion, payBoardJob, placeBoardBid, revealBoardJob, sha256Prefixed } from '../src/board-jobs.js';
import { registerBoardJobRoutes } from '../src/board-job-routes.js';
import { decodeReceiptClaims } from '../src/receipt.js';

const WALLET = `0x${'ab'.repeat(20)}`;
const OTHER = `0x${'cd'.repeat(20)}`;
const TREASURY = `0x${'11'.repeat(20)}`;

function world() {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const jobs = new BoardJobStore();
  const poster = registry.allocate();
  registry.bindWallet(poster.agent_id, { agentWallet: WALLET });
  const bidder = registry.allocate();
  registry.bindWallet(bidder.agent_id, { agentWallet: OTHER });
  return { registry, ledger, jobs, poster, bidder };
}

function stampOk() {
  let calls = 0;
  return {
    calls: () => calls,
    async ensure() {
      calls += 1;
      return {
        ok: true,
        waived: false,
        settlement: { paymentRef: `base:stamp${calls}${crypto.randomBytes(3).toString('hex')}`, amount: '2000', payer: WALLET },
      };
    },
  };
}

function deps(ctx, actor, extra = {}) {
  return {
    jobs: ctx.jobs,
    ledger: ctx.ledger,
    registry: ctx.registry,
    actor,
    baseUrl: 'https://api.chit402.com',
    reqHost: 'api.chit402.com',
    chitPayTo: TREASURY,
    ...extra,
  };
}

function futureDeadline() {
  return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
}

async function openJob(ctx, stamp = stampOk()) {
  const created = await createBoardJob({
    text: 'Summarize the receipt and stop.',
    budget: '5000000',
    deadline: futureDeadline(),
    acceptance_test: 'Names the amount.',
  }, deps(ctx, ctx.poster, { ensureStamp: stamp.ensure }));
  assert.equal(created.status, 201, created.message);
  return { created, stamp, id: created.body.job.id };
}

function legs() {
  let header = false;
  return {
    arm() { header = true; },
    async settle(spec) {
      if (spec.challengeOnly || !header) {
        return {
          ok: false,
          status: 402,
          error: 'job_payment_required',
          message: 'payment required',
          challenge: {
            x402Version: 2,
            leg: spec.leg,
            payTo: spec.payTo,
            maxAmountRequired: String(spec.amount),
          },
        };
      }
      header = false;
      return {
        ok: true,
        settlement: {
          paymentRef: `base:${spec.leg}${crypto.randomBytes(4).toString('hex')}`,
          amount: String(spec.amount),
          payer: WALLET,
          payTo: spec.payTo,
        },
      };
    },
  };
}

test('job cap is $25 and the close fee is the stamp plus 1%', () => {
  assert.equal(JOB_BUDGET_MAX, 25_000_000n);
  assert.equal(feeLegAmount(1_000_000n), 12_000n);
  assert.equal(feeLegAmount('1000000'), 12000n);
});

test('post, bid, award, deliver, then one leg does not issue a receipt', async () => {
  const ctx = world();
  const stamp = stampOk();
  const { id } = await openJob(ctx, stamp);
  assert.equal(stamp.calls(), 1);

  const secret = await createBoardJob({
    text: 'sk-live-secret-key',
    budget: '1000',
    deadline: futureDeadline(),
  }, deps(ctx, ctx.poster, { ensureStamp: stamp.ensure }));
  assert.equal(secret.status, 400);
  assert.equal(secret.error, 'secret_rejected');
  assert.equal(stamp.calls(), 1);

  const over = await createBoardJob({
    text: 'too big',
    budget: '26000000',
    deadline: futureDeadline(),
  }, deps(ctx, ctx.poster, { ensureStamp: stamp.ensure }));
  assert.equal(over.status, 400);
  assert.equal(over.error, 'budget_cap');

  const self = await placeBoardBid(id, { price: '1000000', pitch: 'I can do it' }, deps(ctx, ctx.poster, { ensureStamp: stamp.ensure }));
  assert.equal(self.status, 409);
  assert.equal(stamp.calls(), 1);

  const bid = await placeBoardBid(id, { price: '1000000', pitch: 'Two pages, plain text.' }, deps(ctx, ctx.bidder, { ensureStamp: stamp.ensure }));
  assert.equal(bid.status, 201);
  const bidId = bid.body.bid_id;
  const revise = await placeBoardBid(id, { price: '900000', pitch: 'Revised once.' }, deps(ctx, ctx.bidder, { ensureStamp: stamp.ensure }));
  assert.equal(revise.status, 200);
  const again = await placeBoardBid(id, { price: '800000', pitch: 'no' }, deps(ctx, ctx.bidder, { ensureStamp: stamp.ensure }));
  assert.equal(again.status, 409);

  const awarded = awardBoardBid(id, { bid_id: bidId }, deps(ctx, ctx.poster));
  assert.equal(awarded.status, 200);
  assert.equal(awarded.body.job.status, 'awarded');
  assert.equal(awarded.body.job.bids.filter((b) => b.status === 'awarded').length, 1);

  const early = await payBoardJob(id, deps(ctx, ctx.poster, { settleLeg: async () => ({ ok: true, settlement: {} }) }));
  assert.equal(early.status, 409);
  assert.equal(early.error, 'hash_required');

  const output = 'the amount is one dollar';
  const hash = sha256Prefixed(output);
  const delivered = deliverBoardJob(id, { output_sha256: hash, preview: 'one dollar' }, deps(ctx, ctx.bidder));
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.job.output_commitment.hash, hash);
  assert.equal(delivered.body.job.payout, null);

  const pay = legs();
  const challenge = await payBoardJob(id, deps(ctx, ctx.poster, { settleLeg: pay.settle }));
  assert.equal(challenge.status, 402);
  assert.equal(challenge.challenge.payTo, OTHER);
  pay.arm();
  const winnerOnly = await payBoardJob(id, deps(ctx, ctx.poster, { settleLeg: pay.settle }));
  assert.equal(winnerOnly.status, 402);
  assert.equal(winnerOnly.error, 'fee_payment_required');
  assert.equal(winnerOnly.winner_settled, true);
  const mid = getBoardJob(id, { jobs: ctx.jobs });
  assert.equal(mid.body.job.payout, null);
  assert.equal(mid.body.job.status, 'delivered');
});

test('both legs issue one signed receipt on both books and reveal checks the hash', async () => {
  const ctx = world();
  const { id } = await openJob(ctx);
  const bid = await placeBoardBid(id, { price: '1000000', pitch: 'ready' }, deps(ctx, ctx.bidder, { ensureStamp: stampOk().ensure }));
  awardBoardBid(id, { bid_id: bid.body.bid_id }, deps(ctx, ctx.poster));
  const output = 'delivered work';
  const hash = sha256Prefixed(output);
  deliverBoardJob(id, { output_sha256: hash, preview: 'work' }, deps(ctx, ctx.bidder));

  const pay = legs();
  pay.arm();
  const first = await payBoardJob(id, deps(ctx, ctx.poster, { settleLeg: pay.settle }));
  assert.equal(first.status, 402);
  pay.arm();
  const stored = [];
  const paid = await payBoardJob(id, deps(ctx, ctx.poster, {
    settleLeg: pay.settle,
    persistTask: (task) => stored.push(task),
  }));
  assert.equal(paid.status, 200, paid.message);
  const payout = paid.body.payout;
  assert.equal(payout.payer_wallet.toLowerCase(), WALLET);
  assert.equal(payout.winner_wallet.toLowerCase(), OTHER);
  assert.match(payout.payment_ref, /^base:winner/);
  assert.equal(payout.amount, '1000000');
  assert.equal(payout.output_commitment.hash, hash);
  assert.equal(payout.output_commitment.kind, 'sha256');
  assert.equal(payout.verify_url, `https://api.chit402.com/receipt/${payout.task_id.replace(/^xfuel-/, 'chit-')}`);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].intent.paymentRef, payout.payment_ref);
  assert.equal(stored[0].outputHash, hash);

  const claims = decodeReceiptClaims(paid.body.receipt);
  assert.equal(claims.caller_binding.payer_wallet.toLowerCase(), WALLET);
  assert.equal(claims.payment.ref, payout.payment_ref);
  assert.equal(claims.payment.gross_amount, '1000000');
  assert.equal(claims.payment.payee.toLowerCase(), OTHER);
  assert.equal(claims.fulfillment.output_commitment.hash, hash);
  assert.ok(paid.body.receipt.issuer_signature.jws);

  const closes = ctx.ledger.entries.filter((e) => e.event === 'board_close');
  assert.equal(closes.length, 2);
  assert.equal(closes[0].board.verify_url, closes[1].board.verify_url);
  assert.equal(closes[0].board.verify_url, payout.verify_url);
  for (const row of closes) {
    assert.equal(entryQualifiesForCap(row), false);
    assert.equal(deriveEvidence(row), BOOK_EVIDENCE.BOARD_CLOSE);
  }
  const publicJob = getBoardJob(id, { jobs: ctx.jobs }).body.job;
  assert.equal(publicJob.payout.verify_url, payout.verify_url);
  assert.equal(JSON.stringify(publicJob).includes(output), false);

  const bad = revealBoardJob(id, { output: 'other work' }, deps(ctx, ctx.bidder));
  assert.equal(bad.status, 409);
  const closed = revealBoardJob(id, { output }, deps(ctx, ctx.bidder));
  assert.equal(closed.status, 200);
  assert.equal(closed.body.job.status, 'closed');
  assert.equal(closed.body.job.outcome, 'paid');
  assert.equal(closed.body.payout.verify_url, payout.verify_url);

  const again = await payBoardJob(id, deps(ctx, ctx.poster, { settleLeg: pay.settle }));
  assert.equal(again.body.idempotent, true);
});

test('a challenged job counts as paid, not delivered, and a mutual pair is related', async () => {
  const ctx = world();
  const { id } = await openJob(ctx);
  const bid = await placeBoardBid(id, { price: '1000000' }, deps(ctx, ctx.bidder, { ensureStamp: stampOk().ensure }));
  awardBoardBid(id, { bid_id: bid.body.bid_id }, deps(ctx, ctx.poster));
  const hash = sha256Prefixed('hidden');
  deliverBoardJob(id, { output_sha256: hash }, deps(ctx, ctx.bidder));
  const pay = legs();
  pay.arm();
  await payBoardJob(id, deps(ctx, ctx.poster, { settleLeg: pay.settle }));
  pay.arm();
  await payBoardJob(id, deps(ctx, ctx.poster, { settleLeg: pay.settle }));
  const challenged = challengeBoardJob(id, deps(ctx, ctx.poster));
  assert.equal(challenged.body.job.outcome, 'paid_not_delivered');
  const card = getAgentRecord(ctx.bidder.agent_id, {}, deps(ctx, null));
  assert.equal(card.body.record.paid_not_delivered, 1);
  assert.equal(card.body.record.jobs_won_independent, 0);

  revealBoardJob(id, { output: 'hidden' }, deps(ctx, ctx.bidder));
  const won = getAgentRecord(ctx.bidder.agent_id, {}, deps(ctx, null));
  assert.equal(won.body.record.jobs_won_independent, 1);
  assert.equal(won.body.record.earned_range, '$0–10');

  const back = await createBoardJob({
    text: 'return job',
    budget: '2000000',
    deadline: futureDeadline(),
  }, deps(ctx, ctx.bidder, { ensureStamp: stampOk().ensure }));
  const backBid = await placeBoardBid(back.body.job.id, { price: '1000000' }, deps(ctx, ctx.poster, { ensureStamp: stampOk().ensure }));
  const awarded = awardBoardBid(back.body.job.id, { bid_id: backBid.body.bid_id }, deps(ctx, ctx.bidder));
  assert.equal(awarded.body.job.related, true);
});

test('inbound completion returns a Chit receipt and replays the same verify_url', () => {
  const ctx = world();
  const prev = process.env.CHIT_BOARD_INBOUND_SECRET;
  process.env.CHIT_BOARD_INBOUND_SECRET = 'inbound-test-secret';
  try {
    const denied = ingestExternalCompletion({
      source: 'daydreams',
      external_id: 'task-1',
      payer: WALLET,
      payee: OTHER,
      amount: '2500000',
      payment_ref: 'base:0xabc123',
      output_hash: sha256Prefixed('market output'),
    }, deps(ctx, null, { inboundAuth: authorizeInbound('nope') }));
    assert.equal(denied.status, 403);

    const hash = sha256Prefixed('market output');
    const body = {
      source: 'agent.market',
      external_id: 'near-9',
      payer: WALLET,
      payee: OTHER,
      amount: '2500000',
      payment_tx: '5solanaTx111',
      network: 'solana',
      output_hash: hash,
    };
    const created = ingestExternalCompletion(body, deps(ctx, null, { inboundAuth: authorizeInbound('inbound-test-secret') }));
    assert.equal(created.status, 201);
    assert.match(created.body.verify_url, /^https:\/\/api\.chit402\.com\/receipt\//);
    const claims = decodeReceiptClaims(created.body.receipt);
    assert.equal(claims.payment.ref, 'solana:5solanaTx111');
    assert.equal(claims.payment.gross_amount, '2500000');
    assert.equal(claims.caller_binding.payer_wallet.toLowerCase(), WALLET);
    assert.equal(claims.payment.payee.toLowerCase(), OTHER);
    assert.equal(claims.fulfillment.output_commitment.hash, hash);
    const replay = ingestExternalCompletion(body, deps(ctx, null, { inboundAuth: authorizeInbound('inbound-test-secret') }));
    assert.equal(replay.status, 200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(replay.body.payout.verify_url, created.body.verify_url);
    const closes = ctx.ledger.entries.filter((e) => e.event === 'board_close');
    assert.equal(closes.length, 2);
  } finally {
    if (prev == null) delete process.env.CHIT_BOARD_INBOUND_SECRET;
    else process.env.CHIT_BOARD_INBOUND_SECRET = prev;
  }
});

test('buildJobPayoutReceipt does not invent a new signed schema', () => {
  const built = buildJobPayoutReceipt({
    taskId: 'xfuel-job-example',
    payerWallet: WALLET,
    paymentRef: 'base:0xexample',
    amount: '1000000',
    winnerWallet: OTHER,
    outputHash: sha256Prefixed('example'),
    baseUrl: 'https://api.chit402.com',
    reqHost: 'api.chit402.com',
  });
  const claims = decodeReceiptClaims(built.receipt);
  assert.equal(claims.iss, 'chit402');
  assert.equal(Object.prototype.hasOwnProperty.call(claims, 'merkle_witness'), false);
  assert.ok(claims.fulfillment.output_commitment);
  assert.equal(built.receipt.verify_url, 'https://api.chit402.com/receipt/chit-job-example');
});

test('HTTP pay challenge names the winner wallet, then the treasury', async () => {
  const ctx = world();
  const { id } = await openJob(ctx);
  const bid = await placeBoardBid(id, { price: '1000000', pitch: 'ok' }, deps(ctx, ctx.bidder, { ensureStamp: stampOk().ensure }));
  awardBoardBid(id, { bid_id: bid.body.bid_id }, deps(ctx, ctx.poster));
  deliverBoardJob(id, { output_sha256: sha256Prefixed('http') }, deps(ctx, ctx.bidder));

  let calls = 0;
  const app = express();
  app.use(express.json());
  registerBoardJobRoutes(app, {
    jobs: ctx.jobs,
    ledger: ctx.ledger,
    registry: ctx.registry,
    verify: bindBookVerifier(ctx.registry),
    isDemoKey: () => false,
    x402Enabled: true,
    runX402Handshake: async (req, spec) => {
      calls += 1;
      const header = req.headers?.['payment-signature'] || req.headers?.['x-payment'];
      if (!header) {
        return { kind: 'challenge', body: { x402Version: 2, accepts: [{ payTo: spec.payTo, maxAmountRequired: spec.amount }] } };
      }
      return {
        kind: 'settled',
        paymentRef: `base:http${calls}`,
        settledAmount: spec.amount,
        payerWallet: WALLET,
        payTo: spec.payTo,
      };
    },
    setPaymentHeaders: () => {},
    baseUrlFor: () => 'https://api.chit402.com',
    peekStampWaiver: () => ({ eligible: false }),
    commitStampWaiver: () => {},
    chitPayTo: TREASURY,
    persistTask: () => {},
    signingSecret: null,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${base}/v1/board/jobs/${id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XFuel-Session': ctx.poster.session },
      body: '{}',
    });
    assert.equal(first.status, 402);
    const firstBody = await first.json();
    assert.equal(firstBody.accepts[0].payTo, OTHER);
    assert.equal(firstBody.legs.winner.settled, false);

    const second = await fetch(`${base}/v1/board/jobs/${id}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XFuel-Session': ctx.poster.session,
        'PAYMENT-SIGNATURE': 'winner-proof',
      },
      body: '{}',
    });
    assert.equal(second.status, 402);
    const secondBody = await second.json();
    assert.equal(secondBody.winner_settled, true);
    assert.equal(secondBody.legs.fee.pay_to, TREASURY);
    assert.equal(secondBody.accepts[0].payTo, TREASURY);
  } finally {
    server.close();
  }
});

test('job store reloads from disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-jobs-'));
  const ctx = world();
  ctx.jobs = new BoardJobStore({ dir, persist: true });
  const { id } = await openJob(ctx);
  const reloaded = new BoardJobStore({ dir, persist: true });
  assert.equal(reloaded.get(id).untrusted_text, 'Summarize the receipt and stop.');
  fs.rmSync(dir, { recursive: true, force: true });
});
