/**
 * Two OS processes pay in parallel against one funder cap. CDP's lock is
 * in-process, so this is the case its SpendStore cannot close by itself.
 * Paths stay on node:path / node:child_process so Windows CI can run it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FUNDER, TOKEN, startHoldGateway } from './harness.mjs';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.mjs');

function runWorker(env) {
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      execArgv: [],
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exit ${code}: ${err || out}`));
        return;
      }
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
      try {
        resolve(JSON.parse(line));
      } catch (parseErr) {
        reject(new Error(`worker output: ${parseErr.message}; stdout=${out}; stderr=${err}`));
      }
    });
  });
}

test('two processes cannot spend past one cap, and a refusal is not signed', async () => {
  const cap = 10000n;
  const amount = 4000;
  const gateway = await startHoldGateway(cap);
  try {
    const env = {
      CHIT_GATEWAY: gateway.base,
      CHIT_TOKEN: TOKEN,
      CHIT_FUNDER: FUNDER,
      CHIT_AMOUNT: String(amount),
      CHIT_COUNT: '4',
      CHIT_LOCAL_CAP: '1000000000000',
    };
    const [left, right] = await Promise.all([runWorker(env), runWorker(env)]);
    const successes = left.ok + right.ok;
    const signs = left.signs + right.signs;
    // The scheme increments only inside createPaymentPayload. A before-hook
    // throw never reaches it, so signs stay equal to the payments that passed.
    assert.equal(successes, 2, JSON.stringify({ left, right }));
    assert.equal(signs, successes, JSON.stringify({ left, right }));
    assert.ok(
      left.codes.includes('CEILING_EXCEEDED') || right.codes.includes('CEILING_EXCEEDED'),
      JSON.stringify({ left, right }),
    );
    const listed = await fetch(`${gateway.base}/v1/spend/holds?funder=${FUNDER}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = await listed.json();
    assert.equal(BigInt(body.held), BigInt(successes) * BigInt(amount));
    assert.ok(BigInt(body.held) <= cap);
  } finally {
    await gateway.close();
  }
});
