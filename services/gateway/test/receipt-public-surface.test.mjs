/**
 * Public receipt routes carry one receipt. Another receipt shows up only as
 * a sibling hash or a count. These tests are the attacks: each one fails if
 * the old body, header, or lookup comes back.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
delete process.env.SOLANA_ANCHOR_SECRET_KEY;
delete process.env.SOLANA_RPC_URL;

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const {
  epochRecordClaims,
  epochRecordWithUnlogged,
  unloggedSection,
  publicEpochRecord,
} = await import('../src/receipt-log-epoch.js');
const { signJws } = await import('../src/issuer-key.js');
const { preimageField } = await import('../src/receipt-preimage.js');

const A = 'xfuel-pub-a-11111111-1111-4111-8111-111111111111';
const B = 'xfuel-pub-b-22222222-2222-4222-8222-222222222222';
const PRE = 'xfuel-pub-pre-33333333-3333-4333-8333-333333333333';
const AGENT_B = 918273645;
const ROW_B = 'row-foreign-b-not-shared';
const WALLET_B = '0xB0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0';
const TX_A = `0x${'a1'.repeat(32)}`;
const TX_B = `0x${'b2'.repeat(32)}`;
const REF_A = `base:${TX_A}`;
const REF_B = `base:${TX_B}`;

let server;
let base;
let httpApp;
const planted = [];

function leafHash(body) {
  return createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from(body)])).digest('hex');
}

function paidTask(taskId, ref, agentId, wallet) {
  return {
    taskId,
    status: 'completed',
    createdAt: 1_790_432_737_000,
    updatedAt: 1_790_432_738_000,
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: ref,
      amount: '2000',
      modelId: 'akash/meta-llama/Llama-3.3-70B-Instruct',
    },
    meta: {
      payerWallet: wallet,
      payTo: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
      paymentAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      provider: 'akash-network',
      chain: 'base',
      agentId,
    },
    result: {
      provider: 'akash-network',
      model: 'akash/meta-llama/Llama-3.3-70B-Instruct',
    },
  };
}

before(async () => {
  resetReceiptMerkleTree();
  await initAIListener();
  const store = getAIListener().activeTasks;
  httpApp = createApp();
  const tree = getReceiptMerkleTree();
  const ledger = httpApp.locals.__test.usageSettled;
  const plant = (taskId, rowHash, ref, agentId, wallet) => {
    tree.appendReceipt(taskId, rowHash, { publish: false });
    store.set(taskId, paidTask(taskId, ref, agentId, wallet));
    planted.push(taskId);
  };
  plant(A, 'row-own-a', REF_A, 187, '0x9F8951CB8b060f52fdf87297b3c5B00f7aa18f52');
  plant(B, ROW_B, REF_B, AGENT_B, WALLET_B);
  store.set(PRE, paidTask(PRE, `base:0x${'c3'.repeat(32)}`, 188, '0x1111111111111111111111111111111111111111'));
  planted.push(PRE);
  const taskA = store.get(A);
  taskA.usage = { prompt_tokens: 4242, completion_tokens: 4343, total_tokens: 8585, source: 'provider' };
  taskA.meta.requestedModel = 'xfuel/auto';
  taskA.meta.modelSubstituted = true;
  taskA.meta.providerCogs = {
    provider: 'akash-network',
    float_id: 'akash-network',
    estimated: '12',
    actual: '12',
    basis: 'measured',
    below_low_water: true,
  };
  ledger._index({
    task_id: A,
    agent_id: 187,
    evidence: 'collected',
    amount: '2000',
    collected_at: '2026-09-05T17:14:11.000Z',
  }, { persist: false, notify: false });
  const claims = epochRecordWithUnlogged(epochRecordClaims(), [
    { task_id: B, agent_id: AGENT_B, reason: 'forked' },
  ]);
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-epoch+jwt' });
  tree.epochRecord = { ...claims, issuer_signature: { jws, kid } };
  await new Promise((resolve) => {
    server = httpApp.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    const store = getAIListener().activeTasks;
    for (const id of planted) store.delete(id);
  } catch { /* listener already down */ }
  resetReceiptMerkleTree();
});

async function fetchText(path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

function assertNoForeign(text, label) {
  const hay = String(text);
  assert.equal(hay.includes(B), false, `${label} names the other task`);
  assert.equal(hay.includes(String(AGENT_B)), false, `${label} names the other agent`);
  assert.equal(hay.includes(ROW_B), false, `${label} names the other row`);
  assert.equal(hay.includes(WALLET_B), false, `${label} names the other wallet`);
  assert.equal(hay.includes(TX_B), false, `${label} names the other payment`);
  assert.equal(hay.includes(`${B}|${ROW_B}`), false, `${label} names the other leaf body`);
}

function assertPrivateNegotiated(res, label) {
  const cc = res.headers.get('cache-control') || '';
  assert.match(cc, /private/, label);
  assert.match(cc, /no-store/, label);
  assert.match(res.headers.get('vary') || '', /accept/i, label);
}

test('prototype field names are not a preimage', () => {
  const fields = { payload_hash: { preimage_utf8: 'own' } };
  assert.equal(preimageField({ fields }, '__proto__'), null);
  assert.equal(preimageField({ fields }, 'constructor'), null);
  assert.equal(preimageField({ fields }, 'prototype'), null);
  assert.equal(preimageField({ fields }, 'toString'), null);
  assert.equal(preimageField({ fields }, 'payload_hash').preimage_utf8, 'own');
  const viaProto = Object.create({ inherited: { preimage_utf8: 'nope' } });
  viaProto.payload_hash = { preimage_utf8: 'own' };
  assert.equal(preimageField({ fields: viaProto }, 'inherited'), null);
});

test('a version 2 row list is not served as an unsigned stub', () => {
  const rows = [{ task_id: B, agent_id: AGENT_B, reason: 'forked' }];
  const legacy = { ...epochRecordClaims(), payload_version: 2, unlogged: unloggedSection(rows) };
  assert.equal(publicEpochRecord(legacy), null);
  const v1 = {
    ...epochRecordClaims(),
    issuer_signature: { jws: 'v1-header.v1-payload.v1-sig', kid: 'k' },
  };
  const served = publicEpochRecord(legacy, v1);
  assert.equal(served, v1);
  assert.equal(served.issuer_signature.jws, v1.issuer_signature.jws);
  assert.equal(JSON.stringify(served).includes(B), false);
  assert.equal(JSON.stringify(served).includes('withheld'), false);
});

test('?tx= cannot serve another receipt under this id', async () => {
  const swapped = await fetchText(`/receipt/${A}?format=json&tx=${TX_B}`);
  assert.equal(swapped.status, 404, swapped.text.slice(0, 180));
  assert.deepEqual(JSON.parse(swapped.text), { error: 'not_found' });
  assertNoForeign(swapped.text, 'tx swap');

  const missing = await fetchText(`/receipt/xfuel-does-not-exist?format=json&tx=${encodeURIComponent(REF_B)}`);
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.text), { error: 'not_found' });
  assertNoForeign(missing.text, 'tx fallback');

  const own = await fetchText(`/receipt/${A}?format=json&tx=${encodeURIComponent(REF_A)}`);
  assert.equal(own.status, 200, own.text.slice(0, 180));
  assert.equal(JSON.parse(own.text).task_id, A);
  assertNoForeign(own.text, 'own tx');

  const bare = await fetchText(`/receipt/${A}?format=json&tx=${TX_A}`);
  assert.equal(bare.status, 200, bare.text.slice(0, 120));
  assert.equal(JSON.parse(bare.text).task_id, A);

  for (const flag of ['ref', 'task_id']) {
    const other = await fetchText(`/receipt/${A}?format=json&${flag}=${B}`);
    assert.equal(other.status, 200, flag);
    assert.equal(JSON.parse(other.text).task_id, A);
    assertNoForeign(other.text, flag);
  }
});

test('error bodies are fixed and do not echo the request', async () => {
  const nasty = '<script>alert(1)</script>';
  const probes = [
    [`/receipt/${encodeURIComponent(nasty)}?format=json`, 404],
    [`/receipt/${encodeURIComponent(nasty)}`, 404],
    [`/receipt/${'z'.repeat(4000)}?format=json`, 404],
    [`/receipt/${A}/preimage/${encodeURIComponent(nasty)}`, 404],
    [`/receipt/${A}/preimage/__proto__`, 404],
    [`/receipt/${A}/preimage/constructor`, 404],
    [`/refusal/${encodeURIComponent(nasty)}?format=json`, 404],
    [`/refusal/${encodeURIComponent(nasty)}`, 404],
    [`/receipt/by-tx?tx=${encodeURIComponent(nasty)}&format=json`, 404],
    ['/this-route-is-not-real', 404],
    [`/v1/receipts/${encodeURIComponent(nasty)}/inclusion`, 404],
  ];
  for (const [path, status] of probes) {
    const res = await fetchText(path);
    assert.equal(res.status, status, `${path} ${res.status} ${res.text.slice(0, 120)}`);
    assert.equal(res.text.includes(nasty), false, path);
    assert.equal(res.text.includes('<script>'), false, path);
    assert.equal(res.text.includes('alert(1)'), false, path);
    assert.equal(res.text.includes('z'.repeat(80)), false, path);
    assert.equal(res.text.includes('Available:'), false, path);
    assert.equal(res.text.includes('POST /task-request'), false, path);
    assert.equal(res.text.includes('__proto__'), false, path);
    assert.ok(res.text.length < 2500, `${path} body is ${res.text.length} bytes`);
    if (path.endsWith('/inclusion')) {
      assert.deepEqual(JSON.parse(res.text), { error: 'not_in_tree' });
    }
  }
  const proto = await fetchText(`/receipt/${A}/preimage/__proto__`);
  assert.notEqual(proto.text.trim(), '{}');
  assert.deepEqual(JSON.parse(proto.text), { error: 'preimage_unavailable' });
});

test('a thrown refusal error does not return err.message', async () => {
  const ledger = httpApp.locals.__test.usageSettled;
  const original = ledger.findByRefusal.bind(ledger);
  const secret = 'ENOENT /var/lib/chit-secret-refusal-path';
  ledger.findByRefusal = () => {
    throw new Error(secret);
  };
  try {
    for (const path of [
      '/refusal/any-id?format=json',
      '/refusal/any-id/preimage',
      '/refusal/any-id/preimage/nonce',
    ]) {
      const res = await fetchText(path);
      assert.equal(res.status, 500, `${path} ${res.text}`);
      assert.equal(res.text.includes(secret), false, path);
      assert.equal(res.text.includes('ENOENT'), false, path);
      assert.equal(res.text.includes('/var/lib'), false, path);
      const body = JSON.parse(res.text);
      assert.equal(body.error, 'internal');
      assert.equal(typeof body.code, 'string');
      assert.equal(body.message, undefined);
      assert.match(res.headers.get('cache-control') || '', /no-store/);
    }
  } finally {
    ledger.findByRefusal = original;
  }
});

test('the listed public 500 handlers do not interpolate err.message', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
  for (const label of [
    'GET /refusal/:refusalId error',
    'GET /refusal preimage error',
    'GET /refusal preimage field error',
    'GET issuer-history error',
    'GET anchor-wallets error',
    'GET /.well-known/agent-card.json error',
    'inclusion error',
  ]) {
    const at = src.indexOf(label);
    assert.ok(at > 0, label);
    const window = src.slice(at, at + 280);
    assert.equal(window.includes('err.message'), false, window);
  }
});

test('consistency rejects a leading zero the way a tree size does', async () => {
  const ok = await fetchText('/v1/receipts/tree/consistency?first=1&second=2');
  assert.equal(ok.status, 200, ok.text.slice(0, 160));
  for (const q of ['first=01&second=2', 'first=1&second=02', 'first=01&second=03', 'first=1e2&second=2', 'first=+1&second=2', 'first=0&second=1', 'first=%201&second=2', 'first=1%20&second=2']) {
    const res = await fetchText(`/v1/receipts/tree/consistency?${q}`);
    assert.equal(res.status, 400, `${q} ${res.status} ${res.text}`);
    assert.deepEqual(JSON.parse(res.text), { error: 'bad_tree_size' });
    assert.equal(res.text.includes('01'), false, q);
  }
  for (const q of ['first=1&second=2&epoch=01', 'first=1&second=2&epoch=%201', 'first=1&second=2&epoch=1e2']) {
    const res = await fetchText(`/v1/receipts/tree/consistency?${q}`);
    assert.equal(res.status, 400, `${q} ${res.status} ${res.text}`);
    assert.deepEqual(JSON.parse(res.text), { error: 'bad_epoch' });
    assert.equal(res.text.includes('01'), false, q);
  }
  const epochPath = await fetchText('/v1/receipts/tree/epoch/01/head');
  assert.equal(epochPath.status, 400, epochPath.text);
  assert.deepEqual(JSON.parse(epochPath.text), { error: 'bad_epoch' });
  assert.equal(epochPath.text.includes('01'), false);
  for (const q of ['tree_size=01', 'tree_size=+1', 'tree_size=1e2', 'tree_size=0', 'tree_size=02']) {
    const res = await fetchText(`/v1/receipts/${A}/inclusion?${q}`);
    assert.equal(res.status, 400, `${q} ${res.status} ${res.text}`);
    assert.equal(JSON.parse(res.text).error, 'bad_tree_size');
    assert.equal(res.text.includes(A), false, q);
    assert.equal(res.text.includes('01'), false, q);
    assertNoForeign(res.text, q);
  }
});

test('an inclusion failure does not return err.message or another agent', async () => {
  const tree = getReceiptMerkleTree();
  const original = tree.inclusion.bind(tree);
  const secret = 'ENOENT /var/lib/chit-secret-inclusion-path';
  tree.inclusion = () => {
    throw new Error(secret);
  };
  try {
    const res = await fetchText(`/v1/receipts/${A}/inclusion`);
    assert.equal(res.status, 500, res.text);
    assert.equal(res.text.includes(secret), false);
    assert.equal(res.text.includes('ENOENT'), false);
    assert.equal(res.text.includes(A), false);
    assert.deepEqual(JSON.parse(res.text), { error: 'internal', code: 'inclusion_failed' });
    assertNoForeign(res.text, 'inclusion 500');
  } finally {
    tree.inclusion = original;
  }
  const missing = await fetchText('/v1/receipts/xfuel-not-a-leaf/inclusion');
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.text), { error: 'not_in_tree' });
  assertNoForeign(missing.text, 'unlogged inclusion');
});

test('negotiated receipt responses are private and preimages do not publish the other leaf', async () => {
  const negotiated = [
    [`/receipt/${A}`, { Accept: 'text/html' }],
    [`/receipt/${A}`, { Accept: 'application/json' }],
    [`/receipt/${A}`, { Accept: '*/*' }],
    [`/receipt/${A}`, { Accept: 'application/json;q=0.1, text/html' }],
    [`/receipt/${A}`, {}],
    [`/receipt/${A}?format=json`, { Accept: 'text/html' }],
    [`/receipt/${A}?format=auditor`, {}],
    [`/receipt/${A}?format=auditor&view=html`, {}],
    [`/receipt/${A}.json`, {}],
    [`/receipt/by-tx?tx=${TX_A}&format=json`, {}],
    [`/refusal/missing-refusal`, { Accept: 'text/html' }],
    [`/refusal/missing-refusal?format=json`, {}],
  ];
  for (const [path, headers] of negotiated) {
    const res = await fetchText(path, headers);
    assertPrivateNegotiated(res, path);
    assertNoForeign(res.text, path);
    if (res.status === 200 && path.startsWith(`/receipt/${A}`) && !path.includes('auditor')) {
      assert.equal(res.text.includes(A) || res.text.includes('chit-pub-a'), true, path);
    }
  }

  const field = await fetchText(`/receipt/${A}/preimage/tree_head_hash`);
  assert.equal(field.status, 200, field.text.slice(0, 160));
  assert.match(field.headers.get('cache-control') || '', /private/);
  assert.match(field.headers.get('cache-control') || '', /no-store/);
  assertNoForeign(field.text, 'field preimage');
  const parsed = JSON.parse(field.text);
  assert.equal(parsed.leaves, undefined);
  const foreignLeaf = leafHash(`${B}|${ROW_B}`);
  const stripped = field.text.replace(/"hash":"[0-9a-f]{64}"/g, '"hash":""');
  assert.equal(stripped.includes(foreignLeaf), false, 'foreign leaf hash outside a sibling hash');

  const canonical = await fetchText(`/receipt/${A}/preimage`);
  assertNoForeign(canonical.text, 'canonical preimage');
  if (canonical.status === 200) {
    assert.match(canonical.headers.get('cache-control') || '', /public/);
  } else {
    assert.match(canonical.headers.get('cache-control') || '', /no-store/);
  }

  const card = await fetchText(`/receipt/${A}/og.png`);
  assert.equal(card.status, 200, card.text.slice(0, 80));
  assert.match(card.headers.get('cache-control') || '', /private/);
  assert.match(card.headers.get('cache-control') || '', /no-store/);
  assert.equal(card.headers.get('cache-control').includes('immutable'), false);
  assertNoForeign(card.text, 'og.png');

  const epoch = await fetchText('/v1/receipts/tree/epoch');
  assert.equal(epoch.status, 200);
  assertNoForeign(epoch.text, 'epoch');
  const epochDoc = JSON.parse(epoch.text);
  assert.equal(epochDoc.unlogged.rows, undefined);
  assert.equal(epochDoc.unlogged.count, 1);
  assert.match(epochDoc.unlogged.commitment, /^[0-9a-f]{64}$/);
  assert.match(epoch.headers.get('cache-control') || '', /no-store/);

  const inclusion = await fetchText(`/v1/receipts/${A}/inclusion`);
  assert.equal(inclusion.status, 200, inclusion.text.slice(0, 160));
  assertNoForeign(inclusion.text, 'inclusion');
  assert.match(inclusion.headers.get('cache-control') || '', /no-store/);

  const missingInclusion = await fetchText('/v1/receipts/not-a-leaf/inclusion');
  assert.deepEqual(JSON.parse(missingInclusion.text), { error: 'not_in_tree' });
  assertNoForeign(missingInclusion.text, 'inclusion 404');
});

test('a disclosing epoch record serves the last signed v1 or 404', async () => {
  const tree = getReceiptMerkleTree();
  const saved = tree.epochRecord;
  const savedV1 = tree.epochRecordV1;
  const v2 = {
    ...epochRecordClaims(),
    payload_version: 2,
    unlogged: unloggedSection([{ task_id: B, agent_id: AGENT_B, reason: 'forked' }]),
    issuer_signature: { jws: 'v2.payload.sig', kid: 'k2' },
  };
  try {
    tree.epochRecord = v2;
    tree.epochRecordV1 = null;
    const missing = await fetchText('/v1/receipts/tree/epoch');
    assert.equal(missing.status, 404, missing.text);
    assert.deepEqual(JSON.parse(missing.text), { error: 'not_found' });
    assert.equal(missing.text.includes('withheld'), false);
    assert.equal(missing.text.includes(B), false);
    assertNoForeign(missing.text, 'epoch 404');

    const v1 = {
      ...epochRecordClaims(),
      issuer_signature: { jws: 'v1-header.v1-payload.v1-sig', kid: 'k1' },
    };
    tree.epochRecordV1 = v1;
    const served = await fetchText('/v1/receipts/tree/epoch');
    assert.equal(served.status, 200, served.text.slice(0, 180));
    const body = JSON.parse(served.text);
    assert.equal(body.issuer_signature.jws, v1.issuer_signature.jws);
    assert.equal(body.payload_version, 1);
    assert.equal(body.unlogged, undefined);
    assert.equal(body.status, undefined);
    assert.equal(served.text.includes('withheld'), false);
    assertNoForeign(served.text, 'epoch v1');
  } finally {
    tree.epochRecord = saved;
    tree.epochRecordV1 = savedV1;
  }
});

test('a pre-leaf canonical preimage is not publicly cacheable', async () => {
  const pre = await fetchText(`/receipt/${PRE}/preimage`);
  assert.equal(pre.status, 200, pre.text.slice(0, 180));
  assert.match(pre.headers.get('cache-control') || '', /private/);
  assert.match(pre.headers.get('cache-control') || '', /no-store/);
  assert.equal((pre.headers.get('cache-control') || '').includes('max-age=300'), false);
  const meta = await fetchText(`/receipt/${PRE}/preimage?meta=1`);
  assert.equal(meta.status, 200, meta.text.slice(0, 120));
  assert.match(meta.headers.get('cache-control') || '', /no-store/);
  const leafed = await fetchText(`/receipt/${A}/preimage`);
  assert.equal(leafed.status, 200, leafed.text.slice(0, 160));
  assert.match(leafed.headers.get('cache-control') || '', /public/);
  assert.match(leafed.headers.get('cache-control') || '', /max-age=300/);
});

test('public receipt views drop unsigned token, route, stamp, and float fields', async () => {
  const { redactPublicReceipt } = await import('../src/receipt.js');
  const stamped = redactPublicReceipt({
    task_id: A,
    issuer_signature: { jws: 'keep.this.jws', payload_hash: 'abc' },
    stamp: { fee_usd: '0.002', payment_ref: 'base:0xstampfee', paid_by: 'submitter' },
    usage: { prompt_tokens: 4242, completion_tokens: 4343, total_tokens: 8585, source: 'provider' },
    route: { model: 'served', resolved: 'served', requested: 'xfuel/auto', requested_model: 'xfuel/auto', substituted: true },
    provider_cogs: { actual: '12', below_low_water: true },
  });
  assert.equal(stamped.issuer_signature.jws, 'keep.this.jws');
  assert.equal(stamped.issuer_signature.payload_hash, 'abc');
  assert.equal(stamped.stamp.fee_usd, '0.002');
  assert.equal(stamped.stamp.payment_ref, undefined);
  assert.equal(stamped.stamp.paid_by, 'submitter');
  assert.equal(stamped.usage.prompt_tokens, undefined);
  assert.equal(stamped.usage.source, 'provider');
  assert.equal(stamped.route.model, 'served');
  assert.equal(stamped.route.resolved, undefined);
  assert.equal(stamped.route.requested, undefined);
  assert.equal(stamped.provider_cogs.actual, '12');
  assert.equal(stamped.provider_cogs.below_low_water, undefined);

  const json = await fetchText(`/receipt/${A}?format=json`);
  assert.equal(json.status, 200, json.text.slice(0, 160));
  const doc = JSON.parse(json.text);
  assert.equal(doc.usage?.prompt_tokens, undefined);
  assert.equal(doc.usage?.completion_tokens, undefined);
  assert.equal(doc.usage?.total_tokens, undefined);
  assert.equal(doc.route.resolved, undefined);
  assert.equal(doc.route.requested, undefined);
  assert.equal(doc.route.requested_model, undefined);
  assert.equal(doc.route.substituted, undefined);
  assert.equal(doc.route_meta.requested_model, undefined);
  assert.equal(doc.route.model.includes('Llama'), true);
  assert.equal(doc.provider_cogs.below_low_water, undefined);
  assert.equal(doc.provider_cogs.actual, '12');
  assert.equal(json.text.includes('xfuel/auto'), false);
  assert.equal(json.text.includes('4242'), false);
  assert.equal(json.text.includes('4343'), false);
  assert.equal(json.text.includes('below_low_water'), false);
  const again = await fetchText(`/receipt/${A}?format=json`);
  assert.equal(JSON.parse(again.text).issuer_signature.jws, doc.issuer_signature.jws);

  const html = await fetchText(`/receipt/${A}`);
  assert.equal(html.status, 200);
  assert.equal(html.text.includes('xfuel/auto'), false);
  assert.equal(html.text.includes('4242'), false);
  assert.equal(html.text.includes('4343'), false);
  assert.equal(html.text.includes('low water'), false);
  assert.equal(html.text.includes('below_low_water'), false);

  const auditor = await fetchText(`/receipt/${A}?format=auditor`);
  assert.equal(auditor.status, 200, auditor.text.slice(0, 120));
  assert.equal(auditor.text.includes('xfuel/auto'), false);
  assert.equal(auditor.text.includes('4242'), false);
  assert.equal(auditor.text.includes('below_low_water'), false);

  const card = await fetchText(`/receipt/${A}/og.png`);
  assert.equal(card.status, 200);
  assert.equal(card.text.includes('xfuel/auto'), false);
  assert.equal(card.text.includes('4242'), false);

  const followed = await fetchText(`/receipt/by-tx?tx=${TX_A}&format=json`);
  assert.equal(followed.status, 302, followed.text);
  const loc = followed.headers.get('location') || '';
  const canonical = await fetchText(new URL(loc).pathname + new URL(loc).search);
  assert.equal(canonical.status, 200, canonical.text.slice(0, 120));
  assert.equal(canonical.text.includes('xfuel/auto'), false);
  assert.equal(canonical.text.includes('4242'), false);
});

test('published fixtures stay VERIFIED after unsigned fields are dropped', async () => {
  const { readFileSync } = await import('node:fs');
  const { redactPublicReceipt } = await import('../src/receipt.js');
  const { verifyReceipt } = await import('../../../packages/verify/dist/index.js');
  const dir = fileURLToPath(new URL('../../../packages/verify/test/fixtures/public/', import.meta.url));
  for (const name of ['chit-1ebc5616.json', 'chit-39af100b.json']) {
    const original = JSON.parse(readFileSync(`${dir}${name}`, 'utf8'));
    const jws = original.issuer_signature.jws;
    const redacted = redactPublicReceipt(original);
    assert.equal(redacted.issuer_signature.jws, jws, name);
    assert.equal(redacted.usage?.prompt_tokens, undefined, name);
    assert.equal(redacted.usage?.completion_tokens, undefined, name);
    assert.equal(redacted.route?.resolved, undefined, name);
    assert.equal(redacted.route?.requested, undefined, name);
    assert.equal(redacted.provider_cogs?.below_low_water, undefined, name);
    assert.equal(redacted.stamp?.payment_ref, undefined, name);
    assert.equal(original.issuer_signature.jws, jws, name);
    const before = await verifyReceipt(original, {});
    const after = await verifyReceipt(redacted, {});
    assert.equal(before.overall, 'verified', name);
    assert.equal(after.overall, 'verified', name);
    assert.equal(before.issuer_signature.valid, true, name);
    assert.equal(after.issuer_signature.valid, true, name);
  }
});

test('non-receipt 500 bodies do not echo the exception', async () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
  for (const label of [
    'GET /.well-known/x402 error',
    'GET /openapi.json error',
    'GET /stats error',
    'GET /stats/door error',
    'GET /health error',
    'book export get error',
    'book export post error',
    'book gaps error',
    'POST /task-quote error',
    'POST /task-request error',
    'POST /v1/agents/register error',
  ]) {
    const at = src.indexOf(label);
    assert.ok(at > 0, label);
    const window = src.slice(at, at + 220);
    assert.equal(window.includes('err.message'), false, window);
  }
  assert.equal(src.includes("status: 'error', message: err.message"), false);

  const secret = 'ENOENT /var/lib/chit-secret-nonreceipt';
  const tree = getReceiptMerkleTree();
  const bundle = tree.bundleStatus.bind(tree);
  tree.bundleStatus = () => { throw new Error(secret); };
  try {
    const health = await fetchText('/health');
    assert.equal(health.status, 503, health.text);
    assert.deepEqual(JSON.parse(health.text), { error: 'internal', code: 'health_failed' });
    assert.equal(health.text.includes(secret), false);
    assert.equal(health.text.includes('ENOENT'), false);
  } finally {
    tree.bundleStatus = bundle;
  }

  const store = getAIListener().activeTasks;
  const hadSnapshots = typeof store.allSnapshots === 'function';
  const snapshots = hadSnapshots ? store.allSnapshots.bind(store) : null;
  store.allSnapshots = () => ({
    [Symbol.iterator]() { throw new Error(secret); },
  });
  try {
    for (const [path, code] of [['/stats?format=json', 'stats_failed'], ['/stats/door', 'stats_door_failed']]) {
      const res = await fetchText(path);
      assert.equal(res.status, 500, `${path} ${res.text}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'internal', code });
      assert.equal(res.text.includes(secret), false, path);
      assert.equal(res.text.includes('/var/lib'), false, path);
    }
  } finally {
    if (hadSnapshots) store.allSnapshots = snapshots;
    else delete store.allSnapshots;
  }

  const { getFloatManager } = await import('../src/provider-float.js');
  const floats = getFloatManager();
  const select = floats.selectForQuote.bind(floats);
  floats.selectForQuote = () => { throw new Error(secret); };
  try {
    const quote = await fetch(`${base}/task-quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const text = await quote.text();
    assert.equal(quote.status, 500, text.slice(0, 180));
    assert.deepEqual(JSON.parse(text), { error: 'internal', code: 'task_quote_failed' });
    assert.equal(text.includes(secret), false);
  } finally {
    floats.selectForQuote = select;
  }

  const config = (await import('../src/config.js')).default;
  const savedX402 = config.x402;
  config.x402 = new Proxy({}, { get() { throw new Error(secret); } });
  try {
    for (const [path, code] of [['/.well-known/x402', 'x402_failed'], ['/openapi.json', 'openapi_failed']]) {
      const res = await fetchText(path);
      assert.equal(res.status, 500, `${path} ${res.text.slice(0, 160)}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'internal', code });
      assert.equal(res.text.includes(secret), false, path);
    }
  } finally {
    config.x402 = savedX402;
  }

  const registry = httpApp.locals.__test.agentRegistry;
  const getAgent = registry.get.bind(registry);
  registry.get = () => { throw new Error(secret); };
  try {
    for (const [path, code] of [
      ['/v1/agents/1/book/export', 'book_export_failed'],
      ['/v1/agents/1/book/gaps', 'book_gaps_failed'],
    ]) {
      const res = await fetchText(path, { 'x-xfuel-session': 'not-a-session' });
      assert.equal(res.status, 500, `${path} ${res.text.slice(0, 160)}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'internal', code });
      assert.equal(res.text.includes(secret), false, path);
    }
    const posted = await fetch(`${base}/v1/agents/1/book/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xfuel-session': 'not-a-session' },
      body: '{}',
    });
    const postedText = await posted.text();
    assert.equal(posted.status, 500, postedText.slice(0, 160));
    assert.deepEqual(JSON.parse(postedText), { error: 'internal', code: 'book_export_failed' });
    assert.equal(postedText.includes(secret), false);
  } finally {
    registry.get = getAgent;
  }
});

test('filesWithoutCompletion lists files that did not finish', async () => {
  const { filesWithoutCompletion } = await import('../scripts/run-tests.mjs');
  const a = '/tmp/a.test.mjs';
  const b = '/tmp/b.test.mjs';
  const both = `${JSON.stringify({ file: a, passed: true })}\n${JSON.stringify({ file: b, passed: true })}\n`;
  assert.deepEqual(filesWithoutCompletion(both, [a, b]), []);
  assert.deepEqual(filesWithoutCompletion(`${JSON.stringify({ file: a, passed: true })}\n`, [a, b]), [b]);
  assert.deepEqual(filesWithoutCompletion('', [a, b]), [a, b]);
  assert.deepEqual(
    filesWithoutCompletion(`${JSON.stringify({ file: a, passed: false })}\n{"fi`, [a, b]),
    [b],
  );
});

test('the file-done reporter records a finished file', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { filesWithoutCompletion } = await import('../scripts/run-tests.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'file-done-'));
  const file = join(dir, 'one.test.mjs');
  const out = join(dir, 'files.jsonl');
  writeFileSync(file, "import { test } from 'node:test';\ntest('one', () => {});\n");
  const reporter = fileURLToPath(new URL('../scripts/file-done-reporter.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--test',
    `--test-reporter=${reporter}`,
    `--test-reporter-destination=${out}`,
    file,
  ], { env, encoding: 'utf8' });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(filesWithoutCompletion(readFileSync(out, 'utf8'), [file]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('public receipt routes for one id do not carry the other receipt', async () => {
  const paths = [
    `/receipt/${A}`,
    `/receipt/${A}?format=json`,
    `/receipt/${A}?format=html`,
    `/receipt/${A}?format=auditor`,
    `/receipt/${A}?format=audit`,
    `/receipt/${A}?format=auditor&view=html`,
    `/receipt/${A}.json`,
    `/receipt/${A}/preimage`,
    `/receipt/${A}/preimage?meta=1`,
    `/receipt/${A}/preimage?raw=1`,
    `/receipt/${A}/preimage/tree_head_hash`,
    `/receipt/${A}/preimage/tree_head_hash?raw=1`,
    `/receipt/${A}/preimage/no-such-field`,
    `/receipt/${A}/og.png`,
    `/v1/receipts/${A}/inclusion`,
    '/v1/receipts/tree/head',
    '/v1/receipts/tree/epoch',
    '/v1/receipts/tree/consistency?first=1&second=2',
    `/receipt/not-planted?format=json&tx=${TX_B}`,
    '/receipt/not-planted?format=json',
    '/this-route-is-not-real',
  ];
  const accepts = [undefined, 'text/html', 'application/json', '*/*', 'application/xml'];
  for (const path of paths) {
    for (const accept of accepts) {
      const headers = accept ? { Accept: accept } : {};
      const res = await fetchText(path, headers);
      assertNoForeign(res.text, `${path} accept=${accept || 'none'}`);
      assert.equal(res.text.includes(leafHash(`${B}|${ROW_B}`)) && !res.text.includes('"hash":"' + leafHash(`${B}|${ROW_B}`) + '"'), false);
    }
  }
});
