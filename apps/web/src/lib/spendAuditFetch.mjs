/**
 * Live readers for the public spend audit.
 * Base RPC: https://mainnet.base.org (eth_getLogs on USDC Transfer).
 * Receipts: GET /receipt/by-tx on the public gateway. 404 is unreceipted.
 * A failed read is unavailable. It is never filled in as zero.
 */

import {
  AUDIT_CHUNK_BLOCKS,
  AUDIT_CHUNK_FLOOR,
  AUDIT_MAX_LOG_CALLS,
  AUDIT_RPC_CONCURRENCY,
  AUDIT_RPC_MIN_GAP_MS,
  AUDIT_WINDOW_BLOCKS,
  BASE_RPC_URL,
  BASE_USDC,
  ERC20_TRANSFER_TOPIC,
  MAX_RECEIPT_LOOKUPS,
  MAX_TX_READS,
  addressTopic,
  buildSpendAuditReport,
  decodeUsdcTransferLog,
  isLogRangeLimitError,
  parseAuditQuery,
  planLogRanges,
  shrinkLogRange,
  statedLogRangeLimit,
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

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryableRpcError(err) {
  const message = String(err?.message || '');
  if (/rpc_http_429|rpc_http_502|rpc_http_503|rpc_http_504|rpc_unreachable|rpc_unreadable/.test(message)) {
    return true;
  }
  return /rate limit|too many requests|overloaded/i.test(message);
}

function isRateLimitMessage(message) {
  return /429|rate limit|too many requests/i.test(String(message || ''));
}

function retryDelayMs(attempt, err) {
  const retryAfter = Number(err?.retryAfterMs);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 8000);
  if (isRateLimitMessage(err?.message)) return Math.min(8000, 800 * (2 ** attempt));
  return 250 * (attempt + 1);
}

function parseRetryAfter(header) {
  if (header == null || header === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const when = Date.parse(String(header));
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

async function readRpcErrorDetail(res) {
  try {
    const body = await res.json();
    if (typeof body?.error?.message === 'string' && body.error.message) return body.error.message;
    if (typeof body?.error === 'string' && body.error) return body.error;
    if (typeof body?.message === 'string' && body.message) return body.message;
  } catch {
    /* body was not JSON */
  }
  return '';
}

/**
 * Space the start of each RPC so parallel workers cannot burst past the gap.
 * @param {number} minGapMs
 * @param {(ms: number) => Promise<void>} sleep
 */
function createRequestPacer(minGapMs, sleep) {
  const gap = Math.max(0, minGapMs);
  let nextAt = 0;
  let tail = Promise.resolve();
  function hold(ms) {
    const pause = Math.max(0, ms);
    const base = Math.max(nextAt, Date.now());
    nextAt = base + pause;
  }
  function pace() {
    const run = tail.then(async () => {
      const wait = Math.max(0, nextAt - Date.now());
      nextAt = Date.now() + wait + gap;
      if (wait > 0) await sleep(wait);
    });
    tail = run.then(() => {}, () => {});
    return run;
  }
  return { pace, hold };
}

async function rpcCall(rpcUrl, method, params, fetchImpl, signal, attempts = 1, sleep = defaultSleep, pacer = null) {
  const pace = typeof pacer === 'function' ? pacer : pacer?.pace;
  const hold = typeof pacer?.hold === 'function' ? pacer.hold : null;
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (pace) await pace();
      return await rpcCallOnce(rpcUrl, method, params, fetchImpl, signal);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      last = err;
      if (!retryableRpcError(err) || attempt === attempts - 1) throw err;
      const delay = retryDelayMs(attempt, err);
      if (hold && isRateLimitMessage(err?.message)) hold(delay);
      await sleep(delay);
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
    const detail = await readRpcErrorDetail(res);
    const err = new AuditSourceError(detail ? `rpc_http_${res.status}: ${detail}` : `rpc_http_${res.status}`);
    err.status = res.status;
    const retryAfter = parseRetryAfter(res.headers?.get?.('retry-after'));
    if (retryAfter != null) err.retryAfterMs = retryAfter;
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new AuditSourceError('rpc_unreadable');
  }
  if (body?.error) {
    const err = new AuditSourceError(body.error.message || 'rpc_error');
    err.status = res.status;
    throw err;
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
  const chunkBlocks = Math.max(1, options.chunkBlocks ?? AUDIT_CHUNK_BLOCKS);
  const chunkFloor = Math.max(1, options.chunkFloor ?? AUDIT_CHUNK_FLOOR);
  const concurrency = Math.max(1, options.concurrency ?? AUDIT_RPC_CONCURRENCY);
  const maxLogCalls = Math.max(1, options.maxLogCalls ?? AUDIT_MAX_LOG_CALLS);
  const sleep = options.sleep || defaultSleep;
  const onProgress = options.onProgress || (() => {});
  const topic = addressTopic(address);
  if (!topic) throw new AuditSourceError('invalid_base_address', 'invalid');

  onProgress('Reading the Base head…');
  const headHex = await rpcCall(rpcUrl, 'eth_blockNumber', [], fetchImpl, signal, 4, sleep);
  const head = Number.parseInt(String(headHex), 16);
  if (!Number.isFinite(head)) throw new AuditSourceError('rpc_head_unreadable');

  const fromBlock = Math.max(0, head - windowBlocks);
  const [fromHeader, toHeader] = await Promise.all([
    rpcCall(rpcUrl, 'eth_getBlockByNumber', [hex(fromBlock), false], fetchImpl, signal, 4, sleep).catch(() => null),
    rpcCall(rpcUrl, 'eth_getBlockByNumber', [hex(head), false], fetchImpl, signal, 4, sleep).catch(() => null),
  ]);

  const queue = planLogRanges(fromBlock, head, chunkBlocks).map(([start, end]) => ({
    start,
    end,
    outerAttempts: 0,
  }));
  const logs = [];
  const failedRanges = [];
  const pace = createRequestPacer(options.minGapMs ?? AUDIT_RPC_MIN_GAP_MS, sleep);
  let logCalls = 0;
  let pending = queue.length;
  let finished = 0;
  const waiters = [];

  function wakeWaiters() {
    const waiting = waiters.splice(0);
    for (const resolve of waiting) resolve();
  }

  function recordFailure(item, error) {
    failedRanges.push({
      from_block: item.start,
      to_block: item.end,
      error: error || 'rpc_logs_failed',
    });
    pending -= 1;
    finished += 1;
    onProgress(`Reading USDC transfers ${finished}/${finished + pending}`);
    if (pending === 0) wakeWaiters();
  }

  async function readRange(start, end) {
    if (logCalls >= maxLogCalls) throw new AuditSourceError('rpc_log_call_cap');
    logCalls += 1;
    const result = await rpcCall(rpcUrl, 'eth_getLogs', [{
      address: BASE_USDC,
      fromBlock: hex(start),
      toBlock: hex(end),
      topics: [ERC20_TRANSFER_TOPIC, topic],
    }], fetchImpl, signal, 4, sleep, pace);
    if (!Array.isArray(result)) throw new AuditSourceError('rpc_logs_unreadable');
    const rows = [];
    for (const log of result) {
      const row = decodeUsdcTransferLog(log);
      if (row && row.from === address.toLowerCase()) rows.push(row);
    }
    return rows;
  }

  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) {
        if (pending === 0) return;
        await new Promise((resolve) => {
          waiters.push(resolve);
        });
        if (pending === 0 && queue.length === 0) return;
        continue;
      }
      try {
        logs.push(...await readRange(item.start, item.end));
        pending -= 1;
        finished += 1;
        onProgress(`Reading USDC transfers ${finished}/${finished + pending}`);
        if (pending === 0) wakeWaiters();
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (isLogRangeLimitError(err)) {
          const pieces = shrinkLogRange(item.start, item.end, {
            floor: chunkFloor,
            statedLimit: statedLogRangeLimit(err),
          });
          if (!pieces || logCalls >= maxLogCalls) {
            recordFailure(item, err?.message || 'rpc_logs_failed');
          } else {
            pending += pieces.length - 1;
            for (const [start, end] of pieces) queue.push({ start, end, outerAttempts: 0 });
            onProgress(`Splitting a ${item.end - item.start + 1}-block range the RPC refused…`);
            wakeWaiters();
          }
        } else if (item.outerAttempts < 2 && err?.message !== 'rpc_log_call_cap') {
          const rateLimited = isRateLimitMessage(err?.message);
          const pause = rateLimited ? 1500 : 400;
          onProgress('Retrying a block range the RPC refused…');
          if (rateLimited) pace.hold(pause);
          await sleep(pause);
          queue.push({ start: item.start, end: item.end, outerAttempts: item.outerAttempts + 1 });
          wakeWaiters();
        } else {
          recordFailure(item, err?.message || 'rpc_logs_failed');
        }
      }
    }
  }

  if (queue.length > 0) {
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.all(workers);
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
      sleep: options.sleep,
      windowBlocks: options.windowBlocks,
      chunkBlocks: options.chunkBlocks,
      chunkFloor: options.chunkFloor,
      concurrency: options.concurrency,
      minGapMs: options.minGapMs,
      maxLogCalls: options.maxLogCalls,
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
