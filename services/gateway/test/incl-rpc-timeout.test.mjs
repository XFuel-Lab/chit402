/**
 * INCL-RPC-NOTIMEOUT: the boot eth_chainId call and the Base send
 * abort instead of holding the publish lock open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.RECEIPT_LOG_BOOT = '0';

const { assertBaseChainId } = await import('../src/receipt-log-anchor.js');
const { ReceiptMerkleTree, finishReceiptLogBoot } = await import('../src/receipt-merkle.js');

function hungServer() {
  const sockets = new Set();
  const server = http.createServer(() => { /* never answers */ });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(done);
      }),
    }));
  });
}

function jsonServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const result = handler(body);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

test('boot eth_chainId aborts when the RPC never answers', { timeout: 10_000 }, async () => {
  const srv = await hungServer();
  const started = Date.now();
  try {
    await assert.rejects(
      () => assertBaseChainId({ rpcUrl: srv.url, timeoutMs: 150 }),
      (err) => err.code === 'anchor_chain_mismatch' && /timeout/i.test(err.message),
    );
    assert.ok(Date.now() - started < 2_000, `chain id took ${Date.now() - started} ms`);

    const tree = new ReceiptMerkleTree();
    tree.allowFreshGenesis = true;
    const bootStarted = Date.now();
    await assert.rejects(
      () => finishReceiptLogBoot(tree, {
        allowFreshGenesis: true,
        baseRpc: srv.url,
        timeoutMs: 150,
      }),
      (err) => err.code === 'anchor_chain_mismatch',
    );
    assert.ok(Date.now() - bootStarted < 2_000, `boot took ${Date.now() - bootStarted} ms`);
    assert.equal(tree.lastAnchorError, 'anchor_chain_mismatch');
  } finally {
    await srv.close();
  }
});

test('boot eth_chainId aborts when the injected request ignores the signal', { timeout: 10_000 }, async () => {
  const started = Date.now();
  await assert.rejects(
    () => assertBaseChainId({
      rpcUrl: 'http://127.0.0.1:9',
      timeoutMs: 150,
      request: () => new Promise(() => {}),
    }),
    (err) => err.code === 'anchor_chain_mismatch' && /rpc_timeout/.test(err.message),
  );
  assert.ok(Date.now() - started < 2_000);
});

test('the Base send aborts when eth_sendRawTransaction never answers', { timeout: 10_000 }, async () => {
  const srv = await hungServer();
  const prev = process.env.BASE_RPC_URL;
  process.env.BASE_RPC_URL = srv.url;
  const tree = new ReceiptMerkleTree();
  tree.anchorRpcTimeoutMs = 150;
  const started = Date.now();
  try {
    await assert.rejects(() => tree._broadcastRaw({
      raw: '0x02',
      from: '0x1111111111111111111111111111111111111111',
      to: '0x1111111111111111111111111111111111111111',
      root: 'ab'.repeat(32),
      nonce: 1,
      tx: `0x${'11'.repeat(32)}`,
    }, null, async (_url, method) => (method === 'eth_chainId' ? '0x2105' : null)));
    assert.ok(Date.now() - started < 2_000, `send took ${Date.now() - started} ms`);
  } finally {
    if (prev == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
    await srv.close();
  }
});

test('a live Base RPC still returns the chain id and the send hash', async () => {
  const srv = await jsonServer((body) => {
    if (body.method === 'eth_chainId') return '0x2105';
    if (body.method === 'eth_sendRawTransaction') return `0x${'22'.repeat(32)}`;
    return null;
  });
  const prev = process.env.BASE_RPC_URL;
  process.env.BASE_RPC_URL = srv.url;
  try {
    const chainId = await assertBaseChainId({ rpcUrl: srv.url, timeoutMs: 1_000 });
    assert.equal(chainId, '0x2105');
    const tree = new ReceiptMerkleTree();
    tree.anchorRpcTimeoutMs = 1_000;
    await tree._broadcastRaw({
      raw: '0x02',
      from: '0x1111111111111111111111111111111111111111',
      to: '0x1111111111111111111111111111111111111111',
      root: 'ab'.repeat(32),
      nonce: 1,
      tx: `0x${'11'.repeat(32)}`,
    }, null, async () => '0x2105');
  } finally {
    if (prev == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
    await srv.close();
  }
});
