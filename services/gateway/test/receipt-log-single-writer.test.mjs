/**
 * One writer per receipt log directory, and new signed artifacts only from
 * a durable, pin-checked log.
 *
 * The lock is an exclusive flock on a descriptor this process keeps open.
 * It is same-host only and has no pid file or reclaim. Production never
 * publishes a tree head from a log that is not durable.
 */
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const {
  acquireReceiptLogLock,
  holdsReceiptLogLock,
  verifyReceiptLogLock,
  FLOCK_BIN,
  RECEIPT_LOG_LOCK_FILE,
  _releaseReceiptLogLocksForTest,
} = await import('../src/receipt-log-lock.js');
const {
  ReceiptMerkleTree,
  bootReceiptLog,
  receiptLogSigningReady,
  receiptLogHeadReady,
  readReceiptLogPin,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');
const { _setIssuerSignerForTest } = await import('../src/issuer-signer.js');

const lockModule = fileURLToPath(new URL('../src/receipt-log-lock.js', import.meta.url));

function tmp() {
  return mkdtempSync(join(tmpdir(), 'chit-single-writer-'));
}

const children = new Set();
const WAIT_MS = 10_000;

/** Kill every child a test started, even when the test failed or timed out. */
async function killChildren() {
  const waits = [];
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    waits.push(waitExit(child));
  }
  children.clear();
  await Promise.all(waits);
}
afterEach(killChildren);
after(killChildren);

/** Start a child that takes the lock, prints LOCKED or the reason, then waits. */
function holder(dir, extra = '', { env = process.env, opts = null } = {}) {
  const code = `
    import { acquireReceiptLogLock } from ${JSON.stringify(lockModule)};
    const r = acquireReceiptLogLock(${JSON.stringify(dir)}${opts ? `, ${JSON.stringify(opts)}` : ''});
    process.stdout.write((r.held ? 'LOCKED' : r.reason) + '\\n');
    ${extra}
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'], env });
  children.add(child);
  const ready = new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('holder did not report within the timeout')), WAIT_MS);
    child.stdout.on('data', (b) => {
      out += String(b);
      if (out.includes('\n')) {
        clearTimeout(timer);
        resolve(out.trim());
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(`exit:${c}`);
    });
  });
  return { child, ready };
}

function waitExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, WAIT_MS);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function withEnv(vars, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env = saved;
      resetReceiptMerkleTree();
    });
}

const hasFlock = process.platform !== 'win32' && fs.existsSync(FLOCK_BIN)
  && spawnSync(FLOCK_BIN, ['--version'], { stdio: 'ignore', timeout: 5000 }).status === 0;
/** Every test fails fast instead of hanging. */
const T = { skip: !hasFlock, timeout: 30_000 };
const T_ANY = { timeout: 30_000 };

test('M12: a second process on the same log directory is refused while the first holds it', T, async () => {
  const dir = tmp();
  const a = holder(dir);
  assert.equal(await a.ready, 'LOCKED');
  try {
    const b = holder(dir);
    assert.equal(await b.ready, 'log_locked');
    b.child.kill('SIGKILL');
    await waitExit(b.child);
    const mine = acquireReceiptLogLock(dir);
    assert.equal(mine.held, false);
    assert.equal(mine.reason, 'log_locked');
    assert.throws(() => bootReceiptLog(dir, { pin: null }), (err) => err.code === 'log_locked');
  } finally {
    a.child.kill('SIGKILL');
    await waitExit(a.child);
  }
});

test('M12: the kernel releases the lock when the holder dies, with no pid file or reclaim step', T, async () => {
  const dir = tmp();
  const a = holder(dir);
  assert.equal(await a.ready, 'LOCKED');
  a.child.kill('SIGKILL');
  await waitExit(a.child);
  const lockBody = fs.readFileSync(join(dir, RECEIPT_LOG_LOCK_FILE), 'utf8');
  assert.equal(lockBody, '', 'the lock file carries no pid');
  const b = holder(dir);
  assert.equal(await b.ready, 'LOCKED');
  b.child.kill('SIGKILL');
  await waitExit(b.child);
});

test('M22: a lock file left on disk by a dead process does not block, and content is never used to reclaim', T, async () => {
  const dir = tmp();
  fs.writeFileSync(join(dir, RECEIPT_LOG_LOCK_FILE), '999999\n');
  const a = holder(dir);
  assert.equal(await a.ready, 'LOCKED');
  // A live holder is never displaced, whatever the file says.
  fs.writeFileSync(join(dir, RECEIPT_LOG_LOCK_FILE), '1\n');
  const b = holder(dir);
  assert.equal(await b.ready, 'log_locked');
  b.child.kill('SIGKILL');
  a.child.kill('SIGKILL');
  await waitExit(a.child);
  await waitExit(b.child);
});

test('M12: the lock is not inherited by other child processes of the holder', T, async () => {
  const dir = tmp();
  const extra = "import('node:child_process').then(({ spawn }) => spawn('sleep', ['30'], { stdio: 'ignore', detached: true }).unref());";
  const a = holder(dir, extra);
  assert.equal(await a.ready, 'LOCKED');
  a.child.kill('SIGKILL');
  await waitExit(a.child);
  const b = holder(dir);
  assert.equal(await b.ready, 'LOCKED', 'a grandchild must not keep the lock alive');
  b.child.kill('SIGKILL');
  await waitExit(b.child);
});

test('M12: the same process reuses its own lock for the same directory', T, () => {
  const dir = tmp();
  const first = acquireReceiptLogLock(dir);
  assert.equal(first.held, true);
  const second = acquireReceiptLogLock(dir);
  assert.equal(second.held, true);
  assert.equal(second.reused, true);
  assert.equal(holdsReceiptLogLock(dir), true);
  _releaseReceiptLogLocksForTest();
  assert.equal(holdsReceiptLogLock(dir), false);
});

test('M12: production refuses boot when the lock cannot be taken; test env warns and is not signing-ready', T_ANY, async () => {
  const dir = tmp();
  await withEnv({ NODE_ENV: 'production', ANCHOR_MAX_FEE_WEI: '1000000000', ANCHOR_MAX_PRIORITY_WEI: '1000000' }, () => {
    assert.throws(
      () => bootReceiptLog(dir, { pin: null, lock: { flockBin: join(dir, 'no-such-flock') } }),
      (err) => err.code === 'log_lock_unavailable',
    );
  });
  await withEnv({ NODE_ENV: 'test', RECEIPT_LOG_ACCEPT_FRESH_GENESIS: undefined }, () => {
    const dir2 = tmp();
    const tree = bootReceiptLog(dir2, { pin: null, allowFreshGenesis: true, lock: { flockBin: join(dir2, 'no-such-flock') } });
    assert.equal(tree.durable, true);
    assert.equal(holdsReceiptLogLock(dir2), false);
    assert.deepEqual(receiptLogSigningReady(tree), { ok: false, reason: 'fresh_genesis' });
  });
});

test('M13: signing readiness needs durable + boot enabled + no fresh genesis + pin verified + lock held', T, async () => {
  await withEnv({ RECEIPT_LOG_BOOT: undefined, RECEIPT_LOG_ACCEPT_FRESH_GENESIS: undefined }, () => {
    assert.deepEqual(receiptLogSigningReady(null), { ok: false, reason: 'log_not_durable' });
    const memory = new ReceiptMerkleTree();
    assert.deepEqual(receiptLogSigningReady(memory), { ok: false, reason: 'log_not_durable' });

    const dir = tmp();
    const tree = new ReceiptMerkleTree();
    tree.durable = true;
    tree.dir = dir;
    tree.pinVerified = false;
    assert.deepEqual(receiptLogSigningReady(tree), { ok: false, reason: 'pin_unverified' });
    tree.pinVerified = true;
    assert.deepEqual(receiptLogSigningReady(tree), { ok: false, reason: 'log_lock_missing' });
    assert.equal(acquireReceiptLogLock(dir).held, true);
    assert.deepEqual(receiptLogSigningReady(tree), { ok: true });

    assert.deepEqual(receiptLogSigningReady(tree, { RECEIPT_LOG_BOOT: '0' }), { ok: false, reason: 'log_boot_disabled' });
    assert.deepEqual(
      receiptLogSigningReady(tree, { RECEIPT_LOG_ACCEPT_FRESH_GENESIS: 'RECEIPT LOG FRESH GENESIS' }).ok,
      true,
      'only the exact operator flag counts as fresh genesis',
    );
    tree.allowFreshGenesis = true;
    assert.deepEqual(receiptLogSigningReady(tree), { ok: false, reason: 'fresh_genesis' });
    _releaseReceiptLogLocksForTest();
  });
});

test('M13: a boot that skips the pin (pin unset or fresh genesis) never marks the log pin-verified', T, async () => {
  await withEnv({ NODE_ENV: 'test' }, () => {
    const dir = tmp();
    const tree = bootReceiptLog(dir, { pin: null, allowFreshGenesis: true });
    assert.equal(tree.pinVerified, false);
    assert.equal(receiptLogSigningReady(tree).ok, false);
    _releaseReceiptLogLocksForTest();
  });
});

function countingSigner() {
  const calls = { n: 0 };
  const signer = {
    kind: 'env',
    kid: 'test-kid',
    publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    async sign() {
      calls.n += 1;
      return Buffer.alloc(64, 1);
    },
  };
  return { signer, calls };
}

test('M13: production never publishes a tree head from a non-durable (RECEIPT_LOG_BOOT=0) tree', T_ANY, async () => {
  const { signer, calls } = countingSigner();
  await withEnv({ NODE_ENV: 'production', RECEIPT_LOG_BOOT: '0' }, async () => {
    _setIssuerSignerForTest(signer);
    try {
      const tree = new ReceiptMerkleTree();
      assert.equal(tree.durable, false);
      const head = await tree.publishHead({ force: true });
      assert.equal(head, null);
      assert.equal(tree.heads.length, 0);
      assert.equal(tree.leaves.length, 0, 'no genesis minted on the refused path');
      assert.equal(calls.n, 0, 'the issuer signer is never called');
    } finally {
      _setIssuerSignerForTest(null);
    }
  });
});

const backfillScript = fileURLToPath(new URL('../scripts/backfill-receipt-log.mjs', import.meta.url));
const gatewayDir = fileURLToPath(new URL('..', import.meta.url));
const PROD_ENV = { NODE_ENV: 'production', ANCHOR_MAX_FEE_WEI: '1000000000', ANCHOR_MAX_PRIORITY_WEI: '1000000' };

function snapshotDir(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (fs.statSync(p).isFile()) out[name] = fs.readFileSync(p).toString('base64');
  }
  return out;
}

/** A small durable log made in this process (test env, fresh genesis), lock released afterwards. */
async function makeLog() {
  const dir = tmp();
  await withEnv({ NODE_ENV: 'test', RECEIPT_LOG_ACCEPT_FRESH_GENESIS: undefined }, async () => {
    const tree = bootReceiptLog(dir, { pin: null, allowFreshGenesis: true });
    await tree.appendReceipt('task-a', 'aa'.repeat(32), { publish: false });
  });
  _releaseReceiptLogLocksForTest();
  return dir;
}

test('MF-1: backfill --apply is refused with log_locked while another process holds the lock, and the log is unchanged', T, async () => {
  const dir = await makeLog();
  const jsonl = join(tmp(), 'usage-settled.jsonl');
  fs.writeFileSync(jsonl, `${JSON.stringify({ task_id: 'task-b', agent_id: 'a1', row_hash: 'bb'.repeat(32) })}\n`);
  const before = snapshotDir(dir);
  const a = holder(dir);
  assert.equal(await a.ready, 'LOCKED');
  const env = { ...process.env, NODE_ENV: 'test' };
  delete env.ISSUER_PRIVATE_KEY;
  const run = spawnSync(process.execPath, [backfillScript, '--jsonl', jsonl, '--dir', dir, '--apply'], {
    cwd: gatewayDir,
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /REFUSED: log_locked/);
  assert.deepEqual(snapshotDir(dir), before, 'journal and leaves are unchanged');
});

test('MF-1: a tree opened with load() and no lock cannot append in production (log_not_locked)', T, async () => {
  const dir = await makeLog();
  const before = snapshotDir(dir);
  const tree = new ReceiptMerkleTree();
  tree.load(dir);
  const size = tree.leaves.length;
  await withEnv(PROD_ENV, async () => {
    await assert.rejects(tree.appendReceipt('task-c', 'cc'.repeat(32), { publish: false }), (err) => err.code === 'log_not_locked');
  });
  assert.equal(tree.leaves.length, size);
  assert.deepEqual(snapshotDir(dir), before);
});

for (const how of ['deleted', 'renamed']) {
  test(`lock: when the lock file is ${how} while held, the next append fails closed (log_lock_lost)`, T, async () => {
    const dir = tmp();
    await withEnv({ NODE_ENV: 'test', RECEIPT_LOG_ACCEPT_FRESH_GENESIS: undefined }, async () => {
      const tree = bootReceiptLog(dir, { pin: null, allowFreshGenesis: true });
      await tree.appendReceipt('task-a', 'aa'.repeat(32), { publish: false });
      assert.deepEqual(verifyReceiptLogLock(dir), { ok: true });
      const lockPath = join(dir, RECEIPT_LOG_LOCK_FILE);
      if (how === 'deleted') fs.unlinkSync(lockPath);
      else {
        fs.renameSync(lockPath, `${lockPath}.old`);
        fs.writeFileSync(lockPath, '');
      }
      // Another process can now lock the new path, so this writer must stop.
      const b = holder(dir);
      assert.equal(await b.ready, 'LOCKED');
      const before = snapshotDir(dir);
      const size = tree.leaves.length;
      assert.deepEqual(verifyReceiptLogLock(dir), { ok: false, reason: 'log_lock_lost' });
      assert.equal(holdsReceiptLogLock(dir), false);
      await assert.rejects(tree.appendReceipt('task-b', 'bb'.repeat(32), { publish: false }), (err) => err.code === 'log_lock_lost');
      assert.equal(tree.leaves.length, size);
      assert.deepEqual(snapshotDir(dir), before, 'nothing written after the lock was lost');
      assert.equal(acquireReceiptLogLock(dir).reason, 'log_lock_lost', 'the same process does not silently re-lock');
      assert.equal(receiptLogHeadReady(tree).ok, false);
      _releaseReceiptLogLocksForTest();
    });
  });
}

test('lock: flock runs from /usr/bin/flock only; a fake flock earlier on PATH is ignored, and a fake binary fails the probe', T, async () => {
  const dir = tmp();
  const bin = tmp();
  const fake = join(bin, 'flock');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const a = holder(dir);
  assert.equal(await a.ready, 'LOCKED');
  const b = holder(dir, '', { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(await b.ready, 'log_locked', 'PATH is not used to find flock');
  await killChildren();

  const viaFake = acquireReceiptLogLock(tmp(), { flockBin: fake });
  assert.equal(viaFake.held, false);
  assert.equal(viaFake.reason, 'log_lock_unavailable');
  assert.equal(viaFake.cause.error, 'lock_probe_failed', 'a helper that locks nothing fails the second-open probe');

  const relative = acquireReceiptLogLock(tmp(), { flockBin: 'flock' });
  assert.equal(relative.reason, 'log_lock_unavailable');
  assert.equal(relative.cause.error, 'flock_not_absolute');
});

test('lock: log_lock_unavailable carries the cause (error code, status, signal)', T_ANY, () => {
  const dir = tmp();
  const r = acquireReceiptLogLock(dir, { flockBin: join(dir, 'no-such-flock') });
  assert.equal(r.reason, 'log_lock_unavailable');
  assert.equal(r.cause.error, 'ENOENT');
  assert.ok(Object.prototype.hasOwnProperty.call(r.cause, 'status'));
  assert.ok(Object.prototype.hasOwnProperty.call(r.cause, 'signal'));
});

test('lock: a symlinked lock file is refused and its target is not created or locked', T, () => {
  const dir = tmp();
  const outside = join(tmp(), 'target.lock');
  fs.symlinkSync(outside, join(dir, RECEIPT_LOG_LOCK_FILE));
  const r = acquireReceiptLogLock(dir);
  assert.equal(r.held, false);
  assert.equal(r.reason, 'log_lock_unavailable');
  assert.equal(r.cause.error, 'lock_symlink');
  assert.equal(fs.existsSync(outside), false, 'a dangling symlink target is not created');
  fs.writeFileSync(outside, '');
  const r2 = acquireReceiptLogLock(dir);
  assert.equal(r2.cause.error, 'lock_symlink');
  assert.equal(holdsReceiptLogLock(dir), false);
});

test('pin: in production a missing RECEIPT_LOG_PIN_FILE refuses boot and signing; outside production it reads as unset', T, async () => {
  const missing = join(tmp(), 'no-pin.json');
  await withEnv({ ...PROD_ENV, RECEIPT_LOG_PIN_FILE: missing }, () => {
    assert.throws(() => readReceiptLogPin(), (err) => err.code === 'pin_missing');
    const dir = tmp();
    assert.throws(() => bootReceiptLog(dir, { allowFreshGenesis: true }), (err) => err.code === 'pin_missing');
    _releaseReceiptLogLocksForTest();
    const dir2 = tmp();
    assert.throws(() => bootReceiptLog(dir2, { pin: null, allowFreshGenesis: true }), (err) => err.code === 'pin_missing');
    _releaseReceiptLogLocksForTest();
  });
  await withEnv({ NODE_ENV: 'test', RECEIPT_LOG_PIN_FILE: missing }, () => {
    assert.equal(readReceiptLogPin(), null);
  });
});

test('head path: production publishes a head only from a durable, pin-checked, locked log', T, async () => {
  const { signer, calls } = countingSigner();
  const dir = tmp();
  await withEnv({ ...PROD_ENV, RECEIPT_LOG_BOOT: undefined }, async () => {
    _setIssuerSignerForTest(signer);
    try {
      const tree = new ReceiptMerkleTree();
      tree.durable = true;
      tree.dir = dir;
      tree.pinVerified = false;
      tree.allowFreshGenesis = false;
      assert.deepEqual(receiptLogHeadReady(tree), { ok: false, reason: 'pin_unverified' });
      assert.equal(await tree.publishHead({ force: true }), null);
      tree.pinVerified = true;
      assert.deepEqual(receiptLogHeadReady(tree), { ok: false, reason: 'log_lock_missing' });
      assert.equal(await tree.publishHead({ force: true }), null);
      assert.equal(calls.n, 0, 'the issuer signer is never called');
      assert.equal(tree.heads.length, 0);
      assert.equal(acquireReceiptLogLock(dir).held, true);
      assert.deepEqual(receiptLogHeadReady(tree), { ok: true });
      assert.deepEqual(receiptLogSigningReady(tree, {}), { ok: true }, 'the stricter gate builds on the head gate');
    } finally {
      _setIssuerSignerForTest(null);
      _releaseReceiptLogLocksForTest();
    }
  });
});

test('closed epoch head signed on read: production refuses unless durable, pin-checked and locked', T, async () => {
  const { signer, calls } = countingSigner();
  const dir = tmp();
  await withEnv({ ...PROD_ENV, RECEIPT_LOG_BOOT: undefined }, async () => {
    _setIssuerSignerForTest(signer);
    let touched = 0;
    const pin = new Proxy({}, { get() { touched += 1; return undefined; } });
    try {
      const tree = new ReceiptMerkleTree();
      tree.closedEpochs = [{ epoch: 1, leaves: [Buffer.alloc(32, 1)] }];
      assert.equal(await tree.signedClosedEpochHead(1, pin), null);
      tree.durable = true;
      tree.dir = dir;
      tree.pinVerified = false;
      assert.equal(await tree.signedClosedEpochHead(1, pin), null);
      tree.pinVerified = true;
      assert.equal(await tree.signedClosedEpochHead(1, pin), null);
      assert.equal(touched, 0, 'refused before the pin or the signer is used');
      assert.equal(calls.n, 0);
      assert.equal(acquireReceiptLogLock(dir).held, true);
      try {
        await tree.signedClosedEpochHead(1, pin);
      } catch {
        // The fake pin has no anchors; only reaching it matters here.
      }
      assert.ok(touched > 0, 'a ready log goes on to the pinned anchor check');
    } finally {
      _setIssuerSignerForTest(null);
      _releaseReceiptLogLocksForTest();
    }
  });
});

// ---- Shared production check: NODE_ENV alone does not switch the gates off ----

const { PRODUCTION_ISSUER_KID, isProductionProcess } = await import('../src/production-process.js');
const { isProductionIssuerEnv } = await import('../src/issuer-key.js');
const { isProductionEnv: saltIsProductionEnv } = await import('../src/salt-store.js');
const nodeCrypto = await import('node:crypto');

/** A throwaway P-256 key, base64 PEM, the same format the loader reads. */
function throwawayKeyEnv() {
  const { privateKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
}

/** A stub signer that reports the production kid. It holds no key and never signs. */
function prodKidStub() {
  return {
    kind: 'env',
    kid: PRODUCTION_ISSUER_KID,
    publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    async sign() {
      throw new Error('stub signer must not sign');
    },
  };
}

/** `dir` is a log made beforehand: making one in these envs is itself refused. */
async function assertDevGatesStayOn(label, dir) {
  const before = snapshotDir(dir);
  const tree = new ReceiptMerkleTree();
  tree.load(dir);
  const size = tree.leaves.length;
  await assert.rejects(
    tree.appendReceipt('task-c', 'cc'.repeat(32), { publish: false }),
    (err) => err.code === 'log_not_locked',
    `${label}: unlocked append is refused`,
  );
  assert.equal(tree.leaves.length, size);
  assert.deepEqual(snapshotDir(dir), before, `${label}: nothing written`);

  const missing = join(tmp(), 'no-pin.json');
  process.env.RECEIPT_LOG_PIN_FILE = missing;
  assert.throws(() => readReceiptLogPin(), (err) => err.code === 'pin_missing', `${label}: pin file`);
  assert.throws(() => bootReceiptLog(tmp(), { allowFreshGenesis: true }), (err) => err.code === 'pin_missing', `${label}: boot`);
  _releaseReceiptLogLocksForTest();
  assert.throws(() => bootReceiptLog(tmp(), { pin: null, allowFreshGenesis: true }), (err) => err.code === 'pin_missing', `${label}: null pin`);
  _releaseReceiptLogLocksForTest();
}

test('production check: NODE_ENV=development with a signer reporting the production kid keeps log_not_locked and pin_missing on', T, async () => {
  const dir = await makeLog();
  await withEnv({ ...PROD_ENV, NODE_ENV: 'development', ISSUER_PRIVATE_KEY: undefined, ISSUER_TEST_KEY: '1' }, async () => {
    _setIssuerSignerForTest(prodKidStub());
    try {
      assert.equal(isProductionProcess(), true);
      assert.equal(isProductionIssuerEnv(), true);
      assert.equal(saltIsProductionEnv('development'), true);
      await assertDevGatesStayOn('production kid', dir);
    } finally {
      _setIssuerSignerForTest(null);
    }
    assert.equal(isProductionProcess(), false, 'without the production kid, development is not production');
  });
});

test('production check: NODE_ENV=development with ISSUER_PRIVATE_KEY set keeps log_not_locked and pin_missing on', T, async () => {
  const dir = await makeLog();
  await withEnv({ ...PROD_ENV, NODE_ENV: 'development', ISSUER_PRIVATE_KEY: throwawayKeyEnv(), ISSUER_TEST_KEY: undefined }, async () => {
    assert.equal(isProductionProcess(), true);
    assert.equal(isProductionIssuerEnv('development'), true);
    assert.equal(saltIsProductionEnv('test'), true);
    await assertDevGatesStayOn('ISSUER_PRIVATE_KEY set', dir);
  });
});

test('production check: ISSUER_TEST_KEY=1 opts a throwaway key out, but never the production kid or key material that does not parse', T_ANY, async () => {
  const key = throwawayKeyEnv();
  await withEnv({ NODE_ENV: 'development', ISSUER_PRIVATE_KEY: key, ISSUER_TEST_KEY: '1' }, () => {
    assert.equal(isProductionProcess(), false);
    assert.equal(isProductionProcess(process.env, { nodeEnv: 'production' }), true, 'NODE_ENV production always wins');
    _setIssuerSignerForTest(prodKidStub());
    try {
      assert.equal(isProductionProcess(), true, 'the opt-out never covers the production kid');
    } finally {
      _setIssuerSignerForTest(null);
    }
  });
  await withEnv({ NODE_ENV: 'test', ISSUER_PRIVATE_KEY: 'bm90IGEga2V5', ISSUER_TEST_KEY: '1' }, () => {
    assert.equal(isProductionProcess(), true, 'unparsable key material cannot prove it is a test key');
  });
  await withEnv({ NODE_ENV: 'test', ISSUER_PRIVATE_KEY: key, ISSUER_TEST_KEY: 'true' }, () => {
    assert.equal(isProductionProcess(), true, 'only the exact value 1 opts out');
  });
  await withEnv({ NODE_ENV: 'test', ISSUER_PRIVATE_KEY: undefined, ISSUER_TEST_KEY: undefined }, () => {
    assert.equal(isProductionProcess(), false);
    assert.equal(isProductionProcess({ NODE_ENV: 'test', ISSUER_PRIVATE_KEY: key }), true, 'a passed env with a key set counts');
  });
});

// ---- Side-file writes check the writer too ----

async function unlockedProdTree(fn) {
  const dir = await makeLog();
  const before = snapshotDir(dir);
  const tree = new ReceiptMerkleTree();
  tree.load(dir);
  await withEnv(PROD_ENV, () => fn(tree));
  assert.deepEqual(snapshotDir(dir), before, 'no side file was rewritten');
}

test('writer: noteBundleFailure refuses in production without the lock (log_not_locked) and leaves bundle-index alone', T, async () => {
  await unlockedProdTree((tree) => {
    const failures = tree.bundleFailures || 0;
    assert.throws(() => tree.noteBundleFailure(), (err) => err.code === 'log_not_locked');
    assert.equal(tree.bundleFailures || 0, failures);
  });
});

test('writer: _reopenAnchored refuses in production without the lock (log_not_locked) and leaves anchor-state alone', T, async () => {
  await unlockedProdTree((tree) => {
    assert.throws(() => tree._reopenAnchored('aa'.repeat(32), '0x' + '11'.repeat(32), 'unconfirmed'), (err) => err.code === 'log_not_locked');
  });
});

test('writer: _writeSnapshot refuses in production without the lock (log_not_locked) and leaves the checkpoint alone', T, async () => {
  await unlockedProdTree((tree) => {
    assert.throws(() => tree._writeSnapshot(), (err) => err.code === 'log_not_locked');
  });
});

test('writer: side-file writes stop with log_lock_lost once the lock file is replaced', T, async () => {
  const dir = tmp();
  await withEnv({ NODE_ENV: 'test', RECEIPT_LOG_ACCEPT_FRESH_GENESIS: undefined }, async () => {
    const tree = bootReceiptLog(dir, { pin: null, allowFreshGenesis: true });
    await tree.appendReceipt('task-a', 'aa'.repeat(32), { publish: false });
    const lockPath = join(dir, RECEIPT_LOG_LOCK_FILE);
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, '');
    const before = snapshotDir(dir);
    assert.throws(() => tree.noteBundleFailure(), (err) => err.code === 'log_lock_lost');
    assert.throws(() => tree._reopenAnchored('aa'.repeat(32), null, 'unconfirmed'), (err) => err.code === 'log_lock_lost');
    assert.throws(() => tree._writeSnapshot(), (err) => err.code === 'log_lock_lost');
    assert.deepEqual(snapshotDir(dir), before);
    _releaseReceiptLogLocksForTest();
  });
});

test('lock: a lock file replaced during the journal write stops the writer after the fsync (log_lock_lost)', T, async () => {
  const dir = tmp();
  await withEnv({ NODE_ENV: 'test', RECEIPT_LOG_ACCEPT_FRESH_GENESIS: undefined }, async () => {
    const tree = bootReceiptLog(dir, { pin: null, allowFreshGenesis: true });
    await tree.appendReceipt('task-a', 'aa'.repeat(32), { publish: false });
    const lockPath = join(dir, RECEIPT_LOG_LOCK_FILE);
    const realFsync = fs.fsyncSync;
    let swapped = false;
    fs.fsyncSync = function patched(fd) {
      const out = realFsync.call(fs, fd);
      if (!swapped) {
        swapped = true;
        fs.unlinkSync(lockPath);
        fs.writeFileSync(lockPath, '');
      }
      return out;
    };
    try {
      await assert.rejects(tree.appendReceipt('task-b', 'bb'.repeat(32), { publish: false }), (err) => err.code === 'log_lock_lost');
    } finally {
      fs.fsyncSync = realFsync;
    }
    assert.equal(swapped, true, 'the swap ran inside the write');
    await assert.rejects(tree.appendReceipt('task-c', 'cc'.repeat(32), { publish: false }), (err) => err.code === 'log_lock_lost');
    _releaseReceiptLogLocksForTest();
  });
});
