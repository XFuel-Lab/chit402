/**
 * Issuer JWS bytes survive hot-map eviction.
 *
 * Doctor, 2026-10-05: GET /receipt/chit-66ca86e4-601a-4c44-92c7-4cfb9213fcd6
 * returned a new issuer_signature.jws on every read (signature segment only).
 * Claims and payload_hash stayed put. book_chain stayed put. The Bankr control
 * chit-1ebc5616 kept one issuer JWS. ES256 is non-deterministic, and the byok
 * row's signature lived only on the ephemeral rehydrate — flushAll never saw it.
 *
 * Coverage (coverage.issuer_signature) is a different document, signed when the
 * book export is built. These tests do not treat that JWS as the receipt.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-jws-evict-'));
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.TASK_STORE_PERSIST = 'true';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt } = await import('../src/receipt.js');
const { PersistentTaskStore } = await import('../src/task-store.js');

const BASE_URL = 'https://api.chit402.com';
const STORED_UUID = '1ebc5616-d9ce-4da9-b56c-847062ff6b96';
const BARE_UUID = '66ca86e4-601a-4c44-92c7-4cfb9213fcd6';
const STORED_ID = `xfuel-${STORED_UUID}`;
const BARE_ID = `xfuel-${BARE_UUID}`;

let server;
let base;
let originalJws;
let originalHash;

function byokTask(taskId, txNibble) {
  const tx = `0x${txNibble.repeat(32)}`;
  return {
    taskId,
    status: 'completed',
    createdAt: 1790432737000,
    updatedAt: 1790432738000,
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:${tx}`,
      amount: '2000',
      modelId: 'openrouter/meta-llama/llama-3.1-8b-instruct',
      requestedModel: 'openrouter/meta-llama/llama-3.1-8b-instruct',
      modelSubstituted: false,
    },
    meta: {
      payerWallet: '0x9F8951CB8b060f52fdf87297b3c5B00f7aa18f52',
      payTo: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
      paymentAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      provider: 'openrouter',
      chain: 'base',
      agentId: 187,
      pricing: {
        platform_fee: '0',
        fee_bps: 0,
        tier2_proof: '0',
        floor_applied: false,
        basis: 'byok_receipt',
      },
      providerCogs: {
        provider: 'openrouter',
        currency: 'USD',
        basis: 'reported',
        paid_by: 'caller-to-openrouter',
        label: 'paid-by-caller-to-OpenRouter',
        reported_cost_usd: '0.00000083',
      },
      openrouter: {
        label: 'paid-by-caller-to-OpenRouter',
        served_model: 'openrouter/meta-llama/llama-3.1-8b-instruct',
        generation_id: null,
      },
      openrouterBilling: 'byok',
    },
    usage: { prompt_tokens: 19, completion_tokens: 9, total_tokens: 28, source: 'provider' },
    outputHash: '0xb86df5c8b6c79662794a21700ca77aac410eec34db8cf9d26fdbb0df9fd00e47',
    result: {
      provider: 'openrouter',
      model: 'openrouter/meta-llama/llama-3.1-8b-instruct',
      outputHash: '0xb86df5c8b6c79662794a21700ca77aac410eec34db8cf9d26fdbb0df9fd00e47',
    },
  };
}

function jwsParts(jws) {
  const parts = String(jws || '').split('.');
  assert.equal(parts.length, 3);
  return { header: parts[0], payload: parts[1], sig: parts[2] };
}

async function getReceipt(taskId) {
  const res = await fetch(`${base}/receipt/${taskId}?format=json`);
  assert.equal(res.status, 200, taskId);
  const shell = await res.json();
  assert.equal(shell.schema, 'chit402.receipt_shell.v1');
  assert.equal(shell.issuer_signature, undefined);
  const store = getAIListener().activeTasks;
  const storedId = taskId.startsWith('chit-') ? `xfuel-${taskId.slice(5)}` : taskId;
  const onDisk = JSON.parse(fs.readFileSync(store._fileFor(storedId), 'utf8'));
  return buildReceipt(onDisk, {
    baseUrl: BASE_URL,
    persistSignature: false,
    agentId: onDisk.meta?.agentId ?? onDisk.meta?.agent_id ?? null,
  });
}

before(async () => {
  await initAIListener();
  const store = getAIListener().activeTasks;
  assert.equal(store.persist, true, 'eviction test needs a durable task store');

  const stored = byokTask(STORED_ID, 'cd');
  const drafted = buildReceipt(stored, {
    baseUrl: BASE_URL,
    persistSignature: true,
    agentId: 187,
  });
  originalJws = drafted.issuer_signature.jws;
  originalHash = drafted.issuer_signature.payload_hash;
  store.set(STORED_ID, stored);
  assert.equal(store.delete(STORED_ID), true);

  const bare = byokTask(BARE_ID, 'ab');
  store.set(BARE_ID, bare);
  assert.equal(store.delete(BARE_ID), true);
  assert.equal(store.size, 0, 'both rows evicted');
  const bareFile = JSON.parse(fs.readFileSync(store._fileFor(BARE_ID), 'utf8'));
  assert.equal(bareFile.issuerSignature, undefined, 'byok row on disk has no issuer JWS yet');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try { getAIListener().activeTasks.destroy(); } catch { /* listener may already be down */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('two GETs after eviction keep a stored issuer JWS byte-identical', async () => {
  const first = await getReceipt(`chit-${STORED_UUID}`);
  const second = await getReceipt(`chit-${STORED_UUID}`);
  assert.equal(first.issuer_signature.jws, originalJws);
  assert.equal(second.issuer_signature.jws, originalJws);
  assert.equal(first.issuer_signature.payload_hash, originalHash);
  assert.equal(second.issuer_signature.payload_hash, originalHash);
  assert.equal(jwsParts(first.issuer_signature.jws).payload, jwsParts(originalJws).payload);
  assert.equal(getAIListener().activeTasks.size, 0);
});

test('two GETs after eviction persist one issuer JWS for a byok row that had none', async () => {
  const store = getAIListener().activeTasks;
  const first = await getReceipt(`chit-${BARE_UUID}`);
  const second = await getReceipt(`chit-${BARE_UUID}`);

  assert.equal(first.issuer_signature.jws, second.issuer_signature.jws);
  assert.equal(first.issuer_signature.payload_hash, second.issuer_signature.payload_hash);
  const firstParts = jwsParts(first.issuer_signature.jws);
  const secondParts = jwsParts(second.issuer_signature.jws);
  assert.equal(firstParts.header, secondParts.header);
  assert.equal(firstParts.payload, secondParts.payload);
  assert.equal(firstParts.sig, secondParts.sig);
  assert.equal(store.size, 0, 'the sealed read stays out of the hot map');

  const onDisk = JSON.parse(fs.readFileSync(store._fileFor(BARE_ID), 'utf8'));
  assert.equal(onDisk.issuerSignature.jws, first.issuer_signature.jws);
  assert.equal(onDisk.persistSignatureSnapshot, undefined);

  // A restarted store has no pin. It must still reuse the sealed JWS.
  const restarted = new PersistentTaskStore({ dir: store.dir, autoFlushMs: 0 });
  try {
    assert.equal(restarted.size, 0);
    const reread = restarted.get(BARE_ID);
    const rebuilt = buildReceipt(reread, {
      baseUrl: BASE_URL,
      persistSignature: true,
      agentId: 187,
    });
    assert.equal(rebuilt.issuer_signature.jws, first.issuer_signature.jws);
    assert.equal(rebuilt.issuer_signature.payload_hash, first.issuer_signature.payload_hash);
  } finally {
    restarted.destroy();
  }
});
