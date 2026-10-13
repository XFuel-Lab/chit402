/**
 * Bundle 1: a failed durable write fails the request, and a relayer
 * signature is single-use and audience-bound. TFUEL is not a buyer rail
 * on Base or Solana mainnet.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { PersistentTaskStore } from '../src/task-store.js';
import { UsageSettledLedger, setBookRowWrittenHook, setReceiptBoundHook } from '../src/usage-settled.js';
import {
  RelayerNonceStore,
  relayerSignedMessage,
  resetRelayerNonceStore,
  verifyRelayerAuth,
} from '../src/relayer-auth.js';
import { tfuelBuyerRailAllowed } from '../src/x402-flags.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bundle1-'));
}

test('N1 a failed task snapshot is not left in memory', () => {
  const dir = tmp();
  const store = new PersistentTaskStore({ dir, autoFlushMs: 0 });
  const orig = fs.writeFileSync;
  fs.writeFileSync = () => {
    const err = new Error('disk full');
    err.code = 'ENOSPC';
    throw err;
  };
  try {
    assert.throws(
      () => store.set('task-n1', { taskId: 'task-n1', intent: { paymentRef: 'base:0xabc' } }),
      (err) => err.code === 'persist_failed',
    );
    assert.equal(store.get('task-n1'), undefined);
    assert.equal(store.has('task-n1'), false);
  } finally {
    fs.writeFileSync = orig;
  }
});

test('N1 a failed ledger append leaves no in-memory row', () => {
  const dir = tmp();
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const ledger = new UsageSettledLedger({ dir, persist: true });
  const orig = fs.appendFileSync;
  fs.appendFileSync = () => {
    const err = new Error('disk full');
    err.code = 'ENOSPC';
    throw err;
  };
  try {
    assert.throws(
      () => ledger.append({
        task_id: 'task-n1',
        payment: { rail: 'usdc', ref: 'base:0x' + '11'.repeat(32), collected: true, gross_amount: '2000' },
        route: { hub: 'theta', model: 'theta/glm' },
      }, { agentId: 1, payer: '0x' + '22'.repeat(20) }),
      (err) => err.code === 'persist_failed',
    );
    assert.equal(ledger.entries.length, 0);
    assert.equal(ledger.findByTask('task-n1'), null);
  } finally {
    fs.appendFileSync = orig;
    if (prevNode == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});

test('N8 a relayer signature verifies once and only for its audience', async () => {
  resetRelayerNonceStore();
  const wallet = Wallet.createRandom();
  const addresses = new Set([wallet.address.toLowerCase()]);
  const bodySha = 'ab'.repeat(32);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const audience = 'https://api.chit402.com';
  const fields = {
    audience,
    method: 'POST',
    path: '/task-request',
    bodySha,
    timestamp,
    nonce: 'nonce-1',
  };
  const signature = await wallet.signMessage(relayerSignedMessage(fields));
  const args = { ...fields, signature, addresses };
  assert.equal(verifyRelayerAuth(args), true);
  assert.equal(verifyRelayerAuth(args), false);

  const wrongAudience = await wallet.signMessage(relayerSignedMessage({
    ...fields,
    audience: 'https://other.example',
    nonce: 'nonce-2',
  }));
  assert.equal(verifyRelayerAuth({
    ...args,
    signature: wrongAudience,
    nonce: 'nonce-2',
  }), false);

  assert.equal(verifyRelayerAuth({ ...args, nonce: 'nonce-3', signature: undefined }), false);
  const oldMessage = `POST/task-request${bodySha}${timestamp}`;
  const oldSig = await wallet.signMessage(oldMessage);
  assert.equal(verifyRelayerAuth({
    ...args,
    signature: oldSig,
    nonce: 'nonce-4',
  }), false);
  assert.equal(verifyRelayerAuth({ ...args, nonce: '', signature }), false);
});

test('Doctor 537-M1: the log leaf is appended before the covering head is stamped', () => {
  const order = [];
  setBookRowWrittenHook(() => order.push('leaf'));
  setReceiptBoundHook(() => order.push('stamp'));
  try {
    const ledger = new UsageSettledLedger({ persist: false });
    const r = ledger.append({
      task_id: 'doctor-537-m1',
      payment: { rail: 'usdc', ref: `base:0x${'ef'.repeat(32)}`, collected: true, gross_amount: '5000' },
    }, { agentId: 1 });
    assert.equal(r.ok, true);
    assert.deepEqual(order, ['leaf', 'stamp']);
  } finally {
    setBookRowWrittenHook(null);
    setReceiptBoundHook(null);
  }
});

test('a used relayer nonce stays used after the store is reopened from disk', async () => {
  const dir = tmp();
  const file = path.join(dir, 'relayer-nonces.json');
  const wallet = Wallet.createRandom();
  const addresses = new Set([wallet.address.toLowerCase()]);
  const fields = {
    audience: 'https://api.chit402.com',
    method: 'POST',
    path: '/task-request',
    bodySha: 'ab'.repeat(32),
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: 'nonce-restart',
  };
  const signature = await wallet.signMessage(relayerSignedMessage(fields));
  const args = { ...fields, signature, addresses };
  const first = new RelayerNonceStore({ file });
  assert.equal(verifyRelayerAuth({ ...args, store: first }), true);
  const reopened = new RelayerNonceStore({ file });
  assert.equal(verifyRelayerAuth({ ...args, store: reopened }), false);
  assert.equal(fs.existsSync(file), true);
});

test('F7 TFUEL is not a buyer rail on Base or Solana mainnet', () => {
  assert.equal(tfuelBuyerRailAllowed('base'), false);
  assert.equal(tfuelBuyerRailAllowed('eip155:8453'), false);
  assert.equal(tfuelBuyerRailAllowed('solana'), false);
  assert.equal(tfuelBuyerRailAllowed('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), false);
  assert.equal(tfuelBuyerRailAllowed('base-sepolia'), true);
  assert.equal(tfuelBuyerRailAllowed('solana-devnet'), true);
  assert.equal(tfuelBuyerRailAllowed(''), false);
});
