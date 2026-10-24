/**
 * One writer per receipt log directory, and new signed artifacts only from
 * a durable, pin-checked log.
 *
 * The lock is an exclusive flock on a descriptor this process keeps open.
 * It is same-host only and has no pid file or reclaim. Production never
 * publishes a tree head from a log that is not durable.
 */
import { test } from 'node:test';
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
  RECEIPT_LOG_LOCK_FILE,
  _releaseReceiptLogLocksForTest,
} = await import('../src/receipt-log-lock.js');
const {
  ReceiptMerkleTree,
  bootReceiptLog,
  receiptLogSigningReady,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');
const { _setIssuerSignerForTest } = await import('../src/issuer-signer.js');

const lockModule = fileURLToPath(new URL('../src/receipt-log-lock.js', import.meta.url));

function tmp() {
  return mkdtempSync(join(tmpdir(), 'chit-single-writer-'));
}

/** Start a child that takes the lock, prints LOCKED or the reason, then waits. */
function holder(dir, extra = '') {
  const code = `
    import { acquireReceiptLogLock } from ${JSON.stringify(lockModule)};
    const r = acquireReceiptLogLock(${JSON.stringify(dir)});
    process.stdout.write((r.held ? 'LOCKED' : r.reason) + '\\n');
    ${extra}
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ready = new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (b) => {
      out += String(b);
      if (out.includes('\n')) resolve(out.trim());
    });
    child.on('error', reject);
    child.on('exit', (c) => resolve(`exit:${c}`));
  });
  return { child, ready };
}

function waitExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.on('exit', () => resolve());
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

const hasFlock = spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;

test('M12: a second process on the same log directory is refused while the first holds it', { skip: !hasFlock }, async () => {
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

test('M12: the kernel releases the lock when the holder dies, with no pid file or reclaim step', { skip: !hasFlock }, async () => {
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

test('M22: a lock file left on disk by a dead process does not block, and content is never used to reclaim', { skip: !hasFlock }, async () => {
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

test('M12: the lock is not inherited by other child processes of the holder', { skip: !hasFlock }, async () => {
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

test('M12: the same process reuses its own lock for the same directory', { skip: !hasFlock }, () => {
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

test('M12: production refuses boot when the lock cannot be taken; test env warns and is not signing-ready', async () => {
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

test('M13: signing readiness needs durable + boot enabled + no fresh genesis + pin verified + lock held', { skip: !hasFlock }, async () => {
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

test('M13: a boot that skips the pin (pin unset or fresh genesis) never marks the log pin-verified', { skip: !hasFlock }, async () => {
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

test('M13: production never publishes a tree head from a non-durable (RECEIPT_LOG_BOOT=0) tree', async () => {
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
