/**
 * Public attestation follow-up (PR #572 review S1–S4, S7, N4).
 * Store durability, async I/O, one sign in flight, bounded memory, and the
 * VERIFIED_PUBLIC stats bucket. Fake signer and throwaway key; no KMS, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
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

test('S1 a signed JWS is never served or kept in memory unless it is durable', async () => {
  const dir = tmpDir('s1');
  const alerts = [];
  const fail = { createExclusive: (f) => f.includes(`${path.sep}done${path.sep}`) };
  const store = new storeMod.PublicAttestationStore({ dir, backend: faulty(storeMod.diskBackend(), fail), alert: (e) => alerts.push(e) });
  let signs = 0;
  const worker = workerFor(store, { sign: async (p) => { signs += 1; return realSign(p); } });
  assert.equal((await worker.enqueue(entryFor())).ok, true);
  await worker.tick();
  assert.equal(signs, 1);
  // The write failed: memory still says pending, the JWS is not served, and
  // the task is held so the worker cannot mint a second, different JWS.
  assert.deepEqual(await store.servedAttestation(TASK), { status: 'pending' });
  assert.equal((await store.get(TASK)).state, 'pending');
  assert.equal((await store.get(TASK)).jws, undefined);
  assert.ok(alerts.some((a) => a.event === 'public_attestation_persist_failed' && a.op === 'markSigned'));
  assert.equal(store.counts().held, 1);
  await worker.tick();
  await worker.tick();
  assert.equal(signs, 1, 'a held task is not re-signed');
  assert.deepEqual(await store.markSigned(TASK, { jws: 'x.y.z', kid: 'k' }), { ok: false, reason: 'held' });

  // Restart on a healthy disk: the row replays as pending and is signed once.
  // The served bytes are then stable across reads and another restart.
  const healthy = new storeMod.PublicAttestationStore({ dir });
  assert.deepEqual(await healthy.servedAttestation(TASK), { status: 'pending' });
  const w2 = workerFor(healthy, { sign: async (p) => { signs += 1; return realSign(p); } });
  await w2.tick();
  assert.equal(signs, 2);
  const first = await healthy.servedAttestation(TASK);
  assert.ok(first?.jws);
  assert.deepEqual(await healthy.servedAttestation(TASK), first);
  const again = new storeMod.PublicAttestationStore({ dir });
  assert.deepEqual(await again.servedAttestation(TASK), first);
  await workerFor(again).tick();
  assert.deepEqual(await again.servedAttestation(TASK), first, 'no re-sign after restart');
});

test('S1 enqueue, retry, failed, and skipped persist before memory changes', async () => {
  // Enqueue: the pending write fails. Nothing is queued, the ref is released.
  {
    const dir = tmpDir('s1-enq');
    const alerts = [];
    const store = new storeMod.PublicAttestationStore({
      dir,
      backend: faulty(storeMod.diskBackend(), { writeAtomic: (f) => f.includes(`${path.sep}pending${path.sep}`) }),
      alert: (e) => alerts.push(e),
    });
    assert.deepEqual(await store.enqueue({ taskId: TASK, ref: REF }), { ok: false, reason: 'persist_failed' });
    assert.equal(await store.get(TASK), null);
    assert.equal(await store.servedAttestation(TASK), null);
    assert.equal(await store.taskForRef(REF), null, 'the ref claim is rolled back');
    assert.equal(store.counts().pending, 0);
    assert.ok(alerts.some((a) => a.event === 'public_attestation_persist_failed' && a.op === 'enqueue'));
    // A later task can claim the ref.
    const ok = new storeMod.PublicAttestationStore({ dir });
    assert.equal((await ok.enqueue({ taskId: 'xfuel-other', ref: REF })).ok, true);
  }
  // Retry: the rewrite fails. attempts and next_at stay as on disk.
  {
    const dir = tmpDir('s1-retry');
    let failNow = false;
    const store = new storeMod.PublicAttestationStore({
      dir,
      backend: faulty(storeMod.diskBackend(), { writeAtomic: () => failNow }),
    });
    await store.enqueue({ taskId: TASK, ref: REF, now: 1000 });
    failNow = true;
    assert.deepEqual(await store.markRetry(TASK, { error: 'x', nextAt: 5000 }), { ok: false, reason: 'persist_failed' });
    const row = await store.get(TASK);
    assert.equal(row.attempts, 0);
    assert.equal(row.next_at, 1000);
    assert.equal(row.last_error, null);
  }
  // Failed and skipped: the terminal write fails. The row stays pending in memory and on disk.
  for (const op of ['markFailed', 'markSkipped']) {
    const dir = tmpDir(`s1-${op}`);
    let failNow = false;
    const store = new storeMod.PublicAttestationStore({
      dir,
      backend: faulty(storeMod.diskBackend(), { createExclusive: (f) => failNow && f.includes(`${path.sep}done${path.sep}`) }),
    });
    await store.enqueue({ taskId: TASK, ref: REF });
    failNow = true;
    assert.deepEqual(await store[op](TASK, { error: 'e', reason: 'r' }), { ok: false, reason: 'persist_failed' });
    assert.equal((await store.get(TASK)).state, 'pending');
    assert.equal(await store.taskForRef(REF), TASK, 'the ref stays claimed');
    const reloaded = new storeMod.PublicAttestationStore({ dir });
    assert.equal((await reloaded.get(TASK)).state, 'pending');
  }
});

test('S1 crash windows: a torn temp file and a terminal row beside a stale pending row', async () => {
  const dir = tmpDir('s1-crash');
  const store = new storeMod.PublicAttestationStore({ dir });
  await store.enqueue({ taskId: TASK, ref: REF });
  // A crash mid-write leaves a .tmp; a crash after the terminal row but before
  // the pending unlink leaves both.
  const pendingDir = path.join(dir, 'pending');
  const [pendingFile] = fs.readdirSync(pendingDir);
  fs.writeFileSync(path.join(pendingDir, `${pendingFile}.123.abc.tmp`), '{"task_id":"tor');
  const saved = fs.readFileSync(path.join(pendingDir, pendingFile), 'utf8');
  assert.equal((await store.markSigned(TASK, { jws: 'a.b.c', kid: 'k' })).ok, true);
  fs.writeFileSync(path.join(pendingDir, pendingFile), saved);
  const reloaded = new storeMod.PublicAttestationStore({ dir });
  assert.equal(reloaded.counts().pending, 0, 'the terminal row wins over the stale pending row');
  assert.deepEqual(await reloaded.servedAttestation(TASK), { jws: 'a.b.c' });
  assert.deepEqual(await reloaded.markSigned(TASK, { jws: 'x.y.z', kid: 'k' }), { ok: false, reason: 'conflict' });
});

test('S2 the store does no synchronous file I/O after boot', async () => {
  const src = fs.readFileSync(path.join(here, '..', 'src', 'public-attestation-store.js'), 'utf8');
  for (const call of ['fsyncSync', 'writeSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'openSync', 'unlinkSync', 'mkdirSync', 'linkSync']) {
    assert.equal(src.includes(call), false, `${call} on the event loop`);
  }
  // The only sync reads are the boot-time pending scan.
  const syncReads = src.match(/fs\.(readdirSync|readFileSync)/g) || [];
  assert.equal(syncReads.length, 2);
  assert.match(src, /listSync\(dir\)[\s\S]*readdirSync/);
  // Every mutator returns a promise, and the event loop runs while a write is pending.
  const slow = storeMod.memoryBackend();
  const base = slow.writeAtomic;
  let release;
  slow.writeAtomic = (f, d) => new Promise((resolve) => { release = () => resolve(base(f, d)); });
  const store = new storeMod.PublicAttestationStore({ backend: slow });
  const pending = store.enqueue({ taskId: TASK, ref: REF });
  assert.ok(pending instanceof Promise);
  let ticked = false;
  await new Promise((resolve) => setImmediate(() => { ticked = true; resolve(); }));
  assert.equal(ticked, true);
  assert.equal(await store.servedAttestation(TASK), null, 'not visible until durable');
  release();
  assert.equal((await pending).ok, true);
  assert.deepEqual(await store.servedAttestation(TASK), { status: 'pending' });
});

test('S3 a timed-out sign blocks the next sign until it settles; its late result is dropped', async (t0) => {
  // The worker's timers are unref'd; keep the loop alive while signs hang.
  const keep = setInterval(() => {}, 1000);
  t0.after(() => clearInterval(keep));
  let t = Date.parse('2026-10-17T18:30:12.000Z');
  const alerts = [];
  const calls = [];
  const sign = (payload, { signal } = {}) => new Promise((resolve, reject) => {
    calls.push({ payload, signal, resolve: () => realSign(payload).then(resolve), reject });
  });
  const store = new storeMod.PublicAttestationStore();
  const worker = workerFor(store, { sign, now: () => t, extra: { signTimeoutMs: 20, stuckAfterMs: 30 }, alerts });
  await worker.enqueue(entryFor());
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true, 'the timeout aborts the outstanding sign');
  assert.equal((await store.get(TASK)).last_error, 'sign_timeout');
  assert.equal(worker.stats().inflight, true);

  // Due again, but the first sign is still outstanding: no second sign.
  t = (await store.get(TASK)).next_at + 1;
  await worker.tick();
  await new Promise((r) => setTimeout(r, 40));
  await worker.tick();
  assert.equal(calls.length, 1, 'never two signs in flight');
  assert.ok(worker.stats().waited_on_inflight >= 2);
  assert.ok(alerts.some((a) => a.event === 'public_attestation_sign_stuck'), 'a long outstanding sign alerts once');
  assert.equal(alerts.filter((a) => a.event === 'public_attestation_sign_stuck').length, 1);

  // The orphan settles late. Its JWS is not stored.
  calls[0].resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(worker.stats().inflight, false);
  assert.deepEqual(await store.servedAttestation(TASK), { status: 'pending' });

  // The next tick signs once and stores that one.
  await worker.tick();
  assert.equal(calls.length, 2);
  calls[1].resolve();
  await new Promise((r) => setTimeout(r, 30));
  // The second call also hit the 20 ms timeout before it was resolved; drive one more round.
  if ((await store.get(TASK)).state === 'pending') {
    t = (await store.get(TASK)).next_at + 1;
    const quick = workerFor(store, { now: () => t });
    await quick.tick();
  }
  assert.equal((await store.get(TASK)).state, 'signed');
});

test('S4 memory holds only pending rows and a bounded cache; the tick is O(due)', async () => {
  const dir = tmpDir('s4');
  const ids = Array.from({ length: 40 }, (_, i) => `xfuel-0b1e2c3d-4e5f-4a6b-8c7d-${i.toString(16).padStart(12, "0")}`);
  const refs = new Map(ids.map((id, i) => [id, refFor(i + 1)]));
  const store = new storeMod.PublicAttestationStore({ dir, cacheSize: 8 });
  for (const id of ids) await store.enqueue({ taskId: id, ref: refs.get(id), now: 0 });
  assert.equal(store.counts().pending, 40);
  assert.equal(store.heap.size, 40);
  // Drain with a fresh worker per round so the rate bucket is full.
  for (let round = 0; round < 5 && store.counts().pending > 0; round += 1) await workerFor(store, { ids, refs }).tick();
  assert.equal(store.counts().pending, 0);
  assert.equal(store.heap.size, 0);
  assert.ok(store.cache.size <= 8, `cache ${store.cache.size}`);
  // Every attestation is still served, from disk, through the bounded cache.
  const served = await Promise.all(ids.map((id) => store.servedAttestation(id)));
  assert.equal(served.filter((s) => s?.jws).length, 40);
  assert.ok(store.cache.size <= 8);
  // Boot reads only pending/: with 40 terminal rows and none pending, nothing is read.
  let reads = 0;
  const counting = { ...storeMod.diskBackend() };
  const baseRead = counting.readSync;
  counting.readSync = (f) => { reads += 1; return baseRead(f); };
  const booted = new storeMod.PublicAttestationStore({ dir, backend: counting });
  assert.equal(reads, 0);
  assert.equal(booted.counts().pending, 0);
  // due() with nothing due touches only the heap top.
  const big = new storeMod.PublicAttestationStore();
  for (let i = 0; i < 2000; i += 1) await big.enqueue({ taskId: `t-${i}`, ref: refFor(10_000 + i), now: 10_000_000 + i });
  assert.deepEqual(big.due(0), []);
  assert.equal(big.heap.size, 2000);
  const first = big.due(10_000_000, 5);
  assert.deepEqual(first.map((r) => r.task_id), ['t-0']);
  assert.equal(big.heap.size, 1999);
});

test('S4 a retried row is rescheduled once; stale heap entries are dropped', async () => {
  const store = new storeMod.PublicAttestationStore();
  await store.enqueue({ taskId: TASK, ref: REF, now: 100 });
  const [row] = store.due(100, 1);
  assert.equal(row.task_id, TASK);
  assert.equal(store.heap.size, 0);
  await store.markRetry(TASK, { error: 'x', nextAt: 200 });
  store.reschedule(TASK, 150); // already scheduled: ignored
  assert.equal(store.heap.size, 1);
  assert.deepEqual(store.due(199), []);
  assert.equal(store.due(200)[0].task_id, TASK);
});

test('N4 signing refuses to start without a durable store', () => {
  assert.deepEqual(storeMod.publicAttestationSignDecision({ env: {}, dir: '/x' }), { on: false, reason: 'flag_off' });
  assert.deepEqual(storeMod.publicAttestationSignDecision({ env: { PUBLIC_ATTESTATION_SIGN: 'true' }, dir: null }), { on: false, reason: 'no_durable_store' });
  assert.deepEqual(storeMod.publicAttestationSignDecision({ env: { PUBLIC_ATTESTATION_SIGN: 'true' }, dir: '/x' }), { on: true, reason: null });
  const server = fs.readFileSync(path.join(here, '..', 'src', 'server.js'), 'utf8');
  assert.match(server, /publicAttestationSignDecision\(\{ env: process\.env, dir: publicAttestationDir \}\)/);
  assert.match(server, /const publicAttestationWorker = publicAttestationSignOn/);
});

test('S7 VERIFIED_PUBLIC has its own stats bucket and never counts as VERIFIED', () => {
  assert.equal(stats.resultOfOverall('VERIFIED_PUBLIC'), 'VERIFIED_PUBLIC');
  assert.equal(stats.resultOfOverall('VERIFIED'), 'VERIFIED');
  assert.ok(stats.CHECK_RESULTS.includes('VERIFIED_PUBLIC'));
  const db = stats.openCheckStats(':memory:');
  const at = Date.parse('2026-10-17T18:10:00.000Z');
  for (let i = 0; i < 4; i += 1) db.record({ at, result: 'VERIFIED_PUBLIC', reason: 'none', client: 'web' });
  for (let i = 0; i < 3; i += 1) db.record({ at, result: 'VERIFIED', reason: 'none', client: 'api' });
  const [bucket] = stats.bucketRows(db.rowsBetween(at, at));
  assert.equal(bucket.verified, 3);
  assert.equal(bucket.verified_public, 4);
  assert.equal(bucket.by_client.web.verified, 0);
  assert.equal(bucket.by_client.web.verified_public, 4);
  const masked = stats.maskPublicStats([bucket], stats.evaluateCheckAlert([], at));
  assert.equal(masked.buckets[0].verified_public, 4);
  assert.equal(masked.buckets[0].by_client.api.verified_public, '<3');
  // Not a failure for the alert either.
  const rows = [];
  for (let i = 0; i < 25; i += 1) rows.push({ hour: at, result: 'VERIFIED_PUBLIC', reason: 'none', client: 'web', n: 1 });
  const alert = stats.evaluateCheckAlert(rows, at);
  assert.equal(alert.raised, false);
  assert.equal(alert.top_reason, null);
  db.close();
  // The receipt check counter keeps its own bucket too.
  const src = fs.readFileSync(path.join(here, '..', 'src', 'receipt-check.js'), 'utf8');
  assert.match(src, /if \(result === 'verified_public'\) return 'verified_public';/);
  assert.match(src, /verified: 0, verified_public: 0, invalid: 0/);
});

test('M5 under races: a ref released by a failed row is taken by exactly one new task', async () => {
  for (let round = 0; round < 25; round += 1) {
    const mem = storeMod.memoryBackend();
    const jitter = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
    const slow = {
      ...mem,
      async read(f) { await jitter(); return mem.read(f); },
      async writeAtomic(f, d) { await jitter(); return mem.writeAtomic(f, d); },
      async createExclusive(f, d) { await jitter(); return mem.createExclusive(f, d); },
      async unlink(f) { await jitter(); return mem.unlink(f); },
    };
    const store = new storeMod.PublicAttestationStore({ backend: slow });
    await store.enqueue({ taskId: 'A', ref: REF, now: 0 });
    const [, b, c] = await Promise.all([
      store.markFailed('A', { error: 'x' }),
      store.enqueue({ taskId: 'B', ref: REF, now: 0 }),
      store.enqueue({ taskId: 'C', ref: REF, now: 0 }),
    ]);
    const live = [['B', b], ['C', c]].filter(([, out]) => out.ok && !out.duplicate).map(([id]) => id);
    assert.ok(live.length <= 1, `round ${round}: ${JSON.stringify([b, c])}`);
    const holder = await store.taskForRef(REF);
    if (live.length === 1) assert.equal(holder, live[0]);
    // Whoever is not live was skipped as a duplicate (or found A still live).
    for (const [id, out] of [['B', b], ['C', c]]) {
      if (!live.includes(id)) assert.equal(out.reason, 'duplicate_ref');
    }
  }
});

test('S3 a sign that finishes frees the slot at once: one tick drains several due rows', async () => {
  const ids = Array.from({ length: 3 }, (_, i) => `xfuel-0b1e2c3d-4e5f-4a6b-8c7d-${(100 + i).toString(16).padStart(12, '0')}`);
  const refs = new Map(ids.map((id, i) => [id, refFor(500 + i)]));
  const store = new storeMod.PublicAttestationStore();
  for (const id of ids) await store.enqueue({ taskId: id, ref: refs.get(id), now: 0 });
  let inFlight = 0;
  let maxInFlight = 0;
  const worker = workerFor(store, {
    ids,
    refs,
    sign: async (p) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await realSign(p);
      } finally {
        inFlight -= 1;
      }
    },
  });
  await worker.tick();
  assert.equal(store.counts().pending, 0);
  assert.equal(store.counts().signed, 3);
  assert.equal(maxInFlight, 1);
  assert.equal(worker.stats().waited_on_inflight, 0);
  assert.equal(worker.stats().inflight, false);
});
