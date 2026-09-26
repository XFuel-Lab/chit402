import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { AgentRegistry } from '../src/agent-registry.js';
import { UsageSettledLedger, entryQualifiesForCap, BOOK_EVIDENCE } from '../src/usage-settled.js';
import { bindBookVerifier, bookHmacPayload } from '../src/agent-book.js';
import { BoardPostStore, PUBLIC_LIVE_KEYS, createEndpointReport, findSecret, flagBoardPost, getBoardPost, hideBoardPost, listBoardPosts, planHouseSeed, takedownBoardPost, toPublicPost } from '../src/board-posts.js';
import { registerBoardRoutes } from '../src/board-routes.js';

const WALLET = `0x${'ab'.repeat(20)}`;
const OTHER_WALLET = `0x${'cd'.repeat(20)}`;
const CHIT = new Set(['api.chit402.com', 'api.xfuel.app']);
const HEX64 = 'ab'.repeat(32);

function world() {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const posts = new BoardPostStore();
  const agent = registry.allocate();
  registry.bindWallet(agent.agent_id, { agentWallet: WALLET });
  const other = registry.allocate();
  registry.bindWallet(other.agent_id, { agentWallet: OTHER_WALLET });
  return { registry, ledger, posts, agent, other };
}

function addChitReceipt(ledger, agentId, { taskId = 'chit-task-1', ref = `base:0x${'11'.repeat(32)}`, amount = '2000', payer = WALLET } = {}) {
  const appended = ledger.append({
    task_id: taskId,
    payment: {
      rail: 'usdc',
      ref,
      collected: true,
      gross_amount: amount,
      payer,
    },
    route: { hub: 'theta', model: 'theta/glm_5_2' },
  }, { agentId, payer });
  assert.equal(appended.ok, true, appended.reason);
  return appended.entry;
}

function addForeignReceipt(ledger, agentId, {
  taskId = 'foreign-task-1',
  ref = `base:0x${'22'.repeat(32)}`,
  amount = '9000',
  payer = WALLET,
  payTo = `0x${'11'.repeat(20)}`,
  resource = 'https://shop.example/v1/chat',
} = {}) {
  const appended = ledger.append({
    task_id: taskId,
    foreign_x402: true,
    source: 'foreign_ingest',
    payment: {
      rail: 'usdc',
      ref,
      collected: true,
      gross_amount: amount,
      payer,
      payTo,
    },
    route: { hub: 'shop.example', model: '/v1/chat', resource },
  }, { agentId, payer });
  assert.equal(appended.ok, true, appended.reason);
  return appended.entry;
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
        settlement: { paymentRef: `base:stamp-${calls}-${crypto.randomBytes(4).toString('hex')}`, amount: '2000' },
      };
    },
  };
}

async function postReport(ctx, body, { actor = ctx.agent, ensureStamp, houseAgentIds, suspendedAgentIds } = {}) {
  const stamp = ensureStamp || stampOk().ensure;
  return createEndpointReport(body, {
    posts: ctx.posts,
    ledger: ctx.ledger,
    actor,
    ensureStamp: stamp,
    chitHosts: CHIT,
    baseUrl: 'https://api.chit402.com',
    houseAgentIds: houseAgentIds || [],
    suspendedAgentIds: suspendedAgentIds || [],
  });
}

test('findSecret catches api keys, bearer tokens, PEM, and 64-hex keys', () => {
  assert.equal(findSecret('paid fine'), null);
  assert.equal(findSecret('model sk-proj-abc123 leaked'), 'api_key');
  assert.equal(findSecret('Authorization: Bearer abcdefghijklmnop'), 'bearer');
  assert.equal(findSecret('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'), 'pem');
  assert.equal(findSecret(`tx ${HEX64}`), 'hex_key');
  assert.equal(findSecret(`tx 0x${HEX64}`), 'hex_key');
  assert.equal(findSecret('short deadbeef'), null);
});

test('possession gate: receipt on another book is 403 and does not stamp', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.other.agent_id, { ref: 'base:0xother' });
  const stamp = stampOk();
  const missing = await postReport(ctx, {
    receipt_ref: 'base:0xmissing',
    endpoint: 'https://api.chit402.com/v1/chat/completions',
    outcome: 'success',
  }, { ensureStamp: stamp.ensure });
  assert.equal(missing.status, 403);
  assert.equal(missing.error, 'forbidden');
  const stolen = await postReport(ctx, {
    receipt_ref: 'base:0xother',
    endpoint: 'https://api.chit402.com/v1/chat/completions',
    outcome: 'success',
  }, { ensureStamp: stamp.ensure });
  assert.equal(stolen.status, 403);
  assert.equal(stamp.calls(), 0);
  assert.equal(ctx.posts.list().length, 0);
});

test('stamp is 402 until paid, then the book records board_stamp without debiting the cap', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  const before = ctx.ledger.sumCollectedByAgent(ctx.agent.agent_id);
  const challenged = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1/chat/completions',
    outcome: 'error',
    text: 'slow once',
  }, {
    ensureStamp: async () => ({
      ok: false,
      status: 402,
      error: 'stamp_payment_required',
      message: 'pay the stamp',
      challenge: { x402Version: 2 },
    }),
  });
  assert.equal(challenged.status, 402);
  assert.equal(challenged.challenge.x402Version, 2);
  assert.equal(ctx.posts.list().length, 0);

  const paid = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1/chat/completions',
    outcome: 'error',
    text: 'slow once',
    latency_ms: 1400,
  });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.stamp_fee, '2000');
  assert.equal(paid.body.stamp_fee_usd, '0.002');
  const stampRow = ctx.ledger.entries.find((e) => e.event === 'board_stamp');
  assert.ok(stampRow);
  assert.equal(stampRow.evidence, BOOK_EVIDENCE.BOARD_STAMP);
  assert.equal(stampRow.amount, '2000');
  assert.equal(entryQualifiesForCap(stampRow), false);
  assert.equal(ctx.ledger.sumCollectedByAgent(ctx.agent.agent_id), before);
  const listed = ctx.ledger.listByAgent(ctx.agent.agent_id);
  assert.ok(listed.some((e) => e.event === 'board_stamp'));
  assert.ok(listed.some((e) => e.event === 'board_post'));
  assert.equal(ctx.ledger.recordBoardEvent({
    agentId: ctx.agent.agent_id,
    kind: 'board_bid',
    taskId: 'nope',
  }).ok, false);
});

test('one receipt backs one post', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  const stamp = stampOk();
  const first = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
  }, { ensureStamp: stamp.ensure });
  assert.equal(first.status, 201);
  const again = await postReport(ctx, {
    receipt_ref: `base:0x${'11'.repeat(32)}`,
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
  }, { ensureStamp: stamp.ensure });
  assert.equal(again.status, 409);
  assert.equal(again.error, 'duplicate_receipt');
  assert.equal(stamp.calls(), 1);
  assert.equal(ctx.posts.list().length, 1);
});

test('secret scan rejects the post and stores nothing', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  const stamp = stampOk();
  const samples = [
    'key sk-live-abcdef123456',
    'Authorization: Bearer abcdefghijklmnop',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----',
    `hash ${HEX64}`,
  ];
  for (const text of samples) {
    const result = await postReport(ctx, {
      receipt_ref: 'chit-task-1',
      endpoint: 'https://api.chit402.com/v1',
      outcome: 'error',
      text,
    }, { ensureStamp: stamp.ensure });
    assert.equal(result.status, 400, text.slice(0, 24));
    assert.equal(result.error, 'secret_rejected');
    assert.equal(JSON.stringify(result).includes('sk-live'), false);
    assert.equal(JSON.stringify(result).includes(HEX64), false);
  }
  const dirtyUrl = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: `https://api.chit402.com/v1?token=sk-live-abcdef`,
    outcome: 'error',
  }, { ensureStamp: stamp.ensure });
  assert.equal(dirtyUrl.error, 'secret_rejected');
  assert.equal(stamp.calls(), 0);
  assert.equal(ctx.posts.list().length, 0);
});

test('public rendering is plain text with only the published fields', async () => {
  const ctx = world();
  const payer = WALLET;
  const payTo = WALLET;
  addForeignReceipt(ctx.ledger, ctx.agent.agent_id, { payer, payTo, amount: '5000' });
  const html = '<script>alert(1)</script> [click](https://evil.example)';
  const created = await postReport(ctx, {
    receipt_ref: 'foreign-task-1',
    endpoint: 'https://shop.example/v1/chat?x=1',
    outcome: 'double_charge',
    text: html,
    latency_ms: 80,
  }, { houseAgentIds: [ctx.agent.agent_id] });
  assert.equal(created.status, 201);
  const post = created.body.post;
  assert.deepEqual(Object.keys(post).sort(), [...PUBLIC_LIVE_KEYS].sort());
  assert.equal(post.untrusted_text, html);
  assert.equal(post.endpoint_host, 'shop.example');
  assert.equal(post.amount, '5000');
  assert.equal(post.outcome, 'double_charge');
  assert.equal(post.latency_ms, 80);
  assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(post.verify_url, /^https:\/\/api\.chit402\.com\/receipt\/foreign-task-1$/);
  assert.deepEqual(post.labels, ['house', 'self', 'foreign']);
  assert.equal(post.foreign_notice, 'recorded by XFuel, not attested by the merchant');
  assert.equal(post.counts_on_scoreboard, false);
  const blob = JSON.stringify(post);
  assert.equal(blob.includes('receipt_key'), false);
  assert.equal(blob.includes('payment_ref'), false);
  assert.equal(blob.includes(payer), false);
  assert.equal(blob.includes('0x' + '22'.repeat(32)), false);
  assert.equal(post.html, undefined);

  const listed = listBoardPosts({}, { posts: ctx.posts });
  const summary = listed.body.endpoints.find((e) => e.endpoint_host === 'shop.example');
  assert.equal(summary.report_count, 0);
  assert.equal(summary.house_report_count, 1);
  assert.equal(summary.self_report_count, 1);
  assert.equal(summary.total_paid, '0');
  assert.equal(summary.distinct_payers, 0);
  assert.equal(Object.hasOwn(summary, 'distinct_payer_wallets'), false);
  assert.equal(toPublicPost(ctx.posts.list()[0]).untrusted_text, html);
});

test('a foreign report that is not self counts the payer; a Chit receipt cannot review another host', async () => {
  const ctx = world();
  addForeignReceipt(ctx.ledger, ctx.agent.agent_id);
  addChitReceipt(ctx.ledger, ctx.agent.agent_id, { taskId: 'chit-2', ref: `base:0x${'33'.repeat(32)}` });
  const stamp = stampOk();
  const foreign = await postReport(ctx, {
    receipt_ref: 'foreign-task-1',
    endpoint: 'https://shop.example/v1/chat',
    outcome: 'price_jump',
    text: 'quoted 2000 settled 9000',
  }, { ensureStamp: stamp.ensure });
  assert.equal(foreign.status, 201);
  assert.deepEqual(foreign.body.post.labels, ['foreign']);
  assert.equal(foreign.body.post.counts_on_scoreboard, true);
  const mismatch = await postReport(ctx, {
    receipt_ref: 'chit-2',
    endpoint: 'https://shop.example/v1/chat',
    outcome: 'error',
  }, { ensureStamp: stamp.ensure });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.error, 'endpoint_mismatch');
  const summary = listBoardPosts({ endpoint: 'shop.example', type: 'endpoint_report' }, { posts: ctx.posts });
  assert.equal(summary.body.posts.length, 1);
  assert.equal(summary.body.endpoints[0].distinct_payers, 1);
  assert.equal(Object.hasOwn(summary.body.endpoints[0], 'distinct_payer_wallets'), false);
  assert.equal(JSON.stringify(summary.body).toLowerCase().includes(WALLET.toLowerCase()), false);
  assert.equal(summary.body.endpoints[0].total_paid, '9000');
  assert.equal(summary.body.endpoints[0].warning_count, 1);
  const warning = listBoardPosts({ type: 'warning' }, { posts: ctx.posts });
  assert.equal(warning.status, 400);
  assert.equal(warning.error, 'warning_is_outcome');
  const httpEndpoint = await postReport(ctx, {
    receipt_ref: 'chit-2',
    endpoint: 'http://api.chit402.com/v1',
    outcome: 'success',
  }, { ensureStamp: stamp.ensure });
  assert.equal(httpEndpoint.status, 400);
  assert.equal(httpEndpoint.error, 'invalid_endpoint');
});

test('takedown is the poster only and becomes a tombstone; flag costs one stamp', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  const created = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
    text: 'fine',
  });
  const id = created.body.post.id;
  const stranger = takedownBoardPost(id, { posts: ctx.posts, ledger: ctx.ledger, actor: ctx.other });
  assert.equal(stranger.status, 403);
  const down = takedownBoardPost(id, { posts: ctx.posts, ledger: ctx.ledger, actor: ctx.agent });
  assert.equal(down.status, 200);
  assert.equal(down.body.post.status, 'taken_down');
  assert.equal(down.body.post.untrusted_text, undefined);
  assert.equal(getBoardPost(id, { posts: ctx.posts }).body.post.status, 'taken_down');

  const ctx2 = world();
  addChitReceipt(ctx2.ledger, ctx2.agent.agent_id);
  const live = await postReport(ctx2, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
  });
  const stamp = stampOk();
  const flagged = await flagBoardPost(live.body.post.id, {
    posts: ctx2.posts,
    ledger: ctx2.ledger,
    actor: ctx2.other,
    ensureStamp: stamp.ensure,
    suspendedAgentIds: [],
  });
  assert.equal(flagged.status, 201);
  const again = await flagBoardPost(live.body.post.id, {
    posts: ctx2.posts,
    ledger: ctx2.ledger,
    actor: ctx2.other,
    ensureStamp: stamp.ensure,
    suspendedAgentIds: [],
  });
  assert.equal(again.status, 409);
  assert.equal(stamp.calls(), 1);
  assert.equal(ctx2.ledger.entries.filter((e) => e.event === 'board_stamp' && e.board?.purpose === 'flag').length, 1);
  const publicPost = getBoardPost(live.body.post.id, { posts: ctx2.posts }).body.post;
  assert.equal(JSON.stringify(publicPost).includes('flag'), false);
});

test('takedown then ops hide keeps the receipt locked', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  const created = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
  });
  const id = created.body.post.id;
  const down = takedownBoardPost(id, { posts: ctx.posts, ledger: ctx.ledger, actor: ctx.agent });
  assert.equal(down.status, 200);
  const hidden = hideBoardPost(id, { posts: ctx.posts, ledger: ctx.ledger, ops: { ok: true } });
  assert.equal(hidden.body.status, 'taken_down');
  assert.equal(hidden.body.hidden, false);
  assert.equal(ctx.posts.get(id).free_repost, false);
  assert.equal(ctx.posts.findByReceipt('endpoint_report', ctx.posts.get(id).receipt_key).id, id);
  const stamp = stampOk();
  const again = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
  }, { ensureStamp: stamp.ensure });
  assert.equal(again.status, 409);
  assert.equal(again.error, 'duplicate_receipt');
  assert.equal(stamp.calls(), 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-tomb-'));
  fs.writeFileSync(path.join(dir, 'board-posts.json'), JSON.stringify({
    posts: [{
      id: 'rpt_tomb',
      type: 'endpoint_report',
      status: 'taken_down',
      receipt_key: 'base:locked',
      free_repost: true,
    }, {
      id: 'rpt_hidden',
      type: 'endpoint_report',
      status: 'hidden',
      receipt_key: 'base:freed',
      free_repost: true,
    }],
  }));
  const loaded = new BoardPostStore({ dir, persist: true });
  assert.equal(loaded.findByReceipt('endpoint_report', 'base:locked').id, 'rpt_tomb');
  assert.equal(loaded.findByReceipt('endpoint_report', 'base:freed'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a flag that loses the race still records the stamp', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  const created = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
  });
  const id = created.body.post.id;
  const stamp = stampOk();
  const raced = await flagBoardPost(id, {
    posts: ctx.posts,
    ledger: ctx.ledger,
    actor: ctx.other,
    suspendedAgentIds: [],
    ensureStamp: async () => {
      ctx.posts.get(id).flags = [{ agent_id: ctx.other.agent_id, at: new Date().toISOString() }];
      return stamp.ensure();
    },
  });
  assert.equal(raced.status, 409);
  assert.equal(raced.error, 'duplicate_flag');
  assert.equal(stamp.calls(), 1);
  const rows = ctx.ledger.entries.filter((e) => e.event === 'board_stamp' && e.board?.purpose === 'flag');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, '2000');
  assert.equal(rows[0].collected, true);
  assert.equal(entryQualifiesForCap(rows[0]), false);
});

test('ops hide removes the post and allows one free re-post', async () => {
  const prev = process.env.BOARD_OPS_TOKEN;
  process.env.BOARD_OPS_TOKEN = 'ops-test-token';
  try {
    const ctx = world();
    addChitReceipt(ctx.ledger, ctx.agent.agent_id);
    const created = await postReport(ctx, {
      receipt_ref: 'chit-task-1',
      endpoint: 'https://api.chit402.com/v1',
      outcome: 'success',
      text: 'keep me',
    });
    const id = created.body.post.id;
    const missing = hideBoardPost(id, { posts: ctx.posts, ledger: ctx.ledger, ops: { ok: false, status: 503, error: 'ops_unavailable', message: 'no' } });
    assert.equal(missing.status, 503);
    const hidden = hideBoardPost(id, { posts: ctx.posts, ledger: ctx.ledger, ops: { ok: true } });
    assert.equal(hidden.body.hidden, true);
    assert.equal(getBoardPost(id, { posts: ctx.posts }).status, 404);
    assert.equal(listBoardPosts({}, { posts: ctx.posts }).body.posts.length, 0);
    assert.ok(ctx.ledger.entries.some((e) => e.event === 'board_ops'));
    const stamp = stampOk();
    const repost = await postReport(ctx, {
      receipt_ref: 'chit-task-1',
      endpoint: 'https://api.chit402.com/v1',
      outcome: 'success',
      text: 'again',
    }, { ensureStamp: stamp.ensure });
    assert.equal(repost.status, 201);
    assert.equal(repost.body.stamp_waived, true);
    assert.equal(stamp.calls(), 0);
    const third = await postReport(ctx, {
      receipt_ref: 'chit-task-1',
      endpoint: 'https://api.chit402.com/v1',
      outcome: 'success',
    }, { ensureStamp: stamp.ensure });
    assert.equal(third.status, 409);
  } finally {
    if (prev == null) delete process.env.BOARD_OPS_TOKEN;
    else process.env.BOARD_OPS_TOKEN = prev;
  }
});

test('pilot stamp waiver is committed once; a free repost does not consume it', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  let commits = 0;
  const deps = {
    posts: ctx.posts,
    ledger: ctx.ledger,
    actor: ctx.agent,
    chitHosts: CHIT,
    houseAgentIds: [],
    suspendedAgentIds: [],
    commitStampWaiver: () => { commits += 1; },
  };
  const created = await createEndpointReport({
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
  }, {
    ...deps,
    ensureStamp: async () => ({ ok: true, waived: true, waiverKey: true }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.stamp_waived, true);
  assert.equal(commits, 1);
  const stampRow = ctx.ledger.entries.find((e) => e.event === 'board_stamp' && e.task_id === created.body.book.stamp_task_id);
  assert.equal(stampRow.board.waived_reason, 'pilot');

  const prev = process.env.BOARD_OPS_TOKEN;
  process.env.BOARD_OPS_TOKEN = 'waiver-ops';
  try {
    hideBoardPost(created.body.post.id, { posts: ctx.posts, ledger: ctx.ledger, ops: { ok: true } });
    const repost = await createEndpointReport({
      receipt_ref: 'chit-task-1',
      endpoint: 'https://api.chit402.com/v1',
      outcome: 'success',
    }, {
      ...deps,
      ensureStamp: async () => { throw new Error('free repost must not charge'); },
    });
    assert.equal(repost.status, 201);
    assert.equal(repost.body.stamp_waived, true);
    assert.equal(commits, 1);
    const repostStamp = ctx.ledger.entries.find((e) => e.task_id === repost.body.book.stamp_task_id);
    assert.equal(repostStamp.board.waived_reason, 'ops_repost');
  } finally {
    if (prev == null) delete process.env.BOARD_OPS_TOKEN;
    else process.env.BOARD_OPS_TOKEN = prev;
  }
});

test('house seed lists real rows and does not write posts', () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  addForeignReceipt(ctx.ledger, ctx.agent.agent_id);
  const plan = planHouseSeed(ctx.ledger, { agentId: ctx.agent.agent_id, posts: ctx.posts, chitHosts: CHIT });
  assert.equal(plan.length, 2);
  assert.ok(plan.some((row) => row.endpoint_host === 'api.chit402.com' && row.foreign === false));
  assert.ok(plan.some((row) => row.endpoint_host === 'shop.example' && row.foreign === true));
  assert.equal(ctx.posts.list().length, 0);
});

test('board store reloads posts from disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-posts-'));
  const posts = new BoardPostStore({ dir, persist: true });
  const ctx = { ...world(), posts };
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  const created = await postReport(ctx, {
    receipt_ref: 'chit-task-1',
    endpoint: 'https://api.chit402.com/v1',
    outcome: 'success',
    text: 'persisted',
  });
  assert.equal(created.status, 201);
  const reloaded = new BoardPostStore({ dir, persist: true });
  assert.equal(reloaded.get(created.body.post.id).untrusted_text, 'persisted');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('HTTP: session gate, 402 stamp, duplicate, secret, and plain-text body', async () => {
  const ctx = world();
  addChitReceipt(ctx.ledger, ctx.agent.agent_id);
  addChitReceipt(ctx.ledger, ctx.other.agent_id, { taskId: 'other-task', ref: 'base:0xotherpay' });
  let mode = 'challenge';
  const app = express();
  app.use(express.json());
  registerBoardRoutes(app, {
    posts: ctx.posts,
    ledger: ctx.ledger,
    registry: ctx.registry,
    verify: bindBookVerifier(ctx.registry),
    isDemoKey: (key) => key === 'chit402-demo',
    x402Enabled: true,
    runX402Handshake: async () => {
      if (mode === 'challenge') return { kind: 'challenge', body: { accepts: [{ scheme: 'exact' }] } };
      mode = 'challenge';
      return { kind: 'settled', paymentRef: `base:http-${crypto.randomBytes(3).toString('hex')}`, settledAmount: '2000', payerWallet: WALLET };
    },
    setPaymentHeaders: () => {},
    baseUrlFor: () => 'https://api.chit402.com',
    peekStampWaiver: () => ({ eligible: false }),
    commitStampWaiver: () => {},
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const anon = await fetch(`${base}/v1/board/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipt_ref: 'chit-task-1',
        endpoint: 'https://api.chit402.com/v1',
        outcome: 'success',
      }),
    });
    assert.equal(anon.status, 401);

    const stolen = await fetch(`${base}/v1/board/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XFuel-Session': ctx.agent.session },
      body: JSON.stringify({
        receipt_ref: 'base:0xotherpay',
        endpoint: 'https://api.chit402.com/v1',
        outcome: 'success',
      }),
    });
    assert.equal(stolen.status, 403);

    const due = await fetch(`${base}/v1/board/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XFuel-Session': ctx.agent.session },
      body: JSON.stringify({
        receipt_ref: 'chit-task-1',
        endpoint: 'https://api.chit402.com/v1',
        outcome: 'success',
        text: 'hello',
      }),
    });
    assert.equal(due.status, 402);
    assert.ok(due.headers.get('payment-required'));
    const dueBody = await due.json();
    assert.equal(dueBody.stamp_fee, '2000');

    mode = 'settled';
    const paid = await fetch(`${base}/v1/board/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XFuel-Session': ctx.agent.session },
      body: JSON.stringify({
        receipt_ref: 'chit-task-1',
        endpoint: 'https://api.chit402.com/v1',
        outcome: 'success',
        text: '<b>not html</b>',
      }),
    });
    assert.equal(paid.status, 201);
    const paidBody = await paid.json();
    assert.equal(paidBody.post.untrusted_text, '<b>not html</b>');
    assert.equal(Object.hasOwn(paidBody.post, 'receipt_key'), false);

    mode = 'settled';
    const dup = await fetch(`${base}/v1/board/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XFuel-Session': ctx.agent.session },
      body: JSON.stringify({
        receipt_ref: 'chit-task-1',
        endpoint: 'https://api.chit402.com/v1',
        outcome: 'success',
      }),
    });
    assert.equal(dup.status, 409);

    const secret = await fetch(`${base}/v1/board/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XFuel-Session': ctx.agent.session },
      body: JSON.stringify({
        receipt_ref: 'chit-task-1',
        endpoint: 'https://api.chit402.com/v1',
        outcome: 'error',
        text: 'sk-proj-supersecretvalue',
      }),
    });
    assert.equal(secret.status, 400);
    const secretBody = await secret.json();
    assert.equal(secretBody.error, 'secret_rejected');
    assert.equal(JSON.stringify(secretBody).includes('supersecretvalue'), false);

    const proof = `sha256=${crypto.createHmac('sha256', ctx.other.session).update(bookHmacPayload(ctx.other.agent_id, 50)).digest('hex')}`;
    mode = 'settled';
    const hmac = await fetch(`${base}/v1/board/posts/${paidBody.post.id}/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: ctx.other.agent_id, proof }),
    });
    assert.equal(hmac.status, 201);

    const prev = process.env.BOARD_OPS_TOKEN;
    process.env.BOARD_OPS_TOKEN = 'route-ops';
    const hide = await fetch(`${base}/v1/board/posts/${paidBody.post.id}/hide`, {
      method: 'POST',
      headers: { 'X-Chit-Board-Ops': 'route-ops' },
    });
    assert.equal(hide.status, 200);
    const gone = await fetch(`${base}/v1/board/posts/${paidBody.post.id}`);
    assert.equal(gone.status, 404);
    if (prev == null) delete process.env.BOARD_OPS_TOKEN;
    else process.env.BOARD_OPS_TOKEN = prev;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
