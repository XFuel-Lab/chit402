/**
 * Solana audit proxy. The Helius key is read only here, from HELIUS_API_KEY,
 * inside the request handler. Nothing in this module is imported by the web app.
 * Do not log URLs or error objects: the key is in the upstream query string.
 */

import {
  SOLANA_MAINNET_GENESIS,
  SOLANA_USDC_MINT,
  TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  MEMO_PROGRAM_V1_ID,
  DENY_SOLANA_ACCOUNTS,
  parseSolanaAddress,
  parseSolanaSignature,
} from '../../apps/web/src/lib/solanaAddress.mjs';

const HELIUS_HOST = 'mainnet.helius-rpc.com';
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const ROUTES = new Set(['head', 'account', 'token-accounts', 'signatures', 'tx']);
const DENY = new Set(DENY_SOLANA_ACCOUNTS);

const hitsByIp = new Map();
let clusterState = null;

export function resetSolanaAuditState() {
  hitsByIp.clear();
  clusterState = null;
}

export function solanaAuditEndpoint(env) {
  const key = env?.HELIUS_API_KEY;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(key)) return null;
  let url;
  try {
    url = new URL(`https://${HELIUS_HOST}/`);
    url.searchParams.set('api-key', key);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== HELIUS_HOST) return null;
  return url.toString();
}

function clientIp(headers) {
  const forwarded = headers?.['x-forwarded-for'] || headers?.get?.('x-forwarded-for') || '';
  const first = String(forwarded).split(',')[0].trim();
  return first || 'unknown';
}

function rateLimited(ip, now) {
  const list = (hitsByIp.get(ip) || []).filter((stamp) => now - stamp < 60_000);
  if (list.length >= 120) {
    hitsByIp.set(ip, list);
    return true;
  }
  list.push(now);
  hitsByIp.set(ip, list);
  return false;
}

function readQuery(url) {
  const raw = String(url || '');
  const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  if (q.length > 256) return null;
  const values = new Map();
  if (!q) return values;
  for (const part of q.split('&')) {
    if (!part) return null;
    const eq = part.indexOf('=');
    let key;
    let value;
    try {
      key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
      value = decodeURIComponent(eq < 0 ? '' : part.slice(eq + 1));
    } catch {
      return null;
    }
    if (values.has(key)) return null;
    values.set(key, value);
  }
  return values;
}

function allowed(values, names) {
  for (const key of values.keys()) {
    if (!names.includes(key)) return false;
  }
  return true;
}

function jsonResult(status, body, cacheControl) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
    },
    body,
  };
}

function fail(status, error, cacheControl = 'no-store') {
  return jsonResult(status, { v: 1, error }, cacheControl);
}

async function readLimited(res) {
  const length = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_UPSTREAM_BYTES) return { tooLarge: true };
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_UPSTREAM_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return { tooLarge: true };
      }
      chunks.push(next.value);
    }
    const buf = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { text: new TextDecoder().decode(buf) };
  }
  const text = await res.text();
  if (text.length > MAX_UPSTREAM_BYTES) return { tooLarge: true };
  return { text };
}

async function rpcCall(fetchImpl, endpoint, method, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (res.status === 429) return { error: 'upstream_rate_limited' };
    if (res.status >= 500) return { error: 'upstream_unavailable' };
    if (!res.ok) return { error: 'upstream_bad_response' };
    const read = await readLimited(res);
    if (read.tooLarge) return { error: 'upstream_too_large' };
    let parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch {
      return { error: 'upstream_bad_response' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'upstream_bad_response' };
    if (parsed.error) return { error: 'upstream_bad_response' };
    return { result: parsed.result };
  } catch {
    return { error: 'upstream_unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

async function pinCluster(call) {
  if (clusterState === 'ok') return { ok: true };
  if (clusterState === 'bad') return { ok: false, error: 'wrong_cluster' };
  const got = await call('getGenesisHash', []);
  if (got.error) return { ok: false, error: got.error };
  if (got.result !== SOLANA_MAINNET_GENESIS) {
    clusterState = 'bad';
    return { ok: false, error: 'wrong_cluster' };
  }
  clusterState = 'ok';
  return { ok: true };
}

function walletParam(value) {
  const parsed = parseSolanaAddress(value);
  if (!parsed.ok) return null;
  if (DENY.has(parsed.address)) return null;
  return parsed.address;
}

function validateRoute(route, query) {
  if (route === 'head') {
    if (query.size !== 0) return null;
    return { route };
  }
  if (route === 'account') {
    if (!allowed(query, ['address']) || !query.has('address')) return null;
    const address = walletParam(query.get('address'));
    if (!address) return null;
    return { route, address };
  }
  if (route === 'token-accounts') {
    if (!allowed(query, ['owner']) || !query.has('owner')) return null;
    const owner = walletParam(query.get('owner'));
    if (!owner) return null;
    return { route, owner };
  }
  if (route === 'signatures') {
    if (!allowed(query, ['address', 'before', 'limit']) || !query.has('address')) return null;
    const address = walletParam(query.get('address'));
    if (!address) return null;
    let limit = 1000;
    if (query.has('limit')) {
      const raw = query.get('limit');
      if (!/^(?:[1-9][0-9]{0,2}|1000)$/.test(raw)) return null;
      limit = Number(raw);
    }
    let before = null;
    if (query.has('before')) {
      const parsed = parseSolanaSignature(query.get('before'));
      if (!parsed.ok) return null;
      before = parsed.signature;
    }
    return { route, address, limit, before };
  }
  if (route === 'tx') {
    if (!allowed(query, ['sig']) || !query.has('sig')) return null;
    const sig = parseSolanaSignature(query.get('sig'));
    if (!sig.ok) return null;
    return { route, sig: sig.signature };
  }
  return null;
}

function projectAccount(result) {
  const value = result?.value;
  if (!value) return { v: 1, exists: false, owner: null, mint: null, token_owner: null };
  const info = value.data?.parsed?.info || {};
  return {
    v: 1,
    exists: true,
    owner: typeof value.owner === 'string' ? value.owner : null,
    mint: typeof info.mint === 'string' ? info.mint : null,
    token_owner: typeof info.owner === 'string' ? info.owner : null,
  };
}

function projectTokenAccounts(result) {
  const accounts = [];
  for (const item of result?.value || []) {
    const programOwner = item?.account?.owner;
    const info = item?.account?.data?.parsed?.info;
    if (programOwner !== TOKEN_PROGRAM_ID) continue;
    if (info?.mint !== SOLANA_USDC_MINT) continue;
    if (typeof item?.pubkey !== 'string') continue;
    accounts.push({
      address: item.pubkey,
      mint: info.mint,
      owner: typeof info.owner === 'string' ? info.owner : null,
      amount: typeof info.tokenAmount?.amount === 'string' ? info.tokenAmount.amount : null,
    });
  }
  return { v: 1, accounts };
}

function projectSignatures(result) {
  const signatures = [];
  for (const item of Array.isArray(result) ? result : []) {
    if (typeof item?.signature !== 'string') continue;
    signatures.push({
      signature: item.signature,
      slot: item.slot ?? null,
      blockTime: item.blockTime ?? null,
      failed: item.err != null,
    });
  }
  return { v: 1, signatures };
}

function projectInstruction(ix) {
  if (!ix || typeof ix !== 'object') return null;
  if (ix.programId === MEMO_PROGRAM_ID || ix.programId === MEMO_PROGRAM_V1_ID) return null;
  const info = ix.parsed?.info;
  let parsed = null;
  if (ix.parsed && typeof ix.parsed === 'object' && !Array.isArray(ix.parsed)) {
    const tokenAmount = info?.tokenAmount;
    parsed = {
      type: typeof ix.parsed.type === 'string' ? ix.parsed.type : null,
      info: {
        source: typeof info?.source === 'string' ? info.source : null,
        destination: typeof info?.destination === 'string' ? info.destination : null,
        mint: typeof info?.mint === 'string' ? info.mint : null,
        authority: typeof info?.authority === 'string' ? info.authority : null,
        amount: typeof info?.amount === 'string' ? info.amount : null,
        tokenAmount: tokenAmount && typeof tokenAmount === 'object'
          ? {
            amount: typeof tokenAmount.amount === 'string' ? tokenAmount.amount : null,
            decimals: typeof tokenAmount.decimals === 'number' ? tokenAmount.decimals : null,
          }
          : null,
      },
    };
  }
  return { programId: ix.programId || null, parsed };
}

function projectTransaction(result) {
  if (result == null) return null;
  const meta = result.meta;
  if (!meta || typeof meta !== 'object') return null;
  const message = result.transaction?.message || {};
  const accountKeys = [];
  for (const key of message.accountKeys || []) {
    if (typeof key === 'string') accountKeys.push({ pubkey: key, signer: false });
    else if (key && typeof key.pubkey === 'string') accountKeys.push({ pubkey: key.pubkey, signer: key.signer === true });
  }
  const balances = (list) => (list || []).map((bal) => ({
    accountIndex: bal.accountIndex,
    mint: bal.mint,
    owner: bal.owner,
    programId: bal.programId,
    amount: typeof bal.uiTokenAmount?.amount === 'string' ? bal.uiTokenAmount.amount : null,
    decimals: typeof bal.uiTokenAmount?.decimals === 'number' ? bal.uiTokenAmount.decimals : null,
  }));
  return {
    slot: result.slot ?? null,
    blockTime: result.blockTime ?? null,
    err: meta.err != null,
    accountKeys,
    instructions: (message.instructions || []).map(projectInstruction).filter(Boolean),
    innerInstructions: (meta.innerInstructions || []).map((group) => ({
      index: group.index,
      instructions: (group.instructions || []).map(projectInstruction).filter(Boolean),
    })),
    preTokenBalances: balances(meta.preTokenBalances),
    postTokenBalances: balances(meta.postTokenBalances),
  };
}

function routeNameOf(request) {
  if (typeof request.route === 'string' && request.route) return request.route;
  try {
    const path = new URL(request.url, 'https://chit402.com').pathname;
    const match = path.match(/\/api\/solana-audit\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

/**
 * @param {{ method?: string, url?: string, headers?: object, route?: string }} request
 * @param {{ env?: object, fetchImpl?: typeof fetch, now?: () => number, log?: (entry: object) => void, rateLimit?: boolean }} [options]
 */
export async function handleSolanaAudit(request, options = {}) {
  const started = Date.now();
  const now = options.now || Date.now;
  const log = options.log || ((entry) => {
    console.log(JSON.stringify({
      route: entry.route,
      status: entry.status,
      ms: entry.ms,
      code: entry.code,
    }));
  });
  const route = routeNameOf(request);
  const finish = (result) => {
    log({
      route: ROUTES.has(route) ? route : 'unknown',
      status: result.status,
      ms: Date.now() - started,
      code: result.body?.error || null,
    });
    return result;
  };

  if (String(request?.method || 'GET').toUpperCase() !== 'GET') {
    return finish(fail(405, 'method_not_allowed'));
  }
  if (!ROUTES.has(route)) return finish(fail(404, 'not_found'));

  const query = readQuery(request?.url || '');
  if (!query) return finish(fail(400, 'invalid_param'));

  const parsed = validateRoute(route, query);
  if (!parsed) return finish(fail(400, 'invalid_param'));

  const env = options.env || process.env;
  const endpoint = solanaAuditEndpoint(env);
  if (!endpoint) return finish(fail(503, 'not_configured'));

  if (options.rateLimit !== false && rateLimited(clientIp(request?.headers), now())) {
    return finish(fail(429, 'upstream_rate_limited'));
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const call = (method, params) => rpcCall(fetchImpl, endpoint, method, params);
  const cluster = await pinCluster(call);
  if (!cluster.ok) {
    const status = cluster.error === 'wrong_cluster' ? 503 : (cluster.error === 'upstream_rate_limited' ? 429 : 502);
    return finish(fail(status, cluster.error === 'wrong_cluster' ? 'wrong_cluster' : cluster.error));
  }

  if (route === 'head') {
    const slotRes = await call('getSlot', [{ commitment: 'finalized' }]);
    if (slotRes.error) return finish(fail(slotRes.error === 'upstream_rate_limited' ? 429 : 502, slotRes.error));
    if (typeof slotRes.result !== 'number') return finish(fail(502, 'head_unreadable'));
    for (let back = 0; back < 8; back += 1) {
      const slot = slotRes.result - back;
      if (slot < 0) break;
      const timeRes = await call('getBlockTime', [slot]);
      if (timeRes.error) return finish(fail(timeRes.error === 'upstream_rate_limited' ? 429 : 502, timeRes.error));
      if (typeof timeRes.result === 'number') {
        return finish(jsonResult(200, { v: 1, slot, blockTime: timeRes.result }, 'no-store'));
      }
    }
    return finish(fail(502, 'head_unreadable'));
  }

  if (route === 'account') {
    const address = parsed.address;
    const got = await call('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'finalized' }]);
    if (got.error) return finish(fail(got.error === 'upstream_rate_limited' ? 429 : 502, got.error));
    return finish(jsonResult(200, projectAccount(got.result), 'public, s-maxage=30'));
  }

  if (route === 'token-accounts') {
    const owner = parsed.owner;
    const got = await call('getTokenAccountsByOwner', [
      owner,
      { mint: SOLANA_USDC_MINT },
      { encoding: 'jsonParsed', commitment: 'finalized' },
    ]);
    if (got.error) return finish(fail(got.error === 'upstream_rate_limited' ? 429 : 502, got.error));
    return finish(jsonResult(200, projectTokenAccounts(got.result), 'public, s-maxage=30'));
  }

  if (route === 'signatures') {
    const address = parsed.address;
    const config = { limit: parsed.limit, commitment: 'finalized' };
    if (parsed.before) config.before = parsed.before;
    const got = await call('getSignaturesForAddress', [address, config]);
    if (got.error) return finish(fail(got.error === 'upstream_rate_limited' ? 429 : 502, got.error));
    const cache = query.has('before') ? 'public, s-maxage=3600' : 'public, s-maxage=10';
    return finish(jsonResult(200, projectSignatures(got.result), cache));
  }

  if (route === 'tx') {
    const got = await call('getTransaction', [parsed.sig, {
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
      commitment: 'finalized',
    }]);
    if (got.error) return finish(fail(got.error === 'upstream_rate_limited' ? 429 : 502, got.error));
    const tx = projectTransaction(got.result);
    if (!tx || tx.blockTime == null) {
      return finish(jsonResult(200, tx ? { v: 1, tx } : { v: 1, tx: null }, 'no-store'));
    }
    return finish(jsonResult(200, { v: 1, tx }, 'public, s-maxage=604800, immutable'));
  }

  return finish(fail(404, 'not_found'));
}

export function sendSolanaAudit(res, result) {
  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.end(JSON.stringify(result.body));
}
