/**
 * GET /receipt/by-tx for stamp book rows. A board or ingest stamp has no receipt
 * page of its own, so by-tx sends it to what it paid for: the board post (comments
 * included) or the foreign receipt. A stamp with no resolvable parent stays a 404.
 * Every paid book row's tx must land on a 200 once the redirect is followed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { buildForeignReceipt } = await import('../src/foreign-x402-ingest.js');

const AGENT = 41;
const txOf = (b) => `0x${b.repeat(32)}`;
const TX = {
  foreign: txOf('a1'),
  ingestStamp: txOf('a2'),
  postStamp: txOf('a3'),
  commentStamp: txOf('a4'),
  flagStamp: txOf('a5'),
  orphanBoard: txOf('b1'),
  orphanIngest: txOf('b2'),
  hiddenPost: txOf('b3'),
  takenDownPost: txOf('b4'),
  stampParentIngest: txOf('b5'),
};
const TAKEN_ID = 'rpt_00112233aabbccdd';
const POST_ID = 'rpt_0123456789abcdef';
const HIDDEN_ID = 'rpt_fedcba9876543210';

let server;
let base;
let hooks;
let foreignTaskId;

function post(id, status = 'live') {
  return {
    id, type: 'endpoint_report', status, agent_id: AGENT, receipt_key: null, stamp_ref: null,
    endpoint_host: 'example.com', amount: '2000', outcome: 'success', latency_ms: null,
    date: '2026-10-20', verify_url: null, untrusted_text: '', labels: [], foreign_notice: null,
    created_at: new Date().toISOString(), taken_down_at: null, hidden_at: null, flags: [], likes: [], confirms: [],
  };
}

async function stamp(taskId, tx, { postId, purpose }) {
  const r = await hooks.usageSettled.recordBoardEvent({
    agentId: AGENT, kind: 'board_stamp', taskId, paymentRef: `base:${tx}`, amount: '2000',
    collected: true, rail: 'usdc', parentRef: null,
    board: { post_id: postId, purpose, waived: false, waived_reason: null, fee_units: '2000' },
  });
  assert.equal(r.ok, true, r.reason);
}

before(async () => {
  await initAIListener();
  const app = await createApp();
  hooks = app.locals.__test;
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });

  const built = await buildForeignReceipt({
    taskId: 'foreign-x402-bytx-parent',
    paymentRequired: { resource: `https://basescan.org/tx/${TX.foreign}`, amount: '1000000', payTo: '0x1111111111111111111111111111111111111111', network: 'base' },
    paymentResponse: { tx: TX.foreign, payer: '0x2222222222222222222222222222222222222222', network: 'base' },
    rail: 'usdc',
    agentId: AGENT,
  });
  const appended = await hooks.usageSettled.append(built, { payer: '0x2222222222222222222222222222222222222222', agentId: AGENT });
  assert.equal(appended.ok, true, appended.reason);
  foreignTaskId = built.task_id;

  const ing = await hooks.usageSettled.recordIngestStamp({
    agentId: AGENT, taskId: `ingest-stamp-${foreignTaskId}`, paymentRef: `base:${TX.ingestStamp}`, amount: '2000', parentRef: foreignTaskId,
  });
  assert.equal(ing.ok, true, ing.reason);

  hooks.boardPosts.insert(post(POST_ID));
  hooks.boardPosts.insert(post(HIDDEN_ID, 'hidden'));
  await stamp(`board-stamp-${POST_ID}`, TX.postStamp, { postId: POST_ID, purpose: 'post' });
  await stamp('board-stamp-comment-cmt_0123456789abcdef', TX.commentStamp, { postId: POST_ID, purpose: 'comment' });
  await stamp(`board-stamp-flag-${POST_ID}-${AGENT}`, TX.flagStamp, { postId: POST_ID, purpose: 'flag' });

  // True orphans: no parent that resolves.
  await stamp('board-stamp-race-00000001', TX.orphanBoard, { postId: null, purpose: 'post' });
  await stamp(`board-stamp-${HIDDEN_ID}`, TX.hiddenPost, { postId: HIDDEN_ID, purpose: 'post' });
  hooks.boardPosts.insert({ ...post(TAKEN_ID, 'taken_down'), taken_down_at: new Date().toISOString() });
  await stamp(`board-stamp-${TAKEN_ID}`, TX.takenDownPost, { postId: TAKEN_ID, purpose: 'post' });
  // An ingest stamp whose parent is another stamp row, not a receipt.
  const viaStamp = await hooks.usageSettled.recordIngestStamp({
    agentId: AGENT, taskId: 'ingest-stamp-via-stamp', paymentRef: `base:${TX.stampParentIngest}`, amount: '2000', parentRef: `board-stamp-${POST_ID}`,
  });
  assert.equal(viaStamp.ok, true, viaStamp.reason);
  const orphan = await hooks.usageSettled.recordIngestStamp({
    agentId: AGENT, taskId: 'ingest-stamp-foreign-x402-gone', paymentRef: `base:${TX.orphanIngest}`, amount: '2000', parentRef: 'foreign-x402-gone',
  });
  assert.equal(orphan.ok, true, orphan.reason);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const byTx = (tx, opts = {}) => fetch(`${base}/receipt/by-tx?tx=${tx}`, { redirect: 'manual', ...opts });

test('stamp rows redirect to their parent post, comments or foreign receipt', async () => {
  const cases = [
    [TX.ingestStamp, `/receipt/${foreignTaskId}`],
    [TX.postStamp, `/v1/board/posts/${POST_ID}`],
    [TX.commentStamp, `/v1/board/posts/${POST_ID}/comments`],
    [TX.flagStamp, `/v1/board/posts/${POST_ID}`],
  ];
  for (const [tx, path] of cases) {
    const res = await byTx(tx);
    assert.equal(res.status, 302, tx);
    assert.equal(res.headers.get('location'), `${base}${path}`, tx);
  }
  const json = await byTx(TX.postStamp, { headers: { Accept: 'application/json' } });
  assert.equal(json.status, 302);
  const fmt = await fetch(`${base}/receipt/by-tx?tx=${TX.ingestStamp}&format=json`, { redirect: 'manual' });
  assert.equal(fmt.headers.get('location'), `${base}/receipt/${foreignTaskId}?format=json`);
});

test('a stamp with no resolvable parent stays a 404', async () => {
  for (const tx of [TX.orphanBoard, TX.orphanIngest, TX.hiddenPost]) {
    const res = await byTx(tx, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 404, tx);
    assert.equal(res.headers.get('location'), null, tx);
  }
});

test('every paid book row resolves through by-tx to a 200, redirect followed', async () => {
  const orphans = new Set([TX.orphanBoard, TX.orphanIngest, TX.hiddenPost, TX.takenDownPost, TX.stampParentIngest].map((t) => `base:${t}`));
  const rows = hooks.usageSettled.listByAgent(AGENT, { limit: 500 })
    .filter((r) => r.payment_ref && !String(r.payment_ref).startsWith('waiver:') && !orphans.has(r.payment_ref));
  assert.ok(rows.length >= 5, `paid rows seen: ${rows.length}`);
  for (const row of rows) {
    const tx = String(row.payment_ref).replace(/^base:/, '');
    const res = await fetch(`${base}/receipt/by-tx?tx=${tx}`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 200, `${row.task_id} → ${res.url}`);
    assert.equal(res.redirected, true, row.task_id);
  }
});

test('an ingest stamp whose parent is not a receipt row is a 404', async () => {
  const res = await byTx(TX.stampParentIngest, { headers: { Accept: 'application/json' } });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('location'), null);
});

test('a stamp for a taken-down or hidden post is a 404', async () => {
  for (const tx of [TX.takenDownPost, TX.hiddenPost]) {
    const res = await byTx(tx, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 404, tx);
    assert.equal(res.headers.get('location'), null, tx);
  }
});

test('?format= carries only json or html into a redirect', async () => {
  const loc = async (tx, f) => (await fetch(`${base}/receipt/by-tx?tx=${tx}&format=${encodeURIComponent(f)}`, { redirect: 'manual' })).headers.get('location');
  assert.equal(await loc(TX.ingestStamp, 'json'), `${base}/receipt/${foreignTaskId}?format=json`);
  assert.equal(await loc(TX.ingestStamp, 'HTML'), `${base}/receipt/${foreignTaskId}?format=html`);
  for (const f of ['x&y=1', 'json#a', '<b>', 'auditor%0d%0a', 'xml']) {
    assert.equal(await loc(TX.ingestStamp, f), `${base}/receipt/${foreignTaskId}`, f);
    assert.equal(await loc(TX.foreign, f), `${base}/receipt/${foreignTaskId}`, f);
  }
  assert.equal(await loc(TX.postStamp, 'evil'), `${base}/v1/board/posts/${POST_ID}`);
});
