/**
 * 0.4.10 anchor lookup resilience. One confirmed chain is enough when the
 * other chain's RPC lookup failed. A mismatch on either chain is still exit 1.
 * Nothing confirmed is still exit 2. Throwaway keys, injected fetchers, and
 * loopback servers only. No production host, no POST outside loopback.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  verifyAnchoredRoot,
  runAnchorSide,
  anchorRpcUrls,
  isRpcLookupFailure,
  fetchBaseAnchorTransaction,
  BASE_ANCHOR_RPC_FALLBACKS,
  SOLANA_ANCHOR_RPC_FALLBACKS,
  SOLANA_GENESIS,
} = await import('../dist/anchor-witness.js');
const { PINNED_BASE_ANCHOR_WALLET, PINNED_SOLANA_ANCHOR_FEE_PAYER } = await import('../dist/anchor-trust.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { jcsCanonicalize } = await import('../dist/jcs.js');
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');
const { verifyPublicShell } = await import('../dist/check-input.js');

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const sha = (buf) => createHash('sha256').update(buf).digest();
const leafOf = (body) => sha(Buffer.concat([Buffer.from([0]), Buffer.from(body)]));
const nodeOf = (l, r) => sha(Buffer.concat([Buffer.from([1]), l, r]));

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(j);
  return { privateKey, kid, publicJwk: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, kid, alg: 'ES256', use: 'sig' } };
}
function signRaw(key, header, payloadText) {
  const input = `${b64(header)}.${b64(payloadText)}`;
  const s = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${s.toString('base64url')}`;
}
function sealHead(head, key) {
  const claims = JSON.parse(JSON.stringify(head));
  const header = { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: key.kid };
  return {
    ...claims,
    issuer_signature: { alg: 'ES256', typ: 'chit402-tree-head+jwt', jws: signRaw(key, header, JSON.stringify(claims)), kid: key.kid, issuer_jwk: key.publicJwk },
  };
}

const key = issuerKey();
const TASK = 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ROW = 'row-hash-0410';
const leaf = leafOf(`${TASK}|${ROW}`);
const sibling = leafOf('genesis');
const root = nodeOf(sibling, leaf).toString('hex');
const memo = `chit402:root:v1:global:2026-10-20:${root}:${'0'.repeat(64)}`;
const ANCHOR_TX = `0x${'ab'.repeat(32)}`;
const SIG = 'sig0410';
const head = sealHead({
  schema: 'chit402.tree_head.v1',
  payload_version: 1,
  root,
  tree_size: 2,
  anchors: {
    base: { status: 'anchored', tx: ANCHOR_TX, calldata: `0x${root}`, chain_id: 8453, from: PINNED_BASE_ANCHOR_WALLET },
    solana: { status: 'anchored', signature: SIG, slot: 99, cluster: 'devnet', memo, fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER },
  },
}, key);
const inclusion = {
  task_id: TASK, epoch: 1, leaf_index: 1, tree_size: 2, root,
  leaf: leaf.toString('hex'),
  proof: [{ hash: sibling.toString('hex'), position: 'left' }],
};
function solanaTx(memoText = memo) {
  return {
    slot: 99,
    confirmationStatus: 'finalized',
    meta: { err: null },
    transaction: {
      signatures: [SIG],
      message: {
        accountKeys: [{ pubkey: PINNED_SOLANA_ANCHOR_FEE_PAYER, signer: true, writable: true }],
        instructions: [{ program: 'spl-memo', programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: memoText }],
      },
    },
  };
}
function baseTx(input = `0x${root}`) {
  return { hash: ANCHOR_TX, input, chainId: 8453, from: PINNED_BASE_ANCHOR_WALLET, status: '0x1', blockNumber: '0x64', tipBlockNumber: '0x70' };
}
const noSleep = { backoffMs: 0 };

function anchored(over = {}) {
  return verifyAnchoredRoot({
    receipt: { task_id: TASK, row_hash: ROW },
    inclusion,
    head,
    trustedKids: [key.kid],
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
    fetchSolanaTx: async () => solanaTx(),
    fetchBaseTx: async () => baseTx(),
    rpcRetry: noSleep,
    ...over,
  });
}

// ---- library level ----

test('FLAP: Solana RPC errors on every attempt while Base confirms is verified with a warning', async () => {
  let calls = 0;
  const r = await anchored({
    solanaRpcUrls: ['http://127.0.0.1:1/a', 'http://127.0.0.1:1/b'],
    fetchSolanaTx: async () => { calls += 1; throw new Error('rpc_http_429'); },
  });
  assert.equal(r.overall, 'verified');
  assert.equal(r.base.valid, true);
  assert.equal(r.solana.valid, false);
  assert.equal(r.solana.reason, 'solana_rpc_error');
  assert.deepEqual(r.anchor_warnings, ['solana:solana_rpc_error']);
  assert.equal(calls, 4, 'two attempts on each of two endpoints, then stop');
  // Proves only what Base showed.
  assert.ok(r.proves.every((line) => !/Solana transaction memo/.test(line)));
});

test('both chains erroring stays could_not_check with no warning', async () => {
  const r = await anchored({
    fetchSolanaTx: async () => { throw new Error('rpc_http_503'); },
    fetchBaseTx: async () => { throw new Error('socket hang up'); },
  });
  assert.equal(r.overall, 'could_not_check');
  assert.equal(r.anchor_warnings, undefined);
  assert.equal(r.solana.reason, 'solana_rpc_error');
  assert.equal(r.base.reason, 'base_rpc_error');
});

test('Solana erroring once then answering on retry verifies both chains, no warning', async () => {
  let calls = 0;
  const slept = [];
  const r = await anchored({
    solanaRpcUrls: ['http://127.0.0.1:1/only'],
    fetchSolanaTx: async () => { calls += 1; if (calls === 1) throw new Error('rpc_http_429'); return solanaTx(); },
    rpcRetry: { backoffMs: 400, sleep: async (ms) => { slept.push(ms); } },
  });
  assert.equal(r.overall, 'verified');
  assert.equal(r.solana.valid, true);
  assert.equal(r.solana.attempts, 2);
  assert.deepEqual(slept, [400]);
  assert.equal(r.anchor_warnings, undefined);
});

test('the fallback endpoint is used when the first one keeps failing', async () => {
  const seen = [];
  const r = await anchored({
    solanaRpcUrls: ['http://127.0.0.1:1/primary', 'http://127.0.0.1:1/fallback'],
    fetchSolanaTx: async (_sig, url) => { seen.push(url); if (url.endsWith('/primary')) throw new Error('rpc_timeout'); return solanaTx(); },
    fetchGenesis: async (url) => { assert.ok(url.endsWith('/fallback'), 'genesis comes from the endpoint that served the tx'); return SOLANA_GENESIS.devnet; },
  });
  assert.equal(r.overall, 'verified');
  assert.deepEqual(seen, ['http://127.0.0.1:1/primary', 'http://127.0.0.1:1/primary', 'http://127.0.0.1:1/fallback']);
  assert.equal(r.solana.rpc, 'http://127.0.0.1:1/fallback');
  assert.equal(r.solana.valid, true);
});

test('Base fallback endpoint is used too', async () => {
  const seen = [];
  const r = await anchored({
    baseRpcUrls: ['http://127.0.0.1:1/b1', 'http://127.0.0.1:1/b2'],
    fetchBaseTx: async (_tx, url) => { seen.push(url); if (url.endsWith('/b1')) throw new Error('base_rpc_null'); return baseTx(); },
  });
  assert.equal(r.overall, 'verified');
  assert.equal(r.base.rpc, 'http://127.0.0.1:1/b2');
  assert.equal(seen.length, 3);
});

test('a Solana memo mismatch is failed even when Base confirms, and is not retried', async () => {
  let calls = 0;
  const r = await anchored({ fetchSolanaTx: async () => { calls += 1; return solanaTx(memo.replace(root, 'f'.repeat(64))); } });
  assert.equal(r.overall, 'failed');
  assert.equal(r.solana.reason, 'memo_mismatch');
  assert.equal(calls, 1);
});

test('a Base calldata mismatch is failed even when Solana confirms', async () => {
  const r = await anchored({ fetchBaseTx: async () => baseTx(`0x${'f'.repeat(64)}`) });
  assert.equal(r.overall, 'failed');
  assert.equal(r.base.reason, 'calldata_mismatch');
});

test('a mismatch on one chain with an RPC error on the other is failed, not could_not_check', async () => {
  const r = await anchored({
    fetchSolanaTx: async () => { throw new Error('rpc_http_429'); },
    fetchBaseTx: async () => baseTx(`0x${'f'.repeat(64)}`),
  });
  assert.equal(r.overall, 'failed');
});

test('a non-RPC unchecked reason (not finalized) is not covered by the other chain', async () => {
  const r = await anchored({ fetchSolanaTx: async () => ({ ...solanaTx(), confirmationStatus: 'confirmed' }) });
  assert.equal(r.overall, 'could_not_check');
  assert.equal(r.solana.reason, 'not_finalized');
});

test('retries are bounded by attempts and by the time budget', async () => {
  let clock = 0;
  let runs = 0;
  const out = await runAnchorSide('solana', ['u1', 'u2', 'u3'], {
    backoffMs: 1000, budgetMs: 2500, now: () => clock, sleep: async (ms) => { clock += ms; },
  }, async () => { runs += 1; clock += 1000; return 'solana_rpc_timeout'; });
  assert.equal(out.reason, 'solana_rpc_timeout');
  assert.equal(runs, 2, 'no new attempt starts once the budget is spent');
  let total = 0;
  const capped = await runAnchorSide('base', ['a', 'b', 'c', 'd', 'e', 'f'], { backoffMs: 0 }, async () => { total += 1; return 'base_rpc_error'; });
  assert.equal(capped.attempts, 8, 'four endpoints, two attempts each');
  assert.equal(total, 8);
});

test('RPC lists: env replaces the public list; defaults are public https endpoints', () => {
  assert.deepEqual(anchorRpcUrls('solana', { SOLANA_RPC_URL: 'http://127.0.0.1:9/' }), ['http://127.0.0.1:9/']);
  assert.deepEqual(anchorRpcUrls('base', {}), [...BASE_ANCHOR_RPC_FALLBACKS]);
  assert.deepEqual(anchorRpcUrls('solana', {}), [...SOLANA_ANCHOR_RPC_FALLBACKS]);
  assert.equal(SOLANA_ANCHOR_RPC_FALLBACKS[0], 'https://api.mainnet-beta.solana.com');
  assert.equal(BASE_ANCHOR_RPC_FALLBACKS[0], 'https://mainnet.base.org');
  for (const u of [...BASE_ANCHOR_RPC_FALLBACKS, ...SOLANA_ANCHOR_RPC_FALLBACKS]) assert.match(u, /^https:\/\//);
  assert.equal(isRpcLookupFailure('solana_rpc_error'), true);
  assert.equal(isRpcLookupFailure('memo_mismatch'), false);
  assert.equal(isRpcLookupFailure('tx_not_found'), false);
});

test('a hung loopback Base RPC is a bounded timeout, then covered by Solana', async () => {
  const hang = http.createServer(() => {});
  await new Promise((resolve) => hang.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${hang.address().port}`;
  try {
    const started = Date.now();
    const r = await anchored({ baseRpcUrls: [url], fetchBaseTx: (tx, u) => fetchBaseAnchorTransaction(tx, u, 50) });
    assert.equal(r.overall, 'verified');
    assert.deepEqual(r.anchor_warnings, ['base:base_rpc_timeout']);
    assert.ok(Date.now() - started < 5000);
  } finally {
    hang.closeAllConnections?.();
    await new Promise((resolve) => hang.close(resolve));
  }
});

// ---- end to end: public shell, local log, separate Base and Solana RPCs ----

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const PAYER = '0x1111111111111111111111111111111111111111';
const PAY_TX = `0x${'cd'.repeat(32)}`;
const topic = (addr) => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
const amountHex = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;

function historyDoc() {
  const body = {
    kid: key.kid, jwk: key.publicJwk, alg: 'ES256', not_before: '2020-01-01T00:00:00.000Z', not_after: null,
    status: 'active', revoked_at: null, reason: null, custody: 'test custody', prev_hash: null,
  };
  const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
  const claims = { schema: 'chit402.issuer_history.v1', payload_version: 1, entry_count: 1, head_hash: entry.entry_hash, version: 1, seq: 1 };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid: key.kid };
  return {
    schema: 'chit402.issuer_history.v1', payload_version: 1, version: 1, seq: 1, entries: [entry], head_hash: entry.entry_hash,
    issuer_signature: { alg: 'ES256', typ: 'chit402-issuer-history+jwt', payload_version: 1, jws: signRaw(key, header, JSON.stringify(claims)), kid: key.kid, issuer_jwk: key.publicJwk },
  };
}
const claims = {
  attested_at: '2026-10-17T18:30:00.000Z', iss: 'chit402', issued_at: '2026-10-17T18:29:00.000Z',
  log: { epoch: 1, leaf_hash: leaf.toString('hex'), leaf_index: 1 },
  payment: { asset: USDC, gross_amount: '2000', payee: PAYEE, rail: 'usdc', ref: `base:${PAY_TX}`, settled_amount: '2000' },
  task_id: TASK,
};
const attestation = signRaw(key, { alg: 'ES256', typ: 'chit402-public-receipt+jwt', kid: key.kid }, `chit402.public_receipt.v1\n${jcsCanonicalize(claims)}`);
const shell = {
  schema: 'chit402.receipt_shell.v1', unsigned: true, receipt_id: TASK, task_id: TASK, payload_version: 11,
  asset: USDC, chain: 'base', pay_to: PAYEE, amount_gross: '2000', amount_settled: '2000', payment_tx: PAY_TX,
  issued_at: '2026-10-17T18:29:00.000Z',
  inclusion: { leaf_hash: leaf.toString('hex'), proof: inclusion.proof, signed_head: { root, tree_size: 2, signature: null } },
  public_attestation: { jws: attestation },
};

const world = {};
function reset() {
  world.solanaMode = 'ok'; // ok | error | flaky | mismatch
  world.solanaCalls = 0;
  world.baseMode = 'ok'; // ok | error | mismatch
}
reset();

let server;
let origin;
let savedEnv;
before(async () => {
  savedEnv = { b: process.env.BASE_RPC_URL, s: process.env.SOLANA_RPC_URL, k: process.env.CHIT402_RPC_BACKOFF_MS };
  server = http.createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (req.url === '/solana') {
          world.solanaCalls += 1;
          if (world.solanaMode === 'error') return send(429, { error: 'rate limited' });
          if (world.solanaMode === 'flaky' && world.solanaCalls === 1) return send(429, { error: 'rate limited' });
          if (msg.method === 'getGenesisHash') return send(200, { jsonrpc: '2.0', id: msg.id, result: SOLANA_GENESIS.devnet });
          if (msg.method === 'getTransaction') {
            const tx = world.solanaMode === 'mismatch' ? solanaTx(memo.replace(root, 'e'.repeat(64))) : solanaTx();
            return send(200, { jsonrpc: '2.0', id: msg.id, result: tx });
          }
          return send(200, { jsonrpc: '2.0', id: msg.id, result: null });
        }
        const hash = msg.params?.[0];
        let result = null;
        if (hash === ANCHOR_TX || msg.method === 'eth_chainId' || msg.method === 'eth_blockNumber') {
          if (world.baseMode === 'error') return send(503, { error: 'down' });
        }
        if (msg.method === 'eth_chainId') result = '0x2105';
        else if (msg.method === 'eth_blockNumber') result = '0x80';
        else if (msg.method === 'eth_getTransactionByHash' && hash === ANCHOR_TX) {
          const input = world.baseMode === 'mismatch' ? `0x${'e'.repeat(64)}` : `0x${root}`;
          result = { hash: ANCHOR_TX, input, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase(), blockNumber: '0x64', chainId: '0x2105' };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === ANCHOR_TX) {
          result = { transactionHash: ANCHOR_TX, status: '0x1', blockNumber: '0x64', from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === PAY_TX) {
          result = { transactionHash: PAY_TX, status: '0x1', blockNumber: '0x64', logs: [{ address: USDC, topics: [TRANSFER, topic(PAYER), topic(PAYEE)], data: amountHex(2000) }] };
        }
        send(200, { jsonrpc: '2.0', id: msg.id, result });
      });
      return;
    }
    if (req.url.startsWith(`/v1/receipts/${TASK}/inclusion`)) return send(200, inclusion);
    if (req.url.startsWith('/v1/receipts/tree/head')) return send(200, head);
    return send(404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.BASE_RPC_URL = `${origin}/base`;
  process.env.SOLANA_RPC_URL = `${origin}/solana`;
  process.env.CHIT402_RPC_BACKOFF_MS = '0';
});
after(() => {
  server?.close();
  for (const [k, v] of [['BASE_RPC_URL', savedEnv.b], ['SOLANA_RPC_URL', savedEnv.s], ['CHIT402_RPC_BACKOFF_MS', savedEnv.k]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function verifyShell() {
  return verifyPublicShell(structuredClone(shell), {
    history: historyDoc(), historySource: 'file', requestedId: TASK, origin, publicInput: false,
    rpcUrl: `${origin}/base`, trustedKids: [key.kid],
  });
}

test('E2E baseline: both anchors answer, VERIFIED_PUBLIC exit 0, no warnings', async () => {
  reset();
  const v = await verifyShell();
  assert.equal(v.exit_code, 0, `${v.result} ${v.reason}`);
  assert.equal(v.result, 'verified_public');
  assert.equal(v.log.warnings, undefined);
});

test('E2E FLAP: Solana RPC 429 on every call while Base confirms is exit 0 with a JSON warning (0.4.9 gave exit 2 solana_rpc_error)', async () => {
  reset();
  world.solanaMode = 'error';
  const v = await verifyShell();
  assert.equal(v.exit_code, 0, `${v.result} ${v.reason}`);
  assert.equal(v.result, 'verified_public');
  assert.equal(v.checks.anchor, 'pass');
  assert.deepEqual(v.log.warnings, ['solana:solana_rpc_error']);
  assert.equal(world.solanaCalls, 2, 'one endpoint from env, two bounded attempts');
});

test('E2E: Solana 429 once, then answers on retry, exit 0 and no warning', async () => {
  reset();
  world.solanaMode = 'flaky';
  const v = await verifyShell();
  assert.equal(v.exit_code, 0, `${v.result} ${v.reason}`);
  assert.equal(v.log.warnings, undefined);
});

test('E2E: both chains down is exit 2 COULD_NOT_CHECK', async () => {
  reset();
  world.solanaMode = 'error';
  world.baseMode = 'error';
  const v = await verifyShell();
  assert.equal(v.exit_code, 2, `${v.result} ${v.reason}`);
  assert.equal(v.result, 'could_not_check');
});

test('E2E: Solana memo mismatch with Base confirmed is exit 1', async () => {
  reset();
  world.solanaMode = 'mismatch';
  const v = await verifyShell();
  assert.equal(v.exit_code, 1, `${v.result} ${v.reason}`);
});

test('E2E: Base calldata mismatch with Solana confirmed is exit 1', async () => {
  reset();
  world.baseMode = 'mismatch';
  const v = await verifyShell();
  assert.equal(v.exit_code, 1, `${v.result} ${v.reason}`);
});
