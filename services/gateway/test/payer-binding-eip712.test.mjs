/**
 * Payer binding (EIP-712 ReceiptBinding), tests B1-B12 of the escrow v0
 * brief. Offline: synthetic key, local server, no network.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Wallet, ethers } from 'ethers';
import { syntheticIssuerKey, syntheticIssuerKeyEnv } from '../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';
import { stubSigner } from './helpers/fixed-head-scenario.mjs';

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'payer-binding-test-secret';
process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();
const KEY = syntheticIssuerKey();
process.env.ISSUER_KID = KEY.kid;
process.env.OWNER_VIEW_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'payer-binding-ov-')), 'owner-view.sqlite');
process.env.AGENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'payer-binding-agents-'));
process.env.OWNER_VIEW_FETCH_MAX = '8000';
process.env.OWNER_VIEW_CHALLENGE_MAX = '800';
process.env.OWNER_VIEW_NOT_FOUND_BUDGET_MS = '8';
process.env.OWNER_VIEW_AUDIENCES = '127.0.0.1';
delete process.env.RECEIPT_PAYER_BINDING_EIP712;
delete process.env.RECEIPT_FIXED_HEAD_EIP712;
delete process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS;
delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;

const here = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'escrow-eip712-vectors.json'), 'utf8'));
const BINDING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'payer-binding-store-'));
fs.rmdirSync(BINDING_DIR); // the store creates it on first write
process.env.RECEIPT_PAYER_BINDING_DIR = BINDING_DIR;

const E = await import('../src/eip712-p256.js');
const B = await import('../src/receipt-binding-eip712.js');
const { openPayerBindingStore, payerBindingStoreDir } = await import('../src/payer-binding-store.js');
const W = await import('../src/payer-binding-worker.js');
const guard = await import('../src/issuer-signer-guard.js');
const { leafHashOf, BASE_USDC } = await import('../src/public-attestation.js');
const { ReceiptMerkleTree, _setReceiptMerkleTreeForTest, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const { acquireReceiptLogLock, _releaseReceiptLogLocksForTest } = await import('../src/receipt-log-lock.js');
const { _setIssuerSignerForTest, createEnvSigner } = await import('../src/issuer-signer.js');
const { resetIssuerSigner } = await import('../src/issuer-signer-state.js');
const { _resetIssuerKey, getJwks } = await import('../src/issuer-key.js');
const { issuanceCapHealth } = await import('../src/issuance-cap.js');
const { EPOCH1_FINAL_ROOT, EPOCH1_GENESIS_DIGEST } = await import('../src/receipt-log-epoch.js');
const { _bookRowWrittenHookForTest } = await import('../src/usage-settled.js');
const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { NOT_FOUND_BODY } = await import('../src/owner-view.js');

const payerA = Wallet.createRandom();
const payerB = Wallet.createRandom();
const payTo = Wallet.createRandom();
const ROW = (n) => crypto.createHash('sha256').update(`row-${n}`).digest('hex');

// ---------------------------------------------------------------- helpers

const MADE = [];
function tmp(prefix = 'payer-binding-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  MADE.push(dir);
  return dir;
}

/** Counting wrapper round the real env signer: counts typed (EIP-712) signs. */
function countingSigner(inner) {
  const counts = { typed: 0, jws: 0 };
  let fail = null;
  return {
    counts,
    failWith(code) { fail = code; },
    signer: {
      kind: inner.kind,
      kid: inner.kid,
      publicJwk: inner.publicJwk,
      async sign(input, opts) {
        if (opts?.typedPreimage) {
          counts.typed += 1;
          if (fail) {
            const err = new Error('signer down');
            err.code = fail;
            throw err;
          }
        } else {
          counts.jws += 1;
        }
        return inner.sign(input, opts);
      },
    },
  };
}

/** A durable, pin-checked, locked tree in a fresh dir with fixed genesis. */
async function readyTree({ ready = true } = {}) {
  const dir = tmp('payer-binding-log-');
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.durable = true;
  tree.allowFreshGenesis = true;
  tree._now = () => new Date('2026-10-20T09:00:00.000Z');
  tree.genesisLeaf = () => ({
    task_id: 'genesis',
    bytes: Buffer.from('{"schema":"chit402.tree_genesis.v1","payload_version":1,"verifier_binary_build_digest":null}'),
    kind: 'genesis',
  });
  await tree.appendReceipt('seed-1', 'hash-1', { publish: false });
  tree.allowFreshGenesis = false;
  if (ready) {
    assert.equal(acquireReceiptLogLock(dir).held, true);
    tree.pinVerified = true;
    tree.logIdentity = { epoch1_root: EPOCH1_FINAL_ROOT, genesis_digest: EPOCH1_GENESIS_DIGEST };
  }
  return { tree, dir };
}

function claims({ payer = payerA.address, asset = BASE_USDC, gross = '2000', taskId = 'xfuel-pb-unit', network } = {}) {
  return {
    task_id: taskId,
    caller_binding: { payer_wallet: payer },
    payment: { rail: 'usdc', asset, gross_amount: gross, settled_amount: gross, ...(network === undefined ? {} : { network }) },
  };
}

function fakeJws(c) {
  return `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(c)).toString('base64url')}.c2ln`;
}

function withFlag(value, fn) {
  const prev = process.env.RECEIPT_PAYER_BINDING_EIP712;
  if (value == null) delete process.env.RECEIPT_PAYER_BINDING_EIP712;
  else process.env.RECEIPT_PAYER_BINDING_EIP712 = value;
  return Promise.resolve().then(fn).finally(() => {
    if (prev == null) delete process.env.RECEIPT_PAYER_BINDING_EIP712;
    else process.env.RECEIPT_PAYER_BINDING_EIP712 = prev;
  });
}

function unitWorker({ store, tree, jwsFor, signer, env, now, maxAttempts, randomBytes }) {
  return W.createPayerBindingWorker({
    store,
    tree: () => tree,
    holderJws: jwsFor,
    signer: () => signer,
    env: env || { RECEIPT_PAYER_BINDING_EIP712: 'true' },
    now,
    maxAttempts,
    randomBytes,
    baseDelayMs: 1000,
  });
}

/** Append a fresh leaf and enqueue it the way the server hook does. */
async function appendAndEnqueue(worker, tree, taskId, rowHash) {
  const had = W.taskHasLeaf(tree, taskId);
  await tree.appendReceipt(taskId, rowHash, { publish: false });
  if (had) return { queued: false, reason: 'had_leaf' };
  return worker.enqueueAppended({ taskId, rowHash, leafHash: W.appendedLeafHash(tree, taskId) });
}

/**
 * Capture everything written to fd 1 and 2 during fn: pino writes through
 * sonic-boom with fs.write / fs.writeSync, and the rest through the streams.
 */
async function captureLogs(fn) {
  const chunks = [];
  const take = (fd, data) => {
    if (fd === 1 || fd === 2) chunks.push(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
  };
  const orig = {
    out: process.stdout.write,
    err: process.stderr.write,
    write: fs.write,
    writeSync: fs.writeSync,
  };
  process.stdout.write = function patched(chunk, ...rest) { take(1, chunk); return orig.out.call(this, chunk, ...rest); };
  process.stderr.write = function patched(chunk, ...rest) { take(2, chunk); return orig.err.call(this, chunk, ...rest); };
  fs.write = function patched(fd, data, ...rest) { take(fd, data); return orig.write.call(fs, fd, data, ...rest); };
  fs.writeSync = function patched(fd, data, ...rest) { take(fd, data); return orig.writeSync.call(fs, fd, data, ...rest); };
  try {
    await fn();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
    fs.write = orig.write;
    fs.writeSync = orig.writeSync;
  }
  return chunks.join('');
}

// ---------------------------------------------------------------- server fixture

let appOff;
let appOn;
let serverOff;
let serverOn;
let baseOff;
let baseOn;
let hookOff;
let hookOn;
let envSigner;
let counting;

function plant(taskId, payer, { rail = 'usdc', asset = BASE_USDC } = {}) {
  const task = {
    taskId,
    status: 'completed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    intent: {
      type: 'inference_request',
      amount: '2000',
      paymentRail: rail,
      paymentRef: `base:0x${crypto.createHash('sha256').update(taskId).digest('hex')}`,
      model: 'hidden-model-pb',
    },
    meta: { payerWallet: payer, agentId: 4, provider: 'hidden-provider', payTo: payTo.address, paymentAsset: asset },
    outputHash: `0x${'cd'.repeat(32)}`,
  };
  getAIListener().activeTasks.set(taskId, task);
  return task;
}

async function listen(app) {
  return await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function openOwner(base, wallet, taskIds) {
  const issued = await (await fetch(`${base}/v1/receipts/owner/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: { receipt_ids: taskIds } }),
  })).json();
  const signature = await wallet.signTypedData(issued.typed_data.domain, issued.typed_data.types, issued.typed_data.message);
  const res = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: issued.challenge, signature, signer: wallet.address, kind: 'evm' }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

async function ownerBody(base, wallet, taskId) {
  const token = await openOwner(base, wallet, [taskId]);
  const res = await fetch(`${base}/v1/receipts/${taskId}/owner`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text() };
}

/** Holder JWS for a planted task: the gateway signs it on first load. */
async function holderJwsOf(base, taskId) {
  await fetch(`${base}/receipt/${taskId}?format=json`);
  const task = getAIListener().activeTasks.get(taskId);
  return task?.issuerSignature?.jws || null;
}

async function publicSurfaces(base, taskId) {
  const out = {};
  out.html = await (await fetch(`${base}/receipt/${taskId}`)).text();
  out.json = await (await fetch(`${base}/receipt/${taskId}?format=json`)).text();
  out.auditor = await (await fetch(`${base}/receipt/${taskId}?format=auditor`)).text();
  out.accept = await (await fetch(`${base}/receipt/${taskId}`, { headers: { accept: 'application/json' } })).text();
  out.preimage = await (await fetch(`${base}/receipt/${taskId}/preimage`)).text();
  out.raw = await (await fetch(`${base}/receipt/${taskId}/preimage?raw=1`)).text();
  out.og = (await (await fetch(`${base}/receipt/${taskId}/og.png`)).arrayBuffer()).byteLength;
  out.llms = await (await fetch(`${base}/llms.txt`)).text();
  out.health = await (await fetch(`${base}/health`)).text();
  out.ownerNoSession = await (await fetch(`${base}/v1/receipts/${taskId}/owner`)).text();
  return out;
}

/** Wait until the background daily publish has finished writing. */
async function settleJournal(dir) {
  const file = path.join(dir, 'journal.jsonl');
  let last = -1;
  for (let i = 0; i < 50; i += 1) {
    const size = fs.statSync(file).size;
    if (size === last) return;
    last = size;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

/** Per-surface digests, so a mismatch names the surface without huge diffs. */
function digests(surfaces) {
  return Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, crypto.createHash('sha256').update(String(v)).digest('hex')]));
}

async function runHook(hook, tree, taskId, rowHash) {
  _setReceiptMerkleTreeForTest(tree);
  await hook({ task_id: taskId, row_hash: rowHash });
  // The hook queues the job off its own path.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

before(async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  envSigner = createEnvSigner(process.env);
  // JWS bytes deterministic (stub), typed signs real under the synthetic key.
  counting = countingSigner(stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey }));
  _setIssuerSignerForTest(counting.signer);
  await initAIListener();
  appOff = await createApp();
  hookOff = _bookRowWrittenHookForTest();
  process.env.RECEIPT_PAYER_BINDING_EIP712 = 'true';
  appOn = await createApp();
  hookOn = _bookRowWrittenHookForTest();
  // The flag stays set: the process env is what a deployed flag-on app sees.
  // The flag-off app has no worker and no owner-view field either way.
  serverOff = await listen(appOff);
  serverOn = await listen(appOn);
  baseOff = `http://127.0.0.1:${serverOff.address().port}`;
  baseOn = `http://127.0.0.1:${serverOn.address().port}`;
  for (const app of [appOff, appOn]) {
    app.locals.__test.agentRegistry.byId.set(4, { agent_id: 4, agentWallet: Wallet.createRandom().address, session: 'sess-a' });
  }
});

after(async () => {
  try { getAIListener().stopListening(); } catch { /* not started */ }
  for (const app of [appOff, appOn]) {
    try { app?.locals?.ownerStore?.close?.(); } catch { /* closed */ }
  }
  for (const server of [serverOff, serverOn]) {
    if (!server) continue;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  _releaseReceiptLogLocksForTest?.();
  resetReceiptMerkleTree();
  resetIssuerSigner();
  delete process.env.RECEIPT_PAYER_BINDING_EIP712;
  for (const dir of [BINDING_DIR, ...MADE, path.dirname(process.env.OWNER_VIEW_DB), process.env.AGENTS_DIR]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- B1

test('B1: flag off: no binding store, no job, owner view and journal as before', async () => {
  assert.equal(B.payerBindingFlagOn({}), false);
  for (const v of ['TRUE', '1', 'yes', ' true', 'true ']) assert.equal(B.payerBindingFlagOn({ RECEIPT_PAYER_BINDING_EIP712: v }), false);
  assert.equal(B.payerBindingFlagOn({ RECEIPT_PAYER_BINDING_EIP712: 'true' }), true);
  assert.equal(appOff.locals.__test.payerBindingWorker, null);
  assert.equal(appOff.locals.__test.payerBindingStore != null, true);

  const taskId = 'xfuel-pb-b1';
  plant(taskId, payerA.address);
  const jwsBefore = await holderJwsOf(baseOff, taskId);
  assert.ok(jwsBefore);
  const { tree: treeOff, dir: dirOff } = await readyTree();
  const before = counting.counts.typed;
  await runHook(hookOff, treeOff, taskId, ROW(1));
  assert.equal(W.appendedLeafHash(treeOff, taskId), leafHashOf(taskId, ROW(1)));
  assert.equal(fs.existsSync(BINDING_DIR), false, 'no binding store created');
  assert.equal(counting.counts.typed, before);
  const owner = await ownerBody(baseOff, payerA, taskId);
  assert.equal(owner.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(owner.text)).sort(), ['jws', 'private_fields', 'row_hash', 'salt']);
  assert.equal(getAIListener().activeTasks.get(taskId).issuerSignature.jws, jwsBefore);

  // Same append through the flag-on hook: the log bytes are identical.
  const { tree: treeOn, dir: dirOn } = await readyTree();
  await runHook(hookOn, treeOn, taskId, ROW(1));
  await settleJournal(dirOff);
  await settleJournal(dirOn);
  assert.equal(
    fs.readFileSync(path.join(dirOn, 'journal.jsonl'), 'utf8'),
    fs.readFileSync(path.join(dirOff, 'journal.jsonl'), 'utf8'),
  );
  assert.deepEqual(fs.readdirSync(dirOn).sort(), fs.readdirSync(dirOff).sort());
  resetReceiptMerkleTree();
});

test('B1: flag off, holder JWS, public shells, owner view, book row and journal equal the main dab93caf golden', () => {
  // Same helper, run on main dab93caf to make the fixture, run here with the
  // flag unset in a fresh process.
  const golden = fs.readFileSync(path.join(here, 'fixtures', 'payer-binding-b1-main.json'), 'utf8');
  const out = path.join(tmp('payer-binding-b1-golden-'), 'b1.json');
  const env = { ...process.env };
  delete env.RECEIPT_PAYER_BINDING_EIP712;
  delete env.RECEIPT_PAYER_BINDING_DIR;
  const run = spawnSync(process.execPath, [path.join(here, 'helpers', 'make-payer-binding-golden.mjs'), out], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr.slice(-2000));
  const mine = fs.readFileSync(out, 'utf8');
  const a = JSON.parse(mine);
  const b = JSON.parse(golden);
  const digest = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
  for (const key of Object.keys(b)) {
    if (key === 'public') {
      for (const k of Object.keys(b.public)) assert.equal(digest(a.public[k]), digest(b.public[k]), `public.${k}`);
    } else {
      assert.equal(digest(a[key]), digest(b[key]), key);
    }
  }
  assert.equal(mine, golden);
  assert.equal(a.agents_dir_files.includes('payer-bindings'), false);
  assert.equal(a.owner.status, 200);
  assert.equal('payer_binding' in JSON.parse(a.owner.body), false);
});

// ---------------------------------------------------------------- B2

test('B2: flag on: JWS, public shells unchanged; binding is only a new owner-view field', async () => {
  const taskId = 'xfuel-pb-b2';
  plant(taskId, payerA.address);
  const jws = await holderJwsOf(baseOn, taskId);
  const { tree } = await readyTree();
  await runHook(hookOn, tree, taskId, ROW(2));
  await appOn.locals.__test.payerBindingWorker.tick();
  const sealed = appOn.locals.__test.payerBindingStore.getBinding(taskId);
  assert.ok(sealed, 'binding stored');
  assert.equal(getAIListener().activeTasks.get(taskId).issuerSignature.jws, jws, 'receipt JWS unchanged');
  // Same receipt, same log: the flag-on app (binding stored) and the
  // flag-off app serve the same public bytes.
  const publicOn = await publicSurfaces(baseOn, taskId);
  const publicOff = await publicSurfaces(baseOff, taskId);
  assert.deepEqual(digests(publicOn), digests(publicOff));
  assert.match(JSON.parse(publicOn.json).inclusion.leaf_hash, /^[0-9a-f]{64}$/);
  const ownerOff = JSON.parse((await ownerBody(baseOff, payerA, taskId)).text);
  const ownerOn = JSON.parse((await ownerBody(baseOn, payerA, taskId)).text);
  const { payer_binding: binding, ...rest } = ownerOn;
  assert.deepEqual(rest, ownerOff);
  assert.equal(ownerOn.jws, jws);
  assert.equal(binding.status, 'signed');
  assert.deepEqual(Object.keys(binding).sort(), ['binding', 'payer_salt', 'status']);
  resetReceiptMerkleTree();
});

// ---------------------------------------------------------------- B3

test('B3: binding vector: typehash, domain separator, structHash, commitment and e', () => {
  const v = VECTORS.receipt_binding;
  assert.equal(E.RECEIPT_BINDING_TYPE, v.type);
  assert.equal(E.RECEIPT_BINDING_TYPEHASH, v.typehash);
  assert.equal(E.RECEIPT_BINDING_TYPEHASH, '0x988137c56725cd0e31ca35c99b68f3e106602c950645b1a17ea521fe49100ba0');
  assert.equal(E.PAYER_COMMITMENT_TAG, '0x48d821d8afa6e4e7fb248cd90fb31e5b8e381d46154394f008c7ffabf630665d');
  assert.equal(E.BASE_USDC_ASSET_ID, '0xe388d402aba230f5d279b790e1c6cb48e608d50c648f65eb394dfa8a44b5ddb5');
  assert.equal(E.domainSeparator(E.RECEIPT_BINDING_DOMAIN_NAME, VECTORS.log_id.salt), v.domain_separator);
  for (const vec of v.vectors) {
    const [taskId, rowHash] = vec.leaf_preimage.split('|');
    assert.equal(`0x${leafHashOf(taskId, rowHash)}`, vec.message.leaf_hash);
    assert.equal(E.payerCommitment(vec.payer, Buffer.from(vec.payer_salt.slice(2), 'hex')), vec.message.payer_commitment);
    // Independent encoder for the commitment.
    const coder = ethers.AbiCoder.defaultAbiCoder();
    assert.equal(ethers.keccak256(coder.encode(['bytes32', 'address', 'bytes32'], [E.PAYER_COMMITMENT_TAG, vec.payer, vec.payer_salt])), vec.message.payer_commitment);
    const d = E.typedDigest('ReceiptBinding', vec.message, VECTORS.log_id.salt);
    assert.equal(d.structHash, vec.struct_hash);
    assert.equal(`0x${d.preimage.toString('hex')}`, vec.preimage);
    assert.equal(d.e, vec.e);
  }
  // The binding domain is not the tree-head domain.
  assert.notEqual(v.domain_separator, VECTORS.tree_head.domain_separator);
});

// ---------------------------------------------------------------- B4

test('B4: signed once after the append; retry and restart return stored bytes; no sign on GET', async () => {
  const { tree } = await readyTree();
  const store = openPayerBindingStore(tmp('payer-binding-b4-'));
  const c = countingSigner(envSigner);
  const jwsFor = (id) => fakeJws(claims({ taskId: id }));
  const worker = unitWorker({ store, tree, jwsFor, signer: c.signer });
  const q = await appendAndEnqueue(worker, tree, 'xfuel-pb-b4', ROW(4));
  assert.equal(q.queued, true);
  assert.deepEqual(await worker.tick(), ['signed']);
  assert.equal(c.counts.typed, 1);
  const bytes = fs.readFileSync(path.join(store.dir, 'xfuel-pb-b4.binding.json'), 'utf8');
  // Retry: same job again, and a second enqueue of the same leaf.
  assert.deepEqual(await worker.tick(), []);
  assert.equal(worker.enqueueAppended({ taskId: 'xfuel-pb-b4', rowHash: ROW(4), leafHash: leafHashOf('xfuel-pb-b4', ROW(4)) }).queued, false);
  store.updateJob('xfuel-pb-b4', { status: 'pending' });
  assert.deepEqual(await worker.tick(), ['signed']);
  // Restart: a fresh worker on the same store.
  const again = unitWorker({ store: openPayerBindingStore(store.dir), tree, jwsFor, signer: c.signer });
  assert.deepEqual(await again.tick(), []);
  // A second append of the same task is not fresh: no job.
  assert.equal((await appendAndEnqueue(again, tree, 'xfuel-pb-b4', ROW(4))).reason, 'had_leaf');
  assert.equal(c.counts.typed, 1);
  assert.equal(fs.readFileSync(path.join(store.dir, 'xfuel-pb-b4.binding.json'), 'utf8'), bytes);
  const view = W.payerBindingView(store, 'xfuel-pb-b4');
  assert.equal(view.status, 'signed');
  assert.equal(B.verifyBinding(view.binding, view.payer_salt, payerA.address, KEY.publicJwk).ok, true);
  assert.equal(view.binding.message.leaf_hash, `0x${leafHashOf('xfuel-pb-b4', ROW(4))}`);

  // Server: GETs never sign.
  const taskId = 'xfuel-pb-b4s';
  plant(taskId, payerA.address);
  await holderJwsOf(baseOn, taskId);
  const t2 = (await readyTree()).tree;
  // Signer down at append time: the job is pending.
  counting.failWith('issuer_sign_unavailable');
  const typedAtAppend = counting.counts.typed;
  await runHook(hookOn, t2, taskId, ROW(40));
  await appOn.locals.__test.payerBindingWorker.tick();
  assert.equal(counting.counts.typed, typedAtAppend + 1, 'one try, from the worker');
  counting.failWith(null);
  const typedBefore = counting.counts.typed;
  for (let i = 0; i < 3; i += 1) {
    await publicSurfaces(baseOn, taskId);
    const owner = JSON.parse((await ownerBody(baseOn, payerA, taskId)).text);
    assert.deepEqual(owner.payer_binding, { status: 'pending' });
  }
  assert.equal(counting.counts.typed, typedBefore, 'no sign on any GET');
  // The worker retries when the job is due.
  appOn.locals.__test.payerBindingStore.updateJob(taskId, { next_at: 0 });
  await appOn.locals.__test.payerBindingWorker.tick();
  assert.equal(counting.counts.typed, typedBefore + 1);
  const owner = JSON.parse((await ownerBody(baseOn, payerA, taskId)).text);
  assert.equal(owner.payer_binding.status, 'signed');
  for (let i = 0; i < 3; i += 1) await ownerBody(baseOn, payerA, taskId);
  assert.equal(counting.counts.typed, typedBefore + 1);
  resetReceiptMerkleTree();
});

// ---------------------------------------------------------------- B5

test('B5: payer, payer_salt and payer_commitment stay off public surfaces, logs and error bodies', async () => {
  const taskId = 'xfuel-pb-b5';
  plant(taskId, payerA.address);
  await holderJwsOf(baseOn, taskId);
  const { tree, dir } = await readyTree();
  let surfaces;
  const logs = await captureLogs(async () => {
    await runHook(hookOn, tree, taskId, ROW(5));
    await appOn.locals.__test.payerBindingWorker.tick();
    surfaces = await publicSurfaces(baseOn, taskId);
    surfaces.offline = await publicSurfaces(baseOff, taskId);
    // Error paths: other owner, unknown id.
    surfaces.otherOwner = (await ownerBody(baseOn, payerB, taskId)).text;
    surfaces.unknown = await (await fetch(`${baseOn}/v1/receipts/xfuel-pb-none/owner`)).text();
  });
  const sealed = appOn.locals.__test.payerBindingStore.getBinding(taskId);
  assert.ok(sealed);
  const secrets = [
    payerA.address.toLowerCase(),
    payerA.address.slice(2).toLowerCase(),
    sealed.payer_salt.slice(2),
    sealed.binding.message.payer_commitment.slice(2),
  ];
  const haystacks = {
    ...Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, JSON.stringify(v)])),
    logs,
    journal: fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8'),
    logDirFiles: fs.readdirSync(dir).map((f) => {
      const p = path.join(dir, f);
      return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : '';
    }).join('\n'),
  };
  for (const [name, hay] of Object.entries(haystacks)) {
    const lower = hay.toLowerCase();
    for (const secret of secrets) assert.equal(lower.includes(secret), false, `secret in ${name}`);
  }
  assert.match(logs, /payer_binding_signed/);
  // The store holds them, outside the log dir.
  assert.equal(path.relative(dir, appOn.locals.__test.payerBindingStore.dir).startsWith('..'), true);
  resetReceiptMerkleTree();
});

// ---------------------------------------------------------------- B6

test('B6: owner-only: no session or another owner gets the generic 404', async () => {
  const taskId = 'xfuel-pb-b6';
  plant(taskId, payerA.address);
  await holderJwsOf(baseOn, taskId);
  const { tree } = await readyTree();
  await runHook(hookOn, tree, taskId, ROW(6));
  await appOn.locals.__test.payerBindingWorker.tick();
  const none = await fetch(`${baseOn}/v1/receipts/${taskId}/owner`);
  assert.equal(none.status, 404);
  assert.equal(await none.text(), NOT_FOUND_BODY);
  const other = await ownerBody(baseOn, payerB, taskId);
  assert.equal(other.status, 404);
  assert.equal(other.text, NOT_FOUND_BODY);
  const own = await ownerBody(baseOn, payerA, taskId);
  assert.equal(own.status, 200);
  const view = JSON.parse(own.text).payer_binding;
  assert.equal(view.status, 'signed');
  assert.equal(B.verifyBinding(view.binding, view.payer_salt, payerA.address, KEY.publicJwk).ok, true);
  assert.equal(B.verifyBinding(view.binding, view.payer_salt, payerB.address, KEY.publicJwk).reason, 'commitment');
  resetReceiptMerkleTree();
});

// ---------------------------------------------------------------- B7

test('B7: payer_salt is 32 CSPRNG bytes; two bindings for one payer have different commitments', async () => {
  const { tree } = await readyTree();
  const store = openPayerBindingStore(tmp('payer-binding-b7-'));
  const seen = [];
  const spy = (n) => {
    const out = crypto.randomBytes(n);
    seen.push(n);
    return out;
  };
  const worker = unitWorker({ store, tree, jwsFor: (id) => fakeJws(claims({ taskId: id })), signer: envSigner, randomBytes: spy });
  await appendAndEnqueue(worker, tree, 'xfuel-pb-b7a', ROW(71));
  await appendAndEnqueue(worker, tree, 'xfuel-pb-b7b', ROW(72));
  assert.deepEqual(await worker.tick(), ['signed', 'signed']);
  assert.deepEqual(seen, [32, 32]);
  const a = store.getBinding('xfuel-pb-b7a');
  const b = store.getBinding('xfuel-pb-b7b');
  assert.match(a.payer_salt, /^0x[0-9a-f]{64}$/);
  assert.notEqual(a.payer_salt, b.payer_salt);
  assert.notEqual(a.binding.message.payer_commitment, b.binding.message.payer_commitment);
  // The default source is node:crypto randomBytes; a short source is refused.
  const short = await B.signReceiptBinding({
    leafHash: 'ab'.repeat(32),
    claims: claims(),
    ctx: { ready: { ok: true }, logIdentity: tree.logIdentity, kid: KEY.kid, signer: envSigner, randomBytes: () => Buffer.alloc(31) },
  });
  assert.equal(short.refused, 'salt_source');
  const src = fs.readFileSync(path.join(here, '..', 'src', 'receipt-binding-eip712.js'), 'utf8');
  assert.match(src, /const random = ctx\.randomBytes \|\| crypto\.randomBytes;/);
});

// ---------------------------------------------------------------- B8

test('B8: no payer, non-USDC, pre-flag receipt: no binding, coded reason, receipt unchanged', async () => {
  const { tree } = await readyTree();
  const store = openPayerBindingStore(tmp('payer-binding-b8-'));
  const byTask = {
    'xfuel-pb-b8-nopayer': claims({ taskId: 'xfuel-pb-b8-nopayer', payer: null }),
    'xfuel-pb-b8-zero': claims({ taskId: 'xfuel-pb-b8-zero', payer: `0x${'0'.repeat(40)}` }),
    'xfuel-pb-b8-asset': claims({ taskId: 'xfuel-pb-b8-asset', asset: '0x0000000000000000000000000000000000000001' }),
    'xfuel-pb-b8-amount': claims({ taskId: 'xfuel-pb-b8-amount', gross: '0' }),
  };
  const c = countingSigner(envSigner);
  const worker = unitWorker({ store, tree, jwsFor: (id) => fakeJws(byTask[id]), signer: c.signer });
  for (const [id, n] of Object.keys(byTask).map((k, i) => [k, i])) await appendAndEnqueue(worker, tree, id, ROW(80 + n));
  assert.deepEqual(await worker.tick(), ['skipped', 'skipped', 'skipped', 'skipped']);
  assert.equal(c.counts.typed, 0);
  assert.deepEqual(W.payerBindingView(store, 'xfuel-pb-b8-nopayer'), { status: 'missing', reason: 'no_payer' });
  assert.deepEqual(W.payerBindingView(store, 'xfuel-pb-b8-zero'), { status: 'missing', reason: 'no_payer' });
  assert.deepEqual(W.payerBindingView(store, 'xfuel-pb-b8-asset'), { status: 'missing', reason: 'asset' });
  assert.deepEqual(W.payerBindingView(store, 'xfuel-pb-b8-amount'), { status: 'missing', reason: 'amount' });

  // Pre-flag: leaf appended while the flag was off. Turning it on later does
  // not backfill, and the owner sees `missing`.
  const taskId = 'xfuel-pb-b8-preflag';
  plant(taskId, payerA.address);
  const jws = await holderJwsOf(baseOn, taskId);
  const t2 = (await readyTree()).tree;
  await runHook(hookOff, t2, taskId, ROW(89));
  await runHook(hookOn, t2, taskId, ROW(89));
  await appOn.locals.__test.payerBindingWorker.tick();
  assert.equal(appOn.locals.__test.payerBindingStore.getJob(taskId), null);
  assert.equal(appOn.locals.__test.payerBindingStore.getBinding(taskId), null);
  const owner = JSON.parse((await ownerBody(baseOn, payerA, taskId)).text);
  assert.deepEqual(owner.payer_binding, { status: 'missing', reason: 'not_bound' });
  assert.equal(getAIListener().activeTasks.get(taskId).issuerSignature.jws, jws);

  // Server path, asset signed only as the symbol "USDC": not the Base USDC
  // contract, so no binding.
  const symbolTask = 'xfuel-pb-b8-symbol';
  plant(symbolTask, payerA.address, { asset: 'USDC' });
  const symbolJws = await holderJwsOf(baseOn, symbolTask);
  await runHook(hookOn, t2, symbolTask, ROW(88));
  await appOn.locals.__test.payerBindingWorker.tick();
  const symbolOwner = JSON.parse((await ownerBody(baseOn, payerA, symbolTask)).text);
  assert.deepEqual(symbolOwner.payer_binding, { status: 'missing', reason: 'asset' });
  assert.equal(getAIListener().activeTasks.get(symbolTask).issuerSignature.jws, symbolJws);
  resetReceiptMerkleTree();
});

test('B8: a signed network other than Base mainnet gets no binding; Base spellings and an absent network do', async () => {
  for (const network of ['base-sepolia', 'eip155:84532', 'solana', 'ethereum', 'eip155:1', '', 'basex']) {
    assert.deepEqual(B.bindingInputsFromClaims(claims({ network })), { ok: false, reason: 'network' }, network);
  }
  for (const network of ['base', 'eip155:8453', 'Base', ' eip155:8453 ', null, undefined]) {
    assert.equal(B.bindingInputsFromClaims(claims({ network })).ok, true, String(network));
  }
  // Through the worker: skipped with the coded reason, no sign.
  const { tree } = await readyTree();
  const store = openPayerBindingStore(tmp('payer-binding-b8n-'));
  const c = countingSigner(envSigner);
  const worker = unitWorker({ store, tree, jwsFor: (id) => fakeJws(claims({ taskId: id, network: 'base-sepolia' })), signer: c.signer });
  await appendAndEnqueue(worker, tree, 'xfuel-pb-b8-network', ROW(87));
  assert.deepEqual(await worker.tick(), ['skipped']);
  assert.equal(c.counts.typed, 0);
  assert.deepEqual(W.payerBindingView(store, 'xfuel-pb-b8-network'), { status: 'missing', reason: 'network' });
});

// ---------------------------------------------------------------- B9

test('B9: only TreeHead and ReceiptBinding produce typed 0x1901 inputs; the domains do not cross', async () => {
  assert.deepEqual(E.allowedTypedStructs().map((s) => s.kind), ['TreeHead', 'ReceiptBinding']);
  assert.deepEqual(E.allowedTypedStructs().map((s) => s.typehash), [E.TREE_HEAD_TYPEHASH, E.RECEIPT_BINDING_TYPEHASH]);
  await assert.rejects(E.signTypedStruct('Receiptbinding', {}, { salt: E.EXPECTED_LOG_SALT }), (err) => err.code === 'eip712_type_not_allowed');
  await assert.rejects(E.signTypedStruct('toString', {}, { salt: E.EXPECTED_LOG_SALT }), (err) => err.code === 'eip712_type_not_allowed');
  const vec = VECTORS.receipt_binding.vectors[0];
  const pre = E.typedDigest('ReceiptBinding', { ...vec.message, kid: E.kidBytes32(KEY.kid) }, E.EXPECTED_LOG_SALT).preimage;
  assert.equal(guard.typedPreimageShapeOk(pre), true);
  // Without the module's capability the signer refuses it.
  await assert.rejects(envSigner.sign(pre), (err) => err.code === 'issuer_sign_refused');
  await assert.rejects(envSigner.sign(pre, { typedPreimage: Symbol('fake') }), (err) => err.code === 'issuer_sign_refused');
  // A binding signature does not verify as a tree head over the same words.
  const out = await E.signTypedStruct('ReceiptBinding', { ...vec.message, kid: E.kidBytes32(KEY.kid) }, { salt: E.EXPECTED_LOG_SALT, signer: envSigner });
  const headDomain = E.domainSeparator(E.TREE_HEAD_DOMAIN_NAME, E.EXPECTED_LOG_SALT);
  const crossed = E.typedPreimage(headDomain, out.structHash);
  assert.equal(E.verifyTypedSignature(out.preimage, out.r, out.s, KEY.publicJwk), true);
  assert.equal(E.verifyTypedSignature(crossed, out.r, out.s, KEY.publicJwk), false);
});

// ---------------------------------------------------------------- B10

test('B10: own cap kind; receipt cap unchanged; a failed sign is retried by the worker, never on read', async () => {
  const { tree } = await readyTree();
  const store = openPayerBindingStore(tmp('payer-binding-b10-'));
  const c = countingSigner(envSigner);
  let clock = 1_800_000_000_000;
  const worker = unitWorker({
    store,
    tree,
    jwsFor: (id) => fakeJws(claims({ taskId: id })),
    signer: c.signer,
    env: { RECEIPT_PAYER_BINDING_EIP712: 'true', RECEIPT_PAYER_BINDING_HOURLY_CAP: '1' },
    now: () => clock,
  });
  const capBefore = issuanceCapHealth();
  await appendAndEnqueue(worker, tree, 'xfuel-pb-b10a', ROW(101));
  await appendAndEnqueue(worker, tree, 'xfuel-pb-b10b', ROW(102));
  assert.deepEqual(await worker.tick(), ['signed', 'capped']);
  assert.equal(worker.stats().cap_kind, 'payer_binding');
  assert.deepEqual(W.payerBindingView(store, 'xfuel-pb-b10b'), { status: 'pending' });
  assert.equal(store.getJob('xfuel-pb-b10b').reason, 'binding_cap');
  assert.deepEqual(issuanceCapHealth(), capBefore);
  // Signer down: the job stays pending with a retry time.
  clock += 3_600_000;
  c.failWith('issuer_sign_unavailable');
  assert.deepEqual(await worker.tick(), ['retry']);
  const job = store.getJob('xfuel-pb-b10b');
  assert.equal(job.status, 'pending');
  assert.equal(job.reason, 'signer_unavailable');
  assert.ok(job.next_at > clock);
  // Reads do not sign.
  const typed = c.counts.typed;
  for (let i = 0; i < 3; i += 1) W.payerBindingView(store, 'xfuel-pb-b10b');
  assert.equal(c.counts.typed, typed);
  // Not due yet; then due and the signer is back.
  assert.deepEqual(await worker.tick(), []);
  c.failWith(null);
  // The failed try used this hour's single slot: next hour.
  clock += 3_600_000;
  assert.ok(clock >= job.next_at);
  assert.deepEqual(await worker.tick(), ['signed']);
  assert.deepEqual(issuanceCapHealth(), capBefore);
  // Bounded: a signer that never returns fails after maxAttempts.
  const w2 = unitWorker({ store: openPayerBindingStore(tmp('payer-binding-b10c-')), tree, jwsFor: (id) => fakeJws(claims({ taskId: id })), signer: c.signer, now: () => clock, maxAttempts: 2 });
  await appendAndEnqueue(w2, tree, 'xfuel-pb-b10c', ROW(103));
  c.failWith('issuer_sign_unavailable');
  assert.deepEqual(await w2.tick(), ['retry']);
  clock += 10_000;
  assert.deepEqual(await w2.tick(), ['failed']);
  c.failWith(null);
  // Not ready (no lock): retried, not signed.
  const notReady = (await readyTree({ ready: false })).tree;
  const w3 = unitWorker({ store: openPayerBindingStore(tmp('payer-binding-b10d-')), tree: notReady, jwsFor: (id) => fakeJws(claims({ taskId: id })), signer: c.signer, now: () => clock });
  await appendAndEnqueue(w3, notReady, 'xfuel-pb-b10d', ROW(104));
  const t3 = c.counts.typed;
  assert.deepEqual(await w3.tick(), ['retry']);
  assert.equal(c.counts.typed, t3);
});

// ---------------------------------------------------------------- B11

test('B11: chit402-verify gives the same verdict with a binding next to the receipt', async () => {
  const verify = await import('../../../packages/verify/dist/index.js');
  const taskId = 'xfuel-pb-b11';
  plant(taskId, payerA.address);
  // A real receipt signature for this one, so the verdict is a real verdict.
  _setIssuerSignerForTest(countingSigner(envSigner).signer);
  await holderJwsOf(baseOn, taskId);
  _setIssuerSignerForTest(counting.signer);
  const { tree } = await readyTree();
  await runHook(hookOn, tree, taskId, ROW(11));
  await appOn.locals.__test.payerBindingWorker.tick();
  const owner = JSON.parse((await ownerBody(baseOn, payerA, taskId)).text);
  assert.equal(owner.payer_binding.status, 'signed');
  const task = getAIListener().activeTasks.get(taskId);
  const receipt = { task_id: taskId, issuer_signature: JSON.parse(JSON.stringify(task.issuerSignature)) };
  const withBinding = { ...receipt, payer_binding: owner.payer_binding };
  const jwks = getJwks();
  assert.deepEqual(
    verify.verifyIssuerSignatureWithJwks(withBinding, jwks, { trustedKids: [KEY.kid] }),
    verify.verifyIssuerSignatureWithJwks(receipt, jwks, { trustedKids: [KEY.kid] }),
  );
  const offline = { jwks, trustedKids: [KEY.kid], checkNullifier: false, checkPayer: false, fetchImpl: async () => { throw new Error('offline'); } };
  const a = await verify.verifyReceipt(receipt, offline);
  const b = await verify.verifyReceipt(withBinding, offline);
  // Same verdict. The verifier lists the new owner-view field as unsigned,
  // which is accurate: it sits outside the JWS.
  assert.deepEqual(b.verdict, a.verdict);
  assert.equal(b.overall, a.overall);
  assert.deepEqual(b.issuer_signature, a.issuer_signature);
  assert.equal(a.issuer_signature.valid, true);
  const { unsigned_fields: ub, ...restB } = b;
  const { unsigned_fields: ua, ...restA } = a;
  assert.deepEqual(restB, restA);
  assert.deepEqual(ua, []);
  assert.ok(ub.length > 0 && ub.every((f) => f.startsWith('payer_binding.')));
  resetReceiptMerkleTree();
});

// ---------------------------------------------------------------- B12

test('B12: leaf_hash only from the append record; a wrong or changed leaf is refused', async () => {
  const { tree } = await readyTree();
  const store = openPayerBindingStore(tmp('payer-binding-b12-'));
  const c = countingSigner(envSigner);
  const jwsFor = (id) => fakeJws(claims({ taskId: id }));
  const worker = unitWorker({ store, tree, jwsFor, signer: c.signer });
  // A job whose leaf_hash is not the appended leaf.
  await tree.appendReceipt('xfuel-pb-b12a', ROW(121), { publish: false });
  worker.enqueueAppended({ taskId: 'xfuel-pb-b12a', rowHash: ROW(121), leafHash: leafHashOf('xfuel-pb-b12a', ROW(999)) });
  // A job whose row_hash does not re-derive the stored leaf.
  await tree.appendReceipt('xfuel-pb-b12b', ROW(122), { publish: false });
  worker.enqueueAppended({ taskId: 'xfuel-pb-b12b', rowHash: ROW(998), leafHash: W.appendedLeafHash(tree, 'xfuel-pb-b12b') });
  // Another task's leaf.
  await tree.appendReceipt('xfuel-pb-b12c', ROW(123), { publish: false });
  worker.enqueueAppended({ taskId: 'xfuel-pb-b12c', rowHash: ROW(121), leafHash: W.appendedLeafHash(tree, 'xfuel-pb-b12a') });
  assert.deepEqual(await worker.tick(), ['failed', 'failed', 'failed']);
  assert.equal(c.counts.typed, 0);
  for (const id of ['xfuel-pb-b12a', 'xfuel-pb-b12b', 'xfuel-pb-b12c']) {
    assert.deepEqual(W.payerBindingView(store, id), { status: 'missing', reason: 'leaf_mismatch' });
    assert.equal(store.getBinding(id), null);
  }
  // The store refuses a different leaf for a task, for jobs and for seals.
  await appendAndEnqueue(worker, tree, 'xfuel-pb-b12d', ROW(124));
  assert.deepEqual(await worker.tick(), ['signed']);
  const good = store.getBinding('xfuel-pb-b12d');
  assert.throws(() => store.createJob('xfuel-pb-b12d', { leaf_hash: 'ee'.repeat(32), row_hash: ROW(124) }), (err) => err.code === 'leaf_conflict');
  assert.throws(() => store.seal('xfuel-pb-b12d', { ...good, leaf_hash: 'ee'.repeat(32) }), (err) => err.code === 'leaf_conflict');
  assert.deepEqual(store.seal('xfuel-pb-b12d', good), { created: false, record: good });
  // A pending job against an already sealed different leaf is refused.
  const s2 = openPayerBindingStore(tmp('payer-binding-b12e-'));
  s2.seal('xfuel-pb-b12e', { ...good, leaf_hash: 'dd'.repeat(32) });
  assert.throws(() => s2.createJob('xfuel-pb-b12e', { leaf_hash: 'cc'.repeat(32), row_hash: ROW(125) }), (err) => err.code === 'leaf_conflict');
  // Store paths: task ids cannot leave the dir.
  assert.throws(() => store.getJob('../x'), (err) => err.code === 'binding_task_id');
  assert.throws(() => store.getJob('a/b'), (err) => err.code === 'binding_task_id');
  assert.equal(payerBindingStoreDir({ env: {}, persist: false, agentsDir: '/x' }), null);
  assert.equal(c.counts.typed, 1);
});
