/**
 * Nonces and sessions are durable. A process restart must not
 * resurrect a spent nonce or drop a live session, and boot must
 * refuse to start when the store cannot be written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';

const childPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'support',
  'owner-store-restart-child.mjs',
);

function runStep(step, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [childPath, step], {
      env: { ...process.env, ...env },
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.stderr.on('data', (chunk) => { err += chunk; });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`step ${step} exited ${code}\n${out}\n${err}`));
        return;
      }
      resolve(fs.readFileSync(env.RESULT_FILE, 'utf8').trim());
    });
  });
}

test('a restarted process rejects a spent nonce and still honors the session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-owner-restart-'));
  const wallet = Wallet.createRandom();
  const env = {
    OWNER_VIEW_DB: path.join(dir, 'owner-view.sqlite'),
    STATE_FILE: path.join(dir, 'state.json'),
    RESULT_FILE: path.join(dir, 'result.txt'),
    HOUSE_KEY: wallet.privateKey,
    HUB_CATALOG_OFFLINE: 'true',
    X402_ENABLED: 'false',
  };
  assert.equal(await runStep('open', env), 'opened');
  assert.equal(fs.existsSync(env.OWNER_VIEW_DB), true);
  assert.equal(await runStep('replay', env), '401');
  assert.equal(await runStep('hold', env), '200');
});

test('boot fails closed when the owner view store cannot be written', async () => {
  const blocker = path.join(os.tmpdir(), `chit-owner-block-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(blocker, 'not-a-directory');
  process.env.OWNER_VIEW_DB = path.join(blocker, 'owner-view.sqlite');
  const { createApp } = await import('../src/server.js');
  assert.throws(() => createApp(), /owner view store cannot be written/);
});
