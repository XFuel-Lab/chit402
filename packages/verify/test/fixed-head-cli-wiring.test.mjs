/**
 * fixed_head_invalid wiring through checkReceiptInput, on the full (holder
 * receipt) path and the public-attestation path. Throwaway P-256 key, an
 * in-process loopback log and JSON-RPC. No production host is fetched.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { tempDir } from './tmp-dirs.mjs';

const { PINNED_BASE_ANCHOR_WALLET } = await import('../dist/anchor-trust.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { jcsCanonicalize } = await import('../dist/jcs.js');
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');
const { checkReceiptInput, freshPublicLog } = await import('../dist/check-input.js');
const { humanVerdictLines } = await import('../dist/verdict.js');
const E = await import('../dist/eip712.js');
const { EPOCH1_FINAL_ROOT, EPOCH1_FINAL_SIZE, EPOCH1_GENESIS_DIGEST, EPOCH2_OPENING_ROOT } = await import('../dist/epoch.js');
const { TEST_SNAPSHOT } = await import('../dist/internal/test-seam.js');

// Anything off loopback is refused and recorded: this file never reaches a real host.
const offHost = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const host = new URL(String(url)).hostname;
  if (host !== '127.0.0.1') {
    offHost.push(String(url));
    throw new TypeError('off-loopback fetch refused in test');
  }
  return realFetch(input, init);
};

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const PAYER = '0x1111111111111111111111111111111111111111';
const PAY_TX = `0x${'cd'.repeat(32)}`;
const ANCHOR_TX = `0x${'ab'.repeat(32)}`;
const PUBLISHED_AT = '2026-10-17T18:31:00.000Z';
const ROW = 'row-hash-fixed-head-wiring';
// Holder receipt (full path) and public attestation share one log.
const HOLDER_TASK = 'xfuel-1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PUBLIC_TASK = 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
// Signed by the test key but not in the log: the absence path.
const ABSENT_TASK = 'xfuel-9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const sha = (buf) => createHash('sha256').update(buf).digest();
const leafOf = (text) => sha(Buffer.concat([Buffer.from([0]), Buffer.from(text)]));
const node = (l, r) => sha(Buffer.concat([Buffer.from([1]), l, r]));
const topic = (addr) => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
const clone = (v) => JSON.parse(JSON.stringify(v));

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(j);
  return { privateKey, kid, publicJwk: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, kid, alg: 'ES256', use: 'sig' } };
}

function signCompact(key, header, payloadText) {
  const input = `${b64(header)}.${b64(payloadText)}`;
  const s = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${s.toString('base64url')}`;
}

function historyDoc(key) {
  const body = {
    kid: key.kid, jwk: key.publicJwk, alg: 'ES256', not_before: '2020-01-01T00:00:00.000Z', not_after: null,
    status: 'active', revoked_at: null, reason: null, custody: 'test custody', prev_hash: null,
  };
  const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
  const claims = {
    schema: 'chit402.issuer_history.v1', payload_version: 1, entry_count: 1,
    head_hash: entry.entry_hash, version: 1, seq: 1,
  };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid: key.kid };
  return {
    schema: 'chit402.issuer_history.v1', payload_version: 1, version: 1, seq: 1, entries: [entry], head_hash: entry.entry_hash,
    issuer_signature: {
      alg: 'ES256', typ: 'chit402-issuer-history+jwt', payload_version: 1,
      jws: signCompact(key, header, JSON.stringify(claims)), kid: key.kid, issuer_jwk: key.publicJwk,
    },
  };
}

/** A gateway-shaped EIP-712 fixed head over the JWS head claims. */
function fixedHeadFor(claims, key) {
  const message = E.treeHeadMessageFromClaims(claims, key.kid);
  const { preimage } = E.typedDigest('TreeHead', message, E.EXPECTED_LOG_SALT);
  const raw = sign('sha256', preimage, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    schema: E.FIXED_HEAD_SCHEMA,
    digest_alg: E.EIP712_DIGEST_ALG,
    domain: { name: E.TREE_HEAD_DOMAIN_NAME, version: '1', chainId: E.EIP712_CHAIN_ID, salt: E.EXPECTED_LOG_SALT },
    types: E.TREE_HEAD_TYPE,
    message,
    r: `0x${raw.subarray(0, 32).toString('hex')}`,
    s: `0x${raw.subarray(32).toString('hex')}`,
  };
}

const key = issuerKey();
const history = historyDoc(key);
const historyBytes = JSON.stringify(history);

// Two-leaf tree: the holder receipt's leaf and the public attestation's leaf.
const holderLeaf = leafOf(`${HOLDER_TASK}|${ROW}`);
const publicLeaf = leafOf(`${PUBLIC_TASK}|${ROW}`);
const root = node(holderLeaf, publicLeaf).toString('hex');
const headClaims = {
  schema: 'chit402.tree_head.v1',
  payload_version: 1,
  root,
  tree_size: 2,
  epoch: 2,
  prev_epoch_root: EPOCH1_FINAL_ROOT,
  prev_epoch_size: EPOCH1_FINAL_SIZE,
  published_at: PUBLISHED_AT,
  anchors: {
    base: { status: 'anchored', tx: ANCHOR_TX, calldata: `0x${root}`, chain_id: 8453, from: PINNED_BASE_ANCHOR_WALLET },
    solana: { status: 'pending' },
  },
};
const headSig = { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: key.kid };
const signedHead = {
  ...headClaims,
  issuer_signature: { ...headSig, jws: signCompact(key, headSig, JSON.stringify(headClaims)), issuer_jwk: key.publicJwk },
};
const goodFixed = fixedHeadFor(headClaims, key);
// A head with an epoch needs the signed epoch record. Shaped like production.
const epochClaims = {
  schema: 'chit402.tree_epoch.v1',
  epochs: [
    {
      epoch: 1, status: 'closed', final_root: EPOCH1_FINAL_ROOT, final_size: EPOCH1_FINAL_SIZE,
      genesis_digest: EPOCH1_GENESIS_DIGEST, prev_epoch_root: null, prev_epoch_size: 0,
    },
    {
      epoch: 2, status: 'open', opening_root: EPOCH2_OPENING_ROOT, opening_size: 1,
      genesis_digest: '847edd6698d938721c0c59466a601d65cb82c1fdc0abd80104e1132f0cbaa576',
      prev_epoch_root: EPOCH1_FINAL_ROOT, prev_epoch_size: EPOCH1_FINAL_SIZE,
    },
  ],
  orphans: [
    { root: '20d887917a4c32a49434e4b8f8db864cbf26a8e3a0daa6f5f89ab097282413f9' },
    { root: null, root_prefix: 'd7f6c548', unrecoverable: true },
    { root: EPOCH2_OPENING_ROOT },
  ],
};
const epochSig = { alg: 'ES256', typ: 'chit402-tree-epoch+jwt', kid: key.kid };
const epochRecord = {
  ...epochClaims,
  issuer_signature: { jws: signCompact(key, epochSig, JSON.stringify(epochClaims)), kid: key.kid, issuer_jwk: key.publicJwk },
};
const inclusions = {
  [HOLDER_TASK]: { task_id: HOLDER_TASK, epoch: 2, leaf_index: 0, tree_size: 2, root, leaf: holderLeaf.toString('hex'), proof: [{ hash: publicLeaf.toString('hex'), position: 'right' }] },
  [PUBLIC_TASK]: { task_id: PUBLIC_TASK, epoch: 2, leaf_index: 1, tree_size: 2, root, leaf: publicLeaf.toString('hex'), proof: [{ hash: holderLeaf.toString('hex'), position: 'left' }] },
};

const world = { fixedHead: undefined, gets: [], posts: 0 };
let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST') {
      world.posts += 1;
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const hash = msg.params?.[0];
        let result = null;
        if (msg.method === 'eth_chainId') result = '0x2105';
        else if (msg.method === 'eth_blockNumber') result = '0x80';
        else if (msg.method === 'eth_getTransactionByHash' && hash === ANCHOR_TX) {
          result = { hash: ANCHOR_TX, input: `0x${root}`, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase(), blockNumber: '0x64', chainId: '0x2105' };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === ANCHOR_TX) {
          result = { transactionHash: ANCHOR_TX, status: '0x1', blockNumber: '0x64', from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === PAY_TX) {
          result = {
            transactionHash: PAY_TX, status: '0x1', blockNumber: '0x64',
            logs: [{ address: USDC, topics: [TRANSFER, topic(PAYER), topic(PAYEE)], data: `0x${(2000).toString(16).padStart(64, '0')}` }],
          };
        }
        send(200, { jsonrpc: '2.0', id: msg.id, result });
      });
      return;
    }
    world.gets.push(req.url);
    const inclusion = /^\/v1\/receipts\/([^/]+)\/inclusion/.exec(req.url);
    if (inclusion && inclusions[decodeURIComponent(inclusion[1])]) return send(200, inclusions[decodeURIComponent(inclusion[1])]);
    if (inclusion && decodeURIComponent(inclusion[1]) === ABSENT_TASK) return send(404, { error: 'not_in_tree' });
    if (req.url.startsWith('/v1/receipts/tree/epoch')) return send(200, epochRecord);
    if (req.url.startsWith('/v1/receipts/tree/head')) {
      return send(200, world.fixedHead === undefined ? signedHead : { ...signedHead, fixed_head: world.fixedHead });
    }
    if (req.url.startsWith(`/receipt/${PUBLIC_TASK}`)) return send(200, world.shell);
    return send(404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.BASE_RPC_URL = `${origin}/rpc`;
  process.env.SOLANA_RPC_URL = `${origin}/rpc`;
});
after(() => server?.close());

function holderReceipt(task = HOLDER_TASK) {
  const claims = {
    task_id: task,
    payload_version: 6,
    iat: '2026-10-17T18:29:00.000Z',
    payment: {
      rail: 'usdc', ref: `base:${PAY_TX}`, asset: USDC, payee: PAYEE,
      gross_amount: '2000', settled_amount: '2000',
    },
    caller_binding: { payer_wallet: PAYER },
  };
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid: key.kid };
  return {
    ...claims,
    // Unsigned, as on issued receipts: the log leaf binds it.
    book_chain: { row_hash: ROW },
    verify_url: `${origin}/receipt/${task}`,
    issuer_signature: { alg: 'ES256', jws: signCompact(key, header, JSON.stringify(claims)), kid: key.kid, issuer_jwk: key.publicJwk },
  };
}

function publicShell() {
  const claims = {
    attested_at: '2026-10-17T18:30:00.000Z',
    iss: 'chit402',
    issued_at: '2026-10-17T18:29:00.000Z',
    log: { epoch: 2, leaf_hash: publicLeaf.toString('hex'), leaf_index: 1 },
    payment: {
      asset: USDC, gross_amount: '2000', payee: PAYEE, rail: 'usdc',
      ref: `base:${PAY_TX}`, settled_amount: '2000',
    },
    task_id: PUBLIC_TASK,
  };
  const header = { alg: 'ES256', typ: 'chit402-public-receipt+jwt', kid: key.kid };
  const jws = signCompact(key, header, `chit402.public_receipt.v1\n${jcsCanonicalize(claims)}`);
  return {
    schema: 'chit402.receipt_shell.v1',
    unsigned: true,
    receipt_id: PUBLIC_TASK,
    task_id: PUBLIC_TASK,
    payload_version: 11,
    asset: USDC,
    chain: 'base',
    pay_to: PAYEE,
    amount_gross: '2000',
    amount_settled: '2000',
    payment_tx: PAY_TX,
    issued_at: '2026-10-17T18:29:00.000Z',
    inclusion: { leaf_hash: publicLeaf.toString('hex'), proof: inclusions[PUBLIC_TASK].proof, signed_head: { root, tree_size: 2, signature: null } },
    public_attestation: { jws },
  };
}

function opts() {
  return {
    // The test key's history replaces the bundled one for this call only.
    [TEST_SNAPSHOT]: { issuerHistory: { document: history, bytes: historyBytes } },
    trustedKids: [key.kid],
    rpcUrl: `${origin}/rpc`,
    solanaRpcUrl: `${origin}/rpc`,
  };
}

async function runFull(fixedHead) {
  world.fixedHead = fixedHead;
  const dir = tempDir('chit-fixed-wiring-');
  const file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify(holderReceipt()));
  return (await checkReceiptInput(file, opts())).verdict;
}

async function runPublic(fixedHead) {
  world.fixedHead = fixedHead;
  world.shell = publicShell();
  // Loaded from the loopback host, so the fresh log is read there too.
  return (await checkReceiptInput(`${origin}/receipt/${PUBLIC_TASK}`, opts())).verdict;
}

const forged = () => {
  const x = clone(goodFixed);
  x.s = goodFixed.r;
  return x;
};
const stale = () => fixedHeadFor({ ...headClaims, tree_size: 1 }, key);

test('control: the fixed head signs the JWS head claims', () => {
  assert.deepEqual(E.verifyFixedHeadEip712(goodFixed, { claims: headClaims, kid: key.kid, jwk: key.publicJwk }), { ok: true });
  assert.equal(E.verifyFixedHeadEip712(forged(), { claims: headClaims, kid: key.kid, jwk: key.publicJwk }).ok, false);
  assert.equal(E.verifyFixedHeadEip712(stale(), { claims: headClaims, kid: key.kid, jwk: key.publicJwk }).ok, false);
});

test('full path: no fixed head and a matching one keep the verdict; the log proof passed', async () => {
  const plain = await runFull(undefined);
  assert.equal(plain.checks.log_inclusion, 'pass', JSON.stringify(plain));
  assert.equal(plain.checks.anchor, 'pass', JSON.stringify(plain));
  assert.equal(plain.exit_code, 0, JSON.stringify(plain));
  assert.equal(plain.result, 'verified');
  assert.equal(plain.log?.fixed_head, undefined);
  const good = await runFull(goodFixed);
  assert.equal(good.exit_code, plain.exit_code, JSON.stringify(good));
  assert.equal(good.reason, plain.reason);
  assert.equal(good.log?.fixed_head, 'verified');
  assert.ok(humanVerdictLines(good).some((line) => /Fixed head \(EIP-712\): matches/.test(line)));
});

for (const [label, make] of [['forged', forged], ['stale', stale], ['wrong shape', () => ({})]]) {
  test(`full path: a ${label} fixed head is INVALID fixed_head_invalid, exit 1`, async () => {
    const v = await runFull(make());
    assert.equal(v.exit_code, 1, JSON.stringify(v));
    assert.equal(v.result, 'invalid');
    assert.equal(v.reason, 'fixed_head_invalid');
    assert.notEqual(v.log?.fixed_head, 'verified');
  });
}

test('public path: no fixed head and a matching one are VERIFIED_PUBLIC, exit 0', async () => {
  const plain = await runPublic(undefined);
  assert.equal(plain.exit_code, 0, JSON.stringify(plain));
  assert.equal(plain.result, 'verified_public');
  assert.equal(plain.log?.fixed_head, undefined);
  const good = await runPublic(goodFixed);
  assert.equal(good.exit_code, 0, JSON.stringify(good));
  assert.equal(good.result, 'verified_public');
  assert.equal(good.log?.fixed_head, 'verified');
});

for (const [label, make] of [['forged', forged], ['stale', stale], ['wrong shape', () => ({})]]) {
  test(`public path: a ${label} fixed head is INVALID fixed_head_invalid, exit 1`, async () => {
    const v = await runPublic(make());
    assert.equal(v.exit_code, 1, JSON.stringify(v));
    assert.equal(v.result, 'invalid');
    assert.equal(v.reason, 'fixed_head_invalid');
    assert.equal(v.checks.log_inclusion, 'fail');
    assert.notEqual(v.result, 'verified_public');
  });
}

test('absence: the signed head and its fixed head are judged under the caller pins (N4)', async () => {
  const receipt = { verify_url: `${origin}/receipt/${ABSENT_TASK}`, task_id: ABSENT_TASK };
  world.fixedHead = goodFixed;
  // Caller pins trust the test key: a good head proves absence.
  const pinned = await freshPublicLog(receipt, history, { trustedKids: [key.kid] });
  assert.equal(pinned.logReason, 'not_in_log', JSON.stringify(pinned));
  assert.equal(pinned.anchor, 'pass');
  // Undefined is the production default, which does not trust the test key.
  const prod = await freshPublicLog(receipt, history, {});
  assert.notEqual(prod.logReason, 'not_in_log', JSON.stringify(prod));
  assert.equal(prod.logInclusion, 'fail');
  // [] trusts nothing.
  const none = await freshPublicLog(receipt, history, { trustedKids: [] });
  assert.notEqual(none.logReason, 'not_in_log', JSON.stringify(none));
  assert.equal(none.logInclusion, 'fail');
  // A bad fixed head under the caller pins is fixed_head_invalid.
  world.fixedHead = forged();
  const bad = await freshPublicLog(receipt, history, { trustedKids: [key.kid] });
  assert.equal(bad.logReason, 'fixed_head_invalid', JSON.stringify(bad));
  world.fixedHead = undefined;
});

test('full path absence: a receipt not in the log is NOT_IN_LOG under the caller pins', async () => {
  const dir = tempDir('chit-fixed-absent-');
  const file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify(holderReceipt(ABSENT_TASK)));
  for (const fixed of [undefined, goodFixed]) {
    world.fixedHead = fixed;
    const v = (await checkReceiptInput(file, opts())).verdict;
    assert.equal(v.reason, 'not_in_log', JSON.stringify(v));
    assert.equal(v.exit_code, 1);
  }
  world.fixedHead = stale();
  const bad = (await checkReceiptInput(file, opts())).verdict;
  assert.equal(bad.reason, 'fixed_head_invalid', JSON.stringify(bad));
  assert.equal(bad.exit_code, 1);
  world.fixedHead = undefined;
});

test('only the loopback log and RPC were read', () => {
  assert.ok(world.gets.length > 0);
  assert.ok(world.posts > 0);
  assert.deepEqual(offHost, []);
});
