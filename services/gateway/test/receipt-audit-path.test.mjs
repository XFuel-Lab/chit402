/**
 * Public GET /receipt/:id must not publish any other leaf's task id or body.
 * The book stays possession-gated. This file does not sign a production receipt.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
delete process.env.SOLANA_ANCHOR_SECRET_KEY;
delete process.env.SOLANA_RPC_URL;

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const logger = (await import('../src/logger.js')).default;

const { verifyReceipt } = await import('../../../packages/verify/dist/index.js');
const { verifyPublishedPreimages } = await import('../../../packages/verify/dist/preimage.js');
const cliPath = fileURLToPath(new URL('../../../packages/verify/dist/cli.js', import.meta.url));

const SPECIMEN = 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
const FOREIGN = [
  'xfuel-other-payer-0001',
  'xfuel-546baa6c',
  'xfuel-other-payer-0003',
  'xfuel-other-payer-0005',
  'xfuel-other-payer-0006',
  'xfuel-other-payer-0007',
  'xfuel-other-payer-0008',
];

let server;
let base;
let httpApp;
let genesisBody = '';
const planted = [];

function paidTask(taskId, nibble) {
  const tx = `0x${String(nibble).padStart(2, '0')}${'46'.repeat(31)}`;
  return {
    taskId,
    status: 'completed',
    createdAt: 1_790_432_737_000,
    updatedAt: 1_790_432_738_000,
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:${tx}`,
      amount: '2000',
      modelId: 'akash/meta-llama/Llama-3.3-70B-Instruct',
    },
    meta: {
      payerWallet: '0x9F8951CB8b060f52fdf87297b3c5B00f7aa18f52',
      payTo: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
      paymentAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      provider: 'akash-network',
      chain: 'base',
      agentId: 187,
    },
    result: {
      provider: 'akash-network',
      model: 'akash/meta-llama/Llama-3.3-70B-Instruct',
    },
  };
}

function foreignSecrets(ownTaskId) {
  const secrets = [genesisBody];
  for (const row of planted) {
    if (row.taskId === ownTaskId) continue;
    secrets.push(row.taskId, row.body);
  }
  return secrets;
}

function assertNoForeign(text, ownTaskId, label) {
  const hay = String(text);
  for (const secret of foreignSecrets(ownTaskId)) {
    assert.equal(hay.includes(secret), false, `${label} exposed ${secret}`);
  }
  assert.equal(hay.includes('"leaves"'), false, `${label} still has a leaves array`);
}

before(async () => {
  resetReceiptMerkleTree();
  const tree = getReceiptMerkleTree();
  genesisBody = tree.genesisLeaf().bytes.toString('utf8');
  await initAIListener();
  const store = getAIListener().activeTasks;
  httpApp = createApp();
  const ledger = httpApp.locals.__test.usageSettled;
  const plant = (taskId, rowHash, nibble) => {
    tree.appendReceipt(taskId, rowHash, { publish: false });
    planted.push({
      taskId,
      body: `${taskId}|${rowHash}`,
      index: tree.byTask.get(taskId),
    });
    store.set(taskId, paidTask(taskId, nibble));
  };
  FOREIGN.slice(0, 3).forEach((taskId, i) => {
    plant(taskId, `audit-row-${i}-${taskId}`, (i + 1).toString(16));
  });
  ledger._index({
    task_id: SPECIMEN,
    agent_id: 187,
    evidence: 'collected',
    amount: '2000',
    collected_at: '2026-09-05T17:14:11.000Z',
  }, { persist: false, notify: false });
  const booked = ledger.findByTask(SPECIMEN);
  plant(SPECIMEN, booked.book_chain.row_hash, '4');
  FOREIGN.slice(3).forEach((taskId, i) => {
    plant(taskId, `audit-row-${i + 4}-${taskId}`, (i + 5).toString(16));
  });
  assert.ok(planted.every((row) => row.index > 0));
  assert.equal(planted.find((row) => row.taskId === SPECIMEN).index, 4);
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
    for (const row of planted) store.delete(row.taskId);
  } catch { /* listener already down */ }
  resetReceiptMerkleTree();
});

async function fetchText(path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, type: res.headers.get('content-type') || '' };
}

test('a public receipt at index > 0 shows only its own leaf across tree sizes', async () => {
  for (const row of planted) {
    const json = await fetchText(`/receipt/${row.taskId}?format=json`);
    assert.equal(json.status, 200, json.text.slice(0, 200));
    assert.match(json.headers.get('cache-control') || '', /no-store/);
    assertNoForeign(json.text, row.taskId, `json ${row.taskId}`);
    const doc = JSON.parse(json.text);
    const field = doc.preimages?.fields?.tree_head_hash;
    assert.ok(field, `missing audit field for ${row.taskId}`);
    assert.equal(field.leaf.task_id, row.taskId);
    assert.equal(field.leaf.preimage_utf8, row.body);
    assert.equal(field.audit_path.index, row.index);
    assert.equal(field.audit_path.tree_size, row.index + 1);
    assert.equal(field.audit_path.root, field.hash);
    assert.ok(Array.isArray(field.audit_path.siblings));
    for (const step of field.audit_path.siblings) {
      assert.deepEqual(Object.keys(step), ['hash']);
      assert.match(step.hash, /^[0-9a-f]{64}$/);
    }
    const html = await fetchText(`/receipt/${row.taskId}`);
    assert.equal(html.status, 200);
    assert.match(html.type, /html/);
    assertNoForeign(html.text, row.taskId, `html ${row.taskId}`);
  }
});

test('query params, Accept, format, and the verify page cannot restore other leaves', async () => {
  const id = SPECIMEN;
  const probes = [
    [`/receipt/${id}?format=json`, {}],
    [`/receipt/${id}?format=html`, {}],
    [`/receipt/${id}?format=auditor`, {}],
    [`/receipt/${id}?format=audit`, {}],
    [`/receipt/${id}?format=auditor&view=html`, {}],
    [`/receipt/${id}.json`, {}],
    [`/receipt/${id}?format=json&leaves=1`, {}],
    [`/receipt/${id}?format=json&include=leaves`, {}],
    [`/receipt/${id}?format=json&prefix=full`, {}],
    [`/receipt/${id}?format=json&debug=1`, {}],
    [`/receipt/${id}?format=json&raw=1`, {}],
    [`/receipt/${id}?format=leaves`, {}],
    [`/receipt/${id}?leaves=all&view=full`, { Accept: 'application/json' }],
    [`/receipt/${id}`, { Accept: 'application/json' }],
    [`/receipt/${id}`, { Accept: 'text/html' }],
    [`/receipt/${id}`, { Accept: '*/*' }],
    [`/receipt/${id}/preimage/tree_head_hash`, {}],
    [`/receipt/${id}/preimage/tree_head_hash?raw=1`, {}],
    [`/receipt/${id}/preimage/tree_head_hash?format=json`, {}],
    [`/receipt/${id}/preimage`, {}],
    [`/receipt/${id}/preimage?meta=1`, {}],
    ['/receipt/not-a-real-receipt?format=json', {}],
    ['/receipt/not-a-real-receipt', { Accept: 'text/html' }],
    [`/receipt/${id}/preimage/no-such-field`, {}],
    ['/v1/agents/187/book', {}],
  ];
  for (const [path, headers] of probes) {
    const res = await fetchText(path, headers);
    assert.notEqual(res.status, 500, `${path} ${res.text.slice(0, 180)}`);
    assertNoForeign(res.text, id, `${res.status} ${path}`);
    if (path.includes('tree_head_hash') && !path.includes('raw=1') && res.status === 200) {
      const field = JSON.parse(res.text);
      assert.equal(field.leaf.task_id, id);
      assert.equal(Object.prototype.hasOwnProperty.call(field, 'leaves'), false);
    }
  }

  const again = await fetchText(`/receipt/${id}?format=json`);
  assert.match(again.headers.get('cache-control') || '', /no-store/);
  assertNoForeign(again.text, id, 'second json');

  const book = await fetchText('/v1/agents/187/book');
  assert.equal(book.status, 401);
  assert.equal(book.text, '');
});

test('the chit-1ebc5616 style receipt verifies, and a tampered audit path does not', async () => {
  const res = await fetchText(`/receipt/${SPECIMEN}?format=json`);
  assert.equal(res.status, 200);
  const receipt = JSON.parse(res.text);
  const kid = receipt.issuer_signature.kid;
  const checked = await verifyReceipt(receipt, {
    trustedKids: [kid],
    skipIssuerHistory: true,
    requirePreimages: true,
    rpcUrl: 'http://127.0.0.1:9',
  });
  assert.equal(checked.overall, 'verified', checked.errors.join('; '));
  assert.equal(checked.preimages.ok, true);

  const dir = mkdtempSync(join(tmpdir(), 'chit-audit-http-'));
  const file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify(receipt));
  const cli = cliPath;
  for (const extra of [[], ['--rpc', 'http://127.0.0.1:9']]) {
    const run = spawnSync(process.execPath, [
      cli,
      file,
      '--json',
      '--no-issuer-history',
      '--trusted-kid',
      kid,
      ...extra,
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, `status=${run.status} stderr=${run.stderr} stdout=${run.stdout}`);
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.overall, 'verified', (parsed.errors || []).join('; '));
    assert.equal(parsed.preimages.ok, true);
  }

  const field = receipt.preimages.fields.tree_head_hash;
  const cases = [
    (copy) => { copy.preimages.fields.tree_head_hash.audit_path.siblings[0].hash = 'cd'.repeat(32); },
    (copy) => {
      copy.preimages.fields.tree_head_hash.audit_path.index = 1;
      copy.preimages.fields.tree_head_hash.leaf.index = 1;
    },
    (copy) => { copy.preimages.fields.tree_head_hash.audit_path.tree_size = field.audit_path.tree_size + 4; },
    (copy) => { copy.preimages.fields.tree_head_hash.leaf.preimage_utf8 = `${SPECIMEN}|forged-body`; },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(receipt);
    mutate(copy);
    const failed = await verifyPublishedPreimages(copy, { requirePreimages: true });
    assert.equal(failed.ok, false, JSON.stringify(failed));
  }
});

test('receipt error bodies stay generic and the log keeps the cause', async () => {
  const secret = 'xfuel-error-leaf-body-not-for-clients';
  const tree = getReceiptMerkleTree();
  const ledger = httpApp.locals.__test.usageSettled;
  const originals = {
    latestSignedHead: tree.latestSignedHead,
    signedClosedEpochHead: tree.signedClosedEpochHead,
    consistency: tree.consistency,
    findByPaymentQuery: ledger.findByPaymentQuery,
    error: logger.error,
  };
  const logged = [];
  logger.error = (obj, msg) => {
    const err = obj && typeof obj === 'object' ? obj.err : null;
    logged.push(`${msg || ''} ${err?.message || ''}`);
    return originals.error.call(logger, obj, msg);
  };
  const boom = () => {
    throw new Error(`boom ${secret}`);
  };
  tree.latestSignedHead = boom;
  tree.signedClosedEpochHead = boom;
  tree.consistency = boom;
  ledger.findByPaymentQuery = boom;
  try {
    const paths = [
      `/receipt/by-tx?tx=0x${'e7'.repeat(32)}`,
      '/v1/receipts/tree/head',
      '/v1/receipts/tree/epoch/1/head',
      '/v1/receipts/tree/consistency?first=1&second=2',
    ];
    for (const path of paths) {
      const res = await fetchText(path);
      assert.equal(res.status, 500, `${path} ${res.text}`);
      assert.deepEqual(JSON.parse(res.text), { error: 'internal', message: 'internal error' });
      assert.equal(res.text.includes(secret), false, path);
    }
    assert.equal(logged.some((line) => line.includes(secret)), true);
    assert.equal(logged.filter((line) => line.includes(secret)).length >= paths.length, true);
  } finally {
    tree.latestSignedHead = originals.latestSignedHead;
    tree.signedClosedEpochHead = originals.signedClosedEpochHead;
    tree.consistency = originals.consistency;
    ledger.findByPaymentQuery = originals.findByPaymentQuery;
    logger.error = originals.error;
  }
});
