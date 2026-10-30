/**
 * v13 path. Exact type, bundled pins, the four checks, and the refusal cases
 * from the P0-7 brief. The corpus gate is not edited. The flip list is empty.
 */
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReceiptInput } from '../dist/check-input.js';
import { verifyIssuerHistoryDocument } from '../dist/issuer-history.js';
import { jwkThumbprint } from '../dist/jws.js';
import { TEST_SNAPSHOT } from '../dist/internal/test-seam.js';
import {
  ANCHORED_SIGNATURE,
  ANCHORED_TOPIC0,
  CORPUS_FLIP_LIST,
  MAX_TREE_SIZE,
  UNAUDITED_NOTE,
  runV13,
  topicUint,
  treeSizeFromHead,
  trustedSender,
  isExactV13Receipt,
} from '../dist/v13/core/decide.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = new URL('../../cs2-core/', import.meta.url);
const { leafHash, nodeHash } = await import(new URL('merkle/index.js', CORE));
const { encodeLine, commitments, slotKey, stateLeaf } = await import(new URL('line/index.mjs', CORE));
const { keccak256 } = await import(new URL('ecdsa/keccak.js', CORE));
const { P256 } = await import(new URL('ecdsa/curves.js', CORE));
const { signRawDigest } = await import(new URL('ecdsa/sign.js', CORE));
const { bytesToBig } = await import(new URL('ecdsa/bytes.js', CORE));
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');

const HOUR = 1_699_999_200;
const CONTRACT = `0x${'11'.repeat(20)}`;
const CHECKPOINT = `0x${'22'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const ROTATION_TOPIC0 = '0x95d3ad0e28a557ff091289f350472166359808c1308277737cd6cc7cacc4e8b3';
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const CODE = '0x6001';

function hexOf(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig' };
  const kid = jwkThumbprint(jwk);
  jwk.kid = kid;
  return { privateKey, publicJwk: jwk, kid };
}

function historyEntry(key, prev, extra = {}) {
  const body = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: '2020-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'test custody',
    prev_hash: prev,
    ...extra,
  };
  return { ...body, entry_hash: issuerHistoryEntryHash(body) };
}

function signDoc(key, entries, payloadExtra = {}) {
  const head = entries[entries.length - 1].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: entries.length,
    head_hash: head,
    version: entries.length,
    seq: entries.length,
    narrowing: [],
    ...payloadExtra,
  };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid: key.kid };
  const input = `${b64(header)}.${b64(claims)}`;
  const signature = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: entries.length,
    seq: entries.length,
    narrowing: [],
    entries,
    head_hash: head,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-issuer-history+jwt',
      payload_version: 1,
      jws: `${input}.${signature.toString('base64url')}`,
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

function pinOf(extra = {}) {
  return {
    chainId: 84532,
    address: CONTRACT,
    codeHash: `0x${hexOf(keccak256(Buffer.from('6001', 'hex')))}`,
    predecessor: `0x${'00'.repeat(20)}`,
    checkpoint: CHECKPOINT,
    genesisHourStart: HOUR,
    retireHourStart: null,
    ...extra,
  };
}

function bundleFor(key, pins = [pinOf()], extraEntries = []) {
  const first = historyEntry(key, null);
  const entries = [first, ...extraEntries];
  return signDoc(key, entries, { contracts: pins, narrowing: [] });
}

const SAMPLE_CONTENT = {
  uuid: '66'.repeat(16),
  sellerIdHash: '77'.repeat(32),
  sellerKeyId: '88'.repeat(32),
  requestMethod: 2,
  uriDigest: '99'.repeat(32),
  uriPrefix: 'https://example.test/v1',
  contentDigest: 'aa'.repeat(32),
  responseDigest: 'bb'.repeat(32),
  saltC: 'cc'.repeat(32),
};

function paymentParts(over = {}) {
  return {
    chainId: 84532,
    blockHash: 'ab'.repeat(32),
    blockNumber: 100,
    blockTime: 1_700_000_000,
    txIndex: 0,
    localLogIndex: 1,
    txHash: 'cd'.repeat(32),
    token: USDC.slice(2),
    from: '33'.repeat(20),
    to: '11'.repeat(20),
    value: '1000000',
    method: 1,
    authorizer: '3a'.repeat(20),
    nonce: '44'.repeat(32),
    saltP: '55'.repeat(32),
    ...over,
  };
}

function buildLine(payment = paymentParts(), sigmaHex = `${'00'.repeat(31)}01${'00'.repeat(31)}01`) {
  const encoded = encodeLine({
    payment,
    content: SAMPLE_CONTENT,
    sigma: { alg: 1, sigma: sigmaHex },
  });
  if (!encoded.ok) throw new Error(encoded.reason);
  return encoded.line;
}

function sellerMaterial(line) {
  const opened = commitments(line);
  if (!opened.ok) throw new Error(opened.reason);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const secret = privateKey.export({ format: 'jwk' });
  const d = bytesToBig(Buffer.from(secret.d, 'base64url'));
  let signed = null;
  for (let k = 3n; signed == null && k < 40n; k += 2n) {
    try {
      signed = signRawDigest(opened.sigmaDigest, d, k, P256);
    } catch {
      signed = null;
    }
  }
  if (!signed) throw new Error('sigma');
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const compressed = Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), x]);
  return { sigmaHex: Buffer.from(signed.raw).toString('hex'), compressed };
}

function receiptOf(line, extra = {}) {
  const leaf = leafHash(line);
  const pay = paymentParts();
  return {
    v: 13,
    schema: 'chit402.cs2.receipt.v1',
    line: hexOf(line),
    index: 0,
    epoch: 1,
    contract: CONTRACT,
    proof: [],
    ...extra,
    leafHex: hexOf(leaf.hash),
    payment: pay,
  };
}

function listen(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      seen.push(body);
      const result = handler(body.method, body.params, seen);
      res.setHeader('content-type', 'application/json');
      if (result && result.error) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: result.error } }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: result ?? null }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function anchoredLog({ epoch = 1, hour = HOUR, size = 1, root, stateRoot, kind = 0, block = 105, tx = `0x${'ee'.repeat(32)}` }) {
  return {
    address: CONTRACT,
    topics: [ANCHORED_TOPIC0, topicUint(BigInt(epoch)), topicUint(BigInt(hour))],
    data: `0x${word(size)}${root}${stateRoot}${word(kind)}`,
    blockNumber: `0x${block.toString(16)}`,
    blockHash: `0x${'ef'.repeat(32)}`,
    transactionHash: tx,
    logIndex: '0x0',
  };
}

function chainHandler(scene) {
  const payHash = `0x${scene.payment.blockHash}`;
  const txHash = `0x${scene.payment.txHash}`;
  const anchorTx = scene.anchorTx ?? `0x${'ee'.repeat(32)}`;
  return (method, params) => {
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      return { number: '0x6e', hash: `0x${'ab'.repeat(32)}` };
    }
    if (method === 'eth_getLogs') {
      const topics = params[0]?.topics ?? [];
      if (topics[0] === ANCHORED_TOPIC0 && topics[1] === topicUint(BigInt(scene.epoch ?? 1))) {
        return scene.logs ?? [];
      }
      return [];
    }
    if (method === 'eth_getTransactionReceipt' && params[0] === anchorTx) {
      return {
        from: scene.anchorFrom ?? CHECKPOINT,
        to: CONTRACT,
        blockNumber: '0x69',
        blockHash: `0x${'ef'.repeat(32)}`,
        transactionIndex: '0x0',
        logs: [],
      };
    }
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_call') return { error: 'execution reverted' };
    if (method === 'eth_getBlockByHash' && params[0].toLowerCase() === payHash) {
      if (scene.unknownBlock) return null;
      return {
        number: '0x64',
        hash: scene.reorg ? `0x${'12'.repeat(32)}` : payHash,
        transactions: [txHash],
      };
    }
    if (method === 'eth_getBlockByNumber' && params[0] === '0x64') {
      return { number: '0x64', hash: scene.reorg ? `0x${'99'.repeat(32)}` : payHash };
    }
    if (method === 'eth_getTransactionReceipt' && params[0].toLowerCase() === txHash) {
      return {
        blockHash: scene.wrongBlock ? `0x${'77'.repeat(32)}` : payHash,
        from: `0x${scene.payment.from}`,
        to: USDC,
        logs: [
          {
            logIndex: '0x0',
            address: USDC,
            topics: [
              '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5',
              `0x${'0'.repeat(24)}${scene.payment.authorizer}`,
              `0x${scene.payment.nonce}`,
            ],
            data: '0x',
          },
          {
            logIndex: '0x1',
            address: USDC,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x${'0'.repeat(24)}${scene.payment.from}`,
              `0x${'0'.repeat(24)}${scene.payment.to}`,
            ],
            data: `0x${word(scene.payment.value)}`,
          },
        ],
      };
    }
    if (method === 'eth_getTransactionByHash') {
      return { to: USDC, input: '0x' };
    }
    return null;
  };
}

async function withChain(scene, run) {
  const server = await listen(chainHandler(scene));
  try {
    return await run(server);
  } finally {
    await server.close();
  }
}

function optionsFor(key, doc, url, file) {
  return {
    publicInput: true,
    trustedKids: [key.kid],
    rpcUrl: url,
    issuerHistoryBytes: file ?? null,
    [TEST_SNAPSHOT]: { issuerHistory: { document: doc, bytes: JSON.stringify(doc) } },
  };
}

function signedLine(over = {}) {
  const draft = buildLine(paymentParts(over));
  const seller = sellerMaterial(draft);
  const line = buildLine(paymentParts(over), seller.sigmaHex);
  const leaf = leafHash(line);
  const opened = commitments(line);
  const key = slotKey({ kind: 1, chainId: 84532, id: paymentParts(over).to });
  const leafState = stateLeaf(key.bytes, new Uint8Array(seller.compressed));
  return {
    line,
    leaf: hexOf(leaf.hash),
    stateRoot: hexOf(leafState.bytes),
    slotValue: hexOf(seller.compressed),
    payment: paymentParts(over),
    sigmaDigest: opened.sigmaDigest,
  };
}

function v13Receipt(built, extra = {}) {
  return {
    v: 13,
    schema: 'chit402.cs2.receipt.v1',
    line: hexOf(built.line),
    index: 0,
    epoch: extra.epoch ?? 1,
    contract: extra.contract ?? CONTRACT,
    proof: extra.proof ?? [],
    slotValue: built.slotValue,
    ...extra.fields,
  };
}

test('the topic0 vector is only the event signature and the topic0', () => {
  const vector = JSON.parse(readFileSync(join(HERE, '../src/v13/vectors/anchored-topic0.json'), 'utf8'));
  assert.deepEqual(Object.keys(vector).sort(), ['event', 'signature', 'topic0']);
  assert.equal(vector.signature, ANCHORED_SIGNATURE);
  assert.equal(vector.topic0, ANCHORED_TOPIC0);
  const hash = keccak256(Buffer.from(vector.signature, 'utf8'));
  assert.equal(`0x${hexOf(hash)}`, vector.topic0);
  const source = readFileSync(join(HERE, '../src/v13/core/decide.ts'), 'utf8');
  assert.equal(source.includes("from 'node:"), false);
  assert.equal(source.includes('node:crypto'), false);
});

test('exact type does not sniff a legacy payload_version 13', () => {
  assert.equal(CORPUS_FLIP_LIST.length, 0);
  assert.equal(isExactV13Receipt({ payload_version: 13, schema: 'chit402.cs2.receipt.v1' }), false);
  assert.equal(isExactV13Receipt({ v: '13', schema: 'chit402.cs2.receipt.v1' }), false);
  assert.equal(isExactV13Receipt({ v: 13, schema: 'chit402.cs2.receipt.v1', issuer_signature: { jws: 'a.b.c' } }), false);
  assert.equal(isExactV13Receipt({ v: 13, payload_version: 13, schema: 'chit402.cs2.receipt.v1' }), false);
  assert.equal(isExactV13Receipt({ v: 13.5, schema: 'chit402.cs2.receipt.v1' }), false);
});

test('a sibling contracts list does not break the key-chain reader', () => {
  const key = makeKey();
  const doc = bundleFor(key);
  const checked = verifyIssuerHistoryDocument(doc, { trustedKids: [key.kid] });
  assert.equal(checked.valid, true, checked.reason);
  assert.equal(doc.entries[0].status, 'active');
  assert.equal(Object.hasOwn(doc, 'contracts'), false);
  const payload = JSON.parse(Buffer.from(doc.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.contracts[0].address, CONTRACT);
});

test('tree size 2^53 is refused and 2^53-1 is handled', () => {
  assert.deepEqual(treeSizeFromHead(BigInt(MAX_TREE_SIZE) + 1n), { ok: false, reason: 'tree_size_above_cap' });
  assert.deepEqual(treeSizeFromHead(BigInt(MAX_TREE_SIZE)), { ok: true, size: MAX_TREE_SIZE });
});

test('a rotation address is not a trusted sender', () => {
  assert.equal(trustedSender({ checkpoint: CHECKPOINT }, OTHER), CHECKPOINT);
  assert.equal(trustedSender({ checkpoint: CHECKPOINT }, null), CHECKPOINT);
});

test('a hourly receipt verifies and --json names the unaudited anchor', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0 });
  const verdict = await withChain({ payment: built.payment, logs: [log] }, async (server) => {
    const out = await checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url));
    assert.equal(server.seen.some((call) => JSON.stringify(call.params ?? []).includes(ROTATION_TOPIC0)), false);
    return out;
  });
  assert.equal(verdict.verdict.exit_code, 0, JSON.stringify(verdict.verdict));
  assert.equal(verdict.verdict.notes[0], UNAUDITED_NOTE);
  assert.ok(verdict.verdict.prints.includes('payment: chain-proven'));
  assert.equal(verdict.verdict.result, 'verified');
});

test('caller leaf and caller tree size are refused', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const interior = nodeHash(new Uint8Array(32), new Uint8Array(32));
  const base = v13Receipt(built);
  const leafReceipt = { ...base, leafHash: hexOf(interior.hash) };
  const sizeReceipt = { ...base, treeSize: 2 };
  const leafOut = await checkReceiptInput(JSON.stringify(leafReceipt), optionsFor(key, doc, 'http://127.0.0.1:9'));
  const sizeOut = await checkReceiptInput(JSON.stringify(sizeReceipt), optionsFor(key, doc, 'http://127.0.0.1:9'));
  assert.equal(leafOut.verdict.exit_code, 1);
  assert.equal(leafOut.verdict.reason, 'caller_supplied_leaf');
  assert.equal(sizeOut.verdict.exit_code, 1);
  assert.equal(sizeOut.verdict.reason, 'caller_supplied_tree_size');
  assert.equal(leafOut.verdict.notes[0], UNAUDITED_NOTE);
});

test('pre-anchor is exit 2 and a missing leaf is NOT_IN_LOG', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const missing = await withChain({ payment: built.payment, logs: [] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url))
  ));
  assert.equal(missing.verdict.exit_code, 2);
  assert.equal(missing.verdict.reason, 'pre_anchor');
  const log = anchoredLog({ root: 'ab'.repeat(32), stateRoot: built.stateRoot, kind: 0 });
  const absent = await withChain({ payment: built.payment, logs: [log] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url))
  ));
  assert.equal(absent.verdict.exit_code, 1);
  assert.equal(absent.verdict.reason, 'not_in_log');
});

test('anchor sender mismatch, wrong block hash, reorg, and unknown block', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0 });
  const cases = [
    [{ anchorFrom: OTHER }, 1, 'anchor_sender_mismatch'],
    [{ wrongBlock: true }, 1, 'wrong_block_hash'],
    [{ reorg: true }, 1, 'reorged'],
    [{ unknownBlock: true }, 2, 'unknown_block'],
  ];
  for (const [scene, exit, reason] of cases) {
    const out = await withChain({ payment: built.payment, logs: [log], ...scene }, (server) => (
      checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url))
    ));
    assert.equal(out.verdict.exit_code, exit, reason);
    assert.equal(out.verdict.reason, reason);
  }
});

test('an unpinned contract is exit 2 and a tampered snapshot is exit 1', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const unpinned = await checkReceiptInput(
    JSON.stringify(v13Receipt(built, { contract: OTHER })),
    optionsFor(key, doc, 'http://127.0.0.1:9'),
  );
  assert.equal(unpinned.verdict.exit_code, 2);
  assert.equal(unpinned.verdict.reason, 'contract_not_pinned');
  const tampered = structuredClone(doc);
  const jws = tampered.issuer_signature.jws;
  tampered.issuer_signature.jws = `${jws.slice(0, -1)}${jws.endsWith('a') ? 'b' : 'a'}`;
  const bad = await checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, tampered, 'http://127.0.0.1:9'));
  assert.equal(bad.verdict.exit_code, 1);
  assert.equal(bad.verdict.reason, 'snapshot_signature_invalid');
});

test('a receipt hour outside coverage is exit 1', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, hour: HOUR - 3600 });
  const out = await withChain({ payment: built.payment, logs: [log] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url))
  ));
  assert.equal(out.verdict.exit_code, 1);
  assert.equal(out.verdict.reason, 'hour_outside_coverage');
});

test('fast carried root proves or stays pending, and a hourly root can be unproven', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const proven = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 1 });
  const pending = anchoredLog({ root: built.leaf, stateRoot: '00'.repeat(32), kind: 1 });
  const unproven = anchoredLog({ root: built.leaf, stateRoot: '00'.repeat(32), kind: 0 });
  const a = await withChain({ payment: built.payment, logs: [proven] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url))
  ));
  const b = await withChain({ payment: built.payment, logs: [pending] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url))
  ));
  const c = await withChain({ payment: built.payment, logs: [unproven] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url))
  ));
  assert.equal(a.verdict.exit_code, 0, a.verdict.reason);
  assert.equal(b.verdict.exit_code, 2);
  assert.equal(b.verdict.reason, 'pending_hourly_close');
  assert.equal(c.verdict.exit_code, 1);
  assert.equal(c.verdict.reason, 'key_status_unproven');
});

test('an issuer-history file that adds a pin is refused and a revoke-after is applied', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const added = signDoc(key, [
    ...doc.entries,
    historyEntry(key, doc.head_hash, { not_after: '2026-01-01T00:00:00.000Z' }),
  ], {
    contracts: [pinOf(), pinOf({ address: OTHER })],
    narrowing: [],
  });
  const refused = await checkReceiptInput(
    JSON.stringify(v13Receipt(built)),
    optionsFor(key, doc, 'http://127.0.0.1:9', JSON.stringify(added)),
  );
  assert.equal(refused.verdict.exit_code, 1);
  assert.equal(refused.verdict.reason, 'extension_adds_contract');

  const narrowed = signDoc(key, [
    ...doc.entries,
    historyEntry(key, doc.head_hash, { not_after: '2026-01-01T00:00:00.000Z' }),
  ], {
    narrowing: [{ chainId: 84532, address: CONTRACT, revokeAfterEpoch: 0 }],
  });
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0 });
  const applied = await withChain({ payment: built.payment, logs: [log] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url, JSON.stringify(narrowed)))
  ));
  assert.equal(applied.verdict.exit_code, 1);
  assert.equal(applied.verdict.reason, 'revoked_after_epoch');
});

test('a live document that adds a pin is refused and the bundled pin still verifies', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const live = signDoc(key, [
    ...doc.entries,
    historyEntry(key, doc.head_hash, { not_after: '2026-01-01T00:00:00.000Z' }),
  ], { contracts: [pinOf({ address: OTHER })], narrowing: [] });
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0 });
  const fetchImpl = async (url) => {
    assert.match(url, /issuer-history\.json$/);
    return new Response(JSON.stringify(live), { status: 200 });
  };
  const out = await withChain({ payment: built.payment, logs: [log] }, (server) => (
    checkReceiptInput(JSON.stringify(v13Receipt(built)), { ...optionsFor(key, doc, server.url), fetchImpl })
  ));
  assert.equal(out.verdict.exit_code, 0, out.verdict.reason);
  assert.equal(out.verdict.live_extension, 'extension_adds_contract');
  const attacker = await checkReceiptInput(
    JSON.stringify(v13Receipt(built, { contract: OTHER })),
    { ...optionsFor(key, doc, 'http://127.0.0.1:9'), fetchImpl },
  );
  assert.equal(attacker.verdict.exit_code, 2);
  assert.equal(attacker.verdict.reason, 'contract_not_pinned');
});

test('an extension signed by a retired kid is refused', async () => {
  const key = makeKey();
  const active = historyEntry(key, null);
  const retired = historyEntry(key, active.entry_hash, { status: 'retired' });
  const doc = signDoc(key, [active, retired], { contracts: [pinOf()], narrowing: [] });
  const ext = signDoc(key, [
    ...doc.entries,
    historyEntry(key, doc.head_hash, { status: 'retired', not_after: '2026-01-01T00:00:00.000Z' }),
  ], { narrowing: [{ chainId: 84532, address: CONTRACT, revokeAfterEpoch: 1 }] });
  const built = signedLine();
  const out = await checkReceiptInput(
    JSON.stringify(v13Receipt(built)),
    optionsFor(key, doc, 'http://127.0.0.1:9', JSON.stringify(ext)),
  );
  assert.equal(out.verdict.exit_code, 1);
  assert.equal(out.verdict.reason, 'issuer_history_signer_inactive');
});

test('no configured RPC is exit 2', async () => {
  const key = makeKey();
  const built = signedLine({ chainId: 1, token: '22'.repeat(20) });
  const doc = bundleFor(key, [pinOf({ chainId: 1 })]);
  const prev = process.env.BASE_RPC_URL;
  delete process.env.BASE_RPC_URL;
  try {
    const out = await checkReceiptInput(JSON.stringify(v13Receipt(built)), {
      publicInput: true,
      trustedKids: [key.kid],
      [TEST_SNAPSHOT]: { issuerHistory: { document: doc, bytes: JSON.stringify(doc) } },
    });
    assert.equal(out.verdict.exit_code, 2);
    assert.equal(out.verdict.reason, 'rpc_unconfigured');
    assert.match(out.verdict.message, /No RPC is configured/);
  } finally {
    if (prev !== undefined) process.env.BASE_RPC_URL = prev;
  }
});

test('a head size above the cap is refused and the cap itself is passed to inclusion', () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const lineBytes = built.line;
  const view = {
    chainId: 84532,
    blockHash: `0x${built.payment.blockHash}`,
    blockNumber: 100,
    txIndex: 0,
    localLogIndex: 1,
    txHash: `0x${built.payment.txHash}`,
    token: USDC,
    from: `0x${built.payment.from}`,
    to: `0x${built.payment.to}`,
    value: 1000000n,
    method: 1,
    authorizer: `0x${built.payment.authorizer}`,
    nonce: `0x${built.payment.nonce}`,
    bytes: lineBytes,
  };
  const history = { ok: true, reason: null, source: 'bundled', headHash: doc.head_hash, entryCount: 1, asOf: null };
  const payload = JSON.parse(Buffer.from(doc.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
  const seen = [];
  const world = (size) => ({
    history,
    snapshotSigned: true,
    bundledPayload: payload,
    narrowing: [],
    liveExtension: null,
    rpcConfigured: true,
    finalizedNumber: 110,
    events: [{
      epoch: 1n,
      hourStart: BigInt(HOUR),
      size,
      root: built.leaf,
      stateRoot: built.stateRoot,
      kind: 0,
      blockNumber: 105,
      blockHash: `0x${'ef'.repeat(32)}`,
      txHash: `0x${'ee'.repeat(32)}`,
      logIndex: 0,
      address: CONTRACT,
    }],
    codeHash: pinOf().codeHash,
    anchorFrom: CHECKPOINT,
    anchorTo: CONTRACT,
    successor: 'not_required',
    chainGenesis: null,
    line: view,
    lineReason: null,
    rotatedTo: OTHER,
    payment: {
      blockHash: view.blockHash,
      txIndexMatch: true,
      txTo: USDC,
      input: '0x',
      logs: [
        {
          index: 0,
          address: USDC,
          topics: [
            '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5',
            `0x${'0'.repeat(24)}${built.payment.authorizer}`,
            `0x${built.payment.nonce}`,
          ],
          data: '0x',
        },
        {
          index: 1,
          address: USDC,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            `0x${'0'.repeat(24)}${built.payment.from}`,
            `0x${'0'.repeat(24)}${built.payment.to}`,
          ],
          data: `0x${word(built.payment.value)}`,
        },
      ],
    },
    canonical: 'ok',
  });
  const hooks = {
    leafHash,
    verifyInclusion: (leaf, index, size) => {
      seen.push(size);
      return { ok: true };
    },
    proveKey: () => true,
    sigmaOk: () => true,
  };
  const high = runV13(v13Receipt(built), world(BigInt(MAX_TREE_SIZE) + 1n), hooks);
  assert.equal(high.exit, 1);
  assert.equal(high.reason, 'tree_size_above_cap');
  assert.equal(seen.length, 0);
  const handled = runV13(v13Receipt(built), world(BigInt(MAX_TREE_SIZE)), hooks);
  assert.equal(handled.reason, null, handled.reason);
  assert.equal(handled.exit, 0);
  assert.deepEqual(seen, [MAX_TREE_SIZE]);
  assert.equal(key.kid.length > 0, true);
});
