/**
 * Local Base JSON-RPC whose finalized head trails latest by N blocks.
 * latest advances one block per tick. No finalized==block shortcut.
 * Two instances can use different lags so a close sees a disagreement.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import { MAINNET_ANCHOR, MAINNET_DOMAIN } from '../../mainnet-pin.js';
import { DOMAIN_CALL, LATEST_CALL, encodeLatestHead } from '../../rpc-base.js';

const CODE = '0x6001600055';

function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}

function hexNum(n) {
  return `0x${BigInt(n).toString(16)}`;
}

function parseQty(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(text)) return null;
  try {
    const n = BigInt(text);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(n);
  } catch {
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.lag] blocks finalized trails latest. Default 450.
 * @param {number} [options.latest] starting head.
 * @param {string} [options.salt] hash domain so two servers disagree.
 */
export function startLagRpc(options = {}) {
  const salt = typeof options.salt === 'string' && options.salt ? options.salt : 'lag';
  let lag = Number.isInteger(options.lag) && options.lag >= 0 ? options.lag : 450;
  let latest = Number.isInteger(options.latest) && options.latest >= 0 ? options.latest : 1000;
  let finalizedPin = null;
  let nullFinalized = false;
  let errorFinalized = false;
  let hangFinalizedMs = 0;
  let headEpoch = 0;
  let headHour = 0;
  const hashSalt = new Map();
  const receipts = new Map();
  const auth = new Map();
  const sends = [];
  let failNextSend = false;
  const methods = [];
  const blocks = new Map();

  function blockHash(n) {
    const extra = hashSalt.has(n) ? hashSalt.get(n) : 0;
    return `0x${sha256Hex(`${salt}:${n}:${extra}`)}`;
  }

  function blockOf(n) {
    if (!Number.isInteger(n) || n < 0) return null;
    if (!blocks.has(n)) {
      blocks.set(n, {
        number: hexNum(n),
        hash: blockHash(n),
        parentHash: n === 0 ? `0x${'00'.repeat(32)}` : blockHash(n - 1),
        timestamp: hexNum(1_700_000_000 + n),
        baseFeePerGas: '0x3b9aca00',
      });
    }
    const row = blocks.get(n);
    row.hash = blockHash(n);
    row.parentHash = n === 0 ? `0x${'00'.repeat(32)}` : blockHash(n - 1);
    return row;
  }

  function finalizedNumber() {
    if (finalizedPin != null) return finalizedPin;
    const n = latest - lag;
    return n < 0 ? 0 : n;
  }

  function putReceipt(input) {
    const tx = String(input.txHash || '').toLowerCase();
    const blockNumber = Number(input.blockNumber);
    const row = blockOf(blockNumber);
    receipts.set(tx, {
      status: input.status == null ? '0x1' : input.status,
      blockNumber: hexNum(blockNumber),
      blockHash: row ? row.hash : null,
      from: input.from || null,
      to: input.to || null,
      transactionIndex: input.transactionIndex == null ? '0x0' : input.transactionIndex,
      logs: Array.isArray(input.logs) ? input.logs : [],
    });
    return receipts.get(tx);
  }

  function refreshReceipts() {
    for (const [tx, receipt] of receipts) {
      const n = parseQty(receipt.blockNumber);
      if (n == null) continue;
      const row = blockOf(n);
      receipt.blockHash = row.hash;
      void tx;
    }
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = {};
      }
      const method = body.method;
      const params = Array.isArray(body.params) ? body.params : [];
      methods.push(method);
      if (method === 'eth_getBlockByNumber' && params[0] === 'finalized' && hangFinalizedMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, hangFinalizedMs));
      }
      const result = answer(method, params);
      if (result && result.hang) return;
      if (result && result.rpcError) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? 1,
          error: { code: -32000, message: result.rpcError },
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result: result === undefined ? null : result }));
    });
  });

  function answer(method, params) {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_maxPriorityFeePerGas') return '0x5f5e100';
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getLogs') return [];
    if (method === 'eth_call') {
      const data = String((params[0] && params[0].data) || '').toLowerCase();
      if (data === LATEST_CALL.toLowerCase()) return encodeLatestHead(headEpoch, headHour);
      if (data === DOMAIN_CALL.toLowerCase()) return MAINNET_DOMAIN;
      if (data.startsWith('0xe94a0102')) {
        const word = data.slice(10);
        if (auth.has(word)) return auth.get(word) ? `0x${'0'.repeat(63)}1` : `0x${'00'.repeat(32)}`;
        if (auth.has('*')) return auth.get('*') ? `0x${'0'.repeat(63)}1` : `0x${'00'.repeat(32)}`;
        return `0x${'0'.repeat(63)}1`;
      }
      if (data.length > 10) return '0x';
      return MAINNET_DOMAIN;
    }
    if (method === 'eth_getBlockByNumber') {
      const which = params[0];
      if (which === 'finalized') {
        if (errorFinalized) return { rpcError: 'header not found' };
        if (nullFinalized) return null;
        return blockOf(finalizedNumber());
      }
      if (which === 'latest' || which === 'safe') {
        const row = blockOf(latest);
        return { ...row, baseFeePerGas: '0x3b9aca00' };
      }
      const n = parseQty(which);
      if (n == null) return null;
      return blockOf(n);
    }
    if (method === 'eth_getTransactionReceipt') {
      const tx = String(params[0] || '').toLowerCase();
      return receipts.has(tx) ? receipts.get(tx) : null;
    }
    if (method === 'eth_getTransactionByHash') {
      const tx = String(params[0] || '').toLowerCase();
      if (!receipts.has(tx)) return null;
      return { hash: tx, from: receipts.get(tx).from || `0x${'11'.repeat(20)}`, blockNumber: receipts.get(tx).blockNumber };
    }
    if (method === 'eth_sendRawTransaction') {
      sends.push(params[0]);
      if (failNextSend) {
        failNextSend = false;
        return { rpcError: 'replacement transaction underpriced' };
      }
      const n = sends.length;
      return `0x${n.toString(16).padStart(64, '0')}`;
    }
    return null;
  }

  return new Promise((resolve) => {
    server.unref();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        anchor: MAINNET_ANCHOR,
        methods,
        sends,
        get latest() { return latest; },
        get lag() { return lag; },
        finalized() { return finalizedNumber(); },
        hashOf(n) { return blockHash(Number(n)); },
        tick(steps = 1) {
          const count = Number.isInteger(steps) && steps > 0 ? steps : 1;
          latest += count;
          refreshReceipts();
          return { latest, finalized: finalizedNumber() };
        },
        setLag(next) {
          lag = Number.isInteger(next) && next >= 0 ? next : lag;
          return finalizedNumber();
        },
        pinFinalized(n) {
          finalizedPin = n == null ? null : Number(n);
          return finalizedNumber();
        },
        setFinalizedMode(mode) {
          nullFinalized = mode === 'null';
          errorFinalized = mode === 'error';
          hangFinalizedMs = mode === 'timeout' ? 400 : 0;
        },
        reorg(n) {
          const block = Number(n);
          hashSalt.set(block, (hashSalt.get(block) || 0) + 1);
          blocks.delete(block);
          refreshReceipts();
          return blockHash(block);
        },
        putReceipt,
        failNextSend() { failNextSend = true; },
        dropReceipt(txHash) {
          receipts.delete(String(txHash || '').toLowerCase());
        },
        setAuthorization(dataKey, used) {
          auth.set(String(dataKey).toLowerCase().replace(/^0x/, ''), used === true);
        },
        setHead(epoch, hourStart) {
          headEpoch = epoch;
          headHour = hourStart;
        },
        close: () => new Promise((done) => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

/**
 * Route two independent hostnames at loopback lag servers.
 * The sealer refuses two loopback URLs, so tests advertise distinct hosts.
 */
export function routeLagFetch(left, right) {
  const ports = new Map();
  return (url, opts) => {
    const host = new URL(url).hostname;
    const target = host.includes('secondary') ? right : left;
    const next = new URL(url);
    next.protocol = 'http:';
    next.hostname = '127.0.0.1';
    next.port = String(target.port);
    return fetch(next, opts);
  };
}
