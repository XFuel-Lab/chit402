/**
 * Offline Base RPC checks. No production host. Loopback servers are local.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test } from 'node:test';
import { ANCHOR_SELECTOR } from '../calldata.js';
import { MAINNET_ANCHOR, MAINNET_CHECKPOINT, MAINNET_DOMAIN } from '../mainnet-pin.js';
import {
  ANCHOR_GAS_FLOOR,
  ANCHOR_GAS_LIMIT,
  ANCHORED_TOPIC,
  anchorLogFilter,
  assertAnchorWire,
  assertSealerRpcPair,
  classifyNodeError,
  classifySealerRpcIndependence,
  createBaseBroadcaster,
  observedChainOk,
  quoteAnchorFees,
  readFeeCapWei,
  selectFinalizedAnchored,
} from '../rpc-base.js';

const PRIMARY = 'http://primary.example.test/rpc?apiKey=CANARY_RPC_SECRET';
const SECONDARY = 'http://secondary.example.org/rpc?apiKey=CANARY_RPC_SECRET';

function word(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function anchoredLog(block, epoch = 1) {
  return {
    address: MAINNET_ANCHOR,
    blockNumber: `0x${Number(block).toString(16)}`,
    transactionHash: `0x${'cd'.repeat(32)}`,
    topics: [ANCHORED_TOPIC, `0x${word(epoch)}`, `0x${word(0)}`],
    data: `0x${word(128)}${'ab'.repeat(32)}${'cd'.repeat(32)}${word(0)}`,
  };
}

function listen(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = {};
      }
      Promise.resolve(handler(body.method, body.params || [])).then((out) => {
        if (out && out.httpStatus) {
          res.writeHead(out.httpStatus, { 'content-type': 'application/json' });
          res.end(out.body || '');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result: out }));
      }, () => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function routeFetch(ports) {
  return (url, opts) => {
    const host = new URL(url).hostname;
    const port = ports[host];
    if (!port) return Promise.reject(new Error(`unrouted ${url}`));
    const next = new URL(url);
    next.protocol = 'http:';
    next.hostname = '127.0.0.1';
    next.port = String(port);
    return fetch(next, opts);
  };
}

describe('v13 base rpc', { concurrency: false }, () => {
  test('fee cap accepts a positive integer and refuses the rest', () => {
    assert.equal(readFeeCapWei('1000000000'), 1000000000n);
    assert.equal(readFeeCapWei(1), 1n);
    assert.equal(readFeeCapWei(''), null);
    assert.equal(readFeeCapWei('0'), null);
    assert.equal(readFeeCapWei('-1'), null);
    assert.equal(readFeeCapWei('1.5'), null);
    assert.equal(readFeeCapWei('1e9'), null);
    assert.equal(readFeeCapWei('  '), null);
  });

  test('two RPCs must be independent providers', () => {
    assert.equal(classifySealerRpcIndependence(PRIMARY, SECONDARY).ok, true);
    assert.equal(classifySealerRpcIndependence(PRIMARY, '').ok, false);
    assert.equal(classifySealerRpcIndependence(
      'https://rpc.example.test/a',
      'https://rpc.example.test/b',
    ).reason, 'same host');
    const sameDomain = classifySealerRpcIndependence(
      'https://rpc1.example.test/a',
      'https://rpc2.example.test/b',
    );
    assert.equal(sameDomain.ok, false);
    assert.equal(sameDomain.reason, 'same registrable domain');
    const loop = classifySealerRpcIndependence('http://127.0.0.1:1', 'http://127.0.0.2:2');
    assert.equal(loop.ok, false);
    assert.equal(loop.reason, 'localhost or IP alias');
    assert.throws(
      () => assertSealerRpcPair('http://primary.example.test', 'http://secondary.example.org', { NODE_ENV: 'production' }),
      (err) => err.code === 'v13_boot_refused',
    );
    assert.deepEqual(
      assertSealerRpcPair(PRIMARY, SECONDARY, { NODE_ENV: 'test' }),
      [PRIMARY, SECONDARY],
    );
  });

  test('the anchor quote uses the measured gas floor, not 100000', () => {
    const quote = quoteAnchorFees('0x3b9aca00', '0x5f5e100');
    assert.equal(quote.gasLimit, ANCHOR_GAS_LIMIT.toString());
    assert.equal(quote.gasLimit, '300000');
    assert.ok(BigInt(quote.gasLimit) >= ANCHOR_GAS_FLOOR);
    assert.equal(quote.maxFeePerGas, ((1000000000n * 2n) + 100000000n).toString());
    assert.equal(quote.maxPriorityFeePerGas, '100000000');
    assert.throws(() => quoteAnchorFees('0x0', '0x0'), (err) => err.code === 'bad_fees');
  });

  test('chain id 84532 and chain id 1 are not Base mainnet', () => {
    assert.equal(observedChainOk('0x2105'), true);
    assert.equal(observedChainOk('0x14a34'), false);
    assert.equal(observedChainOk('0x1'), false);
    assert.equal(observedChainOk('84532'), false);
  });

  test('a wire that is not the pinned anchor is refused before send', async () => {
    let called = false;
    const broadcaster = createBaseBroadcaster({
      urls: [PRIMARY, SECONDARY],
      fetchImpl: async () => {
        called = true;
        throw new Error('fetch');
      },
      timeoutMs: 200,
    });
    await assert.rejects(() => broadcaster.sendRaw('0x02'), (err) => err.code === 'anchor_target');
    assert.equal(called, false);
    assert.equal(classifyNodeError('already known'), 'known');
    assert.equal(classifyNodeError('nonce too low'), 'known');
    assert.equal(classifyNodeError('replacement transaction underpriced'), 'underpriced');
    assert.equal(classifyNodeError('https://primary.example.test/?apiKey=CANARY_RPC_SECRET'), 'rejected');
    const filter = anchorLogFilter('0x10');
    assert.equal(filter.fromBlock, '0x10');
    assert.equal(filter.toBlock, '0x10');
    assert.notEqual(filter.fromBlock, '0x0');
    assert.notEqual(filter.toBlock, 'latest');
  });

  test('an unfinalized Anchored log is not admitted', () => {
    const from = () => MAINNET_CHECKPOINT;
    const early = selectFinalizedAnchored({
      logs: [anchoredLog(4, 1)],
      finalizedNumber: '0x5',
      txFromOf: from,
    });
    assert.equal(early.length, 1);
    assert.equal(early[0].finalized, true);
    assert.equal(early[0].root, 'ab'.repeat(32));
    const late = selectFinalizedAnchored({
      logs: [anchoredLog(32, 1)],
      finalizedNumber: '0x5',
      txFromOf: from,
    });
    assert.equal(late.length, 0);
    const other = selectFinalizedAnchored({
      logs: [anchoredLog(4, 1)],
      finalizedNumber: '0x5',
      txFromOf: () => `0x${'11'.repeat(20)}`,
    });
    assert.equal(other.length, 0);
  });

  test('a local RPC with the wrong chain is refused before a raw send', async () => {
    const calls = [];
    const server = await listen((method) => {
      calls.push(method);
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_sendRawTransaction') return `0x${'ab'.repeat(32)}`;
      return '0x0';
    });
    try {
      const broadcaster = createBaseBroadcaster({
        urls: [PRIMARY, SECONDARY],
        fetchImpl: routeFetch({
          'primary.example.test': server.port,
          'secondary.example.org': server.port,
        }),
        timeoutMs: 1000,
      });
      await assert.rejects(() => broadcaster.prepare(), (err) => err.code === 'anchor_chain_mismatch');
      assert.equal(calls.includes('eth_sendRawTransaction'), false);
    } finally {
      await server.close();
    }
  });

  test('empty code or a mismatched domain refuses before a raw send', async () => {
    const calls = [];
    const server = await listen((method) => {
      calls.push(method);
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_getCode') return '0x';
      if (method === 'eth_call') return MAINNET_DOMAIN;
      if (method === 'eth_sendRawTransaction') return `0x${'ab'.repeat(32)}`;
      return null;
    });
    const other = await listen((method) => {
      calls.push(method);
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_getCode') return '0x6001';
      if (method === 'eth_call') return `0x${'12'.repeat(32)}`;
      return null;
    });
    try {
      const broadcaster = createBaseBroadcaster({
        urls: [PRIMARY, SECONDARY],
        fetchImpl: routeFetch({
          'primary.example.test': server.port,
          'secondary.example.org': other.port,
        }),
        timeoutMs: 1000,
      });
      await assert.rejects(() => broadcaster.prepare(), (err) => err.code === 'v13_pin_refused');
      assert.equal(calls.includes('eth_sendRawTransaction'), false);
      assert.equal(ANCHOR_SELECTOR.length, 8);
    } finally {
      await server.close();
      await other.close();
    }
  });
});
