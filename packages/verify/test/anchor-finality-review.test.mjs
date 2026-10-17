import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  fetchBaseAnchorTransaction,
  assessBaseAnchor,
  isUncheckedAnchorReason,
  ANCHOR_RPC_TIMEOUT_MS,
  SOLANA_ANCHOR_RPC_TIMEOUT_MS,
} from '../dist/anchor-witness.js';

const HASH = `0x${'ab'.repeat(32)}`;

function rpcServer(results) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const msg = JSON.parse(body || '{}');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: results[msg.method] ?? null }));
      });
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('a receipt with no transaction body is could_not_check, not a calldata failure', async () => {
  const server = await rpcServer({
    eth_chainId: '0x2105',
    eth_blockNumber: '0x100',
    eth_getTransactionReceipt: { transactionHash: HASH, status: '0x1', blockNumber: '0x10', from: '0x1' },
    eth_getTransactionByHash: null,
  });
  try {
    const tx = await fetchBaseAnchorTransaction(HASH, `http://127.0.0.1:${server.address().port}`);
    const assessed = assessBaseAnchor(tx, 8453);
    assert.equal(assessed.ok, false);
    assert.equal(assessed.reason, 'anchor_inconsistent');
    assert.ok(isUncheckedAnchorReason(assessed.reason));
  } finally {
    server.close();
  }
});

test('the Solana anchor budget covers a slow public getTransaction and stays bounded', () => {
  assert.equal(ANCHOR_RPC_TIMEOUT_MS, 8_000);
  assert.ok(SOLANA_ANCHOR_RPC_TIMEOUT_MS >= 20_000);
  assert.ok(SOLANA_ANCHOR_RPC_TIMEOUT_MS <= 60_000);
});
