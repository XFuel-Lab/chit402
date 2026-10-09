import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = await import('../src/lib/spendAuditCore.mjs');
const sol = await import('../src/lib/solanaAddress.mjs');
const { runPublicSpendAudit, lookupReceipt } = await import('../src/lib/spendAuditFetch.mjs');
const { handleSolanaAudit, resetSolanaAuditState, solanaAuditEndpoint } = await import('../../../api/solana-audit/_handler.mjs');

const {
  parseAuditQuery,
  auditQueryChip,
  auditQueryMessage,
  shouldRunAuditFetch,
  decodeSolanaUsdcTransfers,
  buildSpendAuditReport,
  reportToCsv,
  reportToJson,
  parseReceiptShell,
  classifySpend,
  BASE_USDC,
  CHIT_FEE_SINK,
  SAMPLE_BASE_ADDRESS,
  AUDIT_WINDOW_BLOCKS,
  AUDIT_CHUNK_BLOCKS,
  AUDIT_RPC_CONCURRENCY,
  AUDIT_RPC_MIN_GAP_MS,
  AUDIT_MAX_LOG_CALLS,
  MAX_INCLUDED_TRANSFERS,
  MAX_RECEIPT_LOOKUPS,
  MAX_TX_READS,
  SOL_WINDOW_SECONDS,
  MAX_SOL_TX_READS,
  SOL_MAX_SIG_PAGES_PER_SOURCE,
  SOL_SIG_PAGE_LIMIT,
  SPONSORED_FEE_CAPTION,
  EIP3009_TRANSFER_WITH_AUTHORIZATION,
} = core;

const {
  encodeBase58,
  parseSolanaAddress,
  safeHttpsHref,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  MEMO_PROGRAM_V1_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SOLANA_USDC_MINT,
  DEVNET_USDC_MINT,
  SOLANA_MAINNET_GENESIS,
  SOLANA_DEVNET_GENESIS,
  SOLANA_CANARY_ACCOUNT,
  SOLANA_CANARY_BEFORE,
  SOLANA_CANARY_SIGNATURE,
  SOLANA_CANARY_PAYEE,
  SOLANA_CANARY_AMOUNT,
  SOLANA_FIXTURE_PAYER,
  SOLANA_CHAIN_ID,
  receiptPageHref,
} = sol;

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const DUMMY_KEY = 'SECRETDUMMYHELIUSKEY01';
const ENV = { HELIUS_API_KEY: DUMMY_KEY };
const FEE_PAYER = 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww';
const A32 = '11111111111111111111111111111112';
const A43 = '4uQeVj5tqViQh7yWWGSu1eji4DWNEvcTqsaEuVHh7kn';
const A44 = '21cesz3zArQM2QLY5QV2sBRhVj1tR1tY3rSj1fRcgZk2';
const WALLET = 'JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG';
const HEAD = 1_800_000_000;
const IN = HEAD - 3600;
const OLD = HEAD - SOL_WINDOW_SECONDS - 50;
const ATA = '7rD5Wrrk73BQwodPu6zHWUg9gLVRtYZXxnwRLRzGfjMX';
const EMPTY_HEADLINE = 'No Solana USDC transfers from this address in the scanned window. The total for that window is 0. Older spend is outside this report.';

const PRIVATE_KEYS = [
  'payer_wallet', 'agent_id', 'book_id', 'book_seq', 'output_hash', 'provider', 'model',
  'prompt_tokens', 'completion_tokens', 'request_digest', 'payer', 'fee_payer',
];

function sigOf(n) {
  const bytes = new Uint8Array(64);
  bytes[0] = (n % 250) + 1;
  bytes[1] = (Math.floor(n / 250) % 250) + 1;
  bytes[2] = Math.floor(n / 62500) + 1;
  for (let i = 3; i < 64; i += 1) bytes[i] = (n * 13 + i * 17) % 256;
  return encodeBase58(bytes);
}

function jsonRes(body, status = 200, extra = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function outTx({
  slot = 10,
  blockTime = IN,
  err = false,
  feePayer = WALLET,
  authority = WALLET,
  source = ATA,
  destination = A43,
  destOwner = A43,
  sourceOwner = WALLET,
  amount = '2000',
  pre = '5000',
  post = '3000',
  type = 'transferChecked',
  programId = TOKEN_PROGRAM_ID,
  mint = SOLANA_USDC_MINT,
  decimals = 6,
  instructions,
  innerInstructions,
  preTokenBalances,
  postTokenBalances,
  programLabel,
} = {}) {
  const keys = [
    { pubkey: feePayer, signer: true },
    { pubkey: source, signer: false },
    { pubkey: destination, signer: false },
  ];
  const ix = {
    program: programLabel,
    programId,
    parsed: {
      type,
      info: {
        source,
        destination,
        mint: type === 'transferChecked' ? mint : null,
        authority,
        amount: type === 'transfer' ? amount : null,
        tokenAmount: type === 'transferChecked' ? { amount, decimals } : null,
      },
    },
  };
  return {
    slot,
    blockTime,
    err,
    accountKeys: keys,
    instructions: instructions || [ix],
    innerInstructions: innerInstructions || [],
    preTokenBalances: preTokenBalances || [
      { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: sourceOwner, programId: TOKEN_PROGRAM_ID, amount: pre, decimals: 6 },
      { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: destOwner, programId: TOKEN_PROGRAM_ID, amount: '0', decimals: 6 },
    ],
    postTokenBalances: postTokenBalances || [
      { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: sourceOwner, programId: TOKEN_PROGRAM_ID, amount: post, decimals: 6 },
      { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: destOwner, programId: TOKEN_PROGRAM_ID, amount, decimals: 6 },
    ],
  };
}

function canaryTx(amount = SOLANA_CANARY_AMOUNT) {
  return outTx({
    feePayer: FEE_PAYER,
    authority: SOLANA_FIXTURE_PAYER,
    source: ATA,
    destination: SOLANA_CANARY_ACCOUNT,
    destOwner: SOLANA_CANARY_PAYEE,
    sourceOwner: SOLANA_FIXTURE_PAYER,
    amount,
    pre: '8000',
    post: String(8000 - Number(amount)),
    blockTime: 1790461600,
    slot: 450808700,
  });
}

function pageOf(all, url) {
  const u = new URL(url, 'https://chit402.com');
  const before = u.searchParams.get('before');
  const limit = Number(u.searchParams.get('limit') || 1000);
  let start = 0;
  if (before) {
    const idx = all.findIndex((item) => item.signature === before);
    start = idx >= 0 ? idx + 1 : all.length;
  }
  return all.slice(start, start + limit);
}

async function scan(address, options = {}) {
  const urls = [];
  const headTime = options.headTime ?? HEAD;
  const sigsFor = options.sigsFor || (() => []);
  const txs = options.txs || new Map();
  const canaryMode = options.canary ?? 'ok';
  const tokenAccounts = options.tokenAccounts || [];
  const accountFor = options.accountFor || (() => ({
    exists: true, owner: SYSTEM_PROGRAM_ID, mint: null, token_owner: null,
  }));
  const fetchImpl = async (url) => {
    const target = String(url);
    urls.push(target);
    if (options.proxyHtml && target.includes('/api/solana-audit/')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        json: async () => { throw new Error('html'); },
        text: async () => '<html></html>',
      };
    }
    if (target.includes('api.chit402.com')) {
      if (options.gateway) return options.gateway(target);
      return jsonRes({ error: 'not_found' }, 404);
    }
    const path = new URL(target, 'https://chit402.com').pathname;
    if (path.endsWith('/head')) return jsonRes({ v: 1, slot: 454900000, blockTime: headTime });
    if (path.endsWith('/account')) {
      const who = new URL(target, 'https://chit402.com').searchParams.get('address');
      return jsonRes({ v: 1, ...accountFor(who) });
    }
    if (path.endsWith('/token-accounts')) return jsonRes({ v: 1, accounts: tokenAccounts });
    if (path.endsWith('/signatures')) {
      const who = new URL(target, 'https://chit402.com').searchParams.get('address');
      if (who === SOLANA_CANARY_ACCOUNT) {
        if (canaryMode === 'missing') return jsonRes({ v: 1, signatures: [] });
        return jsonRes({
          v: 1,
          signatures: [{ signature: SOLANA_CANARY_SIGNATURE, slot: 1, blockTime: 1790461600, failed: false }],
        });
      }
      return jsonRes({ v: 1, signatures: pageOf(sigsFor(who) || [], target) });
    }
    if (path.endsWith('/tx')) {
      const sig = new URL(target, 'https://chit402.com').searchParams.get('sig');
      if (txs.has(sig)) return jsonRes({ v: 1, tx: txs.get(sig) });
      if (sig === SOLANA_CANARY_SIGNATURE) {
        return jsonRes({ v: 1, tx: canaryMode === 'mismatch' ? canaryTx('1') : canaryTx() });
      }
      if (options.defaultTx) return jsonRes({ v: 1, tx: options.defaultTx(sig) });
      return jsonRes({ v: 1, tx: null });
    }
    return jsonRes({ v: 1, error: 'not_found' }, 404);
  };
  const result = await runPublicSpendAudit(address, {
    fetchImpl,
    minGapMs: 0,
    sleep: async () => {},
    windowSeconds: options.windowSeconds,
    deadlineMs: options.deadlineMs,
    now: options.now,
  });
  return { result, urls };
}

function gatewayUrls(urls) {
  return urls.filter((url) => url.includes('api.chit402.com'));
}

function walkKeys(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, found);
    return found;
  }
  for (const key of Object.keys(value)) {
    found.push(key);
    walkKeys(value[key], found);
  }
  return found;
}

function shell(fields) {
  return {
    schema: 'chit402.receipt_shell.v1',
    receipt_id: fields.receipt_id,
    chain: fields.chain,
    payment_tx: fields.payment_tx,
    pay_to: fields.pay_to,
    asset: fields.asset,
    amount_gross: fields.amount_gross,
  };
}

function rawSpl(programId, type, info, program = 'spl-token') {
  return {
    slot: 3,
    blockTime: IN,
    transaction: {
      message: {
        accountKeys: [
          { pubkey: WALLET, signer: true },
          { pubkey: ATA, signer: false },
          { pubkey: A43, signer: false },
        ],
        instructions: [{ program, programId, parsed: { type, info } }],
      },
    },
    meta: {
      err: null,
      innerInstructions: [],
      preTokenBalances: [{
        accountIndex: 1, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID,
        uiTokenAmount: { amount: '1000', decimals: 6 },
      }],
      postTokenBalances: [{
        accountIndex: 1, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID,
        uiTokenAmount: { amount: '1000', decimals: 6 },
      }],
    },
  };
}

test('A1 strict addresses accept 32, 43, and 44 characters and reject the rest', () => {
  for (const address of [A32, A43, A44]) {
    const parsed = parseSolanaAddress(address);
    assert.equal(parsed.ok, true, address);
    assert.equal(parsed.address, address);
    assert.equal(parseAuditQuery(address).kind, 'solana');
  }
  const rejected = [
    'z'.repeat(44),
    encodeBase58(new Uint8Array(31).fill(2)),
    encodeBase58(new Uint8Array(33).fill(2)),
    '0OIl',
    `${A44.slice(0, 20)}\u00a0${A44.slice(20)}`,
    `${A44}\u200b`,
    `\u202e${A44}`,
    `\uff11${A44}`,
    `${A44.slice(0, 10)} ${A44.slice(10)}`,
    `${A44.slice(0, 20)}\n${A44.slice(20)}`,
    '<script>',
    '__proto__',
    '1'.repeat(44),
  ];
  for (const raw of rejected) {
    const parsed = parseSolanaAddress(raw);
    assert.equal(parsed.ok, false, raw);
    assert.equal(parsed.reason, 'invalid');
    assert.equal(parseAuditQuery(raw).kind, 'invalid');
  }
});

test('A2 signature, deny-list, and devnet fetch nothing', async () => {
  const signature = sigOf(7);
  assert.equal(parseAuditQuery(signature).reason, 'solana_signature');
  assert.match(auditQueryMessage(parseAuditQuery(signature)), /Paste the wallet address/);
  const devnet = `solana:${SOLANA_DEVNET_GENESIS.slice(0, 32)}`;
  assert.equal(parseAuditQuery(devnet).reason, 'devnet');
  assert.match(auditQueryMessage(parseAuditQuery(devnet)), /devnet is not scanned/);
  const blocked = [
    signature,
    SOLANA_USDC_MINT,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ATA_PROGRAM_ID,
    MEMO_PROGRAM_ID,
    MEMO_PROGRAM_V1_ID,
    COMPUTE_BUDGET_PROGRAM_ID,
    DEVNET_USDC_MINT,
    devnet,
    `solana:${SOLANA_DEVNET_GENESIS}:${A44}`,
  ];
  for (const raw of blocked) {
    let called = false;
    const result = await runPublicSpendAudit(raw, {
      fetchImpl: async () => {
        called = true;
        throw new Error('fetched');
      },
    });
    assert.equal(called, false, raw);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid');
  }
  const program = await scan(WALLET, {
    accountFor: () => ({ exists: true, owner: MEMO_PROGRAM_ID, mint: null, token_owner: null }),
  });
  assert.equal(program.result.ok, false);
  assert.match(program.result.message, /Not a wallet/);
  assert.equal(program.urls.some((url) => url.includes('/signatures')), false);
});

test('A3 Base and agent precedence stay ahead of Solana', () => {
  assert.equal(parseAuditQuery(SAMPLE_BASE_ADDRESS).kind, 'base');
  assert.equal(parseAuditQuery('123').kind, 'agent');
  assert.equal(parseAuditQuery(`solana:${SOLANA_CHAIN_ID.slice('solana:'.length)}:${A44}`).address, A44);
  const empty = buildSpendAuditReport({
    query: { kind: 'base', address: SAMPLE_BASE_ADDRESS },
    chain: { logs: [], failedRanges: [], scanComplete: true, fromBlock: 1, toBlock: 2 },
    generatedAt: '2026-10-08T00:00:00.000Z',
  });
  assert.equal(empty.headline.usdc_out_atomic, '0');
  assert.equal(empty.coverage.chain, 'eip155:8453');
  assert.equal(empty.coverage.asset, BASE_USDC);
  assert.equal(empty.coverage.window_blocks, AUDIT_WINDOW_BLOCKS);
  assert.equal(AUDIT_CHUNK_BLOCKS, 500);
  assert.equal(AUDIT_RPC_CONCURRENCY, 2);
  assert.equal(AUDIT_RPC_MIN_GAP_MS, 80);
  assert.equal(AUDIT_MAX_LOG_CALLS, 8000);
  assert.equal(MAX_INCLUDED_TRANSFERS, 200);
  assert.equal(MAX_RECEIPT_LOOKUPS, 40);
  assert.equal(MAX_TX_READS, 40);
  assert.equal(MAX_SOL_TX_READS, 250);
});

function rpcMock(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    const answer = await script(body.method, body.params);
    if (answer?.throw) throw answer.throw;
    if (answer?.status) {
      return {
        ok: false,
        status: answer.status,
        headers: { get: () => answer.contentLength || null },
        text: async () => answer.text || '',
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? answer?.contentLength || null : null) },
      text: async () => answer?.raw || JSON.stringify({ jsonrpc: '2.0', id: 1, result: answer?.result ?? null }),
    };
  };
  return { calls, fetchImpl };
}

async function proxy(route, query = '', extra = {}) {
  const { calls, fetchImpl } = rpcMock(extra.script || (async (method) => {
    if (method === 'getGenesisHash') return { result: SOLANA_MAINNET_GENESIS };
    if (method === 'getSlot') return { result: 10 };
    if (method === 'getBlockTime') return { result: HEAD };
    return { result: extra.result ?? null };
  }));
  const logs = [];
  const result = await handleSolanaAudit({
    method: extra.method || 'GET',
    url: `https://www.chit402.com/api/solana-audit/${route}${query ? `?${query}` : ''}`,
    headers: extra.headers || {},
    route: extra.claimedRoute || route,
  }, {
    env: extra.env === undefined ? ENV : extra.env,
    fetchImpl: extra.fetchImpl || fetchImpl,
    rateLimit: false,
    log: extra.log || ((entry) => logs.push(entry)),
  });
  return { result, calls, logs };
}

describe('solana audit proxy', { concurrency: 1 }, () => {
  test('A4 unknown method and params are rejected and bodies are server-built', async () => {
    resetSolanaAuditState();
    const post = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, { method: 'POST' });
    assert.equal(post.result.status, 405);
    assert.equal(post.calls.length, 0);

    resetSolanaAuditState();
    const nope = await proxy('nope');
    assert.equal(nope.result.status, 404);
    assert.equal(nope.result.body.error, 'not_found');
    assert.match(nope.result.headers['content-type'], /application\/json/);
    assert.equal(nope.calls.length, 0);

    resetSolanaAuditState();
    const extra = await proxy('signatures', `address=${WALLET}&method=sendTransaction`);
    assert.equal(extra.result.status, 400);
    assert.equal(extra.calls.length, 0);

    resetSolanaAuditState();
    const badLimit = await proxy('signatures', `address=${WALLET}&limit=1001`);
    assert.equal(badLimit.result.status, 400);
    const badBefore = await proxy('signatures', `address=${WALLET}&before=not-a-signature`);
    assert.equal(badBefore.result.status, 400);
    const commitment = await proxy('signatures', `address=${WALLET}&commitment=processed`);
    assert.equal(commitment.result.status, 400);
    assert.equal(badLimit.calls.length + badBefore.calls.length + commitment.calls.length, 0);

    resetSolanaAuditState();
    const tx = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, {
      script: async (method) => {
        if (method === 'getGenesisHash') return { result: SOLANA_MAINNET_GENESIS };
        return {
          result: {
            slot: 4,
            blockTime: IN,
            meta: { err: null, preTokenBalances: [], postTokenBalances: [], innerInstructions: [], logMessages: ['nope'] },
            transaction: { message: { accountKeys: [WALLET], instructions: [] } },
          },
        };
      },
    });
    assert.equal(tx.result.status, 200);
    const sent = tx.calls.map((call) => call.body);
    assert.deepEqual(sent[0], { jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] });
    assert.deepEqual(sent[1], {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [SOLANA_CANARY_SIGNATURE, {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
        commitment: 'finalized',
      }],
    });
    assert.equal(JSON.stringify(sent).includes('sendTransaction'), false);
    assert.equal(tx.result.body.tx.logMessages, undefined);

    resetSolanaAuditState();
    const listed = await proxy('token-accounts', `owner=${WALLET}`);
    assert.equal(listed.calls.at(-1).body.method, 'getTokenAccountsByOwner');
    assert.deepEqual(listed.calls.at(-1).body.params[1], { mint: SOLANA_USDC_MINT });
    assert.equal(listed.calls.at(-1).body.params[2].commitment, 'finalized');
    assert.equal(String(listed.calls.at(-1).url).includes('mainnet.helius-rpc.com'), true);
  });

  test('A5 upstream errors omit the key and the host', async () => {
    resetSolanaAuditState();
    const logs = [];
    const original = console.log;
    console.log = (...args) => logs.push(args.map(String).join(' '));
    try {
      const hit = await proxy('head', '', {
        log: undefined,
        fetchImpl: async () => {
          throw new TypeError(`fetch failed https://mainnet.helius-rpc.com/?api-key=${DUMMY_KEY}`);
        },
      });
      const packed = JSON.stringify(hit.result.body) + logs.join('\n');
      assert.equal(hit.result.body.error, 'upstream_unavailable');
      assert.equal(packed.includes(DUMMY_KEY), false);
      assert.equal(packed.includes('helius'), false);
      assert.equal(packed.includes('api-key'), false);
    } finally {
      console.log = original;
    }
  });

  test('A6 cache headers follow the route and an extra param is 400', async () => {
    resetSolanaAuditState();
    const head = await proxy('head');
    assert.equal(head.result.headers['cache-control'], 'no-store');

    resetSolanaAuditState();
    const missing = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, {
      script: async (method) => (method === 'getGenesisHash'
        ? { result: SOLANA_MAINNET_GENESIS }
        : { result: null }),
    });
    assert.equal(missing.result.body.tx, null);
    assert.equal(missing.result.headers['cache-control'], 'no-store');

    resetSolanaAuditState();
    const final = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, {
      script: async (method) => (method === 'getGenesisHash'
        ? { result: SOLANA_MAINNET_GENESIS }
        : {
          result: {
            slot: 1,
            blockTime: 2,
            meta: { err: null, innerInstructions: [] },
            transaction: { message: { accountKeys: [], instructions: [] } },
          },
        }),
    });
    assert.equal(final.result.headers['cache-control'], 'public, s-maxage=604800, immutable');

    resetSolanaAuditState();
    const fresh = await proxy('signatures', `address=${WALLET}`);
    assert.equal(fresh.result.headers['cache-control'], 'public, s-maxage=10');
    const older = await proxy('signatures', `address=${WALLET}&before=${SOLANA_CANARY_SIGNATURE}`);
    assert.equal(older.result.headers['cache-control'], 'public, s-maxage=3600');

    resetSolanaAuditState();
    const poisoned = await proxy('head', 'extra=1');
    assert.equal(poisoned.result.status, 400);
    assert.equal(poisoned.calls.length, 0);
  });

  test('X7 a thrown fetch does not log the key or the host', async () => {
    resetSolanaAuditState();
    const lines = [];
    const originalLog = console.log;
    const originalErr = console.error;
    console.log = (...args) => lines.push(args.map(String).join(' '));
    console.error = (...args) => lines.push(args.map(String).join(' '));
    try {
      const hit = await handleSolanaAudit({
        method: 'GET',
        url: 'https://www.chit402.com/api/solana-audit/head',
        route: 'head',
      }, {
        env: ENV,
        rateLimit: false,
        fetchImpl: async () => {
          throw new TypeError(`fetch failed …https://mainnet.helius-rpc.com/?api-key=${DUMMY_KEY}`);
        },
      });
      const packed = JSON.stringify(hit.body) + lines.join('\n');
      assert.equal(hit.body.error, 'upstream_unavailable');
      assert.equal(packed.includes(DUMMY_KEY), false);
      assert.equal(packed.includes('helius-rpc.com'), false);
      assert.equal(packed.includes('api-key'), false);
    } finally {
      console.log = originalLog;
      console.error = originalErr;
    }
  });

  test('X8 devnet genesis is wrong_cluster and a network failure is not cached as that', async () => {
    resetSolanaAuditState();
    let genesisCalls = 0;
    const script = async (method) => {
      if (method === 'getGenesisHash') {
        genesisCalls += 1;
        return { result: SOLANA_DEVNET_GENESIS };
      }
      return { result: { leaked: true } };
    };
    const first = await proxy('head', '', { script });
    const second = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, { script });
    assert.equal(first.result.status, 503);
    assert.equal(first.result.body.error, 'wrong_cluster');
    assert.equal(second.result.status, 503);
    assert.equal(second.result.body.error, 'wrong_cluster');
    assert.equal(second.result.body.tx, undefined);
    assert.equal(genesisCalls, 1);

    resetSolanaAuditState();
    let failures = 0;
    const flaky = async (method) => {
      if (method === 'getGenesisHash') {
        failures += 1;
        return { status: 500 };
      }
      return { result: SOLANA_MAINNET_GENESIS };
    };
    const down = await proxy('head', '', { script: flaky });
    const again = await proxy('head', '', { script: flaky });
    assert.equal(down.result.body.error, 'upstream_unavailable');
    assert.notEqual(down.result.body.error, 'wrong_cluster');
    assert.equal(failures, 2);
    assert.equal(again.result.body.error, 'upstream_unavailable');
  });

  test('X9 memos are dropped from the proxy projection', async () => {
    resetSolanaAuditState();
    const hit = await proxy('signatures', `address=${WALLET}`, {
      script: async (method) => {
        if (method === 'getGenesisHash') return { result: SOLANA_MAINNET_GENESIS };
        return {
          result: [{
            signature: SOLANA_CANARY_SIGNATURE,
            slot: 1,
            blockTime: IN,
            err: null,
            memo: '<img src=x onerror=alert(1)>',
          }],
        };
      },
    });
    assert.equal(Object.hasOwn(hit.result.body.signatures[0], 'memo'), false);
    assert.equal(JSON.stringify(hit.result.body).includes('<img'), false);
  });

  test('X10 abusive queries never call upstream', async () => {
    const cases = [
      { method: 'POST', route: 'tx', query: `sig=${SOLANA_CANARY_SIGNATURE}`, status: 405 },
      { method: 'GET', route: 'tx', query: `sig=${SOLANA_CANARY_SIGNATURE}&method=sendTransaction`, status: 400 },
      { method: 'GET', route: 'tx', query: `sig=${SOLANA_CANARY_SIGNATURE}&rpc=1`, status: 400 },
      { method: 'GET', route: 'tx', query: `sig=${SOLANA_CANARY_SIGNATURE}&url=1`, status: 400 },
      { method: 'GET', route: 'signatures', query: `address=${WALLET}&commitment=processed`, status: 400 },
      { method: 'GET', route: 'signatures', query: `address=${WALLET}&address=${A44}`, status: 400 },
      { method: 'GET', route: 'signatures', query: `address=${WALLET}&limit=0`, status: 400 },
      { method: 'GET', route: 'signatures', query: `address=${WALLET}&limit=1001`, status: 400 },
      { method: 'GET', route: 'signatures', query: `address=${WALLET}&limit=1e3`, status: 400 },
      { method: 'GET', route: 'signatures', query: `address=${WALLET}&limit=01`, status: 400 },
    ];
    for (const item of cases) {
      resetSolanaAuditState();
      const hit = await proxy(item.route, item.query, { method: item.method });
      assert.equal(hit.result.status, item.status, `${item.method} ${item.query}`);
      assert.equal(hit.calls.length, 0);
    }
  });

  test('X11 unknown proxy route is JSON 404', async () => {
    resetSolanaAuditState();
    const hit = await proxy('nope');
    assert.equal(hit.result.status, 404);
    assert.match(hit.result.headers['content-type'], /application\/json/);
    assert.equal(hit.result.body.error, 'not_found');
    assert.equal(JSON.stringify(hit.result.body).includes('<html'), false);
    const catchAll = readFileSync(join(repo, 'api/[...path].ts'), 'utf8');
    assert.match(catchAll, /status\(404\)/);
    assert.match(catchAll, /not_found/);
  });

  test('X12 missing or non-key env does not call upstream', async () => {
    resetSolanaAuditState();
    assert.equal(solanaAuditEndpoint({}), null);
    assert.equal(solanaAuditEndpoint({ HELIUS_API_KEY: 'http://169.254.169.254/' }), null);
    assert.equal(solanaAuditEndpoint({ HELIUS_API_KEY: 'https://evil.example/secret' }), null);
    const unset = await proxy('head', '', { env: {} });
    assert.equal(unset.result.status, 503);
    assert.equal(unset.result.body.error, 'not_configured');
    assert.equal(unset.calls.length, 0);
    const metadata = await proxy('head', '', { env: { HELIUS_API_KEY: 'http://169.254.169.254/' } });
    assert.equal(metadata.result.status, 503);
    assert.equal(metadata.result.body.error, 'not_configured');
    assert.equal(metadata.calls.length, 0);
    const otherHost = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, {
      env: { HELIUS_API_KEY: 'https://evil.example/abcdEFGH1234567890' },
    });
    assert.equal(otherHost.result.status, 503);
    assert.equal(otherHost.calls.length, 0);
  });

  test('X14 errors and nulls are no-store and a finalized tx is immutable', async () => {
    resetSolanaAuditState();
    const limited = await proxy('head', '', {
      script: async (method) => (method === 'getGenesisHash'
        ? { result: SOLANA_MAINNET_GENESIS }
        : { status: 429 }),
    });
    assert.equal(limited.result.status, 429);
    assert.equal(limited.result.headers['cache-control'], 'no-store');

    resetSolanaAuditState();
    const down = await proxy('head', '', {
      script: async (method) => (method === 'getGenesisHash'
        ? { result: SOLANA_MAINNET_GENESIS }
        : { status: 500 }),
    });
    assert.equal(down.result.headers['cache-control'], 'no-store');

    resetSolanaAuditState();
    const empty = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, {
      script: async (method) => (method === 'getGenesisHash' ? { result: SOLANA_MAINNET_GENESIS } : { result: null }),
    });
    assert.equal(empty.result.headers['cache-control'], 'no-store');

    resetSolanaAuditState();
    const kept = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, {
      script: async (method) => (method === 'getGenesisHash'
        ? { result: SOLANA_MAINNET_GENESIS }
        : {
          result: {
            slot: 1,
            blockTime: 2,
            meta: { err: null, innerInstructions: [] },
            transaction: { message: { accountKeys: [], instructions: [] } },
          },
        }),
    });
    assert.equal(kept.result.headers['cache-control'], 'public, s-maxage=604800, immutable');

    resetSolanaAuditState();
    const noTime = await proxy('tx', `sig=${SOLANA_CANARY_SIGNATURE}`, {
      script: async (method) => (method === 'getGenesisHash'
        ? { result: SOLANA_MAINNET_GENESIS }
        : {
          result: {
            slot: 1,
            blockTime: null,
            meta: { err: null, innerInstructions: [] },
            transaction: { message: { accountKeys: [], instructions: [] } },
          },
        }),
    });
    assert.equal(noTime.result.status, 200);
    assert.equal(noTime.result.body.tx.blockTime, null);
    assert.equal(noTime.result.headers['cache-control'], 'no-store');
    const head = await proxy('head');
    assert.equal(head.result.headers['cache-control'], 'no-store');
    const extra = await proxy('account', `address=${WALLET}&foo=1`);
    assert.equal(extra.result.status, 400);
    assert.equal(extra.calls.length, 0);
    assert.equal(kept.result.headers['access-control-allow-origin'], undefined);
  });

  test('X15 oversized upstream bodies are refused whole', async () => {
    resetSolanaAuditState();
    const marker = 'UPSTREAM_PARTIAL_MARKER';
    const hit = await proxy('head', '', {
      script: async (method) => {
        if (method === 'getGenesisHash') return { result: SOLANA_MAINNET_GENESIS };
        return { raw: marker + 'x'.repeat((2 * 1024 * 1024) + 8) };
      },
    });
    assert.equal(hit.result.status, 502);
    assert.equal(hit.result.body.error, 'upstream_too_large');
    assert.equal(JSON.stringify(hit.result.body).includes(marker), false);
  });

  test('X18 deny-listed proxy subjects are 400 before any upstream call', async () => {
    for (const address of [SOLANA_USDC_MINT, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID]) {
      resetSolanaAuditState();
      const hit = await proxy('account', `address=${address}`);
      assert.equal(hit.result.status, 400, address);
      assert.equal(hit.result.body.error, 'invalid_param');
      assert.equal(hit.calls.length, 0);
      const sigs = await proxy('signatures', `address=${address}`);
      assert.equal(sigs.result.status, 400);
      assert.equal(sigs.calls.length, 0);
    }
  });

  test('X22 a Vercel-injected route query passes validation on each audit route', async () => {
    const cases = [
      { route: 'head', query: 'route=head', method: 'getSlot' },
      { route: 'account', query: `route=account&address=${WALLET}`, method: 'getAccountInfo' },
      { route: 'token-accounts', query: `owner=${WALLET}&route=token-accounts`, method: 'getTokenAccountsByOwner' },
      { route: 'signatures', query: `address=${WALLET}&route=signatures&limit=20`, method: 'getSignaturesForAddress' },
      { route: 'tx', query: `sig=${SOLANA_CANARY_SIGNATURE}&route=tx`, method: 'getTransaction' },
    ];
    for (const item of cases) {
      resetSolanaAuditState();
      const hit = await proxy(item.route, item.query);
      assert.equal(hit.result.status, 200, item.route);
      assert.equal(hit.result.body.error, undefined, item.route);
      assert.equal(hit.calls.some((call) => call.body.method === item.method), true, item.route);
    }
  });

  test('X23 a route query that differs from the path is rejected', async () => {
    const smuggled = [
      { path: 'head', query: `route=tx&sig=${SOLANA_CANARY_SIGNATURE}`, claimed: 'tx' },
      { path: 'account', query: `address=${WALLET}&route=signatures`, claimed: 'signatures' },
      { path: 'token-accounts', query: `owner=${WALLET}&route=head`, claimed: 'head' },
      { path: 'signatures', query: `address=${WALLET}&route=account`, claimed: 'account' },
      { path: 'tx', query: `sig=${SOLANA_CANARY_SIGNATURE}&route=head`, claimed: 'head' },
    ];
    for (const item of smuggled) {
      resetSolanaAuditState();
      const hit = await proxy(item.path, item.query, { claimedRoute: item.claimed });
      assert.equal(hit.result.status, 400, item.query);
      assert.equal(hit.result.body.error, 'invalid_param');
      assert.equal(hit.calls.length, 0, item.query);
    }

    resetSolanaAuditState();
    const echoed = await proxy('head', 'route=head&extra=1');
    assert.equal(echoed.result.status, 400);
    assert.equal(echoed.result.body.error, 'invalid_param');
    assert.equal(echoed.calls.length, 0);

    resetSolanaAuditState();
    const dup = await proxy('account', `address=${WALLET}&route=account&route=tx`);
    assert.equal(dup.result.status, 400);
    assert.equal(dup.result.body.error, 'invalid_param');
    assert.equal(dup.calls.length, 0);
  });
});

test('A7 a short page with a missing canary withholds the total', async () => {
  const { result } = await scan(WALLET, { canary: 'missing' });
  assert.equal(result.ok, true);
  assert.equal(result.report.headline.status, 'incomplete');
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.ok(result.report.coverage.failed_ranges.some((range) => range.error === 'history_unproven'));
});

test('A8 pagination, page cap, read cap, and deadline withhold a total', async () => {
  const keep = sigOf(11);
  const older = sigOf(12);
  const stopped = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [
      { signature: keep, slot: 50, blockTime: IN, failed: false },
      { signature: older, slot: 4, blockTime: OLD, failed: false },
    ] : []),
    txs: new Map([[keep, outTx({ amount: '2000', pre: '2000', post: '0' })]]),
  });
  assert.equal(stopped.result.report.transfers.length, 1);
  assert.equal(stopped.result.report.transfers[0].tx_hash, keep);
  assert.equal(stopped.urls.some((url) => url.includes(older)), false);
  assert.equal(stopped.result.report.headline.usdc_out_atomic, '2000');

  const many = Array.from({ length: SOL_MAX_SIG_PAGES_PER_SOURCE * SOL_SIG_PAGE_LIMIT }, (_, index) => ({
    signature: sigOf(1000 + index),
    slot: 9_000_000 - index,
    blockTime: IN,
    failed: false,
  }));
  const capped = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? many : []),
    defaultTx: () => outTx({ amount: '1', pre: '2', post: '1' }),
  });
  assert.ok(capped.result.report.coverage.failed_ranges.some((range) => range.error === 'sig_page_cap'));
  assert.equal(capped.result.report.headline.usdc_out_atomic, null);

  const wide = Array.from({ length: MAX_SOL_TX_READS + 1 }, (_, index) => ({
    signature: sigOf(20_000 + index),
    slot: 8_000_000 - index,
    blockTime: IN,
    failed: false,
  }));
  const truncated = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? wide : []),
    defaultTx: () => outTx({ amount: '1', pre: '2', post: '1' }),
  });
  assert.equal(truncated.result.report.coverage.truncated, true);
  assert.equal(truncated.result.report.headline.usdc_out_atomic, null);

  const deadline = await scan(WALLET, { deadlineMs: 0, now: () => 5_000_000 });
  assert.equal(deadline.result.report.headline.usdc_out_atomic, null);
  assert.ok(deadline.result.report.coverage.failed_ranges.some((range) => range.error === 'deadline'));
});

test('A9 failed transactions are excluded and a null transaction is a failed range', async () => {
  const failedSig = sigOf(30);
  const nullSig = sigOf(31);
  const skipped = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [
      { signature: failedSig, slot: 9, blockTime: IN, failed: true },
      { signature: sigOf(32), slot: 1, blockTime: OLD, failed: false },
    ] : []),
    txs: new Map([[failedSig, outTx({ err: true })]]),
  });
  assert.equal(skipped.result.report.transfers.length, 0);
  assert.equal(skipped.urls.some((url) => url.includes(failedSig)), false);
  assert.equal(skipped.result.report.headline.usdc_out_atomic, '0');

  const unread = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [
      { signature: nullSig, slot: 9, blockTime: IN, failed: false },
    ] : []),
    txs: new Map([[nullSig, null]]),
  });
  assert.equal(unread.result.report.transfers.length, 0);
  assert.equal(unread.result.report.headline.usdc_out_atomic, null);
  assert.ok(unread.result.report.coverage.failed_ranges.some((range) => range.error === 'tx_unavailable'));
});

test('A10 fake mint, Token-2022, and incoming transfers add no rows', async () => {
  const fake = decodeSolanaUsdcTransfers(rawSpl(TOKEN_PROGRAM_ID, 'transferChecked', {
    source: ATA,
    destination: A43,
    mint: A44,
    authority: WALLET,
    tokenAmount: { amount: '2000', decimals: 6 },
  }), { mode: 'wallet', wallet: WALLET, tokenAccounts: new Set([ATA]), signature: sigOf(40) });
  assert.equal(fake.rows.length, 0);

  const t22 = decodeSolanaUsdcTransfers(rawSpl(TOKEN_2022_PROGRAM_ID, 'transferChecked', {
    source: ATA,
    destination: A43,
    mint: SOLANA_USDC_MINT,
    authority: WALLET,
    tokenAmount: { amount: '2000', decimals: 6 },
  }), { mode: 'wallet', wallet: WALLET, tokenAccounts: new Set([ATA]), signature: sigOf(41) });
  assert.equal(t22.rows.length, 0);

  const incomingSig = sigOf(42);
  const incoming = await scan(WALLET, {
    tokenAccounts: [{ address: ATA, mint: SOLANA_USDC_MINT, owner: WALLET, amount: '2000' }],
    sigsFor: (who) => (who === WALLET ? [{ signature: incomingSig, slot: 8, blockTime: IN, failed: false }] : []),
    txs: new Map([[incomingSig, outTx({
      source: A43,
      destination: ATA,
      destOwner: WALLET,
      sourceOwner: A43,
      amount: '2000',
      pre: '0',
      post: '2000',
      preTokenBalances: [
        { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: A43, programId: TOKEN_PROGRAM_ID, amount: '2000', decimals: 6 },
        { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID, amount: '0', decimals: 6 },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: A43, programId: TOKEN_PROGRAM_ID, amount: '0', decimals: 6 },
        { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID, amount: '2000', decimals: 6 },
      ],
    })]]),
  });
  assert.equal(incoming.result.report.transfers.length, 0);
  assert.equal(incoming.result.report.headline.usdc_out_atomic, '0');
});

test('A11 delegate transfers and closed-account outs are both found', async () => {
  const delegateSig = sigOf(50);
  const closed = encodeBase58(Uint8Array.from({ length: 32 }, (_, i) => i + 3));
  const closedSig = sigOf(51);
  const delegate = await scan(WALLET, {
    tokenAccounts: [{ address: ATA, mint: SOLANA_USDC_MINT, owner: WALLET, amount: '0' }],
    sigsFor: (who) => (who === ATA ? [{ signature: delegateSig, slot: 20, blockTime: IN, failed: false }] : []),
    txs: new Map([[delegateSig, outTx({
      feePayer: A43,
      authority: A43,
      amount: '2000',
      pre: '2000',
      post: '0',
    })]]),
  });
  assert.equal(delegate.result.report.transfers.length, 1);
  assert.equal(delegate.result.report.transfers[0].tx_hash, delegateSig);

  const closedScan = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature: closedSig, slot: 19, blockTime: IN, failed: false }] : []),
    txs: new Map([[closedSig, outTx({
      source: closed,
      amount: '1500',
      pre: '1500',
      post: '0',
    })]]),
  });
  assert.equal(closedScan.result.report.transfers.length, 1);
  assert.equal(closedScan.result.report.transfers[0].amount_atomic, '1500');
  assert.equal(closedScan.result.report.coverage.token_accounts.includes(closed), false);
});

test('A12 an unexplained balance drop withholds the total', async () => {
  const burn = sigOf(60);
  const { result } = await scan(WALLET, {
    tokenAccounts: [{ address: ATA, mint: SOLANA_USDC_MINT, owner: WALLET, amount: '3000' }],
    sigsFor: (who) => (who === WALLET ? [{ signature: burn, slot: 6, blockTime: IN, failed: false }] : []),
    txs: new Map([[burn, {
      slot: 6,
      blockTime: IN,
      err: false,
      accountKeys: [{ pubkey: WALLET, signer: true }, { pubkey: ATA, signer: false }],
      instructions: [],
      innerInstructions: [],
      preTokenBalances: [
        { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID, amount: '5000', decimals: 6 },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID, amount: '3000', decimals: 6 },
      ],
    }]]),
  });
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.ok(result.report.coverage.failed_ranges.some((range) => range.error === 'unexplained_out'));
});

test('A13 inner transfers keep their index and two outs stay two rows', () => {
  const signature = sigOf(70);
  const innerIx = {
    programId: TOKEN_PROGRAM_ID,
    parsed: {
      type: 'transferChecked',
      info: {
        source: ATA,
        destination: A43,
        mint: SOLANA_USDC_MINT,
        authority: WALLET,
        tokenAmount: { amount: '2000', decimals: 6 },
      },
    },
  };
  const inner = decodeSolanaUsdcTransfers({
    slot: 7,
    blockTime: IN,
    err: false,
    accountKeys: [
      { pubkey: WALLET, signer: true },
      { pubkey: ATA, signer: false },
      { pubkey: A43, signer: false },
    ],
    instructions: [{ programId: COMPUTE_BUDGET_PROGRAM_ID, parsed: null }],
    innerInstructions: [{ index: 2, instructions: [innerIx] }],
    preTokenBalances: [
      { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID, amount: '2000', decimals: 6 },
    ],
    postTokenBalances: [
      { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID, amount: '0', decimals: 6 },
      { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: A43, programId: TOKEN_PROGRAM_ID, amount: '2000', decimals: 6 },
    ],
  }, { mode: 'wallet', wallet: WALLET, tokenAccounts: new Set([ATA]), signature });
  assert.equal(inner.rows.length, 1);
  assert.equal(inner.rows[0].log_index, '2.0');

  const two = decodeSolanaUsdcTransfers(outTx({
    amount: '2500',
    pre: '2500',
    post: '0',
    instructions: [
      outTx({ amount: '2000' }).instructions[0],
      {
        programId: TOKEN_PROGRAM_ID,
        parsed: {
          type: 'transferChecked',
          info: {
            source: ATA,
            destination: A32,
            mint: SOLANA_USDC_MINT,
            authority: WALLET,
            tokenAmount: { amount: '500', decimals: 6 },
          },
        },
      },
    ],
    postTokenBalances: [
      { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: WALLET, programId: TOKEN_PROGRAM_ID, amount: '0', decimals: 6 },
      { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: A43, programId: TOKEN_PROGRAM_ID, amount: '2000', decimals: 6 },
    ],
  }), { mode: 'wallet', wallet: WALLET, tokenAccounts: new Set([ATA]), signature: sigOf(71) });
  assert.equal(two.rows.length, 2);
  assert.equal(two.rows[0].log_index, '0');
  assert.equal(two.rows[1].log_index, '1');
  assert.equal(two.unexplained, false);
});

test('A14 a mixed-case signature is never lowercased', async () => {
  const signature = SOLANA_CANARY_BEFORE;
  assert.notEqual(signature, signature.toLowerCase());
  const { result } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 15, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({ amount: '2000', pre: '2000', post: '0' })]]),
  });
  const row = result.report.transfers[0];
  assert.equal(row.tx_hash, signature);
  const packed = reportToJson(result.report) + reportToCsv(result.report);
  assert.equal(packed.includes(signature), true);
  assert.equal(packed.includes(signature.toLowerCase()), false);
  assert.equal(row.explorer_url, `https://solscan.io/tx/${signature}`);
});

test('A15 a by-tx redirect to a matching shell is receipted x402', async () => {
  const signature = SOLANA_CANARY_BEFORE;
  const id = 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a';
  const location = `https://api.chit402.com/receipt/${id}?format=json`;
  let hops = 0;
  const { result, urls } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 15, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({
      destination: SOLANA_CANARY_ACCOUNT,
      destOwner: SOLANA_CANARY_PAYEE,
      amount: '2000',
      pre: '2000',
      post: '0',
    })]]),
    gateway: (url) => {
      hops += 1;
      if (url.includes('/receipt/by-tx')) {
        return {
          ok: false,
          status: 302,
          headers: { get: (name) => (String(name).toLowerCase() === 'location' ? location : null) },
          json: async () => ({}),
        };
      }
      assert.equal(url, location);
      return jsonRes(shell({
        receipt_id: id,
        chain: 'solana',
        payment_tx: signature,
        pay_to: SOLANA_CANARY_PAYEE,
        asset: SOLANA_USDC_MINT,
        amount_gross: '2000',
      }));
    },
  });
  assert.equal(hops, 2);
  assert.equal(result.report.transfers[0].receipt_status, 'receipted');
  assert.equal(result.report.transfers[0].spend_class, 'x402');
  assert.equal(result.report.transfers[0].verify_url, `https://api.chit402.com/receipt/${id}`);
  assert.equal(urls.filter((url) => url === location).length, 1);
});

test('A16 shell mismatches are receipt_mismatch and stay out of receipted_atomic', () => {
  const signature = sigOf(80);
  const row = {
    tx_hash: signature,
    log_index: '0',
    block_number: 1,
    block_time: new Date(IN * 1000).toISOString(),
    pay_to: SOLANA_CANARY_PAYEE,
    pay_to_token_account: SOLANA_CANARY_ACCOUNT,
    amount_atomic: '2000',
    settlement_method: 'spl_transfer_checked_sponsored',
  };
  const other = { ...row, log_index: '1', amount_atomic: '5000000' };
  function reportFor(body, rows = [row]) {
    return buildSpendAuditReport({
      query: { kind: 'solana', address: WALLET },
      solana: {
        rows,
        failedRanges: [],
        scanComplete: true,
        truncated: false,
        signaturesSeen: rows.length,
        signaturesRead: rows.length,
        tokenAccounts: [],
        windowSeconds: SOL_WINDOW_SECONDS,
      },
      receipts: new Map([[signature, body]]),
      generatedAt: '2026-10-08T00:00:00.000Z',
    });
  }
  const cases = [
    shell({ receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a', chain: 'solana-devnet', payment_tx: signature, pay_to: SOLANA_CANARY_PAYEE, asset: SOLANA_USDC_MINT, amount_gross: '2000' }),
    shell({ receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a', chain: 'solana', payment_tx: signature.toLowerCase(), pay_to: SOLANA_CANARY_PAYEE, asset: SOLANA_USDC_MINT, amount_gross: '2000' }),
    shell({ receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a', chain: 'solana', payment_tx: `${signature.slice(0, -1)}1`, pay_to: SOLANA_CANARY_PAYEE, asset: SOLANA_USDC_MINT, amount_gross: '2000' }),
    shell({ receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a', chain: 'solana', payment_tx: signature, pay_to: A44, asset: SOLANA_USDC_MINT, amount_gross: '2000' }),
    shell({ receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a', chain: 'solana', payment_tx: signature, pay_to: SOLANA_CANARY_PAYEE, asset: A44, amount_gross: '2000' }),
    shell({ receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a', chain: 'solana', payment_tx: signature, pay_to: SOLANA_CANARY_PAYEE, asset: SOLANA_USDC_MINT, amount_gross: '1' }),
  ];
  for (const body of cases) {
    const report = reportFor({ status: 'found', ...body });
    assert.equal(report.transfers[0].receipt_status, 'receipt_mismatch');
    assert.equal(report.receipt_match.receipted_atomic, '0');
    assert.equal(report.transfers[0].verify_url, null);
  }
  const shared = reportFor({
    status: 'found',
    ...shell({
      receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a',
      chain: 'solana',
      payment_tx: signature,
      pay_to: SOLANA_CANARY_PAYEE,
      asset: 'USDC',
      amount_gross: '2000',
    }),
  }, [row, other]);
  assert.equal(shared.transfers.find((item) => item.amount_atomic === '2000').receipt_status, 'receipted');
  assert.equal(shared.transfers.find((item) => item.amount_atomic === '5000000').receipt_status, 'receipt_mismatch');
  assert.equal(shared.receipt_match.receipted_atomic, '2000');
  const twins = reportFor({
    status: 'found',
    ...shell({
      receipt_id: 'xfuel-597825b6-e72f-4f22-98ed-a27c4c868493',
      chain: 'solana',
      payment_tx: signature,
      pay_to: SOLANA_CANARY_PAYEE,
      asset: SOLANA_USDC_MINT,
      amount_gross: '2000',
    }),
  }, [row, { ...row, log_index: '1' }]);
  assert.equal(twins.transfers.every((item) => item.receipt_status === 'receipt_mismatch'), true);
  assert.equal(twins.receipt_match.receipted_atomic, '0');
  assert.equal(twins.receipt_match.mismatch_count, 2);
});

test('A17 404 is unreceipted, errors are unavailable, and the 41st signature is not checked', async () => {
  const signature = sigOf(90);
  const base = {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 4, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({ amount: '10', pre: '10', post: '0' })]]),
  };
  const missing = await scan(WALLET, base);
  assert.equal(missing.result.report.transfers[0].receipt_status, 'unreceipted');

  for (const gateway of [
    () => jsonRes({ error: 'slow' }, 429),
    () => jsonRes({ error: 'down' }, 500),
    () => { throw new Error('network'); },
    () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => { throw new Error('garbage'); },
    }),
  ]) {
    const hit = await scan(WALLET, { ...base, gateway });
    assert.equal(hit.result.report.transfers[0].receipt_status, 'unavailable');
    assert.equal(hit.result.report.receipt_match.unreceipted_atomic, '0');
  }

  const rows = Array.from({ length: 41 }, (_, index) => ({
    signature: sigOf(500 + index),
    slot: 50_000 - index,
    blockTime: IN - index,
    failed: false,
  }));
  const capped = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? rows : []),
    defaultTx: () => outTx({ amount: '1', pre: '2', post: '1' }),
  });
  assert.equal(capped.result.report.transfers.length, 41);
  assert.equal(capped.result.report.receipt_match.not_checked_count, 1);
  assert.equal(capped.result.report.transfers[40].receipt_status, 'not_checked');
  assert.equal(gatewayUrls(capped.urls).length, 40);
  assert.equal(gatewayUrls(capped.urls).some((url) => url.includes(rows[40].signature)), false);
});

test('A18 a fixture run keeps private receipt keys and the wallet off the gateway', async () => {
  const signature = sigOf(91);
  const { result, urls } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 4, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({ feePayer: FEE_PAYER, authority: WALLET, amount: '2000', pre: '2000', post: '0' })]]),
    gateway: (url) => jsonRes(shell({
      receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a',
      chain: 'solana',
      payment_tx: signature,
      pay_to: A43,
      asset: SOLANA_USDC_MINT,
      amount_gross: '2000',
    })),
  });
  const packed = reportToJson(result.report) + reportToCsv(result.report);
  for (const key of walkKeys(result.report)) {
    assert.equal(PRIVATE_KEYS.includes(key), false, key);
  }
  assert.equal(packed.includes(FEE_PAYER), false);
  assert.equal(packed.includes('format=auditor'), false);
  for (const url of gatewayUrls(urls)) {
    assert.match(url, /^https:\/\/api\.chit402\.com\/receipt\/by-tx\?tx=solana%3A[1-9A-HJ-NP-Za-km-z]{64,88}&format=json$/);
    assert.equal(url.includes(WALLET), false);
    assert.equal(url.includes('/owner'), false);
  }
});

test('A19 memos are not markup and explorer links are strict solscan urls', async () => {
  assert.equal(safeHttpsHref('javascript:alert(1)'), null);
  assert.equal(safeHttpsHref(`https://solscan.io/tx/${SOLANA_CANARY_SIGNATURE}?x=1`), null);
  assert.equal(sol.solanaExplorerHref('not-a-sig'), null);
  const signature = sigOf(92);
  const decoded = decodeSolanaUsdcTransfers({
    ...outTx({ amount: '2000', pre: '2000', post: '0' }),
    instructions: [
      { programId: MEMO_PROGRAM_ID, parsed: '<img onerror=alert(1) src=x>', program: 'spl-memo' },
      outTx({ amount: '2000', pre: '2000', post: '0' }).instructions[0],
    ],
  }, { mode: 'wallet', wallet: WALLET, tokenAccounts: new Set([ATA]), signature });
  const report = buildSpendAuditReport({
    query: { kind: 'solana', address: WALLET },
    solana: {
      rows: decoded.rows,
      failedRanges: [],
      scanComplete: true,
      truncated: false,
      signaturesSeen: 1,
      signaturesRead: 1,
      tokenAccounts: [],
      windowSeconds: SOL_WINDOW_SECONDS,
    },
    receipts: new Map(),
    generatedAt: '2026-10-08T00:00:00.000Z',
  });
  const packed = reportToJson(report) + reportToCsv(report);
  assert.equal(packed.includes('<img'), false);
  assert.equal(packed.includes('javascript:'), false);
  assert.equal(report.transfers[0].explorer_url, `https://solscan.io/tx/${signature}`);
  assert.equal(report.transfers[0].explorer_url.includes('?'), false);
});

test('A20 chips, Base-only note, and Solana copy', () => {
  assert.equal(auditQueryChip(SAMPLE_BASE_ADDRESS), 'Base wallet');
  assert.equal(auditQueryChip(A44), 'Solana wallet');
  assert.equal(auditQueryChip('42'), 'Agent id');
  assert.equal(auditQueryChip(sigOf(93)), 'Solana signature: paste the wallet');
  assert.equal(auditQueryChip(`solana:${SOLANA_DEVNET_GENESIS}`), 'Solana devnet is not scanned.');
  assert.equal(auditQueryChip(SYSTEM_PROGRAM_ID), 'Not a wallet.');
  assert.equal(auditQueryChip('nope'), 'Not recognized');
  const page = readFileSync(join(here, '../src/pages/Audit.tsx'), 'utf8');
  assert.match(page, /Spend audit — Base and Solana USDC out/);
  assert.match(page, /Paste a Base or Solana wallet/);
  assert.match(page, /0x…, Solana address, or agent id/);
  assert.match(page, /Reading Solana…/);
  assert.doesNotMatch(page, /Use a Solana sample/);
  const base = buildSpendAuditReport({
    query: { kind: 'base', address: SAMPLE_BASE_ADDRESS },
    chain: { logs: [], failedRanges: [], scanComplete: true, fromBlock: 1, toBlock: 2 },
  });
  assert.ok(base.coverage.notes.some((note) => note.includes('This report covers Base only. Paste a Solana address for Solana USDC.')));
  const solana = buildSpendAuditReport({
    query: { kind: 'solana', address: A44 },
    solana: {
      rows: [],
      failedRanges: [],
      scanComplete: true,
      truncated: false,
      signaturesSeen: 0,
      signaturesRead: 0,
      tokenAccounts: [],
      windowSeconds: SOL_WINDOW_SECONDS,
    },
  });
  assert.equal(solana.coverage.notes.some((note) => note.includes('Solana USDC is not scanned')), false);
  assert.ok(solana.coverage.notes.some((note) => note.includes('Delegate transfers from closed token accounts are not visible')));
  assert.ok(solana.coverage.notes.some((note) => note.includes('Helius')));
  assert.equal(solana.coverage.rpc, 'chit402 Solana audit proxy (Helius)');
});

test('A21 spike and near-duplicate use Solana block time', () => {
  const payee = A43;
  const start = Date.parse('2026-10-01T00:00:00.000Z');
  const rows = [100n, 100n, 100n, 100n, 1000n].map((amount, index) => ({
    tx_hash: sigOf(200 + index),
    log_index: '0',
    block_number: 10 + index,
    block_time: new Date(start + index * 1000).toISOString(),
    pay_to: payee,
    pay_to_token_account: ATA,
    amount_atomic: amount.toString(),
    settlement_method: 'spl_transfer',
  }));
  rows.push({
    ...rows[0],
    tx_hash: sigOf(206),
    block_time: new Date(start + 30_000).toISOString(),
    block_number: 30,
  });
  const report = buildSpendAuditReport({
    query: { kind: 'solana', address: WALLET },
    solana: {
      rows,
      failedRanges: [],
      scanComplete: true,
      truncated: false,
      signaturesSeen: rows.length,
      signaturesRead: rows.length,
      tokenAccounts: [],
      windowSeconds: SOL_WINDOW_SECONDS,
    },
    receipts: new Map(),
  });
  assert.ok(report.anomalies.some((item) => item.kind === 'spike'));
  assert.ok(report.anomalies.some((item) => item.kind === 'near_duplicate'));
});

test('A22 CSV preamble records the Solana query and scan flags', () => {
  const report = buildSpendAuditReport({
    query: { kind: 'solana', address: WALLET },
    solana: {
      rows: [],
      failedRanges: [],
      scanComplete: true,
      truncated: false,
      signaturesSeen: 0,
      signaturesRead: 0,
      tokenAccounts: [],
      windowSeconds: SOL_WINDOW_SECONDS,
    },
  });
  const csv = reportToCsv(report);
  assert.match(csv, /# query=solana/);
  assert.match(csv, /# scan_complete=true/);
  assert.match(csv, /# truncated=false/);
  const truncated = buildSpendAuditReport({
    query: { kind: 'solana', address: WALLET },
    solana: {
      rows: [],
      failedRanges: [],
      scanComplete: false,
      truncated: true,
      signaturesSeen: 1,
      signaturesRead: 1,
      tokenAccounts: [],
      windowSeconds: SOL_WINDOW_SECONDS,
    },
  });
  assert.match(reportToCsv(truncated), /# truncated=true/);
  assert.match(reportToCsv(truncated), /# scan_complete=false/);
});

test('A23 Node 20 and 22 run the web tests offline, and Base constants stay put', () => {
  const workflow = readFileSync(join(repo, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, /node: \['20', '22'\]/);
  assert.match(workflow, /unshare -rn npm test/);
  assert.equal(AUDIT_WINDOW_BLOCKS, 302400);
  assert.equal(AUDIT_CHUNK_BLOCKS, 500);
  const note = buildSpendAuditReport({
    query: { kind: 'base', address: SAMPLE_BASE_ADDRESS },
    chain: { logs: [], failedRanges: [], scanComplete: true, fromBlock: 1, toBlock: 2 },
  });
  assert.match(note.coverage.solana, /This report covers Base only/);
});

test('A24 offline 14-day fixture finds the three September receipts and 7 days does not', async () => {
  const payments = [
    ['2WaXaTT2LkpMAuryrGqPYsK48V8RDcbnt1ksGMsfwj8Pxpx2G1Z52PEZgjTHZK4YZDdTcv36P2o9toSVVke4iWBy', 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a', 450808797, 1790461677],
    ['4KZ9iXA43AnV4yqfDNuST3z2HcSjpDEuKZ1sjhUd6kmn3WWN1wUTEAXGaQeYSd8ZPiZ43rXoVGZAjvZGif42t5P', 'xfuel-597825b6-e72f-4f22-98ed-a27c4c868493', 450808700, 1790461600],
    ['2jcfP7GpSMGpGvW3FxAtjb3ZvtfVjZxVuJw54AXfsjUcNSkhTyqfdWj6Yeeazzui5UcgZuG4C65LutuSWg1EMZUz', 'xfuel-01d71cd9-57a9-4d0f-84bb-66fe72df9d37', 450808600, 1790461500],
  ];
  const sigs = payments.map(([signature, , slot, blockTime]) => ({ signature, slot, blockTime, failed: false }));
  const txs = new Map(payments.map(([signature, , slot, blockTime]) => [signature, outTx({
    slot,
    blockTime,
    feePayer: FEE_PAYER,
    authority: SOLANA_FIXTURE_PAYER,
    source: ATA,
    sourceOwner: SOLANA_FIXTURE_PAYER,
    destination: SOLANA_CANARY_ACCOUNT,
    destOwner: SOLANA_CANARY_PAYEE,
    amount: '2000',
    pre: '8000',
    post: '6000',
  })]));
  const headTime = 1790461677 + (8 * 86400);
  const run = (windowSeconds) => scan(SOLANA_FIXTURE_PAYER, {
    headTime,
    windowSeconds,
    tokenAccounts: [{ address: ATA, mint: SOLANA_USDC_MINT, owner: SOLANA_FIXTURE_PAYER, amount: '0' }],
    sigsFor: (who) => (who === SOLANA_FIXTURE_PAYER ? sigs : []),
    txs,
    gateway: (url) => {
      const tx = decodeURIComponent(url.split('tx=')[1].split('&')[0]).replace(/^solana:/, '');
      const found = payments.find((item) => item[0] === tx);
      return jsonRes(shell({
        receipt_id: found[1],
        chain: 'solana',
        payment_tx: found[0],
        pay_to: SOLANA_CANARY_PAYEE,
        asset: SOLANA_USDC_MINT,
        amount_gross: '2000',
      }));
    },
  });
  const wide = await run(14 * 86400);
  assert.equal(wide.result.report.transfers.length, 3);
  assert.equal(wide.result.report.transfers.every((row) => row.receipt_status === 'receipted'), true);
  assert.equal(wide.result.report.transfers.every((row) => row.amount_atomic === '2000' && row.amount_usdc === '0.002'), true);
  assert.equal(wide.result.report.transfers.every((row) => row.pay_to === SOLANA_CANARY_PAYEE), true);
  assert.equal(wide.result.report.coverage.scan_complete, true);
  assert.equal(wide.result.report.headline.usdc_out_atomic, '6000');
  assert.equal(JSON.stringify(wide.result.report).includes(FEE_PAYER), false);
  for (const url of gatewayUrls(wide.urls)) {
    assert.match(url, /^https:\/\/api\.chit402\.com\/receipt\/by-tx\?tx=solana%3A[1-9A-HJ-NP-Za-km-z]{64,88}&format=json$/);
    assert.equal(url.includes(SOLANA_FIXTURE_PAYER), false);
  }
  const week = await run(undefined);
  assert.equal(week.result.report.transfers.length, 0);
  assert.equal(week.result.report.headline.usdc_out_atomic, '0');
  assert.equal(week.result.report.headline.label, EMPTY_HEADLINE);
  const srcRoot = join(here, '../src');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(srcRoot);
  const blob = files.map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.equal(blob.includes('AUDIT_DEV_14D'), false);
  assert.equal(readFileSync(join(here, '../src/pages/Audit.tsx'), 'utf8').includes('Use a Solana sample'), false);
});

test('X1 Token-2022 labeled spl-token contributes no rows', () => {
  const decoded = decodeSolanaUsdcTransfers(rawSpl(TOKEN_2022_PROGRAM_ID, 'transferChecked', {
    source: ATA,
    destination: A43,
    mint: SOLANA_USDC_MINT,
    authority: WALLET,
    tokenAmount: { amount: '2000', decimals: 6 },
  }, 'spl-token'), { mode: 'wallet', wallet: WALLET, tokenAccounts: new Set([ATA]), signature: sigOf(300) });
  assert.equal(decoded.rows.length, 0);
});

test('X2 meta.err drops a parsed transfer even when the signature list says success', async () => {
  const signature = sigOf(301);
  const disagreed = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 9, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({ err: true, amount: '2000', pre: '2000', post: '2000' })]]),
  });
  assert.equal(disagreed.result.report.transfers.length, 0);
  assert.equal(disagreed.result.report.headline.usdc_out_atomic, '0');
  const listed = sigOf(302);
  const hidden = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature: listed, slot: 9, blockTime: IN, failed: true }] : []),
    txs: new Map([[listed, outTx()]]),
  });
  assert.equal(hidden.result.report.transfers.length, 0);
  assert.equal(hidden.urls.some((url) => url.includes(`/tx?sig=${listed}`)), false);
});

test('X3 a null getTransaction withholds the total', async () => {
  const signature = sigOf(303);
  const { result } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 3, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, null]]),
  });
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.ok(result.report.coverage.failed_ranges.some((range) => range.error === 'tx_unavailable'));
});

test('X4 one receipt binds one of two amounts, and two equal amounts both mismatch', () => {
  const signature = sigOf(304);
  const small = {
    tx_hash: signature,
    log_index: '0',
    block_number: 1,
    block_time: new Date(IN * 1000).toISOString(),
    pay_to: SOLANA_CANARY_PAYEE,
    pay_to_token_account: SOLANA_CANARY_ACCOUNT,
    amount_atomic: '2000',
    settlement_method: 'spl_transfer_checked',
  };
  const large = { ...small, log_index: '1', amount_atomic: '5000000' };
  const body = {
    status: 'found',
    ...shell({
      receipt_id: 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a',
      chain: 'solana',
      payment_tx: signature,
      pay_to: SOLANA_CANARY_PAYEE,
      asset: SOLANA_USDC_MINT,
      amount_gross: '2000',
    }),
  };
  const one = buildSpendAuditReport({
    query: { kind: 'solana', address: WALLET },
    solana: { rows: [small, large], failedRanges: [], scanComplete: true, truncated: false, signaturesSeen: 1, signaturesRead: 1, tokenAccounts: [], windowSeconds: SOL_WINDOW_SECONDS },
    receipts: new Map([[signature, body]]),
  });
  assert.equal(one.transfers.find((row) => row.amount_atomic === '2000').receipt_status, 'receipted');
  assert.equal(one.transfers.find((row) => row.amount_atomic === '5000000').receipt_status, 'receipt_mismatch');
  assert.equal(one.receipt_match.receipted_atomic, '2000');
  const both = buildSpendAuditReport({
    query: { kind: 'solana', address: WALLET },
    solana: { rows: [small, { ...small, log_index: '1' }], failedRanges: [], scanComplete: true, truncated: false, signaturesSeen: 1, signaturesRead: 1, tokenAccounts: [], windowSeconds: SOL_WINDOW_SECONDS },
    receipts: new Map([[signature, body]]),
  });
  assert.equal(both.transfers.every((row) => row.receipt_status === 'receipt_mismatch'), true);
  assert.equal(both.receipt_match.receipted_atomic, '0');
});

test('X5 Base shells class as x402 when every field matches', () => {
  const liveTx = '0xf5656f683442c4f395fdede876e7fab24e715be7e08fd76014001e5d690d33f6';
  const specimen1 = '0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9';
  const specimen2 = '0x233acdcf3d78436d63a0dba00092fb9a8fe806a3ecd1b415a4d364144baffebd';
  function log(tx, to, amount) {
    return {
      address: BASE_USDC,
      blockNumber: '0x10',
      blockTimestamp: '0x66ff0000',
      logIndex: '0x1',
      transactionHash: tx,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        `0x${SAMPLE_BASE_ADDRESS.slice(2).padStart(64, '0')}`,
        `0x${to.slice(2).padStart(64, '0')}`,
      ],
      data: `0x${amount.toString(16).padStart(64, '0')}`,
    };
  }
  function one(tx, to, amount, body) {
    return buildSpendAuditReport({
      query: { kind: 'base', address: SAMPLE_BASE_ADDRESS },
      chain: { logs: [log(tx, to, amount)], failedRanges: [], scanComplete: true, fromBlock: 1, toBlock: 2 },
      receipts: new Map([[tx, { status: 'found', ...body }]]),
    });
  }
  const live = one(liveTx, CHIT_FEE_SINK, 2000n, shell({
    receipt_id: 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af',
    chain: 'base',
    payment_tx: liveTx,
    pay_to: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount_gross: '2000',
  }));
  assert.equal(live.transfers[0].spend_class, 'x402');
  assert.equal(live.transfers[0].receipt_status, 'receipted');
  assert.equal(live.transfers[0].verify_url, 'https://api.chit402.com/receipt/xfuel-39af100b-23dd-4d86-a16b-4556ca6796af');
  const first = one(specimen1, '0xd78060679aeb403bb5223dfe1ac609323ef1fbf6', 1000000n, shell({
    receipt_id: 'foreign-x402-muq262x0-1467b076fc62',
    chain: 'base',
    payment_tx: specimen1,
    pay_to: '0xd78060679aeb403bb5223dfe1ac609323ef1fbf6',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount_gross: '1000000',
  }));
  assert.equal(first.transfers[0].spend_class, 'x402');
  assert.equal(first.transfers[0].receipt_status, 'receipted');
  const second = one(specimen2, '0xa34520e2a4d3b529d92f9376d4689cd163e37825', 500000n, shell({
    receipt_id: 'foreign-x402-muq264r9-69896464bb19',
    chain: 'base',
    payment_tx: specimen2,
    pay_to: '0xa34520e2a4d3b529d92f9376d4689cd163e37825',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount_gross: '500000',
  }));
  assert.equal(second.transfers[0].spend_class, 'x402');
  assert.equal(second.transfers[0].receipt_status, 'receipted');
  const mismatch = one(liveTx, CHIT_FEE_SINK, 9n, shell({
    receipt_id: 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af',
    chain: 'base',
    payment_tx: liveTx,
    pay_to: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount_gross: '2000',
  }));
  assert.equal(mismatch.transfers[0].receipt_status, 'receipt_mismatch');
  assert.equal(mismatch.receipt_match.receipted_atomic, '0');
});

test('X6 a bad receipt id is unavailable and produces no javascript href', async () => {
  const badIds = ['javascript:alert(1)', '../x', 'a"b', 'x'.repeat(200), 'xfuel-éééééééé'];
  for (const receiptId of badIds) {
    const parsed = parseReceiptShell({
      schema: 'chit402.receipt_shell.v1',
      receipt_id: receiptId,
      chain: 'solana',
      payment_tx: SOLANA_CANARY_SIGNATURE,
      pay_to: SOLANA_CANARY_PAYEE,
      asset: SOLANA_USDC_MINT,
      amount_gross: '2000',
    });
    assert.equal(parsed.status, 'unavailable', receiptId);
    assert.equal(receiptPageHref(receiptId), null);
  }
  const signature = sigOf(306);
  const { result } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 2, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({ amount: '5', pre: '5', post: '0' })]]),
    gateway: () => jsonRes({
      schema: 'chit402.receipt_shell.v1',
      receipt_id: 'javascript:alert(1)',
      chain: 'solana',
      payment_tx: signature,
      pay_to: A43,
      asset: SOLANA_USDC_MINT,
      amount_gross: '5',
    }),
  });
  assert.equal(result.report.transfers[0].receipt_status, 'unavailable');
  assert.equal(result.report.transfers[0].verify_url, null);
  const html = result.report.transfers.map((row) => {
    const href = safeHttpsHref(row.verify_url);
    return href ? `<a href="${href}">Receipt</a>` : row.receipt_status;
  }).join('');
  assert.equal(html.includes('javascript:'), false);
  const page = readFileSync(join(here, '../src/pages/Audit.tsx'), 'utf8');
  assert.equal(page.includes('href={row.verify_url}'), false);
  assert.equal(page.includes('href={row.explorer_url}'), false);
  assert.match(page, /safeHref\(row\.verify_url\)/);
});

test('X16 a null blockTime withholds the total', async () => {
  const signature = sigOf(316);
  const { result } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 2, blockTime: null, failed: false }] : []),
  });
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.ok(result.report.coverage.failed_ranges.some((range) => range.error === 'tx_unavailable'));
});

test('X17 canary content that does not match withholds the total', async () => {
  const signature = sigOf(317);
  const { result } = await scan(WALLET, {
    canary: 'mismatch',
    sigsFor: (who) => (who === WALLET ? [
      { signature, slot: 9, blockTime: IN, failed: false },
      { signature: sigOf(318), slot: 1, blockTime: OLD, failed: false },
    ] : []),
    txs: new Map([[signature, outTx({ amount: '3', pre: '3', post: '0' })]]),
  });
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.ok(result.report.coverage.failed_ranges.some((range) => range.error === 'history_unproven'));
});

test('X19 Solana does not scan from the query string, and audit responses refuse frames', () => {
  assert.equal(shouldRunAuditFetch({ kind: 'solana', query: A44, armed: null }), false);
  assert.equal(shouldRunAuditFetch({ kind: 'solana', query: A44, armed: A44 }), true);
  assert.equal(shouldRunAuditFetch({ kind: 'base', query: SAMPLE_BASE_ADDRESS, armed: null }), true);
  const page = readFileSync(join(here, '../src/pages/Audit.tsx'), 'utf8');
  const effect = page.slice(page.indexOf('useEffect'), page.indexOf('const headlineAmount'));
  assert.ok(effect.indexOf('shouldRunAuditFetch') >= 0);
  assert.ok(effect.indexOf('shouldRunAuditFetch') < effect.indexOf('runPublicSpendAudit'));
  const vercel = readFileSync(join(repo, 'vercel.json'), 'utf8');
  const web = readFileSync(join(here, '../vercel.json'), 'utf8');
  for (const text of [vercel, web]) {
    assert.match(text, /X-Frame-Options/);
    assert.match(text, /frame-ancestors 'none'/);
  }
  assert.match(vercel, /\/api\/solana-audit/);
});

test('X20 a sponsored transferChecked without a receipt stays undetected', async () => {
  const signature = sigOf(320);
  const { result } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 8, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({
      feePayer: FEE_PAYER,
      authority: WALLET,
      amount: '2000',
      pre: '2000',
      post: '0',
    })]]),
  });
  const row = result.report.transfers[0];
  assert.equal(row.spend_class, 'undetected');
  assert.equal(row.settlement_method, 'spl_transfer_checked_sponsored');
  assert.equal(row.receipt_status, 'unreceipted');
  const packed = reportToJson(result.report) + reportToCsv(result.report);
  assert.equal(packed.includes(FEE_PAYER), false);
  assert.equal(packed.includes(SPONSORED_FEE_CAPTION), false);
  const page = readFileSync(join(here, '../src/pages/Audit.tsx'), 'utf8');
  assert.match(page, /spl_transfer_checked_sponsored/);
  assert.match(page, /SPONSORED_FEE_CAPTION/);
  assert.equal(SPONSORED_FEE_CAPTION, 'Network fee paid by another account');
  const html = `${row.spend_class} ${row.settlement_method === 'spl_transfer_checked_sponsored' ? SPONSORED_FEE_CAPTION : ''}`;
  assert.match(html, /Network fee paid by another account/);
  assert.equal(html.includes(FEE_PAYER), false);
});

test('X21 gateway URLs are only by-tx signature lookups', async () => {
  const signature = sigOf(321);
  const { urls } = await scan(WALLET, {
    sigsFor: (who) => (who === WALLET ? [{ signature, slot: 8, blockTime: IN, failed: false }] : []),
    txs: new Map([[signature, outTx({ amount: '4', pre: '4', post: '0' })]]),
    gateway: (url) => jsonRes(shell({
      receipt_id: 'chit-7c4a2c20-57b6-4009-9cef-061efff24c6a',
      chain: 'solana',
      payment_tx: signature,
      pay_to: A43,
      asset: 'USDC',
      amount_gross: '4',
    })),
  });
  const gateways = gatewayUrls(urls);
  assert.ok(gateways.length > 0);
  for (const url of gateways) {
    assert.match(url, /^https:\/\/api\.chit402\.com\/receipt\/by-tx\?tx=solana%3A[1-9A-HJ-NP-Za-km-z]{64,88}&format=json$/);
    assert.equal(url.includes(WALLET), false);
    assert.equal(url.includes('&chain='), false);
  }
});

test('X11 client HTML is a failed range', async () => {
  const { result } = await scan(WALLET, { proxyHtml: true });
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.ok(result.report.coverage.failed_ranges.some((range) => range.error === 'upstream_bad_response'));
});

test('X13 built JS and source maps do not contain the key, host, or env name', () => {
  const srcRoot = join(here, '../src');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(srcRoot);
  const blob = files.map((path) => readFileSync(path, 'utf8')).join('\n');
  for (const needle of ['helius-rpc.com', 'helius.xyz', 'HELIUS_API_KEY', 'SOLANA_AUDIT_RPC_URL', 'api-key', DUMMY_KEY, 'AUDIT_DEV_14D']) {
    assert.equal(blob.includes(needle), false, needle);
  }
  const outDir = join('/tmp', 'solana-audit-bundle');
  const build = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: join(here, '..'),
    env: { ...process.env, HELIUS_API_KEY: DUMMY_KEY },
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const check = spawnSync('node', [join(repo, 'scripts/check-solana-audit-bundle.mjs')], {
    cwd: repo,
    env: { ...process.env, HELIUS_API_KEY: DUMMY_KEY, SOLANA_AUDIT_DIST: outDir },
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test('classifySpend falls through to EIP-3009 when the shell is not a match', () => {
  assert.equal(classifySpend({
    receipt: null,
    txInput: `${EIP3009_TRANSFER_WITH_AUTHORIZATION}${'ab'.repeat(4)}`,
  }), 'x402');
  assert.equal(classifySpend({ receipt: { matched: true, rail: 'nano' }, txInput: null }), 'other');
});

test('lookupReceipt follows only a safe shell redirect', async () => {
  const calls = [];
  const body = shell({
    receipt_id: 'foreign-x402-muq262x0-1467b076fc62',
    chain: 'base',
    payment_tx: '0xabc',
    pay_to: '0xabc',
    asset: BASE_USDC,
    amount_gross: '1',
  });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (String(url).includes('/by-tx')) {
      return {
        ok: false,
        status: 302,
        headers: {
          get: (name) => (String(name).toLowerCase() === 'location'
            ? 'https://evil.example/receipt/xfuel-39af100b-23dd-4d86-a16b-4556ca6796af?format=json'
            : null),
        },
        json: async () => body,
      };
    }
    return jsonRes(body);
  };
  const refused = await lookupReceipt('https://api.chit402.com', '0x' + 'ab'.repeat(32), fetchImpl, undefined, 'base');
  assert.equal(refused.status, 'unavailable');
  assert.equal(calls.length, 1);
});

// Part B (pr528-partB-0949b27e) B1: browsers hide manual redirects.
test('B1 lookupReceipt follows by-tx in browser semantics and checks where it landed', async () => {
  const { lookupReceipt } = await import('../src/lib/spendAuditFetch.mjs');
  const id = 'xfuel-7c4a2c20-57b6-4009-9cef-061efff24c6a';
  const sig = '2WaXaTT2LkpMAuryrGqPYsK48V8RDcbnt1ksGMsfwj8Pxpx2G1Z52PEZgjTHZK4YZDdTcv36P2o9toSVVke4iWBy';
  const shell = {
    schema: 'chit402.receipt_shell.v1', receipt_id: id, chain: 'solana', payment_tx: sig,
    pay_to: 'ALLdmmAsbUnhHS7x2556449syP5Wz73Gng4gzzLHqsC7', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount_gross: '2000',
  };
  const seen = [];
  const followed = (landed) => async (url, init) => {
    seen.push(init?.redirect);
    if (init?.redirect === 'manual') return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), json: async () => ({}) };
    return { type: 'cors', status: 200, ok: true, redirected: true, url: landed, headers: new Headers({ 'content-type': 'application/json' }), json: async () => shell };
  };
  const good = await lookupReceipt('https://api.chit402.com', sig, followed(`https://api.chit402.com/receipt/${id}?format=json`), undefined, 'solana');
  assert.equal(good.status, 'found');
  assert.equal(good.receipt_id, id);
  assert.deepEqual([...new Set(seen)], ['follow']);
  for (const landed of [`https://evil.example/receipt/${id}?format=json`, `https://api.chit402.com/receipt/${id}`, `https://api.chit402.com/receipt/javascript:alert(1)?format=json`]) {
    const bad = await lookupReceipt('https://api.chit402.com', sig, followed(landed), undefined, 'solana');
    assert.equal(bad.status, 'unavailable', landed);
  }
  const opaque = await lookupReceipt('https://api.chit402.com', sig, async () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() }), undefined, 'solana');
  assert.equal(opaque.status, 'unavailable');
});

test('B2 the SPA catch-all rewrite excludes /api so dynamic functions are reachable', () => {
  for (const file of [join(repo, 'vercel.json'), join(here, '../vercel.json')]) {
    const rewrites = JSON.parse(readFileSync(file, 'utf8')).rewrites || [];
    const spa = rewrites.filter((r) => r.destination === '/index.html');
    assert.equal(spa.length, 1, file);
    const re = new RegExp(`^${spa[0].source}$`);
    assert.equal(re.test('/api/solana-audit/head'), false, file);
    assert.equal(re.test('/api/nope'), false, file);
    assert.equal(re.test('/api'), false, file);
    assert.equal(re.test('/audit/anything'), true, file);
    assert.equal(re.test('/apiary'), true, file);
  }
});
