/**
 * identities.json is written through the shared atomic helper and
 * an existing looser file is tightened to mode 600 on boot.
 */
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.ISSUER_TEST_KEY = '1';

const { AgentRegistry } = await import('../src/agent-registry.js');

function dir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ident-mode-'));
}

test('a persisted identities.json is mode 600 under umask 022 and 000', () => {
  for (const mask of [0o022, 0o000]) {
    const prev = process.umask(mask);
    try {
      const root = dir();
      const registry = new AgentRegistry({ dir: root, persist: true });
      registry.allocate({});
      const file = path.join(root, 'identities.json');
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
      process.umask(prev);
    }
  }
});

test('an existing mode 644 identities.json becomes 600 and stays byte-identical', () => {
  const root = dir();
  const file = path.join(root, 'identities.json');
  const body = JSON.stringify({ nextId: 4, identities: [] });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o644);
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  const before = fs.readFileSync(file);
  const registry = new AgentRegistry({ dir: root, persist: true });
  assert.equal(registry.get(1), null);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(Buffer.compare(fs.readFileSync(file), before), 0);
});

test('chmod EPERM or EROFS at boot is chmod failed, not load failed', () => {
  const root = dir();
  const file = path.join(root, 'identities.json');
  fs.writeFileSync(file, JSON.stringify({ nextId: 1, identities: [] }));
  fs.chmodSync(file, 0o644);
  for (const code of ['EPERM', 'EROFS']) {
    const wrapped = mock.method(fs, 'chmodSync', () => {
      const err = new Error(code);
      err.code = code;
      throw err;
    });
    try {
      assert.throws(
        () => new AgentRegistry({ dir: root, persist: true }),
        (err) => err?.code === 'persist_failed' && err.message === 'agent-registry: chmod failed',
      );
    } finally {
      wrapped.mock.restore();
    }
    assert.equal(fs.statSync(file).mode & 0o777, 0o644);
    assert.equal(fs.readFileSync(file, 'utf8').includes('"identities"'), true);
  }
});

test('a directory named identities.json refuses boot without a chmod', () => {
  const root = dir();
  const file = path.join(root, 'identities.json');
  fs.mkdirSync(file);
  const before = fs.statSync(file).mode & 0o777;
  assert.throws(
    () => new AgentRegistry({ dir: root, persist: true }),
    (err) => err?.code === 'persist_failed' && err.message === 'agent-registry: load failed',
  );
  assert.equal(fs.statSync(file).isDirectory(), true);
  assert.equal(fs.statSync(file).mode & 0o777, before);
});

test('boot unlinks stale atomic temps in the agents dir only', () => {
  const root = dir();
  const outside = dir();
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested);
  const stale = path.join(root, '.identities.json.4242.3.tmp');
  const webhookStale = path.join(root, '.book-webhooks.json.9.1.tmp');
  const keep = path.join(root, 'keep.tmp');
  const nestedTmp = path.join(nested, '.identities.json.1.1.tmp');
  const outsideTmp = path.join(outside, '.identities.json.1.1.tmp');
  for (const target of [stale, webhookStale, keep, nestedTmp, outsideTmp]) {
    fs.writeFileSync(target, 'partial');
  }
  new AgentRegistry({ dir: root, persist: true });
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(webhookStale), false);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'partial');
  assert.equal(fs.readFileSync(nestedTmp, 'utf8'), 'partial');
  assert.equal(fs.readFileSync(outsideTmp, 'utf8'), 'partial');
});
