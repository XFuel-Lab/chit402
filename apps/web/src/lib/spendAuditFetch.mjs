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
  FAILED_RANGE_CODES,
  MAX_RECEIPT_LOOKUPS,
  MAX_SOL_TX_READS,
  MAX_TX_READS,
  SOL_MAX_SIG_PAGES,
  SOL_MAX_SIG_PAGES_PER_SOURCE,
  SOL_MAX_TOKEN_ACCOUNTS,
  SOL_SCAN_DEADLINE_MS,
  SOL_SIG_PAGE_LIMIT,
  SOL_WINDOW_SECONDS,
  addressTopic,
  auditQueryMessage,
  buildSpendAuditReport,
  decodeSolanaUsdcTransfers,
  decodeUsdcTransferLog,
  isLogRangeLimitError,
  parseAuditQuery,
  parseReceiptShell,
  planLogRanges,
  shrinkLogRange,
  solanaCanaryContentOk,
  statedLogRangeLimit,
} from './spendAuditCore.mjs';
import {
  SOLANA_CANARY_ACCOUNT,
  SOLANA_CANARY_BEFORE,
  SOLANA_CANARY_SIGNATURE,
  SOLANA_USDC_MINT,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  receiptPageHref,
} from './solanaAddress.mjs';

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
function baseRangeCode(err) {
  if (isLogRangeLimitError(err)) return 'range_limit';
  const message = String(err?.message || err || '');
  if (message === 'rpc_log_call_cap') return 'log_call_cap';
  if (isRateLimitMessage(message) || err?.status === 429) return 'upstream_rate_limited';
  if (/rpc_unreadable|rpc_logs_unreadable/.test(message)) return 'upstream_bad_response';
  const code = message.split(':')[0];
  if (FAILED_RANGE_CODES.has(code)) return code;
  if (FAILED_RANGE_CODES.has(message)) return message;
  return 'upstream_unavailable';
}

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
      error: baseRangeCode(error),
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
            recordFailure(item, err);
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
          recordFailure(item, err);
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

function shellLocationOk(apiHost, location) {
  const root = `${String(apiHost).replace(/\/$/, '')}/receipt/`;
  if (typeof location !== 'string' || !location.startsWith(root)) return false;
  const match = location.slice(root.length).match(/^((?:xfuel|chit|foreign-x402)-[A-Za-z0-9-]{8,80})\?format=json$/);
  return !!(match && receiptPageHref(match[1]));
}

/**
 * by-tx answers 302 to /receipt/<id>?format=json. Browsers hide a manual
 * redirect (opaqueredirect, status 0, no Location), so let fetch follow it and
 * check where it landed. A 3xx that reaches us (Node, test mocks) is followed
 * here under the same check.
 */
export async function lookupReceipt(apiHost, txHash, fetchImpl, signal, chain = 'base') {
  const ref = chain === 'solana' ? `solana:${txHash}` : `base:${txHash}`;
  const url = `${apiHost.replace(/\/$/, '')}/receipt/by-tx?tx=${encodeURIComponent(ref)}&format=json`;
  const init = { headers: { accept: 'application/json' }, cache: 'no-store', redirect: 'follow', signal };
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { status: 'unavailable' };
  }
  if (res.type === 'opaqueredirect' || res.status === 0) return { status: 'unavailable' };
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    const location = res.headers?.get?.('location');
    if (!shellLocationOk(apiHost, location)) return { status: 'unavailable' };
    try {
      res = await fetchImpl(location, init);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return { status: 'unavailable' };
    }
    if (res.status >= 300 && res.status < 400) return { status: 'unavailable' };
  } else if (res.redirected === true && !shellLocationOk(apiHost, res.url)) {
    return { status: 'unavailable' };
  }
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'unavailable' };
  let body;
  try {
    body = await res.json();
  } catch {
    return { status: 'unavailable' };
  }
  return parseReceiptShell(body);
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

function proxyRangeCode(err) {
  const message = String(err?.message || '');
  if (FAILED_RANGE_CODES.has(message)) return message;
  if (err?.status === 429 || isRateLimitMessage(message)) return 'upstream_rate_limited';
  return 'upstream_unavailable';
}

function proxyUrl(base, path) {
  const root = base ? String(base).replace(/\/$/, '') : '';
  return `${root}${path}`;
}

async function proxyGetOnce(url, fetchImpl, signal, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      const abort = new Error('Aborted');
      abort.name = 'AbortError';
      throw abort;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const type = String(res.headers?.get?.('content-type') || '');
    if (res.status === 429) {
      const err = new AuditSourceError('upstream_rate_limited');
      err.status = 429;
      err.retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
      throw err;
    }
    if (!type.includes('application/json')) throw new AuditSourceError('upstream_bad_response');
    let body;
    try {
      body = await res.json();
    } catch {
      throw new AuditSourceError('upstream_bad_response');
    }
    if (!body || body.v !== 1) throw new AuditSourceError('upstream_bad_response');
    if (!res.ok || body.error) {
      const code = FAILED_RANGE_CODES.has(body.error) ? body.error : 'upstream_bad_response';
      const err = new AuditSourceError(code);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function proxyGet(url, options, cache) {
  if (cache.has(url)) return cache.get(url);
  const now = options.now || Date.now;
  if (now() >= options.deadlineAt) throw new AuditSourceError('deadline');
  const sleep = options.sleep || defaultSleep;
  const pace = options.pacer;
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (now() >= options.deadlineAt) throw new AuditSourceError('deadline');
    try {
      if (pace) await pace.pace();
      const body = await proxyGetOnce(url, options.fetchImpl, options.signal, options.timeoutMs ?? 10_000);
      cache.set(url, body);
      return body;
    } catch (err) {
      if (options.signal?.aborted || (err?.name === 'AbortError' && options.signal?.aborted)) throw err;
      if (err?.name === 'AbortError' && !options.signal?.aborted) {
        last = new AuditSourceError('upstream_unavailable');
      } else {
        last = err;
      }
      if (['deadline', 'not_configured', 'wrong_cluster', 'head_unreadable', 'invalid_param', 'not_found', 'upstream_too_large'].includes(err?.message)) {
        throw err;
      }
      if (attempt === 3) throw last;
      const delay = retryDelayMs(attempt, err);
      if (pace?.hold && (err?.status === 429 || isRateLimitMessage(err?.message))) pace.hold(delay);
      await sleep(delay);
    }
  }
  throw last;
}

export async function scanSolanaUsdcOut(address, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || defaultSleep;
  const onProgress = options.onProgress || (() => {});
  const windowSeconds = options.windowSeconds ?? SOL_WINDOW_SECONDS;
  const deadlineAt = now() + (options.deadlineMs ?? SOL_SCAN_DEADLINE_MS);
  const cache = new Map();
  const pacer = createRequestPacer(options.minGapMs ?? 120, sleep);
  const callOptions = {
    fetchImpl,
    signal: options.signal,
    sleep,
    pacer,
    now,
    deadlineAt,
    timeoutMs: options.timeoutMs ?? 10_000,
  };
  const failedRanges = [];
  const base = options.proxyBase || '';

  async function get(path) {
    return proxyGet(proxyUrl(base, path), callOptions, cache);
  }

  onProgress('Reading Solana…');
  let head;
  try {
    head = await get('/api/solana-audit/head');
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    failedRanges.push({ error: proxyRangeCode(err) });
    return solanaScanShell({ failedRanges, windowSeconds });
  }
  if (typeof head?.blockTime !== 'number' || typeof head?.slot !== 'number') {
    failedRanges.push({ error: 'head_unreadable' });
    return solanaScanShell({ failedRanges, windowSeconds });
  }
  const windowStart = head.blockTime - windowSeconds;

  onProgress('Finding USDC accounts…');
  let account;
  try {
    account = await get(`/api/solana-audit/account?address=${encodeURIComponent(address)}`);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    failedRanges.push({ error: proxyRangeCode(err) });
    return solanaScanShell({ failedRanges, windowSeconds, head });
  }

  let mode = 'wallet';
  let wallet = address;
  let tokenAccountNote = null;
  const tokenAccounts = [];
  if (!account?.exists || account.owner === SYSTEM_PROGRAM_ID) {
    let listed;
    try {
      listed = await get(`/api/solana-audit/token-accounts?owner=${encodeURIComponent(address)}`);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      failedRanges.push({ error: proxyRangeCode(err) });
      return solanaScanShell({ failedRanges, windowSeconds, head });
    }
    const accounts = Array.isArray(listed?.accounts) ? listed.accounts : [];
    if (accounts.length > SOL_MAX_TOKEN_ACCOUNTS) {
      return solanaScanShell({
        failedRanges,
        windowSeconds,
        head,
        truncated: true,
        tokenAccounts: accounts.slice(0, SOL_MAX_TOKEN_ACCOUNTS).map((item) => item.address).filter(Boolean),
      });
    }
    for (const item of accounts) {
      if (item?.mint === SOLANA_USDC_MINT && typeof item.address === 'string') tokenAccounts.push(item.address);
    }
  } else if (account.owner === TOKEN_PROGRAM_ID && account.mint === SOLANA_USDC_MINT) {
    mode = 'token_account';
    wallet = typeof account.token_owner === 'string' ? account.token_owner : null;
    tokenAccounts.push(address);
    tokenAccountNote = `This is a USDC token account; its owner is ${wallet || 'unknown'}.`;
  } else {
    const err = new AuditSourceError('invalid_solana_wallet', 'invalid');
    throw err;
  }

  let canary = 'missing';
  try {
    const canaryPage = await get(`/api/solana-audit/signatures?address=${encodeURIComponent(SOLANA_CANARY_ACCOUNT)}&limit=1&before=${encodeURIComponent(SOLANA_CANARY_BEFORE)}`);
    const first = canaryPage?.signatures?.[0];
    if (first?.signature === SOLANA_CANARY_SIGNATURE) {
      const canaryTx = await get(`/api/solana-audit/tx?sig=${encodeURIComponent(SOLANA_CANARY_SIGNATURE)}`);
      canary = canaryTx?.tx && solanaCanaryContentOk(canaryTx.tx) ? 'ok' : 'mismatch';
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    canary = 'missing';
    failedRanges.push({ error: proxyRangeCode(err) });
  }
  if (canary === 'mismatch') failedRanges.push({ error: 'history_unproven' });

  const sources = mode === 'token_account' ? [address] : [address, ...tokenAccounts];
  const collected = [];
  let totalPages = 0;
  let sourceIncomplete = false;
  for (const source of sources) {
    let before = null;
    let pages = 0;
    let sawOlder = false;
    let short = false;
    while (pages < SOL_MAX_SIG_PAGES_PER_SOURCE && totalPages < SOL_MAX_SIG_PAGES) {
      if (now() >= deadlineAt) {
        failedRanges.push({ error: 'deadline' });
        sourceIncomplete = true;
        break;
      }
      pages += 1;
      totalPages += 1;
      const params = new URLSearchParams({ address: source, limit: String(SOL_SIG_PAGE_LIMIT) });
      if (before) params.set('before', before);
      let page;
      try {
        page = await get(`/api/solana-audit/signatures?${params.toString()}`);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        failedRanges.push({ error: proxyRangeCode(err) });
        sourceIncomplete = true;
        break;
      }
      const list = Array.isArray(page?.signatures) ? page.signatures : null;
      if (!list) {
        failedRanges.push({ error: 'upstream_bad_response' });
        sourceIncomplete = true;
        break;
      }
      short = list.length < SOL_SIG_PAGE_LIMIT;
      let halted = false;
      for (const item of list) {
        if (item?.blockTime == null) {
          failedRanges.push({ error: 'tx_unavailable' });
          sourceIncomplete = true;
          halted = true;
          break;
        }
        if (item.blockTime < windowStart) {
          sawOlder = true;
          halted = true;
          break;
        }
        if (item.failed === true) continue;
        if (typeof item.signature !== 'string') {
          failedRanges.push({ error: 'upstream_bad_response' });
          sourceIncomplete = true;
          halted = true;
          break;
        }
        collected.push(item);
      }
      if (halted || sourceIncomplete) break;
      if (short) break;
      before = list[list.length - 1]?.signature || null;
      if (!before) {
        sourceIncomplete = true;
        break;
      }
    }
    if (sourceIncomplete) break;
    if (!sawOlder && (pages >= SOL_MAX_SIG_PAGES_PER_SOURCE || totalPages >= SOL_MAX_SIG_PAGES) && !short) {
      failedRanges.push({ error: 'sig_page_cap' });
      sourceIncomplete = true;
      break;
    }
    if (short && !sawOlder && canary !== 'ok') {
      failedRanges.push({ error: 'history_unproven' });
      sourceIncomplete = true;
      break;
    }
  }

  const seen = new Set();
  const merged = [];
  collected.forEach((item, order) => {
    if (seen.has(item.signature)) return;
    seen.add(item.signature);
    merged.push({ ...item, order });
  });
  merged.sort((a, b) => (b.slot - a.slot) || (a.order - b.order));
  const truncated = merged.length > MAX_SOL_TX_READS;
  const toRead = merged.slice(0, MAX_SOL_TX_READS);
  const decodedByIndex = new Array(toRead.length);
  let readCount = 0;
  const tokenSet = new Set(tokenAccounts);
  await mapPool(toRead, options.concurrency ?? 3, async (item, index) => {
    if (now() >= deadlineAt) {
      failedRanges.push({ error: 'deadline' });
      decodedByIndex[index] = [];
      return;
    }
    onProgress(`Reading Solana transfers ${index + 1}/${toRead.length}`);
    let body;
    try {
      body = await get(`/api/solana-audit/tx?sig=${encodeURIComponent(item.signature)}`);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      failedRanges.push({ error: proxyRangeCode(err) });
      decodedByIndex[index] = [];
      return;
    }
    readCount += 1;
    if (!body?.tx) {
      failedRanges.push({ error: 'tx_unavailable' });
      decodedByIndex[index] = [];
      return;
    }
    const decoded = decodeSolanaUsdcTransfers(body.tx, {
      mode,
      account: address,
      wallet,
      tokenAccounts: tokenSet,
      signature: item.signature,
    });
    if (decoded.error) {
      failedRanges.push({ error: decoded.error });
      decodedByIndex[index] = [];
      return;
    }
    if (decoded.unexplained) failedRanges.push({ error: 'unexplained_out' });
    decodedByIndex[index] = decoded.rows;
  });
  const rows = decodedByIndex.flatMap((part) => part || []);

  const uniqueFailed = [];
  const seenErr = new Set();
  for (const range of failedRanges) {
    const key = range.error;
    if (seenErr.has(key)) continue;
    seenErr.add(key);
    uniqueFailed.push(range);
  }

  return solanaScanShell({
    failedRanges: uniqueFailed,
    windowSeconds,
    head,
    truncated: truncated || sourceIncomplete && uniqueFailed.some((range) => range.error === 'sig_page_cap'),
    tokenAccounts,
    tokenAccountNote,
    signaturesSeen: merged.length,
    signaturesRead: readCount,
    rows,
    scanComplete: uniqueFailed.length === 0 && !truncated,
  });
}

function solanaScanShell({
  failedRanges = [],
  windowSeconds,
  head = null,
  truncated = false,
  tokenAccounts = [],
  tokenAccountNote = null,
  signaturesSeen = 0,
  signaturesRead = 0,
  rows = [],
  scanComplete = false,
} = {}) {
  const fromTime = head ? new Date((head.blockTime - windowSeconds) * 1000).toISOString() : null;
  const toTime = head ? new Date(head.blockTime * 1000).toISOString() : null;
  return {
    rows,
    failedRanges,
    scanComplete: scanComplete && failedRanges.length === 0 && !truncated,
    truncated,
    fromTime,
    toTime,
    headSlot: head?.slot ?? null,
    windowSeconds,
    tokenAccounts,
    tokenAccountNote,
    signaturesSeen,
    signaturesRead,
  };
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
  if (query.kind === 'invalid') return { ok: false, error: 'invalid', message: auditQueryMessage(query) };

  if (query.kind === 'solana') {
    try {
      const solana = await scanSolanaUsdcOut(query.address, {
        fetchImpl,
        signal,
        onProgress,
        sleep: options.sleep,
        now: options.now,
        proxyBase: options.proxyBase,
        windowSeconds: options.windowSeconds,
        deadlineMs: options.deadlineMs,
        minGapMs: options.minGapMs,
        concurrency: options.concurrency,
        timeoutMs: options.timeoutMs,
      });
      const sigs = [];
      const seen = new Set();
      for (const row of solana.rows) {
        if (seen.has(row.tx_hash)) continue;
        seen.add(row.tx_hash);
        sigs.push(row.tx_hash);
      }
      const toCheck = sigs.slice(0, MAX_RECEIPT_LOOKUPS);
      if (toCheck.length) onProgress('Matching public Chit receipts…');
      const lookups = await mapPool(toCheck, 4, (sig) => lookupReceipt(apiHost, sig, fetchImpl, signal, 'solana'));
      const receipts = new Map();
      toCheck.forEach((sig, index) => receipts.set(sig, lookups[index]));
      return { ok: true, report: buildSpendAuditReport({ query, solana, receipts }) };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.code === 'invalid' || err?.message === 'invalid_solana_wallet') {
        return { ok: false, error: 'invalid', message: 'Not a wallet.' };
      }
      return {
        ok: false,
        error: 'source_unavailable',
        message: 'The Solana audit proxy did not answer. No spend total is shown.',
      };
    }
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
      message: baseRangeCode(err),
    };
  }
}

function hex(n) {
  return `0x${n.toString(16)}`;
}
