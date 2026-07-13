import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PersistentTaskStore, createTaskStore } from '../src/task-store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-taskstore-'));
}
function sampleTask(id = 'm2m-task-1', over = {}) {
  return {
    taskId: id,
    intent: { type: 'inference_request', model: 'llama-3-70b' },
    meta: { chain: 'theta' },
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    feeAmount: '5000',
    netAmount: '995000',
    feeBps: 50,
    sp1Proof: null,
    result: null,
    ...over,
  };
}

test('set keeps the live reference; get returns it (mutations visible)', () => {
  const dir = tmpDir();
  const store = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  const t = sampleTask();
  store.set(t.taskId, t);
  const got = store.get(t.taskId);
  assert.equal(got, t); // same reference while live
  t.status = 'fee_collected';
  assert.equal(store.get(t.taskId).status, 'fee_collected');
  store.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('receipt survives a restart: a fresh store over the same dir rehydrates from disk', () => {
  const dir = tmpDir();
  const a = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  a.set('task-abc', sampleTask('task-abc', { status: 'fee_collected', sp1Proof: { nullifier: '0xnull' } }));
  a.destroy();

  // Simulate a process restart — brand new store, empty hot map, same dir.
  const b = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  assert.equal(b.size, 0, 'hot map starts empty after restart');
  const rehydrated = b.get('task-abc');
  assert.ok(rehydrated, 'task rehydrated from disk');
  assert.equal(rehydrated.status, 'fee_collected');
  assert.equal(rehydrated.sp1Proof.nullifier, '0xnull');
  b.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('delete evicts from the hot map but RETAINS the durable snapshot (verify_url still resolves)', () => {
  const dir = tmpDir();
  const store = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  store.set('task-del', sampleTask('task-del', { status: 'fee_collected' }));
  assert.equal(store.size, 1);

  const removed = store.delete('task-del');
  assert.equal(removed, true);
  assert.equal(store.size, 0, 'evicted from the hot map');
  // Still resolvable from disk — this is the whole point.
  const after = store.get('task-del');
  assert.ok(after, 'snapshot retained after delete');
  assert.equal(after.status, 'fee_collected');
  store.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lazy get does not pollute the hot map (iteration stays live-only)', () => {
  const dir = tmpDir();
  const a = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  a.set('task-live', sampleTask('task-live'));
  a.destroy();

  const b = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  b.get('task-live'); // rehydrate read
  assert.equal(b.size, 0, 'get() must not insert the disk snapshot into the hot map');
  assert.deepEqual([...b.values()], [], 'iteration excludes disk-only tasks');
  b.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('flushAll persists in-place mutations made without re-set', () => {
  const dir = tmpDir();
  const a = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  const t = sampleTask('task-flush');
  a.set('task-flush', t);
  t.status = 'completed';
  t.sp1Proof = { nullifier: '0xabc' }; // mutated in place, no set()
  a.flushAll();
  a.destroy();

  const b = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  const got = b.get('task-flush');
  assert.equal(got.status, 'completed');
  assert.equal(got.sp1Proof.nullifier, '0xabc');
  b.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gcPersisted prunes receipts older than retention, keeps fresh ones', () => {
  const dir = tmpDir();
  const a = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  const old = Date.now() - 40 * 24 * 3600 * 1000; // 40 days old
  a.set('task-old', sampleTask('task-old', { updatedAt: old, createdAt: old }));
  a.set('task-new', sampleTask('task-new'));
  a.destroy();

  // GC operates on the durable snapshots; simulate a restart so neither task is in
  // the hot map (matching how evicted/old receipts actually get pruned).
  const store = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  const removed = store.gcPersisted(30 * 24 * 3600 * 1000); // 30-day retention
  assert.equal(removed, 1);
  assert.equal(store.get('task-old'), undefined, 'expired receipt pruned');
  assert.ok(store.get('task-new'), 'fresh receipt retained');
  store.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('serializes BigInt task fields without throwing', () => {
  const dir = tmpDir();
  const a = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  a.set('task-bi', sampleTask('task-bi', { weird: 10n }));
  a.destroy();
  const b = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  assert.equal(b.get('task-bi').weird, '10'); // BigInt → string on disk
  b.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('allSnapshots unions disk + live tasks (live wins) and survives restart', () => {
  const dir = tmpDir();
  const a = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  a.set('t-disk', sampleTask('t-disk', { status: 'fee_collected' }));
  a.set('t-both', sampleTask('t-both', { status: 'pending' }));
  a.destroy();

  // Fresh process: t-both is also live with a newer status → live must win.
  const b = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  b.set('t-both', sampleTask('t-both', { status: 'completed' }));
  b.set('t-live-only', sampleTask('t-live-only', { status: 'routed' }));

  const all = b.allSnapshots();
  const byId = Object.fromEntries(all.map((t) => [t.taskId, t]));
  assert.equal(all.length, 3, 'disk-only + merged + live-only, de-duped');
  assert.equal(byId['t-disk'].status, 'fee_collected', 'disk-only task included after restart');
  assert.equal(byId['t-both'].status, 'completed', 'live copy overrides the on-disk snapshot');
  assert.ok(byId['t-live-only']);
  b.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('persist=false behaves as a plain in-memory Map (no disk, no rehydrate)', () => {
  const dir = tmpDir();
  const store = createTaskStore({ dir, persist: false, autoFlushMs: 0 });
  assert.equal(store.persist, false);
  store.set('task-mem', sampleTask('task-mem'));
  assert.equal(store.get('task-mem').taskId, 'task-mem');
  store.delete('task-mem');
  assert.equal(store.get('task-mem'), undefined, 'no disk fallback when persistence is off');
  assert.equal(fs.readdirSync(dir).length, 0, 'nothing written to disk');
  store.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});
