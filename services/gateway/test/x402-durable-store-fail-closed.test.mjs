/**
 * TG-DSTORE: a corrupt or empty challenge store fails closed.
 * It must not load as a fresh spent-set, and a live lock is not stolen.
 */
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  DurableChallengeStore,
  openDurableChallengeStore,
  challengeStoreFailed,
  setActiveChallengeStore,
} = await import('../src/x402-durable-store.js');

const NONCE = `0x${'ab'.repeat(32)}`;

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-dstore-'));
  return { dir, file: path.join(dir, 'challenges.json') };
}

test('a corrupt store is not read as fresh state and is not rewritten', () => {
  const { dir, file } = tempFile();
  try {
    const store = new DurableChallengeStore(file);
    store.markSpent(NONCE);
    assert.equal(store.isSpent(NONCE), true);
    const before = fs.readFileSync(file, 'utf8');
    assert.equal(before.includes(NONCE), true);

    for (const corrupt of ['{', '', 'null', '{"map":[]}', '[]']) {
      fs.writeFileSync(file, corrupt);
      assert.throws(
        () => new DurableChallengeStore(file),
        (err) => err.code === 'x402_unavailable',
      );
      assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a crashed empty store does not clear a spent nonce on the next read', () => {
  const { dir, file } = tempFile();
  try {
    const store = new DurableChallengeStore(file);
    store.markSpent(NONCE);
    fs.writeFileSync(file, '');
    assert.throws(() => store.isSpent(NONCE), (err) => err.code === 'x402_unavailable');
    assert.equal(fs.readFileSync(file, 'utf8'), '');
    assert.throws(() => new DurableChallengeStore(file), (err) => err.code === 'x402_unavailable');
    assert.equal(fs.readFileSync(file, 'utf8'), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a live lock holder is not preempted', () => {
  const { dir, file } = tempFile();
  try {
    const store = new DurableChallengeStore(file, { lockWaitMs: 40 });
    store.markSpent(NONCE);
    // A live holder is another process. Our own pid is a previous incarnation.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(`${file}.lock`, String(holder.pid));
      const started = Date.now();
      assert.throws(() => store.isSpent(NONCE), (err) => err.code === 'x402_unavailable');
      assert.ok(Date.now() - started < 2_000);
      assert.equal(fs.readFileSync(`${file}.lock`, 'utf8').trim(), String(holder.pid));
    } finally {
      holder.kill();
    }
    fs.unlinkSync(`${file}.lock`);
    assert.equal(store.isSpent(NONCE), true);
    // A lock left by this pid's previous incarnation, or a pidless lock older
    // than the stale window, is reclaimed instead of wedging every settle.
    fs.writeFileSync(`${file}.lock`, String(process.pid));
    assert.equal(store.isSpent(NONCE), true);
    fs.writeFileSync(`${file}.lock`, '');
    const old = new Date(Date.now() - 20_000);
    fs.utimesSync(`${file}.lock`, old, old);
    assert.equal(store.isSpent(NONCE), true);
    // A pidless lock younger than the stale window still belongs to a live holder.
    fs.writeFileSync(`${file}.lock`, '');
    assert.throws(() => store.isSpent(NONCE), (err) => err.code === 'x402_unavailable');
    assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), '');
    fs.unlinkSync(`${file}.lock`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('boot does not create a fresh spent-set when the store file is missing', () => {
  const { dir, file } = tempFile();
  try {
    assert.equal(fs.existsSync(file), false);
    assert.throws(
      () => openDurableChallengeStore(file),
      (err) => err.code === 'x402_unavailable' && /fresh spent-set/.test(err.message),
    );
    assert.equal(fs.existsSync(file), false);
    assert.equal(challengeStoreFailed(), true);
  } finally {
    setActiveChallengeStore(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a lock left by a dead pid can be reclaimed without dropping spent nonces', () => {
  const { dir, file } = tempFile();
  try {
    const store = new DurableChallengeStore(file, { lockWaitMs: 200 });
    store.markSpent(NONCE);
    fs.writeFileSync(`${file}.lock`, '2147483646');
    assert.equal(store.isSpent(NONCE), true);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
