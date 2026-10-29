/**
 * identities.json is written through the shared atomic helper and
 * an existing looser file is tightened to mode 600 on boot.
 */
import { test } from 'node:test';
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
