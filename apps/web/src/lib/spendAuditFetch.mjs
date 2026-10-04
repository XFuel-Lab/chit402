/**
 * Live readers for the public spend audit.
 * Base RPC: https://mainnet.base.org (eth_getLogs on USDC Transfer).
 * Receipts: GET /receipt/by-tx on the public gateway. 404 is unreceipted.
 * A failed read is unavailable. It is never filled in as zero.
 */

import {
  AUDIT_CHUNK_BLOCKS,
  AUDIT_WINDOW_BLOCKS,
  BASE_RPC_URL,
  BASE_USDC,
  ERC20_TRANSFER_TOPIC,
  MAX_RECEIPT_LOOKUPS,
  MAX_TX_READS,
  addressTopic,
  buildSpendAuditReport,
  decodeUsdcTransferLog,
  parseAuditQuery,
} from './spendAuditCore.mjs';

export class AuditSourceError extends Error {
  constructor(message, code = 'source_unavailable') {
    super(message);
    this.name = 'AuditSourceError';
    this.code = code;
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function retryableRpcError(err) {
  const message = String(err?.message || '');
  return /rpc_http_429|rpc_http_502|rpc_http_503|rpc_http_504|rpc_unreachable|rpc_unreadable/.test(message);
}

async function rpcCall(rpcUrl, method, params, fetchImpl, signal, attempts = 1) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await rpcCallOnce(rpcUrl, method, params, fetchImpl, signal);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      last = err;
      if (!retryableRpcError(err) || attempt === attempts - 1) throw err;
      await new Promise((resolve) => {
        setTimeout(resolve, 250 * (attempt + 1));
      });
    }
  }
  throw last;
}

async function rpcCallOnce(rpcUrl, method, params, fetchImpl, signal) {
  let res;
  try {
    res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new AuditSourceError(`rpc_unreachable: ${err?.message || 'network'}`);
  }
  if (!res.ok) {
    throw new AuditSourceError(`rpc_http_${res.status}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new AuditSourceError('rpc_unreadable');
  }
  if (body?.error) {
    throw new AuditSourceError(body.error.message || 'rpc_error');
  }
  return body?.result;
}

function blockTimeIso(block) {
  const ts = block?.timestamp;
  if (ts == null) return null;
  const n = typeof ts === 'number' ? ts : Number.parseInt(String(ts), 16);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

/**
 * USDC Transfer logs where `from` is the wallet, newest window first.
 * A failed chunk is recorded. It does not become an empty range.
 */
export async function scanBaseUsdcOut(address, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const rpcUrl = options.rpcUrl || BASE_RPC_URL;
  const signal = options.signal;
  const windowBlocks = options.windowBlocks ?? AUDIT_WINDOW_BLOCKS;
  const chunkBlocks = options.chunkBlocks ?? AUDIT_CHUNK_BLOCKS;
  const onProgress = options.onProgress || (() => {});
  const topic = addressTopic(address);
  if (!topic) throw new AuditSourceError('invalid_base_address', 'invalid');

  onProgress('Reading the Base head…');
  const headHex = await rpcCall(rpcUrl, 'eth_blockNumber', [], fetchImpl, signal);
  const head = Number.parseInt(String(headHex), 16);
  if (!Number.isFinite(head)) throw new AuditSourceError('rpc_head_unreadable');

  const fromBlock = Math.max(0, head - windowBlocks);
  const [fromHeader, toHeader] = await Promise.all([
    rpcCall(rpcUrl, 'eth_getBlockByNumber', [hex(fromBlock), false], fetchImpl, signal).catch(() => null),
    rpcCall(rpcUrl, 'eth_getBlockByNumber', [hex(head), false], fetchImpl, signal).catch(() => null),
  ]);

  const ranges = [];
  for (let start = fromBlock; start <= head; start += chunkBlocks) {
    const end = Math.min(head, start + chunkBlocks - 1);
    ranges.push([start, end]);
  }

  const logs = [];
  const failedRanges = [];
  let done = 0;

  async function readRange(start, end) {
    const result = await rpcCall(rpcUrl, 'eth_getLogs', [{
      address: BASE_USDC,
      fromBlock: hex(start),
      toBlock: hex(end),
      topics: [ERC20_TRANSFER_TOPIC, topic],
    }], fetchImpl, signal, 4);
    if (!Array.isArray(result)) throw new AuditSourceError('rpc_logs_unreadable');
    const rows = [];
    for (const log of result) {
      const row = decodeUsdcTransferLog(log);
      if (row && row.from === address.toLowerCase()) rows.push(row);
    }
    return rows;
  }

  const firstPass = await mapPool(ranges, 3, async ([start, end]) => {
    try {
      logs.push(...await readRange(start, end));
      return null;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return { start, end, error: err?.message || 'rpc_logs_failed' };
    } finally {
      done += 1;
      onProgress(`Reading USDC transfers ${done}/${ranges.length}`);
    }
  });

  for (const missed of firstPass.filter(Boolean)) {
    onProgress('Retrying a block range the RPC refused…');
    try {
      logs.push(...await readRange(missed.start, missed.end));
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      failedRanges.push({
        from_block: missed.start,
        to_block: missed.end,
        error: err?.message || missed.error,
      });
    }
  }

  return {
    fromBlock,
    toBlock: head,
    fromTime: blockTimeIso(fromHeader),
    toTime: blockTimeIso(toHeader),
    logs,
    failedRanges,
    scanComplete: failedRanges.length === 0,
  };
}

export async function lookupReceipt(apiHost, txHash, fetchImpl, signal) {
  const url = `${apiHost.replace(/\/$/, '')}/receipt/by-tx?tx=${encodeURIComponent(`base:${txHash}`)}&format=json`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'follow',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { status: 'unavailable' };
  }
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'unavailable', httpStatus: res.status };
  let body;
  try {
    body = await res.json();
  } catch {
    return { status: 'unavailable', reason: 'unreadable' };
  }
  if (!body || typeof body !== 'object' || !body.task_id) {
    return { status: 'unavailable', reason: 'unreadable' };
  }
  const payment = body.payment || {};
  const route = body.route || {};
  return {
    status: 'found',
    task_id: String(body.task_id),
    verify_url: body.verify_url || null,
    schema: body.schema || null,
    rail: payment.rail || null,
    payer: body.caller_binding?.payer_wallet || null,
    gross_amount: payment.gross_amount || payment.amount || null,
    hub: route.hub || route.provider || null,
    model: route.model || null,
  };
}

async function readTxInput(rpcUrl, txHash, fetchImpl, signal) {
  try {
    const tx = await rpcCall(rpcUrl, 'eth_getTransactionByHash', [txHash], fetchImpl, signal);
    return typeof tx?.input === 'string' ? tx.input : null;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

export async function probeAgentBook(apiHost, agentId, fetchImpl, signal) {
  const url = `${apiHost.replace(/\/$/, '')}/v1/agents/${encodeURIComponent(agentId)}/book`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { status: 'unavailable' };
  }
  if (res.status === 401 || res.status === 403) {
    return { status: 'possession_required', httpStatus: res.status };
  }
  if (res.status === 404) return { status: 'not_found', httpStatus: 404 };
  if (!res.ok) return { status: 'unavailable', httpStatus: res.status };
  return { status: 'unexpected_public', httpStatus: res.status };
}

/**
 * @param {string} raw
 * @param {object} [options]
 */
export async function runPublicSpendAudit(raw, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiHost = options.apiHost || 'https://api.chit402.com';
  const rpcUrl = options.rpcUrl || BASE_RPC_URL;
  const signal = options.signal;
  const onProgress = options.onProgress || (() => {});
  const query = parseAuditQuery(raw);

  if (query.kind === 'empty') return { ok: false, error: 'empty' };
  if (query.kind === 'invalid') return { ok: false, error: 'invalid' };

  if (query.kind === 'solana') {
    return { ok: true, report: buildSpendAuditReport({ query }) };
  }

  if (query.kind === 'agent') {
    onProgress('Checking the book…');
    const book = await probeAgentBook(apiHost, query.agentId, fetchImpl, signal);
    return { ok: true, report: buildSpendAuditReport({ query, book }) };
  }

  try {
    const chain = await scanBaseUsdcOut(query.address, {
      fetchImpl,
      rpcUrl,
      signal,
      onProgress,
      windowBlocks: options.windowBlocks,
      chunkBlocks: options.chunkBlocks,
    });
    const txs = [];
    const seen = new Set();
    const ordered = [...chain.logs].sort((a, b) => b.block_number - a.block_number || b.log_index - a.log_index);
    for (const row of ordered) {
      if (seen.has(row.tx_hash)) continue;
      seen.add(row.tx_hash);
      txs.push(row.tx_hash);
    }
    const toCheck = txs.slice(0, MAX_RECEIPT_LOOKUPS);
    onProgress('Matching public Chit receipts…');
    const lookups = await mapPool(toCheck, 4, (txHash) => lookupReceipt(apiHost, txHash, fetchImpl, signal));
    const receipts = new Map();
    toCheck.forEach((txHash, index) => receipts.set(txHash, lookups[index]));

    const needsTx = toCheck.slice(0, MAX_TX_READS);
    const inputs = await mapPool(needsTx, 4, (txHash) => readTxInput(rpcUrl, txHash, fetchImpl, signal));
    const txInputs = new Map();
    needsTx.forEach((txHash, index) => txInputs.set(txHash, inputs[index]));

    return {
      ok: true,
      report: buildSpendAuditReport({
        query,
        chain,
        receipts,
        txInputs,
        rpcUrl,
        windowBlocks: options.windowBlocks,
      }),
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return {
      ok: false,
      error: 'source_unavailable',
      message: err?.message || 'Base RPC did not answer',
    };
  }
}

function hex(n) {
  return `0x${n.toString(16)}`;
}
