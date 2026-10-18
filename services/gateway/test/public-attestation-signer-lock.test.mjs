/**
 * Public attestation signer lock (PR #573 review SF1, N-a, N-b, N-d).
 * A sign that never settles is released at a hard ceiling and its row held,
 * so its late result can never be stored. Fake signer and throwaway key; no
 * KMS, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pa = await import('../src/public-attestation.js');
const storeMod = await import('../src/public-attestation-store.js');
const { createPublicAttestationWorker } = await import('../src/public-attestation-worker.js');
const stats = await import('../src/receipt-check-stats.js');

const TASK = 'xfuel-5a1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ROW = 'row-hash-s1s7';
const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const TX = `0x${'ab'.repeat(32)}`;
const REF = `base:${TX}`;

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  return { privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }, kid: 'kid-s1s7' };
}
const key = keypair();

function holderJws(taskId = TASK, ref = REF) {
  const claims = {
    task_id: taskId, iss: 'chit402', iat: '2026-10-17T18:29:41.512Z',
    payment: { rail: 'usdc', ref, asset: pa.BASE_USDC, payee: PAYEE, gross_amount: '2000', settled_amount: '2000' },
    payload_version: 10,
  };
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: key.kid })}.${b(claims)}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

function refFor(i) {
  return `base:0x${i.toString(16).padStart(64, '0')}`;
}

function entryFor(taskId = TASK, ref = REF) {
  return { task_id: taskId, payment_ref: ref, collected: true, evidence: 'collected', rail: 'usdc', row_hash: ROW };
}

function treeFor(ids) {
  const leaves = ids.map((id) => Buffer.from(pa.leafHashOf(id, ROW), 'hex'));
  const byTask = new Map(ids.map((id, i) => [id, i]));
  return { _locate: (id) => (byTask.has(String(id)) ? { epoch: 1, leaves, byTask } : null) };
}

async function realSign(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b({ alg: 'ES256', typ: pa.PUBLIC_RECEIPT_TYP, kid: key.kid })}.${Buffer.from(payload).toString('base64url')}`;
  return { jws: `${input}.${crypto.sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`, kid: key.kid };
}

function workerFor(store, { ids = [TASK], refs = new Map(), sign = realSign, now, extra = {}, alerts = [] } = {}) {
  return createPublicAttestationWorker({
    store,
    tree: () => treeFor(ids),
    findEntry: (id) => (ids.includes(id) ? entryFor(id, refs.get(id) || REF) : null),
    holderJws: (id) => holderJws(id, refs.get(id) || REF),
    publicJwk: () => key.publicJwk,
    now: now || (() => Date.parse('2026-10-17T18:30:12.000Z')),
    alert: (e) => alerts.push(e),
    env: {},
    sign,
    ...extra,
  });
}

function tmpDir(tag) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `chit-s1s7-${tag}-`)), 'public-attestations');
}

/** Disk backend that throws on chosen operations (disk full, EACCES). */
function faulty(base, fail) {
  return {
    ...base,
    async writeAtomic(file, data) {
      if (fail.writeAtomic?.(file)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return base.writeAtomic(file, data);
    },
    async createExclusive(file, data) {
      if (fail.createExclusive?.(file)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return base.createExclusive.call(base, file, data);
    },
  };
}


function keepAlive(t) {
  // The worker's timers are unref'd; keep the loop alive while signs hang.
  const keep = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keep));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TASK_B = 'xfuel-5a1e2c3d-4e5f-4a6b-8c7d-0000000000bb';
const REF_B = refFor(0xbb);

test('SF1 a sign that never settles is released at the ceiling; its row is held and its late result is never stored', async (t) => {
  keepAlive(t);
  const alerts = [];
  const files = new Map();
  const store = new storeMod.PublicAttestationStore({ backend: storeMod.memoryBackend(files), alert: (e) => alerts.push(e) });
  const ids = [TASK, TASK_B];
  const refs = new Map([[TASK, REF], [TASK_B, REF_B]]);
  const calls = [];
  const sign = (payload, { signal } = {}) => {
    const call = { payload, signal };
    calls.push(call);
    // The first sign (TASK) hangs until the test settles it; later ones answer.
    if (calls.length === 1) {
      return new Promise((resolve, reject) => {
        call.resolve = () => realSign(payload).then(resolve);
        call.reject = reject;
      });
    }
    return realSign(payload);
  };
  let now = Date.parse('2026-10-17T18:30:12.000Z');
  const worker = workerFor(store, { ids, refs, sign, now: () => now, alerts, extra: { signTimeoutMs: 20, signCeilingMs: 80 } });
  assert.equal(worker.config.signCeilingMs, 80);
  await store.enqueue({ taskId: TASK, ref: REF, now: 0 });
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal((await store.get(TASK)).last_error, 'sign_timeout');

  // A second row arrives. Below the ceiling nothing new starts.
  await store.enqueue({ taskId: TASK_B, ref: REF_B, now: 0 });
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(worker.stats().released_after_ceiling, 0);

  // Past the ceiling: the slot is released, TASK is held, TASK_B is signed.
  await sleep(90);
  now = (await store.get(TASK)).next_at + 1; // TASK is due again, but held
  await worker.tick();
  assert.equal(worker.stats().released_after_ceiling, 1);
  assert.ok(alerts.some((a) => a.event === 'public_attestation_sign_released' && a.task_id === TASK));
  assert.equal(calls.length, 2, 'only TASK_B was signed; the held TASK was not');
  assert.equal(JSON.parse(String(calls[1].payload).split('\n')[1]).task_id, TASK_B);
  assert.equal((await store.get(TASK_B)).state, 'signed');
  assert.equal(store.counts().held, 1);

  // The abandoned sign settles late with a valid JWS. It is never stored.
  calls[0].resolve();
  await sleep(10);
  assert.deepEqual(await store.servedAttestation(TASK), { status: 'pending' });
  assert.equal((await store.get(TASK)).jws, undefined);
  assert.deepEqual(await store.markSigned(TASK, { jws: 'late.j.ws', kid: 'k' }), { ok: false, reason: 'held' });
  await worker.tick();
  await worker.tick();
  assert.equal(calls.length, 2, 'a held row is not signed again in this process');
  assert.ok(!alerts.some((a) => a.event === 'public_attestation_persist_failed'));

  // Restart: the row replays as pending and is signed once.
  const restarted = new storeMod.PublicAttestationStore({ backend: storeMod.memoryBackend(files) });
  assert.equal(restarted.counts().held, 0);
  let later = 0;
  await workerFor(restarted, { ids, refs, now: () => now + 60 * 60_000, sign: async (p) => { later += 1; return realSign(p); } }).tick();
  assert.equal(later, 1);
  const first = await restarted.servedAttestation(TASK);
  assert.ok(first?.jws);
  assert.deepEqual(await restarted.servedAttestation(TASK), first);
});

test('SF1 a late rejection after the ceiling is also harmless', async (t) => {
  keepAlive(t);
  const store = new storeMod.PublicAttestationStore();
  let hung;
  const sign = () => new Promise((_, reject) => { hung = reject; });
  let now = Date.parse('2026-10-17T18:30:12.000Z');
  const worker = workerFor(store, { sign, now: () => now, extra: { signTimeoutMs: 10, signCeilingMs: 30 } });
  await store.enqueue({ taskId: TASK, ref: REF, now: 0 });
  await worker.tick();
  await sleep(40);
  await worker.tick();
  assert.equal(worker.stats().released_after_ceiling, 1);
  assert.equal(worker.stats().inflight, false);
  hung(Object.assign(new Error('kms late'), { code: 'kms_unavailable' }));
  await sleep(5);
  const row = await store.get(TASK);
  assert.equal(row.state, 'pending');
  assert.equal(row.attempts, 1, 'the late rejection did not count as another attempt');
  assert.equal(worker.stats().inflight, false);
});

test('SF1 ceiling defaults to 10x the timeout and is never below it', () => {
  const store = new storeMod.PublicAttestationStore();
  assert.equal(workerFor(store).config.signCeilingMs, 30_000);
  assert.equal(workerFor(store, { extra: { signTimeoutMs: 500 } }).config.signCeilingMs, 5_000);
  assert.equal(workerFor(store, { extra: { signTimeoutMs: 500, signCeilingMs: 100 } }).config.signCeilingMs, 500);
  assert.equal(store.hold('unknown'), false, 'only a pending row can be held');
});

test('N-a a new shard directory is fsynced into its parent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-sl-na-'));
  const dir = path.join(root, 'public-attestations');
  const synced = [];
  const open = fsp.open;
  fsp.open = async (p, flags, ...rest) => {
    const handle = await open(p, flags, ...rest);
    if (flags === 'r') {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { synced.push(path.resolve(p)); return sync(); };
    }
    return handle;
  };
  t.after(() => { fsp.open = open; });
  const store = new storeMod.PublicAttestationStore({ dir });
  await store.enqueue({ taskId: TASK, ref: REF, now: 0 });
  // pending/ and the store dir were new: their parents were synced.
  assert.ok(synced.includes(path.resolve(root)), 'root synced for the new store dir');
  assert.ok(synced.includes(path.resolve(dir)), 'store dir synced for the new pending/ and refs/');
  const refShard = path.dirname(path.join(dir, 'refs', 'x'));
  assert.ok(synced.includes(path.resolve(refShard)), 'refs/ synced for the new shard');
  synced.length = 0;
  assert.equal((await store.markSigned(TASK, { jws: 'a.b.c', kid: 'k' })).ok, true);
  assert.ok(synced.includes(path.resolve(dir, 'done')), 'done/ synced for the new shard');
  // A second write into existing directories syncs only the file's own directory.
  synced.length = 0;
  await store.enqueue({ taskId: TASK_B, ref: REF_B, now: 0 });
  assert.equal(synced.includes(path.resolve(root)), false);
  assert.equal(synced.includes(path.resolve(dir)), false);
});

test('N-b leftover pending tmp files are removed at boot and never read', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chit-sl-nb-')), 'public-attestations');
  const store = new storeMod.PublicAttestationStore({ dir });
  await store.enqueue({ taskId: TASK, ref: REF, now: 0 });
  const pendingDir = path.join(dir, 'pending');
  const [row] = fs.readdirSync(pendingDir);
  fs.writeFileSync(path.join(pendingDir, `${row}.1.aa.tmp`), '{"task_id":"tor');
  fs.writeFileSync(path.join(pendingDir, `${row}.2.bb.tmp`), JSON.stringify({ task_id: 'xfuel-ghost', state: 'pending' }));
  fs.writeFileSync(path.join(pendingDir, 'notes.txt'), 'not ours');
  const reloaded = new storeMod.PublicAttestationStore({ dir });
  assert.equal(reloaded.counts().pending, 1);
  assert.equal(await reloaded.tmpCleanup, 2);
  assert.deepEqual(fs.readdirSync(pendingDir).sort(), [row, 'notes.txt'].sort());
  assert.equal(await reloaded.get('xfuel-ghost'), null);
});

test('N-d a failed ref release after a durable terminal row is its own alert, not persist_failed', async () => {
  const alerts = [];
  const mem = storeMod.memoryBackend();
  let failRefs = false;
  const backend = {
    ...mem,
    async unlink(file) {
      if (failRefs && file.includes(`${path.sep}refs${path.sep}`)) throw Object.assign(new Error('eio'), { code: 'EIO' });
      return mem.unlink(file);
    },
  };
  const store = new storeMod.PublicAttestationStore({ backend, alert: (e) => alerts.push(e) });
  await store.enqueue({ taskId: TASK, ref: REF, now: 0 });
  failRefs = true;
  assert.deepEqual(await store.markFailed(TASK, { error: 'x' }), { ok: true });
  assert.equal((await store.get(TASK)).state, 'failed');
  assert.equal(store.counts().held, 0);
  assert.equal(store.counts().persist_failed, 0);
  assert.ok(alerts.some((a) => a.event === 'public_attestation_ref_release_failed' && a.task_id === TASK && a.error === 'EIO'));
  assert.ok(!alerts.some((a) => a.event === 'public_attestation_persist_failed'));
  assert.ok(alerts.some((a) => a.event === 'public_attestation_failed'));
  // The claim left behind is stale: another task can take the ref.
  assert.equal(await store.taskForRef(REF), TASK);
  failRefs = false;
  assert.equal((await store.enqueue({ taskId: TASK_B, ref: REF, now: 0 })).ok, true);
  assert.equal(await store.taskForRef(REF), TASK_B);
});
