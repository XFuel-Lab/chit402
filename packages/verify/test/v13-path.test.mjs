/**
 * v13 path. Exact type, bundled pins, the four checks, and the refusal cases
 * from the P0-7 brief. The corpus gate is not edited. The flip list is empty.
 */
import { createServer } from 'node:http';
import { setDefaultResultOrder } from 'node:dns';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReceiptInput } from '../dist/check-input.js';
import { verifyReceipt } from '../dist/index.js';
import { verifyIssuerHistoryDocument } from '../dist/issuer-history.js';
import { jwkThumbprint } from '../dist/jws.js';
import { TEST_SNAPSHOT } from '../dist/internal/test-seam.js';
import {
  ANCHORED_SIGNATURE,
  ANCHORED_TOPIC0,
  CORPUS_FLIP_LIST,
  MAX_TREE_SIZE,
  UNAUDITED_NOTE,
  parseV13Receipt,
  runV13,
  topicUint,
  treeSizeFromHead,
  trustedSender,
  isExactV13Receipt,
} from '../dist/v13/core/decide.js';
import { admittingContract, verifySlot } from '../dist/v13/slot.js';
import {
  DOMAIN_NAME,
  DOMAIN_TYPE,
  DOMAIN_VERSION,
  EXAMPLE_ANCHOR_CODE_HASH,
  PAYTO_CONTROL_TYPE,
  REVOKE_BY_KEY_TYPE,
  REVOKE_TYPE,
  assessSlotValue,
  chitDomainSeparator,
  judgePayTo,
  keyHashOf,
  keySlotKey,
  KEY_STATUS_SCHEMA,
  cachedAdmission,
  clearAdmissionCache,
  TEST_VECTOR_KEY_HASH,
  keyStatus,
  parseKeyHash,
  parsePayToSlot,
  pointOnCurve,
  revokeByKeyDigest,
} from '../dist/v13/key-record.js';
import { V13_RPC_DEFAULTS } from '../dist/v13/rpc-defaults.js';

setDefaultResultOrder('ipv4first');

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = new URL('../../cs2-core/', import.meta.url);
const { leafHash, nodeHash } = await import(new URL('merkle/index.js', CORE));
const { encodeLine, commitments, slotKey, stateLeaf, stateNode, emptyHash, isAllowedAlg, LAYOUT } = await import(new URL('line/index.mjs', CORE));
const { checkSigma, verifyPossession, canonicalKey } = await import(new URL('eip712/index.mjs', CORE));
const { keccak256 } = await import(new URL('ecdsa/keccak.js', CORE));
const { sha256 } = await import(new URL('sha256.js', CORE));
const { P256, SECP256K1 } = await import(new URL('ecdsa/curves.js', CORE));
const { signRawDigest, publicPoint } = await import(new URL('ecdsa/sign.js', CORE));
const { ethereumAddress } = await import(new URL('ecdsa/address.js', CORE));
const { bytesToBig, bigToBytes } = await import(new URL('ecdsa/bytes.js', CORE));
const { hashChit } = await import(new URL('../../chit-seller/eip712.mjs', import.meta.url));
const {
  createTree, putLeaf, prove, rootBytes, verifyProof, blankHash: smtBlank,
} = await import(new URL('../vendor/cs2-core/smt/tree.mjs', import.meta.url));
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
  return { sigmaHex: Buffer.from(signed.raw).toString('hex'), compressed, d };
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
      const result = handler(body.method, body.params, seen, req);
      res.setHeader('content-type', 'application/json');
      if (result && result.error) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: result.error } }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: result ?? null }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function anchoredLog({ epoch = 1, hour = HOUR, size = 1, root, stateRoot, kind = 0, block = 105, tx = `0x${'ee'.repeat(32)}`, prior = null }) {
  const log = {
    address: CONTRACT,
    topics: [ANCHORED_TOPIC0, topicUint(BigInt(epoch)), topicUint(BigInt(hour))],
    data: `0x${word(size)}${root}${stateRoot}${word(kind)}`,
    blockNumber: `0x${block.toString(16)}`,
    blockHash: `0x${'ef'.repeat(32)}`,
    transactionHash: tx,
    logIndex: '0x0',
  };
  if (prior) log.prior = prior;
  return log;
}

function logsFor(scene, topics) {
  const all = scene.logs ?? [];
  if (!topics || topics[0] !== ANCHORED_TOPIC0) return scene.rotationLogs ?? [];
  const epochTopic = topics[1];
  const direct = all.filter((log) => log.topics?.[1] === epochTopic);
  if (direct.length > 0) return direct;
  const synthesized = [];
  for (const log of all) {
    if (!log.prior || topicUint(BigInt(log.prior.epoch)) !== epochTopic) continue;
    synthesized.push(anchoredLog({
      epoch: log.prior.epoch,
      hour: log.prior.hour,
      size: log.prior.size,
      root: log.prior.root,
      stateRoot: log.prior.stateRoot,
      kind: log.prior.kind,
      block: log.prior.block,
      tx: log.prior.tx,
    }));
  }
  return synthesized;
}

function chainHandler(scene) {
  const payHash = `0x${scene.payment.blockHash}`;
  const txHash = `0x${scene.payment.txHash}`;
  const anchorTx = scene.anchorTx ?? `0x${'ee'.repeat(32)}`;
  return (method, params) => {
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      return { number: '0x6e', hash: `0x${'ab'.repeat(32)}` };
    }
    if (method === 'eth_getLogs') return logsFor(scene, params[0]?.topics ?? []);
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

function rpcPair(url) {
  if (typeof url !== 'string' || url === '') return [];
  if (url.includes('127.0.0.1')) return [url, url.replaceAll('127.0.0.1', '127.0.0.2')];
  return [url, url];
}

function optionsFor(key, doc, url, file) {
  return {
    publicInput: true,
    trustedKids: [key.kid],
    rpcUrls: rpcPair(url),
    issuerHistoryBytes: file ?? null,
    [TEST_SNAPSHOT]: { issuerHistory: { document: doc, bytes: JSON.stringify(doc) } },
  };
}

function u16(value) {
  return Buffer.from([(value >> 8) & 0xff, value & 0xff]);
}

function expiryBytes(expiry) {
  const body = Buffer.alloc(8);
  let exp = expiry;
  for (let i = 7; i >= 0; i -= 1) {
    body[i] = Number(exp & 0xffn);
    exp >>= 8n;
  }
  return body;
}

function registrationValue(compressed, paySig, pop, expiry = 4_000_000_000n) {
  return Buffer.concat([
    Buffer.from(compressed),
    expiryBytes(expiry),
    u16(65),
    Buffer.from(paySig),
    u16(64),
    Buffer.from(pop),
  ]);
}

function signLow(digest, scalar, curve) {
  for (let k = 3n; k < 80n; k += 2n) {
    try { return signRawDigest(digest, scalar, k, curve); } catch { /* next nonce */ }
  }
  return null;
}

function compressedP256(scalar) {
  const pub = publicPoint(scalar, P256);
  const y = pub.subarray(33);
  return { uncompressed: pub, compressed: Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), pub.subarray(1, 33)]) };
}

const PAY_SCALAR = 7n;

function treeOf(leaves) {
  let tree = createTree();
  for (const leaf of leaves) {
    const key = leaf.key instanceof Uint8Array ? leaf.key : new Uint8Array(leaf.key);
    const value = leaf.value instanceof Uint8Array ? leaf.value : new Uint8Array(leaf.value);
    const put = putLeaf(tree, key, value);
    if (!put.ok) throw new Error(put.reason);
    tree = put.tree;
  }
  return {
    root: rootBytes(tree),
    proof(key) {
      const raw = key instanceof Uint8Array ? key : new Uint8Array(key);
      const proved = prove(tree, raw);
      if (!proved.ok) throw new Error(proved.reason);
      return proved.proof;
    },
  };
}

function hexProof(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function signedLine(over = {}) {
  const { expiry: expiryOver, keyValue, ...paymentOver } = over;
  const expiry = expiryOver ?? 4_000_000_000n;
  const payPoint = publicPoint(PAY_SCALAR, SECP256K1);
  const payTo = ethereumAddress(payPoint).slice(2);
  const payment = paymentParts({ ...paymentOver, to: payTo });
  const payKey = slotKey({ kind: 1, chainId: 84532, id: payment.to });
  let built = null;
  for (let attempt = 0; attempt < 24 && !built; attempt += 1) {
    const keyScalar = 11n + BigInt(attempt) * 2n;
    if (keyScalar === PAY_SCALAR) continue;
    const sellerKey = compressedP256(keyScalar);
    const draft = buildLine(payment);
    const openedDraft = commitments(draft);
    if (!openedDraft.ok) continue;
    const sigma = signLow(openedDraft.sigmaDigest, keyScalar, P256);
    if (!sigma) continue;
    const signedBytes = buildLine(payment);
    const opened = commitments(signedBytes);
    const line = Buffer.from(signedBytes);
    line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
    if (!opened.ok) continue;
    const control = hashChit('PayToControl', {
      payTo,
      keyAlg: 1,
      key: sellerKey.compressed,
      expiry,
    }, 84532n, CONTRACT.slice(2));
    if (!control.ok) continue;
    const paySig = signLow(control.bytes, PAY_SCALAR, SECP256K1);
    const pop = signLow(sha256(control.bytes), keyScalar, P256);
    if (!paySig || !pop) continue;
    const payBytes = Buffer.concat([Buffer.from(paySig.raw), Buffer.from([paySig.yParity])]);
    const slotValue = registrationValue(sellerKey.compressed, payBytes, pop.raw, expiry);
    const hash = sha256(Buffer.concat([Buffer.from([1]), sellerKey.compressed]));
    const keySlot = keySlotKey(84532, hash, sha256);
    if (!payKey.ok || !keySlot) continue;
    const leaves = [{ key: payKey.bytes, value: slotValue }];
    if (keyValue && keyValue.length > 0) leaves.push({ key: keySlot, value: Buffer.from(keyValue) });
    const tree = treeOf(leaves);
    const prior = treeOf([]);
    built = {
      line,
      leaf: hexOf(leafHash(line).hash),
      stateRoot: hexOf(tree.root),
      priorStateRoot: hexOf(prior.root),
      slotKey: hexOf(payKey.bytes),
      slotValue: hexOf(slotValue),
      slotProof: hexProof(tree.proof(payKey.bytes)),
      keySlotProof: hexProof(tree.proof(keySlot)),
      priorSlotProof: hexProof(prior.proof(payKey.bytes)),
      priorKeyProof: hexProof(prior.proof(keySlot)),
      admissionBlock: 80,
      signedDomain: {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: 84532,
        verifyingContract: CONTRACT,
      },
      prior: {
        epoch: 0,
        hour: HOUR,
        size: 0,
        root: '00'.repeat(32),
        stateRoot: hexOf(prior.root),
        kind: 1,
        block: 50,
        tx: `0x${'dd'.repeat(32)}`,
      },
      payment,
      keyScalar,
      sellerKey: sellerKey.compressed,
      sigmaDigest: opened.sigmaDigest,
    };
  }
  if (!built) throw new Error('seller key');
  return built;
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
    slotKey: built.slotKey,
    slotValue: built.slotValue,
    slotProof: extra.fields && extra.fields.slotProof !== undefined ? undefined : built.slotProof,
    keySlotProof: extra.fields && extra.fields.keySlotProof !== undefined ? undefined : built.keySlotProof,
    admissionBlock: built.admissionBlock,
    priorSlotProof: built.priorSlotProof,
    priorKeyProof: built.priorKeyProof,
    signedDomain: built.signedDomain,
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
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0, prior: built.prior });
  const verdict = await withChain({ payment: built.payment, logs: [log] }, async (server) => {
    const out = await checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, doc, server.url));
    assert.equal(server.seen.some((call) => JSON.stringify(call.params ?? []).includes(ROTATION_TOPIC0)), false);
    return out;
  });
  assert.equal(verdict.verdict.exit_code, 0, JSON.stringify(verdict.verdict));
  assert.equal(verdict.verdict.message, 'PAYMENT PROVEN');
  assert.equal(verdict.verdict.message.includes('not attested'), false);
  assert.equal(verdict.verdict.notes[0], UNAUDITED_NOTE);
  assert.ok(verdict.verdict.prints.includes('payment: chain-proven'));
  assert.ok(verdict.verdict.prints.includes('committed by payer, not attested by seller'));
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
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0, prior: built.prior });
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
  const proven = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 1, prior: built.prior });
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
  assert.equal(b.verdict.exit_code, 1);
  assert.equal(b.verdict.reason, 'not_in_state');
  assert.equal(c.verdict.exit_code, 1);
  assert.equal(c.verdict.reason, 'not_in_state');
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
  const log = anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0, prior: built.prior });
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
    stateOk: () => true,
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

const FIN = 110;

function sceneHandler(s) {
  const payHash = `0x${s.payment.blockHash}`;
  const txHash = `0x${s.payment.txHash}`;
  const anchorTx = `0x${'ee'.repeat(32)}`;
  const calls = [];
  const h = (method, params, _seen, req) => {
    calls.push([method, params]);
    const second = String(req?.socket?.localAddress ?? '').endsWith('.2');
    if (s.failSecond && second) return { error: 'down' };
    if (s.disagree && second && method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      return { number: '0x1', hash: `0x${'11'.repeat(32)}` };
    }
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      return { number: `0x${FIN.toString(16)}`, hash: `0x${'ab'.repeat(32)}` };
    }
    if (method === 'eth_getLogs') return logsFor(s, params[0]?.topics ?? []);
    if (method === 'eth_getTransactionReceipt' && params[0] === anchorTx) {
      if (s.anchorReceiptNull) return null;
      return {
        from: s.anchorFrom ?? CHECKPOINT,
        to: s.anchorTo ?? CONTRACT,
        blockNumber: '0x69',
        blockHash: `0x${'ef'.repeat(32)}`,
        transactionIndex: '0x0',
        logs: [],
      };
    }
    if (method === 'eth_getCode') return s.code ?? CODE;
    if (method === 'eth_call') {
      if (params[0]?.data === '0x2eb38ae0' && s.retired) return `0x${word(1)}`;
      return { error: 'execution reverted' };
    }
    if (method === 'eth_getBlockByHash' && params[0].toLowerCase() === payHash) {
      return {
        number: s.payBlockNumber ?? '0x64',
        hash: s.sameWrong ? `0x${'12'.repeat(32)}` : (s.byHashHash ?? payHash),
        transactions: s.txs ?? [txHash],
      };
    }
    if (method === 'eth_getBlockByNumber' && params[0] === (s.payBlockNumber ?? '0x64')) {
      const hash = s.sameWrong ? `0x${'12'.repeat(32)}` : (s.reorg ? `0x${'99'.repeat(32)}` : payHash);
      return { number: s.payBlockNumber ?? '0x64', hash };
    }
    if (method === 'eth_getTransactionReceipt' && params[0].toLowerCase() === txHash) {
      const base = s.logBase ?? 0;
      return {
        blockHash: payHash,
        logs: s.payLogs ?? [
          {
            logIndex: `0x${base.toString(16)}`,
            address: USDC,
            topics: [
              '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5',
              `0x${'0'.repeat(24)}${s.logAuthorizer ?? s.payment.authorizer}`,
              `0x${s.logNonce ?? s.payment.nonce}`,
            ],
            data: '0x',
          },
          {
            logIndex: `0x${(base + 1).toString(16)}`,
            address: s.emitter ?? USDC,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x${'0'.repeat(24)}${s.logFrom ?? s.payment.from}`,
              `0x${'0'.repeat(24)}${s.logTo ?? s.payment.to}`,
            ],
            data: `0x${word(s.logValue ?? s.payment.value)}`,
          },
        ],
      };
    }
    if (method === 'eth_getTransactionByHash') return { to: s.txTo ?? USDC, input: s.input ?? '0x' };
    return null;
  };
  return { h, calls };
}

async function runScene(scene, receipt, opts) {
  const { h, calls } = sceneHandler(scene);
  const server = await listen(h);
  try {
    const out = await checkReceiptInput(JSON.stringify(receipt), { ...opts(server.url) });
    return { v: out.verdict, calls };
  } finally {
    await server.close();
  }
}

function ext(key, doc, payloadExtra) {
  return signDoc(key, [
    ...doc.entries,
    historyEntry(key, doc.head_hash, { not_after: '2026-01-01T00:00:00.000Z' }),
  ], payloadExtra);
}

const okLog = (built, over = {}) => anchoredLog({ root: built.leaf, stateRoot: built.stateRoot, kind: 0, prior: built.prior, ...over });

test('D00 honest hourly receipt verifies', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 0, r.v.reason);
  assert.equal(r.v.result, 'verified');
});

test('D04 and D05 an extension or a live document keeps the earliest revoke-after', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = signDoc(key, [historyEntry(key, null)], {
    contracts: [pinOf()],
    narrowing: [{ chainId: 84532, address: CONTRACT, revokeAfterEpoch: 0 }],
  });
  const base = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(base.v.exit_code, 1);
  assert.equal(base.v.reason, 'revoked_after_epoch');
  const file = ext(key, doc, { narrowing: [] });
  const lifted = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u, JSON.stringify(file)));
  assert.equal(lifted.v.exit_code, 1);
  assert.equal(lifted.v.reason, 'revoked_after_epoch');
  const fetchImpl = async () => new Response(JSON.stringify(file), { status: 200 });
  const live = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => ({
    ...optionsFor(key, doc, u),
    fetchImpl,
  }));
  assert.equal(live.v.exit_code, 1);
  assert.equal(live.v.reason, 'revoked_after_epoch');
});

test('D14 localLogIndex is the position inside the receipt', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [okLog(built)], logBase: 5 }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 0, r.v.reason);
  const wide = signedLine({ localLogIndex: 6 });
  const bad = await runScene({ payment: wide.payment, logs: [okLog(wide)], logBase: 5 }, v13Receipt(wide), (u) => optionsFor(key, doc, u));
  assert.equal(bad.v.exit_code, 1);
  assert.equal(bad.v.reason, 'payment_mismatch');
});

test('payment value, from, to, emitter, nonce, and authorizer are bound', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const scenes = [
    { logValue: 2 },
    { logFrom: '44'.repeat(20) },
    { logTo: '55'.repeat(20) },
    { emitter: OTHER },
    { logNonce: '66'.repeat(32) },
    { logAuthorizer: '77'.repeat(20) },
  ];
  for (const scene of scenes) {
    const r = await runScene({ payment: built.payment, logs: [okLog(built)], ...scene }, v13Receipt(built), (u) => optionsFor(key, doc, u));
    assert.equal(r.v.exit_code, 1, JSON.stringify(scene));
    assert.equal(r.v.reason, 'payment_mismatch', JSON.stringify(scene));
  }
});

test('a seller signature that does not match the slot key is invalid', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const receipt = v13Receipt(built);
  const at = 750 * 2;
  const flipped = (Number.parseInt(receipt.line.slice(at, at + 2), 16) ^ 1).toString(16).padStart(2, '0');
  receipt.line = receipt.line.slice(0, at) + flipped + receipt.line.slice(at + 2);
  const leaf = leafHash(Buffer.from(receipt.line, 'hex'));
  const r = await runScene({ payment: built.payment, logs: [okLog(built, { root: hexOf(leaf.hash) })] }, receipt, (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 1);
  assert.equal(r.v.reason, 'sigma_not_core');
});

test('the anchor transaction to, the receipt epoch, and a size equal to the index', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const to = await runScene({ payment: built.payment, logs: [okLog(built)], anchorTo: OTHER }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(to.v.exit_code, 1);
  assert.equal(to.v.reason, 'anchor_sender_mismatch');
  const epoch = await runScene({ payment: built.payment, logs: [okLog(built, { epoch: 2 })] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(epoch.v.exit_code, 1);
  assert.equal(epoch.v.reason, 'not_first_anchor');
  const bound = await runScene({ payment: built.payment, logs: [okLog(built, { size: 0 })] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(bound.v.exit_code, 2);
  assert.equal(bound.v.reason, 'pre_anchor');
});

test('an earlier finalized epoch that already covers the index is not the first anchor', () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const payload = JSON.parse(Buffer.from(doc.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
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
  const payment = {
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
  };
  const event = (epoch, size) => ({
    epoch: BigInt(epoch),
    hourStart: BigInt(HOUR),
    size: BigInt(size),
    root: built.leaf,
    stateRoot: built.stateRoot,
    kind: 0,
    blockNumber: 100 + epoch,
    blockHash: `0x${'ef'.repeat(32)}`,
    txHash: `0x${'ee'.repeat(32)}`,
    logIndex: 0,
    address: CONTRACT,
  });
  const world = (events) => ({
    history: { ok: true, reason: null, source: 'bundled', headHash: doc.head_hash, entryCount: 1, asOf: null },
    snapshotSigned: true,
    bundledPayload: payload,
    narrowing: [],
    liveExtension: null,
    rpcConfigured: true,
    finalizedNumber: 110,
    events,
    codeHash: pinOf().codeHash,
    anchorFrom: CHECKPOINT,
    anchorTo: CONTRACT,
    successor: 'not_required',
    chainGenesis: null,
    line: view,
    lineReason: null,
    rotatedTo: null,
    payment,
    canonical: 'ok',
    priorStatus: 'present',
  });
  const hooks = {
    leafHash,
    verifyInclusion: () => ({ ok: true }),
    stateOk: () => true,
    sigmaOk: () => true,
  };
  const covered = runV13(v13Receipt(built, { epoch: 2 }), world([event(1, 1), event(2, 2)]), hooks);
  assert.equal(covered.exit, 1);
  assert.equal(covered.reason, 'not_first_anchor');
  const open = runV13(v13Receipt(built, { epoch: 2 }), world([event(1, 0), event(2, 2)]), hooks);
  assert.equal(open.exit, 0, open.reason);
  assert.equal(key.kid.length > 0, true);
});

test('a retire hour, an unknown kind, and a wrong topic0 do not verify', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key, [pinOf({ retireHourStart: HOUR })]);
  const retired = await runScene({ payment: built.payment, logs: [okLog(built, { hour: HOUR + 3600 })] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(retired.v.exit_code, 1);
  assert.equal(retired.v.reason, 'hour_outside_coverage');
  const kind = await runScene({ payment: built.payment, logs: [okLog(built, { kind: 7 })] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.notEqual(kind.v.exit_code, 0);
  const log = okLog(built);
  log.topics = [`0x${'ab'.repeat(32)}`, log.topics[1], log.topics[2]];
  const topic = await runScene({ payment: built.payment, logs: [log] }, v13Receipt(built), (u) => optionsFor(key, bundleFor(key), u));
  assert.notEqual(topic.v.exit_code, 0);
});

test('exit 2 is could_not_check and the library overall is partial', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 2);
  assert.equal(r.v.result, 'could_not_check');
  const { h } = sceneHandler({ payment: built.payment, logs: [] });
  const server = await listen(h);
  try {
    const lib = await verifyReceipt(v13Receipt(built), optionsFor(key, doc, server.url));
    assert.equal(lib.overall, 'partial');
    assert.equal(lib.verdict.result, 'could_not_check');
  } finally {
    await server.close();
  }
});

test('an extra pin key and a forged extension signature are refused', async () => {
  const key = makeKey();
  const built = signedLine();
  const pin = pinOf();
  pin.note = 'extra';
  const doc = bundleFor(key, [pin]);
  const extra = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(extra.v.exit_code, 1);
  assert.equal(extra.v.reason, 'snapshot_contracts_invalid');
  const honest = bundleFor(key);
  const signed = ext(key, honest, { narrowing: [] });
  const jws = signed.issuer_signature.jws;
  signed.issuer_signature.jws = `${jws.slice(0, -1)}${jws.endsWith('a') ? 'b' : 'a'}`;
  const forged = await checkReceiptInput(JSON.stringify(v13Receipt(built)), optionsFor(key, honest, 'http://127.0.0.1:9', JSON.stringify(signed)));
  assert.equal(forged.verdict.exit_code, 1);
  assert.equal(forged.verdict.reason, 'signature_invalid');
});

test('equal wrong block hashes are still a reorg', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [okLog(built)], sameWrong: true }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 1);
  assert.equal(r.v.reason, 'reorged');
});

test('D15 a Permit2 nonce at an odd nibble does not verify', async () => {
  const key = makeKey();
  const built = signedLine({ method: 2 });
  const doc = bundleFor(key);
  const input = `0x30f28b7a0${built.payment.nonce}${'0'.repeat(63)}`;
  const r = await runScene({
    payment: built.payment,
    logs: [okLog(built)],
    txTo: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    input,
  }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.notEqual(r.v.exit_code, 0);
});

test('D07 a malformed rotation stays invalid and a well-formed chain asks for an update', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const malformed = [{
    address: CONTRACT,
    topics: [ROTATION_TOPIC0, `0x${'0'.repeat(24)}${CHECKPOINT.slice(2)}`, `0x${'0'.repeat(24)}${OTHER.slice(2)}`],
    data: '0x',
    blockNumber: '0x60',
  }];
  const bad = await runScene({
    payment: built.payment,
    logs: [okLog(built)],
    rotationLogs: malformed,
    anchorFrom: OTHER,
  }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(bad.v.exit_code, 1);
  assert.equal(bad.v.reason, 'anchor_sender_mismatch');
  const data = `0x${word(1)}${word(BigInt(CHECKPOINT))}${word(BigInt(OTHER))}`;
  const formed = [{ address: CONTRACT, topics: [ROTATION_TOPIC0], data, blockNumber: '0x60' }];
  const rotated = await runScene({
    payment: built.payment,
    logs: [okLog(built)],
    rotationLogs: formed,
    anchorFrom: OTHER,
  }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(rotated.v.exit_code, 2);
  assert.equal(rotated.v.reason, 'checkpoint_rotated');
  assert.equal(rotated.v.message, 'update chit402-verify');
});

test('D20 an Anchored event from another address is not the head', () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const payload = JSON.parse(Buffer.from(doc.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
  const world = {
    history: { ok: true, reason: null, source: 'bundled', headHash: null, entryCount: 1, asOf: null },
    snapshotSigned: true,
    bundledPayload: payload,
    narrowing: [],
    liveExtension: null,
    rpcConfigured: true,
    finalizedNumber: 110,
    events: [{
      epoch: 1n, hourStart: BigInt(HOUR), size: 1n, root: built.leaf, stateRoot: built.stateRoot,
      kind: 0, blockNumber: 105, blockHash: `0x${'ef'.repeat(32)}`, txHash: `0x${'ee'.repeat(32)}`,
      logIndex: 0, address: OTHER,
    }],
    codeHash: pinOf().codeHash,
    anchorFrom: CHECKPOINT,
    anchorTo: CONTRACT,
    successor: 'not_required',
    chainGenesis: null,
    line: {
      chainId: 84532, blockHash: `0x${built.payment.blockHash}`, blockNumber: 100, txIndex: 0,
      localLogIndex: 1, txHash: `0x${built.payment.txHash}`, token: USDC, from: `0x${built.payment.from}`,
      to: `0x${built.payment.to}`, value: 1000000n, method: 1, authorizer: `0x${built.payment.authorizer}`,
      nonce: `0x${built.payment.nonce}`, bytes: built.line,
    },
    lineReason: null,
    rotatedTo: null,
    payment: { blockHash: `0x${built.payment.blockHash}`, txIndexMatch: true, txTo: USDC, input: '0x', logs: [] },
    canonical: 'ok',
  };
  const out = runV13(v13Receipt(built), world, {
    leafHash, verifyInclusion: () => ({ ok: true }), stateOk: () => true, sigmaOk: () => true,
  });
  assert.equal(out.reason, 'pre_anchor');
  assert.notEqual(out.exit, 0);
});

test('D21 a null anchor receipt is not verified', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [okLog(built)], anchorReceiptNull: true }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 2);
  assert.notEqual(r.v.exit_code, 0);
});

test('D26 index and epoch above the safe integer cap are refused at parse', () => {
  const built = signedLine();
  const epoch = parseV13Receipt({ ...v13Receipt(built), epoch: 2 ** 53 + 2 });
  const index = parseV13Receipt({ ...v13Receipt(built), index: 2 ** 53 });
  assert.equal(epoch.ok, false);
  assert.equal(epoch.reason, 'above_safe_integer');
  assert.equal(index.ok, false);
  assert.equal(index.reason, 'above_safe_integer');
});

test('the admitting domain ignores an old contract and an admission block outside the anchor bounds', () => {
  const old = verifySlot({
    chainId: 84532,
    admitting: CONTRACT,
    signedDomain: { name: 'Chit402', version: '13', chainId: 84532, verifyingContract: OTHER },
    admissionBlock: 100,
    previousAnchorBlock: 90,
    showingAnchorBlock: 110,
    paymentBlock: 100,
  });
  assert.equal(old.ignored, false);
  assert.equal(old.reason, 'domain_mismatch');
  assert.equal(old.domain.version, DOMAIN_VERSION);
  const late = verifySlot({
    chainId: 84532,
    admitting: CONTRACT,
    signedDomain: { name: 'Chit402', version: '13', chainId: 84532, verifyingContract: CONTRACT },
    admissionBlock: 120,
    previousAnchorBlock: 90,
    showingAnchorBlock: 110,
    paymentBlock: 100,
  });
  assert.equal(late.ignored, false);
  assert.equal(late.reason, 'admission_unproven');
  assert.equal(DOMAIN_TYPE.includes('salt'), false);
  assert.equal(PAYTO_CONTROL_TYPE, 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)');
  assert.equal(REVOKE_TYPE, 'Revoke(address payTo,bytes32 keyHash)');
  assert.equal(REVOKE_BY_KEY_TYPE, 'RevokeByKey(bytes32 keyHash)');
});

test('keyHash binds the alg byte, a tombstone stays dead, and expiry is rechecked', () => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const key = Uint8Array.from(Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), x]));
  const gate = { allowed: isAllowedAlg, onCurve: (bytes) => pointOnCurve(bytes, P256) };
  const hash = keyHashOf(0x01, key, sha256, gate);
  assert.ok(hash);
  assert.deepEqual(Buffer.from(hash), Buffer.from(sha256(Buffer.concat([Buffer.from([0x01]), Buffer.from(key)]))));
  assert.notDeepEqual(Buffer.from(hash), Buffer.from(sha256(Buffer.from(key))));
  assert.equal(keyHashOf(0x02, key, sha256, gate), null);
  assert.equal(keyHashOf(0x00, key, sha256, gate), null);
  assert.equal(keyHashOf(0x03, key, sha256, gate), null);
  assert.equal(keyHashOf(undefined, key, sha256, gate), null);
  const off = new Uint8Array(33);
  off[0] = 2;
  off[1] = 9;
  assert.equal(pointOnCurve(off, P256), false);
  assert.equal(keyHashOf(0x01, off, sha256, gate), null);
  assert.equal(keyHashOf(0x01, Uint8Array.of(4, ...new Uint8Array(64)), sha256, gate), null);
  const hour = 1_700_000_000;
  const judged = (extra) => judgePayTo({
    alg: 0x01, key, keyHash: hash, expiry: BigInt(hour + 10),
    showingHour: hour, receiptHour: hour, tombstoned: false, sha256, gate, ...extra,
  });
  assert.equal(judged({}).ok, true);
  assert.equal(judged({ tombstoned: true }).reason, 'key_revoked_tombstone');
  assert.equal(judged({ expiry: BigInt(hour), receiptHour: hour }).reason, 'expiry_not_after_hour');
  assert.equal(judged({ receiptHour: hour, expiry: BigInt(hour + 10) }).ok, true);
  assert.equal(judged({ keyHash: sha256(Buffer.from(key)) }).reason, 'key_hash_mismatch');
  assert.equal(judged({ alg: 0x02 }).reason, 'bad_alg');
  assert.equal(judged({ alg: undefined, key }).reason, 'bad_alg');
  assert.equal(judged({ key: off }).reason, 'off_curve');
  const low = new Uint8Array(64);
  low[31] = 1;
  low[63] = 1;
  const high = new Uint8Array(64);
  high[31] = 1;
  const sHex = (P256.order - 1n).toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i += 1) high[32 + i] = Number.parseInt(sHex.slice(i * 2, i * 2 + 2), 16);
  assert.equal(checkSigma(low).ok, true);
  assert.equal(checkSigma(high).ok, false);
  const digest = revokeByKeyDigest(keccak256, 84532, CONTRACT.slice(2), hash);
  assert.equal(digest.length, 32);
  const again = chitDomainSeparator(keccak256, 84532, CONTRACT.slice(2));
  const typeHash = keccak256(Buffer.from(DOMAIN_TYPE, 'utf8'));
  const nameHash = keccak256(Buffer.from('Chit402', 'utf8'));
  const versionHash = keccak256(Buffer.from('13', 'utf8'));
  const chainWord = Buffer.alloc(32);
  chainWord.writeBigUInt64BE(84532n, 24);
  const addrWord = Buffer.alloc(32);
  Buffer.from(CONTRACT.slice(2), 'hex').copy(addrWord, 12);
  const folded = keccak256(Buffer.concat([typeHash, nameHash, versionHash, chainWord, addrWord]));
  assert.deepEqual(Buffer.from(again), Buffer.from(folded));
  assert.equal(DOMAIN_TYPE.includes('salt'), false);
  assert.equal(PAYTO_CONTROL_TYPE.includes('validFrom'), false);
  assert.equal(REVOKE_TYPE.includes('revokedAt'), false);
  const expiry = BigInt(hour + 10);
  const calls = [];
  const tail = Buffer.concat([
    Buffer.from(key),
    Buffer.from([0x01]),
    Buffer.from(expiry.toString(16).padStart(16, '0'), 'hex'),
    Buffer.from(hash),
    Buffer.from([1]),
    Buffer.from([0x01]),
    Buffer.from(key),
    Buffer.from(hash),
    Buffer.alloc(64, 1),
  ]);
  const tomb = assessSlotValue({
    slotValue: tail,
    sha256,
    keccak: keccak256,
    chainId: 84532,
    admitting: CONTRACT,
    showingHour: hour,
    receiptHour: hour,
    gate,
    signatureOk: () => { calls.push('sig'); return true; },
  });
  assert.equal(tomb.reason, 'key_revoked_tombstone');
  assert.deepEqual(calls, ['sig']);
  const skipped = [];
  const badAlg = Buffer.from(tail);
  badAlg[75] = 0x02;
  const refused = assessSlotValue({
    slotValue: badAlg,
    sha256,
    keccak: keccak256,
    chainId: 84532,
    admitting: CONTRACT,
    showingHour: hour,
    receiptHour: hour,
    gate,
    signatureOk: () => { skipped.push('sig'); return true; },
  });
  assert.equal(refused.reason, 'bad_alg');
  assert.deepEqual(skipped, []);
  const unbound = assessSlotValue({
    slotValue: tail,
    sha256,
    keccak: keccak256,
    chainId: 84532,
    admitting: CONTRACT,
    showingHour: hour,
    receiptHour: hour,
    gate,
    signatureOk: () => false,
  });
  assert.equal(unbound.reason, 'bad_signature');
  assert.equal(EXAMPLE_ANCHOR_CODE_HASH, '0xcd66271f37f16d9a2b526a63c539875ed3b56904cd2014ba0e1cd4aa33a0e080');
});

test('key status needs both proofs, and a tombstone applies only forward', () => {
  const text = `0x${'ab'.repeat(32)}`;
  const parsed = parseKeyHash(text);
  assert.ok(parsed);
  assert.equal(parseKeyHash('ab'.repeat(32)), null);
  assert.equal(parseKeyHash(`0x${'AB'.repeat(32)}`), null);
  assert.equal(parseKeyHash(`0x${'ab'.repeat(31)}`), null);
  assert.equal(parseKeyHash(`0x${'ab'.repeat(33)}`), null);
  const slot = keySlotKey(84532, parsed, sha256);
  assert.equal(slot.length, 32);
  const literal = keySlotKey(8453, new Uint8Array(32).fill(0x33), sha256);
  assert.equal(Buffer.from(literal).toString('hex'), 'e791917a7c2f11b2f7d6db4b211822aa63593fd8a7e3b0abdfee3ec180e62613');
  const registration = {
    admissionBlock: 90,
    expiry: 2_000_000_000n,
    payToSignature: new Uint8Array([1]),
    keySignature: new Uint8Array(64),
    popOk: true,
  };
  const base = {
    schema: KEY_STATUS_SCHEMA,
    block: 100,
    hourStart: 1_700_000_000,
    payToProof: { siblings: [], root: 'aa' },
    keyProof: { siblings: [], root: 'aa' },
    keyLeaf: 'empty',
    registration,
    slotRevokeBlock: null,
    tombstone: null,
    admission: {
      absentAtPrior: false,
      emptySlotAtPrior: true,
      memberAtEpoch: true,
      priorAnchor: 10,
      anchor: 200,
      block: 90,
    },
  };
  assert.equal(keyStatus(base).exit, 0);
  assert.equal(keyStatus({ ...base, admission: null }).exit, 2);
  assert.equal(keyStatus({
    ...base,
    registration: { ...registration, admissionBlock: 120 },
  }).exit, 2);
  assert.equal(keyStatus({ ...base, schema: 'chit402.cs2.key-status.v1' }).exit, 2);
  assert.equal(keyStatus({ ...base, schema: null }).reason, 'old_schema');
  assert.equal(keyStatus({ ...base, payToProof: null }).reason, 'unproven');
  assert.equal(keyStatus({ ...base, keyProof: { siblings: null } }).reason, 'unproven');
  assert.equal(keyStatus({ ...base, registration: { ...registration, payToSignature: null } }).reason, 'unproven');
  assert.equal(keyStatus({ ...base, registration: { ...registration, keySignature: null } }).reason, 'unproven');
  assert.equal(keyStatus({ ...base, registration: { ...registration, popOk: false } }).reason, 'unproven');
  assert.equal(keyStatus({ ...base, keyLeaf: null, tombstone: { revokedAtBlock: 100, outOfBounds: false, signatureOk: true } }).reason, 'revoked');
  const early = keyStatus({ ...base, keyLeaf: null, tombstone: { revokedAtBlock: 150, outOfBounds: false, signatureOk: true } });
  assert.equal(early.exit, 0);
  assert.equal(early.print, 'seller key revoked at block 150 (by key)');
  assert.equal(keyStatus({ ...base, keyLeaf: 'bare' }).exit, 2);
  assert.equal(keyStatus({ ...base, keyLeaf: 'zero' }).reason, 'invalid_leaf');
  assert.equal(keyStatus({ ...base, keyLeaf: 'out_of_bounds' }).exit, 2);
  assert.equal(keyStatus({ ...base, keyLeaf: 'bad_sig' }).exit, 2);
  assert.equal(keyStatus({ ...base, keyLeaf: 'multi' }).exit, 2);
  assert.equal(keyStatus({ ...base, keyLeaf: null, tombstone: { revokedAtBlock: null, outOfBounds: false } }).exit, 2);
  assert.equal(keyStatus({ ...base, keyLeaf: null, tombstone: { revokedAtBlock: 0, outOfBounds: false } }).exit, 2);
  assert.equal(keyStatus({ ...base, keyLeaf: null, tombstone: { revokedAtBlock: 80, outOfBounds: true } }).exit, 2);
  assert.equal(keyStatus({
    ...base,
    block: 50,
    keyLeaf: null,
    registration: { ...registration, admissionBlock: 120 },
    admission: { absentAtPrior: false, emptySlotAtPrior: true, memberAtEpoch: true, priorAnchor: 10, anchor: 200, block: 120 },
    tombstone: { revokedAtBlock: 100, outOfBounds: false, signatureOk: true },
  }).reason, 'registered_after_tombstone');
  const sameHash = new Uint8Array(32).fill(9);
  const otherHash = new Uint8Array(32).fill(8);
  assert.equal(keyStatus({
    ...base, slotRevokeBlock: 100, slotRevokeKeyHash: sameHash, registrationKeyHash: sameHash,
  }).reason, 'revoked');
  assert.equal(keyStatus({
    ...base, slotRevokeBlock: 100, slotRevokeKeyHash: otherHash, registrationKeyHash: sameHash,
  }).exit, 0);
  assert.equal(keyStatus({ ...base, slotRevokeBlock: 150, slotRevokeKeyHash: sameHash, registrationKeyHash: sameHash }).exit, 0);
  assert.equal(keyStatus({
    ...base,
    block: 130,
    registration: { ...registration, admissionBlock: 120 },
    admission: { absentAtPrior: false, emptySlotAtPrior: true, memberAtEpoch: true, priorAnchor: 10, anchor: 200, block: 120 },
    slotRevokeBlock: 100,
    slotRevokeKeyHash: sameHash,
    registrationKeyHash: sameHash,
  }).reason, 'registered_after_slot_revoke');
  assert.equal(keyStatus({
    ...base,
    block: 130,
    slotRevokeBlock: 100,
    revokeByKeyOutsideKeySlot: true,
  }).exit, 0);
  assert.equal(keyStatus({ ...base, hourStart: 200, registration: { ...registration, expiry: 200n } }).reason, 'expired');
  assert.equal(keyStatus({ ...base, block: 22_000_000, hourStart: 1_700_000_000, registration: { ...registration, expiry: 1_800_000_000n, admissionBlock: 90 } }).exit, 0);
  assert.equal(keyStatus({ ...base, payToProof: { siblings: [], root: 'aa' }, keyProof: { siblings: [], root: 'bb' } }).reason, 'two_roots');
  const sigmaKey = Buffer.from('036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296', 'hex');
  const derived = keySlotKey(84532, sha256(Buffer.concat([Buffer.from([1]), Buffer.from(sigmaKey)])), sha256);
  assert.equal(keyStatus({
    ...base,
    sigmaKey,
    chainId: 84532,
    sha256,
    bundleKeySlot: derived,
  }).exit, 0);
  assert.equal(keyStatus({
    ...base,
    sigmaKey,
    chainId: 84532,
    sha256,
    bundleKeySlot: new Uint8Array(32),
  }).reason, 'key_mismatch');
  clearAdmissionCache();
  const first = cachedAdmission({
    slotKey: 'slot', seq: 1, absentAtPrior: true, memberAtEpoch: true, priorAnchor: 10, anchor: 20, block: 15,
  });
  const second = cachedAdmission({
    slotKey: 'slot', seq: 1, absentAtPrior: false, memberAtEpoch: false, priorAnchor: 0, anchor: 1, block: 99,
  });
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.equal(second.ok, true);
  assert.equal(second.block, 15);
  assert.equal(second.cached, true);
  assert.equal(cachedAdmission({
    slotKey: 'other', seq: 1, absentAtPrior: false, memberAtEpoch: true, priorAnchor: 10, anchor: 20, block: 15,
  }).ok, false);
  assert.equal(Object.hasOwn(base, 'otherPayTo'), false);
});

test('T4 the published PoP vector verifies low-S and rejects high-S', () => {
  const key = Buffer.from('0268739255d9bc5e2b747847d240b349248c6bd1d91dd63ef3c0c2ef7fba5fb8d3', 'hex');
  const hash = sha256(Buffer.concat([Buffer.from([0x01]), key]));
  assert.equal(Buffer.from(hash).toString('hex'), '70703a0707c1ba660d772d3b613966bf84599afa8059b29636a613fefbfa9390');
  const d = Buffer.from('44'.repeat(32), 'hex');
  const input = sha256(d);
  assert.equal(Buffer.from(input).toString('hex'), 'bb391415c05e39d77ca17381d3be3f7d0cd5e5332e5a579311adaa0aa62106e9');
  const sig = Buffer.from('2e238cb3c5b55330c113777a6695d5f94e5e4c3f2298dcdd397eb503c5c5c88938f10d7bce3aa35340558528143104c1f9c02ccba0be6026133ad4d15d7dc038', 'hex');
  assert.equal(checkSigma(sig).ok, true);
  assert.equal(pointOnCurve(key, P256), true);
  const canon = canonicalKey(0x01, key);
  assert.equal(canon.ok, true);
  assert.equal(verifyPossession(d, canon.uncompressed, sig).ok, true);
  const s = BigInt(`0x${sig.subarray(32).toString('hex')}`);
  const highS = (P256.order - s).toString(16).padStart(64, '0');
  const high = Buffer.concat([sig.subarray(0, 32), Buffer.from(highS, 'hex')]);
  assert.equal(checkSigma(high).ok, false);
  assert.equal(verifyPossession(d, canon.uncompressed, high).ok, false);
});

test('an empty prior slot, a u16 signature prefix, and the test-vector key', () => {
  clearAdmissionCache();
  const first = cachedAdmission({
    slotKey: 'first', seq: 0, absentAtPrior: false, emptySlotAtPrior: true,
    memberAtEpoch: true, priorAnchor: 10, anchor: 20, block: 15,
  });
  assert.equal(first.ok, true);
  assert.equal(first.block, 15);
  const pop = new Uint8Array(64);
  pop[31] = 1;
  pop[63] = 1;
  const key = Buffer.alloc(33, 2);
  key[0] = 2;
  const body = Buffer.concat([key, Buffer.alloc(8), u16(65), Buffer.alloc(65, 3), u16(64), pop]);
  const opened = parsePayToSlot(body);
  assert.equal(opened.ok, true);
  assert.equal(opened.pop.length, 64);
  assert.equal(opened.payToSignature.length, 65);
  const wide = Buffer.from(body);
  wide[41] = 0;
  wide[42] = 64;
  assert.equal(parsePayToSlot(wide).ok, false);
  const vector = Buffer.from(TEST_VECTOR_KEY_HASH, 'hex');
  const seen = keyStatus({
    schema: KEY_STATUS_SCHEMA,
    block: 100,
    hourStart: 1_700_000_000,
    payToProof: { siblings: [], root: 'aa' },
    keyProof: { siblings: [], root: 'aa' },
    keyLeaf: 'empty',
    registration: {
      admissionBlock: 90,
      expiry: 2_000_000_000n,
      payToSignature: new Uint8Array([1]),
      keySignature: new Uint8Array(64),
      popOk: true,
    },
    slotRevokeBlock: null,
    registrationKeyHash: vector,
    tombstone: null,
  });
  assert.equal(seen.exit, 1);
  assert.equal(seen.print, 'test vector key');
});

test('a short opaque slot value with a matching proof is payment proven', async () => {
  const key = makeKey();
  const built = signedLine();
  const bare = Buffer.from(built.slotValue, 'hex').subarray(0, 33);
  const pay = slotKey({ kind: 1, chainId: 84532, id: built.payment.to });
  const tree = treeOf([{ key: pay.bytes, value: bare }]);
  const doc = bundleFor(key);
  const next = {
    ...built,
    slotValue: hexOf(bare),
    stateRoot: hexOf(tree.root),
    slotProof: hexProof(tree.proof(pay.bytes)),
  };
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(next)] },
    v13Receipt(next),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
  assert.equal(seen.v.message, 'PAYMENT PROVEN');
});

test('a wrong key-slot proof, a wrong payTo proof, a bad possession signature, and a short expiry do not verify', async () => {
  const key = makeKey();
  const doc = bundleFor(key);
  const built = signedLine();
  const tamper = (hex) => `${hex.slice(0, -2)}${hex.endsWith('00') ? 'ff' : '00'}`;
  const wrongKey = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built, { fields: { keySlotProof: tamper(built.keySlotProof) } }), (u) => optionsFor(key, doc, u));
  assert.equal(wrongKey.v.exit_code, 0, wrongKey.v.reason);
  const wrongPay = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built, { fields: { slotProof: tamper(built.slotProof) } }), (u) => optionsFor(key, doc, u));
  assert.equal(wrongPay.v.exit_code, 1);
  assert.equal(wrongPay.v.reason, 'not_in_state');
  const body = Buffer.from(built.slotValue, 'hex');
  body[body.length - 1] ^= 0x01;
  const badPop = rebuildSlot(built, body.toString('hex'));
  const popped = await runScene({ payment: built.payment, logs: [okLog(badPop)] }, v13Receipt(badPop), (u) => optionsFor(key, doc, u));
  assert.equal(popped.v.exit_code, 0, popped.v.reason);
  const short = signedLine({ expiry: 1000n });
  const expired = await runScene({ payment: short.payment, logs: [okLog(short)] }, v13Receipt(short), (u) => optionsFor(key, doc, u));
  assert.equal(expired.v.exit_code, 0, expired.v.reason);
  const broken = Buffer.from(built.slotValue, 'hex').subarray(0, 50);
  const brokenSeen = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { slotValue: broken.toString('hex') } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(brokenSeen.v.exit_code, 1);
  assert.equal(brokenSeen.v.reason, 'not_in_state');
});

test('a receipt hour equal to the retire hour is outside coverage', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key, [pinOf({ retireHourStart: HOUR })]);
  const seen = await runScene({ payment: built.payment, logs: [okLog(built, { hour: HOUR })] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(seen.v.exit_code, 1);
  assert.equal(seen.v.reason, 'hour_outside_coverage');
});

test('a trailing slash does not make a second RPC endpoint', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const seen = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => ({
    ...optionsFor(key, doc, u),
    rpcUrls: [`${u}/`, u],
  }));
  assert.equal(seen.v.exit_code, 2);
  assert.equal(seen.v.reason, 'rpc_unconfigured');
});

test('D23 the CLI refuses a bad shape and an unpinned contract', () => {
  const built = signedLine();
  const dir = mkdtempSync(join(tmpdir(), 'v13cli-'));
  const bad = join(dir, 'bad.json');
  const ok = join(dir, 'ok.json');
  writeFileSync(bad, JSON.stringify({ ...v13Receipt(built), leafHash: built.leaf }));
  writeFileSync(ok, JSON.stringify(v13Receipt(built)));
  const env = { ...process.env, CHIT402_HERMETIC: '1', BASE_RPC_URL: 'http://127.0.0.1:9' };
  const a = spawnSync(process.execPath, [join(HERE, '../dist/cli.js'), bad, '--json'], { env, encoding: 'utf8' });
  const b = spawnSync(process.execPath, [join(HERE, '../dist/cli.js'), ok, '--json'], { env, encoding: 'utf8' });
  assert.equal(a.status, 1, a.stdout + a.stderr);
  assert.equal(b.status, 2, b.stdout + b.stderr);
  assert.match(b.stdout, /contract_not_pinned/);
  assert.match(b.stdout, /anchor contract unaudited/);
});

test('D25 the flip list and the default RPC list are frozen', () => {
  assert.throws(() => { CORPUS_FLIP_LIST.push('x'); });
  assert.equal(Object.isFrozen(V13_RPC_DEFAULTS), true);
  assert.equal(Object.isFrozen(V13_RPC_DEFAULTS[84532]), true);
  assert.ok(V13_RPC_DEFAULTS[84532].length >= 3);
});

test('D01 a caller kid cannot widen the bundled pins', async () => {
  const key = makeKey();
  const att = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const e = signDoc(att, [...doc.entries, historyEntry(att, doc.head_hash)], { narrowing: [], contracts: [pinOf({ address: OTHER })] });
  const r = await runScene({ payment: built.payment, logs: [] }, v13Receipt(built, { contract: OTHER }), (u) => ({
    ...optionsFor(key, doc, u, JSON.stringify(e)),
    trustedKids: [key.kid, att.kid],
  }));
  assert.notEqual(r.v.exit_code, 0);
});

test('D02 an embedded attacker key under the bundled kid is refused', async () => {
  const key = makeKey();
  const att = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const e = ext(att, doc, { narrowing: [] });
  e.issuer_signature.kid = key.kid;
  const r = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u, JSON.stringify(e)));
  assert.equal(r.v.exit_code, 1, r.v.reason);
});

test('D03 a live document signed by another key adds no pin', async () => {
  const key = makeKey();
  const att = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const live = signDoc(att, [...doc.entries, historyEntry(att, doc.head_hash)], { narrowing: [] });
  const fetchImpl = async () => new Response(JSON.stringify(live), { status: 200 });
  const { h } = sceneHandler({ payment: built.payment, logs: [okLog(built)] });
  const server = await listen(h);
  try {
    const out = await checkReceiptInput(JSON.stringify(v13Receipt(built, { contract: OTHER })), { ...optionsFor(key, doc, server.url), fetchImpl });
    assert.equal(out.verdict.exit_code, 2);
    assert.equal(out.verdict.reason, 'contract_not_pinned');
    assert.ok(out.verdict.live_extension);
  } finally {
    await server.close();
  }
});

test('D06 unknown, widening, and unpinned narrowing rows are refused', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = signDoc(key, [historyEntry(key, null)], { contracts: [pinOf({ retireHourStart: HOUR + 7200 })], narrowing: [] });
  const rows = [
    [{ chainId: 84532, address: CONTRACT, revokeAfterEpoch: 9, checkpoint: OTHER }],
    [{ chainId: 84532, address: CONTRACT, retireHourStart: HOUR + 99999 }],
    [{ chainId: 84532, address: OTHER, revokeAfterEpoch: 9 }],
  ];
  for (const row of rows) {
    const e = ext(key, doc, { narrowing: row });
    const r = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u, JSON.stringify(e)));
    assert.equal(r.v.exit_code, 1, JSON.stringify(row));
    assert.equal(r.v.reason, 'extension_widens_pin');
  }
});

test('D08 caller leaf and size spellings are refused', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const cases = [
    ['leaf', 'caller_supplied_leaf'],
    ['leafHash', 'caller_supplied_leaf'],
    ['leaf_hash', 'caller_supplied_leaf'],
    ['treeSize', 'caller_supplied_tree_size'],
    ['tree_size', 'caller_supplied_tree_size'],
    ['size', 'caller_supplied_tree_size'],
    ['root', 'bad_receipt'],
  ];
  for (const [name, reason] of cases) {
    const rec = { ...v13Receipt(built), [name]: name.includes('ize') || name === 'size' ? 1 : built.leaf };
    const out = await checkReceiptInput(JSON.stringify(rec), optionsFor(key, doc, 'http://127.0.0.1:9'));
    assert.equal(out.verdict.exit_code, 1, name);
    assert.equal(out.verdict.reason, reason, name);
  }
});

test('D09 inclusion uses the anchored size', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const other = new Uint8Array(32).fill(7);
  const left = leafHash(other).hash;
  const root2 = hexOf(nodeHash(left, leafHash(built.line).hash).hash);
  const rec = v13Receipt(built, { proof: [hexOf(left)] });
  rec.index = 1;
  const good = await runScene({ payment: built.payment, logs: [okLog(built, { root: root2, size: 2 })] }, rec, (u) => optionsFor(key, doc, u));
  assert.equal(good.v.exit_code, 0, good.v.reason);
  for (const size of [3, 4]) {
    const bad = await runScene({ payment: built.payment, logs: [okLog(built, { root: root2, size })] }, rec, (u) => optionsFor(key, doc, u));
    assert.equal(bad.v.exit_code, 1, `size ${size}`);
    assert.equal(bad.v.reason, 'not_in_log');
  }
});

test('D10 an anchored size above the cap is refused', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  for (const size of [2n ** 64n, 2n ** 53n, 2n ** 256n - 1n]) {
    const r = await runScene({ payment: built.payment, logs: [okLog(built, { size })] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
    assert.equal(r.v.exit_code, 1, String(size));
    assert.equal(r.v.reason, 'tree_size_above_cap');
  }
});

test('D11 the payment block is read by hash', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const ok = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(ok.v.exit_code, 0);
  assert.ok(ok.calls.some(([method, params]) => method === 'eth_getBlockByHash' && params[0] === `0x${built.payment.blockHash}`));
  assert.equal(ok.calls.some(([, params]) => JSON.stringify(params).includes('latest')), false);
  const re = await runScene({ payment: built.payment, logs: [okLog(built)], reorg: true }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(re.v.exit_code, 1);
  assert.equal(re.v.reason, 'reorged');
});

test('D12 a payment block past finalized is exit 2', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const above = await runScene({ payment: built.payment, logs: [okLog(built)], payBlockNumber: `0x${(FIN + 1).toString(16)}` }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(above.v.exit_code, 2);
  assert.equal(above.v.reason, 'block_not_final');
  const at = await runScene({ payment: built.payment, logs: [okLog(built)], payBlockNumber: `0x${FIN.toString(16)}` }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(at.v.exit_code, 0, at.v.reason);
});

test('D13 a txHash at the wrong index is a payment mismatch', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [okLog(built)], txs: [`0x${'01'.repeat(32)}`, `0x${built.payment.txHash}`] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 1);
  assert.equal(r.v.reason, 'payment_mismatch');
});

test('D16 and D17 the hourly close is the finalized boundary', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const fast = okLog(built, { kind: 1, stateRoot: '00'.repeat(32), block: FIN });
  const hourly = okLog(built, { epoch: 2, kind: 0, size: 2, block: FIN + 1 });
  const pending = await runScene({ payment: built.payment, logs: [fast, hourly] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(pending.v.exit_code, 1);
  assert.equal(pending.v.reason, 'not_in_state');
  const landed = okLog(built, { epoch: 2, kind: 0, size: 2, block: FIN });
  const final = await runScene({ payment: built.payment, logs: [okLog(built, { kind: 1, stateRoot: '00'.repeat(32), block: FIN - 1 }), landed] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(final.v.exit_code, 0, final.v.reason);
});

test('D18 a head past finalized is pre-anchor', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [okLog(built, { block: FIN + 1 })] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 2);
  assert.equal(r.v.reason, 'pre_anchor');
});

test('D22 empty code does not match the pin', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const r = await runScene({ payment: built.payment, logs: [okLog(built)], code: '0x' }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(r.v.exit_code, 1);
  assert.equal(r.v.reason, 'code_hash_mismatch');
});

test('D24 the library maps exit 0 and cannot add a pin', async () => {
  const key = makeKey();
  const att = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const { h } = sceneHandler({ payment: built.payment, logs: [okLog(built)] });
  const server = await listen(h);
  try {
    const good = await verifyReceipt(v13Receipt(built), optionsFor(key, doc, server.url));
    assert.equal(good.verdict.exit_code, 0);
    assert.equal(good.overall, 'verified');
    const shape = await verifyReceipt({ ...v13Receipt(built), size: 9 }, optionsFor(key, doc, server.url));
    assert.equal(shape.verdict.exit_code, 1);
    assert.equal(shape.overall, 'failed');
    const e = signDoc(att, [...doc.entries, historyEntry(att, doc.head_hash)], { narrowing: [] });
    const unp = await verifyReceipt(v13Receipt(built, { contract: OTHER }), {
      ...optionsFor(key, doc, server.url, JSON.stringify(e)),
      trustedKids: [key.kid, att.kid],
    });
    assert.notEqual(unp.verdict.exit_code, 0);
  } finally {
    await server.close();
  }
});

test('D27 version 13 lookalikes are not dispatched', () => {
  assert.equal(isExactV13Receipt({ v: 13n }), false);
  assert.equal(isExactV13Receipt({ v: '13', schema: 'chit402.cs2.receipt.v1' }), false);
  assert.equal(isExactV13Receipt({ v: 13, schema: 'chit402.cs2.receipt.v1 ' }), false);
  assert.equal(isExactV13Receipt({ v: 13, schema: 'CHIT402.cs2.receipt.v1' }), false);
});

function rebuildSlot(built, slotHex, keyValue = null) {
  const v = Buffer.from(slotHex, 'hex');
  const payKey = slotKey({ kind: 1, chainId: 84532, id: built.payment.to });
  const hash = sha256(Buffer.concat([Buffer.from([1]), v.subarray(0, 33)]));
  const keySlot = keySlotKey(84532, hash, sha256);
  const leaves = [{ key: payKey.bytes, value: v }];
  if (keyValue && keyValue.length > 0) leaves.push({ key: keySlot, value: Buffer.from(keyValue) });
  const tree = treeOf(leaves);
  return {
    ...built,
    slotValue: slotHex,
    stateRoot: hexOf(tree.root),
    slotProof: hexProof(tree.proof(payKey.bytes)),
    keySlotProof: hexProof(tree.proof(keySlot)),
  };
}

test('a missing key proof cannot be checked', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { slotProof: 'ff'.repeat(32) } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 1, seen.v.reason);
  assert.equal(seen.v.reason, 'not_in_state');
});

test('a malformed key leaf cannot be checked', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const junk = Buffer.alloc(7, 7);
  const next = rebuildSlot(built, built.slotValue, junk);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(next)] },
    v13Receipt(next, { fields: { keySlotValue: hexOf(junk) } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
});

test('two key records in one leaf are ambiguous', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const pair = Buffer.alloc((8 + 8 + 8 + 64) * 2, 4);
  const next = rebuildSlot(built, built.slotValue, pair);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(next)] },
    v13Receipt(next, { fields: { keySlotValue: hexOf(pair) } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
});

test('an absent slot with a matching proof is payment proven', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const emptyRoot = smtBlank(256);
  assert.equal(emptyRoot.ok, true);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(built, { stateRoot: hexOf(emptyRoot.bytes) })] },
    v13Receipt(built, { fields: { slotValue: undefined, slotProof: '00'.repeat(32), keySlotProof: '00'.repeat(32) } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
  assert.equal(seen.v.message, 'PAYMENT PROVEN');
});

test('an expired key is refused', async () => {
  const key = makeKey();
  const built = signedLine({ expiry: BigInt(HOUR) });
  const doc = bundleFor(key);
  const seen = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
});

test('a key admitted after the payment block is unadmitted', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { admissionBlock: 102 } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
});

test('PRD-2 a 1-byte junk payTo signature is refused', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const s = built.slotValue;
  const junk = `${s.slice(0, 82)}0001ff${s.slice(82 + 4 + 130)}`;
  const next = rebuildSlot(built, junk);
  const seen = await runScene({ payment: built.payment, logs: [okLog(next)] }, v13Receipt(next), (u) => optionsFor(key, doc, u));
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
});

test('PRD-4 expiry equal to the receipt hour is refused and the next second verifies', async () => {
  const key = makeKey();
  const doc = bundleFor(key);
  const early = signedLine({ expiry: BigInt(HOUR) });
  const refused = await runScene({ payment: early.payment, logs: [okLog(early)] }, v13Receipt(early), (u) => optionsFor(key, doc, u));
  assert.equal(refused.v.exit_code, 0, refused.v.reason);
  const later = signedLine({ expiry: BigInt(HOUR) + 1n });
  const ok = await runScene({ payment: later.payment, logs: [okLog(later)] }, v13Receipt(later), (u) => optionsFor(key, doc, u));
  assert.equal(ok.v.exit_code, 0, ok.v.reason);
});

test('PRD-5 a revoked key exits revoked', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const hashed = sha256(Buffer.concat([Buffer.from([1]), built.sellerKey]));
  const revoke = hashChit('RevokeByKey', { keyHash: hashed }, 84532n, CONTRACT.slice(2));
  assert.equal(revoke.ok, true);
  const sig = signLow(revoke.bytes, built.keyScalar, P256);
  assert.ok(sig);
  const tomb = Buffer.concat([
    expiryBytes(90n),
    expiryBytes(50n),
    expiryBytes(105n),
    Buffer.from(sig.raw),
  ]);
  const next = rebuildSlot(built, built.slotValue, tomb);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(next)] },
    v13Receipt(next, { fields: { keySlotValue: hexOf(tomb) } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
});

test('PRD-5 a key-slot sibling that does not verify stays unproven', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { slotProof: '77'.repeat(32) } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 1, seen.v.reason);
  assert.equal(seen.v.reason, 'not_in_state');
});

test('PRD-7 localhost and the IPv6 loopback are the same host as 127.0.0.1', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const names = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => ({
    ...optionsFor(key, doc, u),
    rpcUrls: [u, u.replaceAll('127.0.0.1', 'localhost')],
  }));
  assert.equal(names.v.exit_code, 2, names.v.reason);
  assert.equal(names.v.reason, 'rpc_unconfigured');
  const v6 = await runScene({ payment: built.payment, logs: [okLog(built)] }, v13Receipt(built), (u) => {
    const port = new URL(u).port;
    return {
      ...optionsFor(key, doc, u),
      rpcUrls: [u, `http://[::1]:${port}`],
    };
  });
  assert.equal(v6.v.exit_code, 2, v6.v.reason);
  assert.equal(v6.v.reason, 'rpc_unconfigured');
});

test('a high-S line sigma is invalid', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const line = Buffer.from(built.line);
  const sigmaAt = LAYOUT.sigma + 1;
  const s = bytesToBig(line.subarray(sigmaAt + 32, sigmaAt + 64));
  line.set(bigToBytes(P256.order - s, 32), sigmaAt + 32);
  const leaf = hexOf(leafHash(line).hash);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(built, { root: leaf })] },
    { ...v13Receipt(built), line: hexOf(line) },
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 1, seen.v.reason);
  assert.equal(seen.v.reason, 'sigma_not_core');
});

test('two RPCs that disagree stay exit 2', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const seen = await runScene({ payment: built.payment, logs: [okLog(built)], disagree: true }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(seen.v.exit_code, 2, seen.v.reason);
  assert.equal(seen.v.reason, 'rpc_disagreement');
});

test('one answering RPC is not enough', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const seen = await runScene({ payment: built.payment, logs: [okLog(built)], failSecond: true }, v13Receipt(built), (u) => optionsFor(key, doc, u));
  assert.equal(seen.v.exit_code, 2, seen.v.reason);
});

test('a signed domain with the wrong name is refused', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const domain = { ...built.signedDomain, name: 'Other' };
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { signedDomain: domain } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
  const missing = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { signedDomain: undefined } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(missing.v.exit_code, 0, missing.v.reason);
});

test('an admission block outside the anchors is unproven', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const seen = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { admissionBlock: 50 } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(seen.v.exit_code, 0, seen.v.reason);
});

test('the retire hour is outside admittingContract coverage', () => {
  const pins = [{ address: CONTRACT, chainId: 84532, genesisHourStart: HOUR, retireHourStart: HOUR + 3600 }];
  assert.equal(admittingContract(pins, 84532, HOUR), CONTRACT);
  assert.equal(admittingContract(pins, 84532, HOUR + 3600), null);
});

test('the shared state fixtures verify membership, absence, revocation, and a blank key slot', () => {
  const dir = join(HERE, '../../cs2-core/smt-fixtures');
  const sums = readFileSync(join(dir, 'SHA256SUMS'));
  assert.equal(createHash('sha256').update(sums).digest('hex'), '189083cf310a6445f9cd65c973b01937405c72c395443ba15d12a548d5bada4e');
  const files = {};
  for (const line of sums.toString('utf8').trim().split('\n')) {
    const [digest, name] = line.split('  ');
    const bytes = readFileSync(join(dir, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, name);
    files[name] = bytes;
  }
  const root = new Uint8Array(files['root.bytes']);
  const member = (slotName, valueName, proofName) => verifyProof(
    new Uint8Array(files[slotName]),
    new Uint8Array(files[valueName]),
    new Uint8Array(files[proofName]),
    root,
  ).ok;
  const absent = (slotName, proofName) => verifyProof(
    new Uint8Array(files[slotName]),
    null,
    new Uint8Array(files[proofName]),
    root,
  ).ok;
  assert.equal(member('payto-slot.bytes', 'payto-value.bytes', 'payto-member.proof'), true);
  assert.equal(absent('absent-payto-slot.bytes', 'absent-payto.proof'), true);
  assert.equal(member('key-slot.bytes', 'key-value.bytes', 'key-member.proof'), true);
  assert.equal(absent('blank-key-slot.bytes', 'blank-key.proof'), true);
  const flipped = Buffer.from(files['blank-key.proof']);
  flipped[flipped.length - 1] ^= 0x01;
  assert.equal(verifyProof(new Uint8Array(files['blank-key-slot.bytes']), null, new Uint8Array(flipped), root).ok, false);
});

test('shared-module checks are not passed literal booleans', () => {
  const root = join(HERE, '../src/v13');
  const names = ['memberAtEpoch', 'absentAtPrior', 'absentAtPrev', 'emptySlotAtPrior', 'emptyAtPrev', 'popOk'];
  const pattern = new RegExp(`\\b(${names.join('|')})\\s*:\\s*(true|false)\\b`);
  for (const file of ['verify.ts', 'key-record.ts', 'slot.ts', 'core/decide.ts']) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.equal(pattern.test(text), false, file);
  }
});

test('algorithm 0 is required and a nonzero sigma byte is not a core receipt', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const alg = Buffer.from(built.line);
  alg[LAYOUT.sigma] = 1;
  const algLeaf = hexOf(leafHash(alg).hash);
  const algSeen = await runScene(
    { payment: built.payment, logs: [okLog(built, { root: algLeaf })] },
    { ...v13Receipt(built), line: hexOf(alg) },
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(algSeen.v.exit_code, 1, algSeen.v.reason);
  assert.equal(algSeen.v.reason, 'sigma_not_core');
  const byte = Buffer.from(built.line);
  byte[LAYOUT.sigma + 1] = 1;
  const byteLeaf = hexOf(leafHash(byte).hash);
  const byteSeen = await runScene(
    { payment: built.payment, logs: [okLog(built, { root: byteLeaf })] },
    { ...v13Receipt(built), line: hexOf(byte) },
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(byteSeen.v.exit_code, 1, byteSeen.v.reason);
  assert.equal(byteSeen.v.reason, 'sigma_not_core');
});

test('a receipt with no seller key and no slot key cannot check state', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const noKey = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { keySlotProof: undefined, keySlotValue: undefined, signedDomain: undefined } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(noKey.v.exit_code, 0, noKey.v.reason);
  assert.equal(noKey.v.message, 'PAYMENT PROVEN');
  const noSlot = await runScene(
    { payment: built.payment, logs: [okLog(built)] },
    v13Receipt(built, { fields: { slotKey: undefined } }),
    (u) => optionsFor(key, doc, u),
  );
  assert.equal(noSlot.v.exit_code, 2, noSlot.v.reason);
  assert.equal(noSlot.v.reason, 'state_unproven');
});

test('one repeated RPC URL is not two endpoints', async () => {
  const key = makeKey();
  const built = signedLine();
  const doc = bundleFor(key);
  const { h } = sceneHandler({ payment: built.payment, logs: [okLog(built)] });
  const server = await listen(h);
  try {
    const opts = optionsFor(key, doc, server.url);
    opts.rpcUrls = [server.url, server.url];
    const out = await checkReceiptInput(JSON.stringify(v13Receipt(built)), opts);
    assert.equal(out.verdict.exit_code, 2);
    assert.equal(out.verdict.reason, 'rpc_unconfigured');
  } finally {
    await server.close();
  }
});
