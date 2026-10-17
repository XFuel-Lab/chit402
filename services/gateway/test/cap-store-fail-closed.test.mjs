/**
 * Stopgap: the cap and identity stores fail closed on a load error.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { BookPolicyStore, POLICY_TYPES } = await import('../src/book-policy.js');
const { AgentRegistry } = await import('../src/agent-registry.js');

const gatewayRoot = fileURLToPath(new URL('..', import.meta.url));
const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe('cap stores fail closed on load', () => {
  test('truncated book-policy.json refuses to open and is left byte-identical', () => {
    const dir = tmpDir('bp-');
    const s1 = new BookPolicyStore({ dir, persist: true });
    s1.set(7, POLICY_TYPES.KILL_SWITCH, true);
    const f = path.join(dir, 'book-policy.json');
    const bad = fs.readFileSync(f, 'utf8').slice(0, -3);
    fs.writeFileSync(f, bad);
    assert.throws(() => new BookPolicyStore({ dir, persist: true }), (e) => e.code === 'persist_failed');
    assert.equal(fs.readFileSync(f, 'utf8'), bad);
  });

  test('unreadable book-policy.json refuses to open and is left byte-identical', (t) => {
    const dir = tmpDir('bp-');
    const s1 = new BookPolicyStore({ dir, persist: true });
    s1.set(7, POLICY_TYPES.KILL_SWITCH, true);
    const f = path.join(dir, 'book-policy.json');
    const bad = fs.readFileSync(f, 'utf8');
    fs.chmodSync(f, 0o000);
    let denied = false;
    try {
      fs.readFileSync(f);
    } catch (err) {
      denied = err.code === 'EACCES' || err.code === 'EPERM';
    }
    if (!denied) {
      fs.chmodSync(f, 0o644);
      t.skip('this process can still read a mode-000 file');
      return;
    }
    try {
      assert.throws(() => new BookPolicyStore({ dir, persist: true }), (e) => e.code === 'persist_failed');
    } finally {
      fs.chmodSync(f, 0o644);
    }
    assert.equal(fs.readFileSync(f, 'utf8'), bad);
  });

  test('book-policy.json without a policies map refuses to open', () => {
    const dir = tmpDir('bp-');
    const f = path.join(dir, 'book-policy.json');
    fs.writeFileSync(f, '{}');
    assert.throws(() => new BookPolicyStore({ dir, persist: true }), (e) => e.code === 'persist_failed');
    assert.equal(fs.readFileSync(f, 'utf8'), '{}');
    fs.writeFileSync(f, '{"policies":[]}');
    assert.throws(() => new BookPolicyStore({ dir, persist: true }), (e) => e.code === 'persist_failed');
    assert.equal(fs.readFileSync(f, 'utf8'), '{"policies":[]}');
  });

  test('missing book-policy.json is a clean first run', () => {
    const s = new BookPolicyStore({ dir: tmpDir('bp-'), persist: true });
    assert.equal(s.get(1), null);
  });

  test('truncated identities.json refuses to open (no agent_id reuse)', () => {
    const dir = tmpDir('ar-');
    const r1 = new AgentRegistry({ dir, persist: true });
    r1.allocate({});
    const f = path.join(dir, 'identities.json');
    const bad = fs.readFileSync(f, 'utf8').slice(0, -2);
    fs.writeFileSync(f, bad);
    assert.throws(() => new AgentRegistry({ dir, persist: true }), (e) => e.code === 'persist_failed');
    assert.equal(fs.readFileSync(f, 'utf8'), bad);
  });

  test('unreadable identities.json refuses to open and is left byte-identical', (t) => {
    const dir = tmpDir('ar-');
    const r1 = new AgentRegistry({ dir, persist: true });
    r1.allocate({});
    const f = path.join(dir, 'identities.json');
    const bad = fs.readFileSync(f, 'utf8');
    fs.chmodSync(f, 0o000);
    let denied = false;
    try {
      fs.readFileSync(f);
    } catch (err) {
      denied = err.code === 'EACCES' || err.code === 'EPERM';
    }
    if (!denied) {
      fs.chmodSync(f, 0o644);
      t.skip('this process can still read a mode-000 file');
      return;
    }
    try {
      assert.throws(() => new AgentRegistry({ dir, persist: true }), (e) => e.code === 'persist_failed');
    } finally {
      fs.chmodSync(f, 0o644);
    }
    assert.equal(fs.readFileSync(f, 'utf8'), bad);
  });

  test('identities.json without an identities list refuses to open', () => {
    const dir = tmpDir('ar-');
    const f = path.join(dir, 'identities.json');
    fs.writeFileSync(f, '{}');
    assert.throws(() => new AgentRegistry({ dir, persist: true }), (e) => e.code === 'persist_failed');
    assert.equal(fs.readFileSync(f, 'utf8'), '{}');
    fs.writeFileSync(f, '{"identities":{}}');
    assert.throws(() => new AgentRegistry({ dir, persist: true }), (e) => e.code === 'persist_failed');
    assert.equal(fs.readFileSync(f, 'utf8'), '{"identities":{}}');
  });

  test('missing identities.json is a clean first run', () => {
    const registry = new AgentRegistry({ dir: tmpDir('ar-'), persist: true });
    assert.equal(registry.allocate({}).agent_id, 1);
  });

  test('nextId never falls at or below an id on disk', () => {
    const dir = tmpDir('ar-');
    const r1 = new AgentRegistry({ dir, persist: true });
    const a = r1.allocate({});
    r1.allocate({});
    const f = path.join(dir, 'identities.json');
    const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
    snap.nextId = 1;
    fs.writeFileSync(f, JSON.stringify(snap));
    const r2 = new AgentRegistry({ dir, persist: true });
    assert.ok(r2.allocate({}).agent_id > a.agent_id + 1);
  });
});

function refuseBoot(fileName, contents) {
  const dir = tmpDir('boot-');
  const agents = path.join(dir, 'agents');
  const tasks = path.join(dir, 'tasks');
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(tasks, { recursive: true });
  const file = path.join(agents, fileName);
  fs.writeFileSync(file, contents);
  const script = `
    const { createApp } = await import('./src/server.js');
    try {
      await createApp();
      process.stdout.write('\\nBOOT_RESULT ' + JSON.stringify({ booted: true }) + '\\n');
      process.exit(0);
    } catch (err) {
      process.stdout.write('\\nBOOT_RESULT ' + JSON.stringify({
        booted: false,
        code: err && err.code,
        message: err && err.message,
      }) + '\\n');
      process.exit(2);
    }
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: gatewayRoot,
    encoding: 'utf8',
    timeout: 90000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TASK_STORE_PERSIST: 'true',
      TASK_STORE_DIR: tasks,
      AGENTS_DIR: agents,
      OWNER_VIEW_DB: path.join(dir, 'owner.sqlite'),
      RECEIPT_LOG_BOOT: '0',
      HUB_CATALOG_OFFLINE: 'true',
      SPEND_HOLD_ENABLED: 'false',
      X402_ENABLED: 'false',
    },
  });
  return { res, file, contents };
}

describe('gateway refuses to boot on a corrupt store', () => {
  for (const [fileName, contents] of [
    ['book-policy.json', '{'],
    ['identities.json', '{'],
  ]) {
    test(`corrupt ${fileName} is persist_failed and the file is left untouched`, () => {
      const { res, file } = refuseBoot(fileName, contents);
      assert.equal(res.error, undefined, res.error && res.error.message);
      const blob = `${res.stdout || ''}\n${res.stderr || ''}`;
      const line = blob.split('\n').find((row) => row.startsWith('BOOT_RESULT '));
      assert.ok(line, `boot child produced no result (status ${res.status} signal ${res.signal}): ${blob.slice(0, 2000)}`);
      const body = JSON.parse(line.slice('BOOT_RESULT '.length));
      assert.equal(body.booted, false);
      assert.equal(body.code, 'persist_failed');
      assert.equal(fs.readFileSync(file, 'utf8'), contents);
    });
  }
});
