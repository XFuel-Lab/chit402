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
await import('./dist-built.mjs'); // N-F1 (646): build once in npm test, not per file.

const {
  verifyAnchoredRoot,
  fetchSolanaAnchorTransaction,
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
const { humanVerdictLines } = await import('../dist/verdict.js');

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
const SIG = '3C9CBiYwx5zN2w3HierQ6vVhMWNonZi4N1brzq183wxDZGjBMTArGNAvvh3DJoLqQc4LU7e54eQdBFCQKT9VLssE';
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


// ---- PR review regressions (H1, H2, M1, L1, L2) ----

function headWith(anchors) {
  return sealHead({ schema: 'chit402.tree_head.v1', payload_version: 1, root, tree_size: 2, anchors }, key);
}
const baseAnchor = { status: 'anchored', tx: ANCHOR_TX, calldata: `0x${root}`, chain_id: 8453, from: PINNED_BASE_ANCHOR_WALLET };
const solanaAnchor = { status: 'anchored', signature: SIG, slot: 99, cluster: 'devnet', memo, fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER };
const invalidParams = () => Object.assign(new Error('rpc_error: Invalid params'), { rpcCode: -32602 });

/** Loopback JSON-RPC. `handler(msg)` returns { status, body } or a result value. */
async function rpcServer(handler) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let msg = {};
      try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* raw */ }
      seen.push(msg.method);
      const out = handler(msg, req);
      if (out && out.raw !== undefined) {
        res.writeHead(out.httpStatus || 200, { 'content-type': out.type || 'application/json', ...(out.headers || {}) });
        return res.end(out.raw);
      }
      if (out && out.httpStatus) {
        res.writeHead(out.httpStatus, { 'content-type': 'application/json', ...(out.headers || {}) });
        return res.end(JSON.stringify(out.body ?? {}));
      }
      if (out && out.rpcError) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: out.rpcError }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: out === undefined ? null : out }));
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

function baseRpcFor({ input = `0x${root}`, status = '0x1', chainId = '0x2105', tip = '0x80', override = {} } = {}) {
  return (msg) => {
    if (override[msg.method]) return override[msg.method](msg);
    if (msg.method === 'eth_getTransactionByHash') return { hash: ANCHOR_TX, input, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase(), blockNumber: '0x64', chainId: '0x2105' };
    if (msg.method === 'eth_getTransactionReceipt') return { transactionHash: ANCHOR_TX, status, blockNumber: '0x64', from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
    if (msg.method === 'eth_chainId') return chainId;
    if (msg.method === 'eth_blockNumber') return tip;
    return null;
  };
}
function solanaRpcFor({ tx = solanaTx(), override = {} } = {}) {
  return (msg) => {
    if (override[msg.method]) return override[msg.method](msg);
    if (msg.method === 'getTransaction') return tx;
    if (msg.method === 'getGenesisHash') return SOLANA_GENESIS.devnet;
    return null;
  };
}

/** Real fetchers against loopback servers; no injected hooks. */
async function live({ base, solana, head: h = head } = {}) {
  const b = await rpcServer(base || baseRpcFor());
  const s = await rpcServer(solana || solanaRpcFor());
  try {
    return await verifyAnchoredRoot({
      receipt: { task_id: TASK, row_hash: ROW }, inclusion, head: h, trustedKids: [key.kid],
      baseRpcUrls: [b.url], solanaRpcUrls: [s.url], rpcRetry: noSleep,
    });
  } finally { await b.close(); await s.close(); }
}

test('H1 a malformed Solana signature in the signed head is a bad anchor, not covered by Base', async () => {
  let called = 0;
  const r = await anchored({
    head: headWith({ base: baseAnchor, solana: { ...solanaAnchor, signature: 'not-a-signature' } }),
    fetchSolanaTx: async () => { called += 1; throw invalidParams(); },
  });
  assert.notEqual(r.overall, 'verified');
  assert.equal(r.overall, 'failed');
  assert.equal(r.solana.reason, 'anchor_ref_invalid');
  assert.equal(called, 0, 'no RPC call for a malformed reference');
  assert.equal(r.anchor_warnings, undefined);
});

test('H1 a malformed Base tx hash in the signed head is a bad anchor, not covered by Solana', async () => {
  const r = await anchored({
    head: headWith({ base: { ...baseAnchor, tx: '0x1234' }, solana: solanaAnchor }),
    fetchBaseTx: async () => { throw invalidParams(); },
  });
  assert.equal(r.overall, 'failed');
  assert.equal(r.base.reason, 'anchor_ref_invalid');
});

test('H1/MED a -32602 on a well-formed ref is that endpoint rejecting: not covered, and not anchor_ref_invalid', async () => {
  const sol = await live({ solana: solanaRpcFor({ override: { getTransaction: () => ({ rpcError: { code: -32602, message: 'Invalid param: Invalid' } }) } }) });
  assert.notEqual(sol.overall, 'verified');
  assert.equal(sol.solana.reason, 'solana_rpc_rejected');
  assert.equal(sol.anchor_warnings, undefined);
  const refuse = () => ({ rpcError: { code: -32602, message: 'Archive requests require a personal token' } });
  const bas = await live({ base: baseRpcFor({ override: { eth_getTransactionByHash: refuse, eth_getTransactionReceipt: refuse } }) });
  assert.notEqual(bas.overall, 'verified');
  assert.equal(bas.base.reason, 'base_rpc_rejected');
});

test('MED a -32602 from endpoint 1 on a well-formed ref falls back to endpoint 2', async () => {
  const refuse = () => ({ rpcError: { code: -32602, message: 'Archive requests require a personal token' } });
  const b1 = await rpcServer(baseRpcFor({ override: { eth_getTransactionByHash: refuse, eth_getTransactionReceipt: refuse } }));
  const b2 = await rpcServer(baseRpcFor());
  const s1 = await rpcServer(solanaRpcFor({ override: { getTransaction: () => ({ rpcError: { code: -32602, message: 'Invalid params' } }) } }));
  const s2 = await rpcServer(solanaRpcFor());
  try {
    const r = await verifyAnchoredRoot({
      receipt: { task_id: TASK, row_hash: ROW }, inclusion, head, trustedKids: [key.kid],
      baseRpcUrls: [b1.url, b2.url], solanaRpcUrls: [s1.url, s2.url], rpcRetry: noSleep,
    });
    assert.equal(r.overall, 'verified');
    assert.equal(r.base.rpc, b2.url);
    assert.equal(r.solana.rpc, s2.url);
    assert.equal(r.base.attempts, 2, 'a rejecting endpoint is not retried');
    assert.equal(r.anchor_warnings, undefined);
  } finally { await b1.close(); await b2.close(); await s1.close(); await s2.close(); }
});

test('MED a rejection stays the result when a later endpoint only fails at transport', async () => {
  const out = await runAnchorSide('solana', ['a', 'b'], { backoffMs: 0 }, async (u) => (u === 'a' ? 'solana_rpc_rejected' : 'solana_rpc_error'));
  assert.equal(out.reason, 'solana_rpc_rejected');
});

test('HIGH a body that stalls after the headers is a timeout at the real budget, not a 300 s hang', { timeout: 40_000 }, async () => {
  const srv = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"jsonrpc":"2.0","res'); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    await assert.rejects(
      () => fetchSolanaAnchorTransaction(SIG, `http://127.0.0.1:${srv.address().port}`, 12_000),
      (err) => err instanceof Error && err.message === 'solana_rpc_timeout',
    );
    const took = Date.now() - started;
    assert.ok(took >= 11_500 && took < 16_000, `took ${took} ms`);
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});

test('H2 Base calldata mismatch stays failed when eth_blockNumber is null or 429', async () => {
  const nullTip = await live({ base: baseRpcFor({ input: `0x${'e'.repeat(64)}`, tip: null }) });
  assert.equal(nullTip.overall, 'failed');
  assert.equal(nullTip.base.reason, 'calldata_mismatch');
  const limited = await live({ base: baseRpcFor({ input: `0x${'e'.repeat(64)}`, override: { eth_blockNumber: () => ({ httpStatus: 429, body: { error: 'rate limited' } }) } }) });
  assert.equal(limited.overall, 'failed');
  assert.equal(limited.base.reason, 'calldata_mismatch');
});

test('H2 a reverted Base anchor stays failed when eth_chainId errors', async () => {
  const r = await live({ base: baseRpcFor({ status: '0x0', override: { eth_chainId: () => ({ rpcError: { code: -32000, message: 'boom' } }) } }) });
  assert.equal(r.overall, 'failed');
  assert.equal(r.base.reason, 'tx_reverted');
});

test('H2 Solana fee payer or slot mismatch stays failed when getGenesisHash errors', async () => {
  const otherPayer = solanaTx();
  otherPayer.transaction.message.accountKeys = [{ pubkey: '11111111111111111111111111111111', signer: true, writable: true }];
  const payer = await live({ solana: solanaRpcFor({ tx: otherPayer, override: { getGenesisHash: () => ({ rpcError: { code: -32000, message: 'boom' } }) } }) });
  assert.equal(payer.overall, 'failed');
  assert.equal(payer.solana.reason, 'fee_payer_mismatch');
  const slot = await live({ solana: solanaRpcFor({ tx: { ...solanaTx(), slot: 100 }, override: { getGenesisHash: () => ({ httpStatus: 429, body: {} }) } }) });
  assert.equal(slot.overall, 'failed');
  assert.equal(slot.solana.reason, 'slot_mismatch');
});

test('M1 a body that is not a JSON-RPC answer is not an RPC failure the other chain can cover', async () => {
  const cases = [
    ['truncated JSON', () => ({ raw: '{"jsonrpc":"2.0","res' })],
    ['HTML body', () => ({ raw: '<html>hi</html>', type: 'text/html' })],
    ['string result', () => 'not a transaction'],
    ['JSON-RPC error', () => ({ rpcError: { code: -32005, message: 'node is behind' } })],
  ];
  for (const [label, getTransaction] of cases) {
    const r = await live({ solana: solanaRpcFor({ override: { getTransaction } }) });
    assert.notEqual(r.overall, 'verified', label);
    assert.equal(r.anchor_warnings, undefined, label);
    assert.equal(r.solana.reason, 'solana_rpc_rejected', label);
  }
});

test('M1 a code exception on a malformed tx shape is not covered by Base', async () => {
  const bad = solanaTx(memo.replace(root, 'e'.repeat(64)));
  bad.transaction.message.instructions = 7;
  bad.meta.innerInstructions = 7;
  const r = await live({ solana: solanaRpcFor({ tx: bad }) });
  assert.notEqual(r.overall, 'verified');
  assert.equal(r.anchor_warnings, undefined);
});

test('M1 a malformed Solana RPC URL is not covered by Base', async () => {
  const r = await anchored({ solanaRpcUrls: ['http://[::1'], fetchSolanaTx: undefined, fetchGenesis: undefined });
  assert.notEqual(r.overall, 'verified');
  assert.equal(r.solana.reason, 'solana_rpc_rejected');
});

test('M1 transport failures stay coverable: HTTP 429/503, connection refused, timeout', async () => {
  for (const status of [429, 503]) {
    const r = await live({ solana: solanaRpcFor({ override: { getTransaction: () => ({ httpStatus: status, body: {} }) } }) });
    assert.equal(r.overall, 'verified', String(status));
    assert.deepEqual(r.anchor_warnings, ['solana:solana_rpc_error']);
  }
  const refused = await anchored({ solanaRpcUrls: ['http://127.0.0.1:9/'], fetchSolanaTx: undefined, fetchGenesis: undefined });
  assert.equal(refused.overall, 'verified');
  assert.deepEqual(refused.anchor_warnings, ['solana:solana_rpc_error']);
});

test('L1 a redirect is not followed and is not covered', async () => {
  const target = await rpcServer(solanaRpcFor());
  const redirector = await rpcServer(() => ({ httpStatus: 307, headers: { location: target.url }, body: {} }));
  try {
    const r = await anchored({ solanaRpcUrls: [redirector.url], fetchSolanaTx: undefined, fetchGenesis: undefined });
    assert.equal(target.seen.length, 0, 'the POST was not replayed');
    assert.equal(r.solana.valid, false);
    assert.notEqual(r.overall, 'verified');
  } finally { await target.close(); await redirector.close(); }
});

test('L2 backoff is capped', async () => {
  const slept = [];
  await runAnchorSide('solana', ['u1'], { attemptsPerUrl: 3, backoffMs: 600000, sleep: async (ms) => { slept.push(ms); } }, async () => 'solana_rpc_error');
  assert.ok(slept.length === 2 && slept.every((ms) => ms <= 5000), JSON.stringify(slept));
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
  world.head = null;
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
    if (req.url.startsWith('/v1/receipts/tree/head')) return send(200, world.head || head);
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

test('M2 a Solana lookup that did not answer is printed and marked partial', async () => {
  reset();
  world.solanaMode = 'error';
  const v = await verifyShell();
  assert.equal(v.exit_code, 0);
  assert.equal(v.log.partial, true);
  assert.deepEqual(v.log.unchecked_anchors, ['solana']);
  const lines = humanVerdictLines(v);
  assert.ok(lines.some((l) => /^Solana not checked\b/.test(l) && /Base only/.test(l)), lines.join('\n'));
  assert.equal(lines.some((l) => /invalid/i.test(l)), false);
  reset();
  const full = await verifyShell();
  assert.equal(full.log.partial, undefined);
  assert.equal(humanVerdictLines(full).some((l) => /not checked/.test(l)), false);
});

test('MED a malformed anchor ref in the signed head is exit 1 anchor_ref_invalid end to end', async () => {
  for (const anchors of [
    { base: baseAnchor, solana: { ...solanaAnchor, signature: 'not-a-signature' } },
    { base: { ...baseAnchor, tx: '0x1234' }, solana: solanaAnchor },
  ]) {
    reset();
    world.head = headWith(anchors);
    const v = await verifyShell();
    assert.equal(v.exit_code, 1, `${v.result} ${v.reason}`);
    assert.equal(v.reason, 'anchor_ref_invalid');
  }
  reset();
});
