/**
 * INCL-RPC-NOTIMEOUT: the boot eth_chainId call and the Base send
 * abort instead of holding the publish lock open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
      (err) => err.code === 'anchor_rpc_unavailable' && /timeout/i.test(err.message),
    );
    assert.ok(Date.now() - started < 2_000, `chain id took ${Date.now() - started} ms`);

    const tree = new ReceiptMerkleTree();
    tree.allowFreshGenesis = true;
    const bootStarted = Date.now();
    // A silent RPC does not crash-loop boot: anchoring pauses, sends stay gated.
    await finishReceiptLogBoot(tree, {
      allowFreshGenesis: true,
      baseRpc: srv.url,
      timeoutMs: 150,
    });
    assert.ok(Date.now() - bootStarted < 2_000, `boot took ${Date.now() - bootStarted} ms`);
    assert.equal(tree.lastAnchorError, 'anchor_rpc_unavailable');
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
    (err) => err.code === 'anchor_rpc_unavailable' && /rpc_timeout/.test(err.message),
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

test('a send that times out and then succeeds late is not sent twice', { timeout: 10_000 }, async () => {
  const raws = [];
  const late = [];
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (body.method === 'eth_sendRawTransaction') raws.push(body.params?.[0]);
    // The client aborts first. The node still accepts the raw and answers after.
    late.push(new Promise((resolve) => {
      setTimeout(() => {
        try {
          if (!res.writableEnded && !res.destroyed) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: body.id ?? 1,
              result: `0x${'cd'.repeat(32)}`,
            }));
          }
        } catch { /* the client already left */ }
        resolve();
      }, 400);
    }));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  const srv = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
    }));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-late-send-'));
  const prevRpc = process.env.BASE_RPC_URL;
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.BASE_RPC_URL = srv.url;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.anchorRpcTimeoutMs = 150;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  let landed = null;
  const request = async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return landed;
    if (method === 'eth_getTransactionReceipt') return null;
    if (method === 'eth_getTransactionCount') return '0x0';
    return null;
  };
  try {
    const first = await tree.publishHead({
      force: true,
      nonce: 4,
      now: '2026-10-06T12:00:00.000Z',
      request,
    });
    assert.equal(raws.length, 1);
    assert.equal(first.anchor_status, 'blocked');
    assert.match(String(first.anchor?.reason || ''), /timeout|aborted/i);
    await late[0];
    const { keccak256, Transaction } = await import('ethers');
    const raw = raws[0];
    const parsed = Transaction.from(raw);
    landed = {
      hash: keccak256(raw),
      from: parsed.from,
      to: parsed.to,
      nonce: Number(parsed.nonce),
      input: parsed.data,
    };
    const again = await tree.publishHead({
      force: true,
      nonce: 99,
      now: '2026-10-06T12:02:00.000Z',
      request,
    });
    assert.equal(raws.length, 1);
    assert.equal(new Set(raws).size, 1);
    assert.equal(again.anchor_tx, landed.hash);
    assert.equal(again.anchor_status, 'broadcast');
    const signedRaws = tree.anchorIntents.map((row) => row.raw).filter(Boolean);
    assert.equal(new Set(signedRaws).size, 1);
    assert.equal(tree.anchorIntents.some((row) => row.status === 'superseded'), false);
  } finally {
    if (prevRpc == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prevRpc;
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    for (const socket of sockets) socket.destroy();
    await new Promise((done) => server.close(done));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an RPC timeout at boot does not skip the epoch gate or the latest-anchor check', { timeout: 10_000 }, async () => {
  const srv = await hungServer();
  const foreign = async () => ({ root: `0x${'ee'.repeat(32)}`, tx: '0xforeign' });
  try {
    const bare = new ReceiptMerkleTree();
    await assert.rejects(
      () => finishReceiptLogBoot(bare, { baseRpc: srv.url, timeoutMs: 150, readLatest: foreign }),
      (err) => err.code === 'epoch_record_missing',
    );
    const tree = new ReceiptMerkleTree();
    tree.allowFreshGenesis = true;
    await finishReceiptLogBoot(tree, { baseRpc: srv.url, timeoutMs: 150 });
    assert.ok(tree._deferredBoot);
    tree.allowFreshGenesis = false;
    tree._deferredBoot = { ...tree._deferredBoot, readLatest: foreign, lookup: async () => null, rebroadcast: null, readBlockTs: null };
    await assert.rejects(
      () => tree._gateAnchorChain(async (_u, method) => (method === 'eth_chainId' ? '0x2105' : null)),
      (err) => err.code === 'anchor_not_in_journal',
    );
    assert.ok(tree._deferredBoot, 'anchoring stays paused');
  } finally {
    await srv.close();
  }
});

test('the deferred checks refuse a foreign journal before reconcile rebroadcasts a stored raw', { timeout: 10_000 }, async () => {
  const srv = await hungServer();
  const foreign = async () => ({ root: `0x${'ee'.repeat(32)}`, tx: '0xforeign' });
  try {
    const tree = new ReceiptMerkleTree();
    tree.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-deferred-order-'));
    tree.allowFreshGenesis = true;
    await finishReceiptLogBoot(tree, { baseRpc: srv.url, timeoutMs: 150 });
    tree.allowFreshGenesis = false;
    const rebroadcasts = [];
    tree._deferredBoot = {
      ...tree._deferredBoot,
      readLatest: foreign,
      lookup: async () => ({ rebroadcast: true }),
      rebroadcast: async (raw) => { rebroadcasts.push(raw); },
      readBlockTs: null,
    };
    tree.anchorIntents.push({ chain: 'base', day: '2026-10-05', root: `0x${'aa'.repeat(32)}`, nonce: 1, status: 'blocked', raw: '0xdeadbeef', tx: `0x${'ab'.repeat(32)}` });
    await assert.rejects(
      () => tree._gateAnchorChain(async (_u, method) => (method === 'eth_chainId' ? '0x2105' : null)),
      (err) => err.code === 'anchor_not_in_journal',
    );
    assert.equal(rebroadcasts.length, 0);
    assert.ok(tree._deferredBoot);
    fs.rmSync(tree.dir, { recursive: true, force: true });
  } finally {
    await srv.close();
  }
});
