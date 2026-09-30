/**
 * Solana SPL Memo anchor for the daily receipt root.
 * The connection is mocked. No RPC and no secret file is touched.
 */
import crypto from 'crypto';
import fs from 'fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const {
  ReceiptMerkleTree,
  verifyTreeHead,
  dailyAnchorDue,
  ANCHOR_RETRY_MS,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');

const {
  base58Decode,
  base58Encode,
  buildSignedMemoTransaction,
  describeSolanaAnchor,
  jsonRpcConnection,
  MEMO_PROGRAM_ID,
  parseAnchorMemo,
  parseSolanaSecretKey,
  publicKeyFromSeed,
  solanaAnchorMemo,
  ZERO_ROOT,
} = await import('../src/solana-receipt-anchor.js');

const ENV_KEYS = [
  'SOLANA_ANCHOR_SECRET_KEY',
  'SOLANA_RPC_URL',
  'SOLANA_ANCHOR_CLUSTER',
  'RECEIPT_ANCHOR_PRIVATE_KEY',
  'RECEIPT_ANCHOR_FROM',
  'BASE_RPC_URL',
  'SETTLEMENT_RPC_URL',
];

function solanaKeypair() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const spki = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = Buffer.from(spki.subarray(spki.length - 32));
  const secret = Buffer.concat([Buffer.from(seed), publicKey]);
  return {
    secret,
    publicKey,
    json: JSON.stringify([...secret]),
    base58: base58Encode(secret),
  };
}

function mockConnection(behavior = {}) {
  const sent = [];
  const connection = {
    sent,
    async getLatestBlockhash() {
      return { blockhash: base58Encode(Buffer.alloc(32, 9)) };
    },
    async sendRawTransaction(raw) {
      if (behavior.failSends > 0) {
        behavior.failSends -= 1;
        throw new Error('rpc down');
      }
      const buf = Buffer.from(raw);
      sent.push(buf);
      return base58Encode(Buffer.alloc(64, sent.length));
    },
    async confirmTransaction() {
      if (behavior.confirmError) throw new Error(behavior.confirmError);
      return { slot: 424242 };
    },
  };
  return connection;
}

async function withEnv(values, fn) {
  const prev = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
    resetReceiptMerkleTree();
  }
}

test('base58 round-trips and the memo program id is 32 bytes', () => {
  assert.equal(base58Encode(Buffer.alloc(1, 0)), '1');
  assert.equal(base58Encode(Buffer.alloc(32, 0)), '1'.repeat(32));
  const sample = Buffer.from('chit402-root-anchor-key-material!!');
  assert.deepEqual(base58Decode(base58Encode(sample)), sample);
  assert.equal(base58Decode(MEMO_PROGRAM_ID).length, 32);
});

test('JSON and base58 secret keys are the same keypair', () => {
  const kp = solanaKeypair();
  const fromJson = parseSolanaSecretKey(kp.json);
  const fromB58 = parseSolanaSecretKey(kp.base58);
  assert.deepEqual(fromJson.publicKey, kp.publicKey);
  assert.deepEqual(fromB58.publicKey, kp.publicKey);
  assert.throws(() => parseSolanaSecretKey('[1,2,3]'), /bad_key/);
  const tampered = Buffer.from(kp.secret);
  tampered[40] ^= 0xff;
  assert.throws(() => parseSolanaSecretKey(JSON.stringify([...tampered])), /bad_key/);
  assert.deepEqual(publicKeyFromSeed(kp.secret.subarray(0, 32)), kp.publicKey);
});

test('memo text names scope, day, root, and the previous root', () => {
  const root = 'ab'.repeat(32);
  const memo = solanaAnchorMemo({
    scope: 'global',
    day: '2026-09-30',
    rootHex: root,
    prevRootHex: ZERO_ROOT,
  });
  assert.equal(memo, `chit402:root:v1:global:2026-09-30:${root}:${ZERO_ROOT}`);
  assert.deepEqual(parseAnchorMemo(memo), {
    scope: 'global',
    day: '2026-09-30',
    root,
    prev: ZERO_ROOT,
  });
  assert.equal(parseAnchorMemo('not-a-memo'), null);
});

test('a signed memo transaction verifies and carries the memo bytes', () => {
  const kp = solanaKeypair();
  const memo = solanaAnchorMemo({
    scope: 'global',
    day: '2026-09-30',
    rootHex: 'cd'.repeat(32),
  });
  const blockhash = base58Encode(Buffer.alloc(32, 9));
  const tx = buildSignedMemoTransaction({
    seed: kp.secret.subarray(0, 32),
    publicKey: kp.publicKey,
    blockhash,
    memo,
  });
  assert.equal(tx[0], 1);
  const signature = tx.subarray(1, 65);
  const message = tx.subarray(65);
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([spkiPrefix, kp.publicKey]),
    format: 'der',
    type: 'spki',
  });
  assert.equal(crypto.verify(null, message, publicKey, signature), true);
  assert.equal(message.includes(Buffer.from(memo, 'utf8')), true);
  assert.equal(message.includes(base58Decode(MEMO_PROGRAM_ID)), true);
});

test('unset Solana env stays pending and does not call the connection', async () => {
  await withEnv({}, async () => {
    const connection = mockConnection();
    const described = await describeSolanaAnchor({
      rootHex: '11'.repeat(32),
      day: '2026-09-30',
      connection,
    });
    assert.equal(described.status, 'pending');
    assert.equal(described.reason, 'no_key');
    assert.equal(described.signature, null);
    assert.equal(connection.sent.length, 0);
    assert.match(described.memo, /^chit402:root:v1:global:2026-09-30:/);
  });
});

test('mocked connection records signature, slot, cluster, and memo', async () => {
  const kp = solanaKeypair();
  const connection = mockConnection();
  await withEnv({
    SOLANA_ANCHOR_SECRET_KEY: kp.json,
    SOLANA_ANCHOR_CLUSTER: 'devnet',
  }, async () => {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('row-1', 'hash-1');
    await new Promise((resolve) => setImmediate(resolve));
    const head = await tree.publishHead({
      force: true,
      now: '2026-09-30T15:00:00.000Z',
      solanaConnection: connection,
    });
    assert.equal(head.anchors.solana.status, 'anchored');
    assert.equal(head.anchors.solana.cluster, 'devnet');
    assert.equal(head.anchors.solana.slot, 424242);
    assert.equal(head.anchors.base.status, 'pending');
    assert.equal(head.anchors.base.reason, 'no_key');
    assert.match(head.anchors.solana.memo, /^chit402:root:v1:global:2026-09-30:/);
    assert.match(head.anchors.solana.memo, new RegExp(`${head.root}:${ZERO_ROOT}$`));
    assert.equal(connection.sent.length, 1);
    assert.equal(connection.sent[0].includes(Buffer.from(head.anchors.solana.memo)), true);
    assert.equal(JSON.stringify(head).includes(kp.json), false);
    assert.equal(verifyTreeHead(head).valid, true);
    const { renderInclusionSection } = await import('../src/receipt-merkle.js');
    assert.match(renderInclusionSection(tree.inclusion('row-1')), /anchored in Solana tx/);
    const again = await tree.publishHead({
      force: true,
      now: '2026-09-30T16:00:00.000Z',
      solanaConnection: connection,
    });
    assert.equal(connection.sent.length, 1);
    assert.equal(again.anchors.solana.signature, head.anchors.solana.signature);
    assert.equal(again.anchors.solana.slot, head.anchors.solana.slot);
  });
});

test('a failed send stays pending and a later publish retries once', async () => {
  const kp = solanaKeypair();
  const connection = mockConnection({ failSends: 1 });
  await withEnv({
    SOLANA_ANCHOR_SECRET_KEY: kp.base58,
    SOLANA_ANCHOR_CLUSTER: 'devnet',
  }, async () => {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('row-1', 'hash-1');
    await new Promise((resolve) => setImmediate(resolve));
    const failed = await tree.publishHead({
      force: true,
      now: '2026-09-30T15:00:00.000Z',
      solanaConnection: connection,
    });
    assert.equal(failed.anchors.solana.status, 'pending');
    assert.match(failed.anchors.solana.reason, /rpc down/);
    assert.equal(connection.sent.length, 0);
    const anchored = await tree.publishHead({
      force: true,
      now: '2026-09-30T15:05:00.000Z',
      solanaConnection: connection,
    });
    assert.equal(anchored.anchors.solana.status, 'anchored');
    assert.equal(connection.sent.length, 1);
    assert.equal(verifyTreeHead(anchored).valid, true);
    const fresh = new Date('2026-09-30T15:00:30.000Z');
    assert.equal(dailyAnchorDue(failed, fresh), false);
    const later = new Date('2026-09-30T15:02:00.000Z');
    assert.equal(dailyAnchorDue(failed, later), true);
    assert.equal(ANCHOR_RETRY_MS, 60_000);
    assert.equal(dailyAnchorDue(anchored, later), false);
  });
});

test('a day that already anchored a different root is not sent again', async () => {
  const kp = solanaKeypair();
  const connection = mockConnection();
  await withEnv({
    SOLANA_ANCHOR_SECRET_KEY: kp.json,
    SOLANA_ANCHOR_CLUSTER: 'mainnet-beta',
  }, async () => {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('row-1', 'hash-1');
    await new Promise((resolve) => setImmediate(resolve));
    const first = await tree.publishHead({
      force: true,
      now: '2026-09-29T12:00:00.000Z',
      solanaConnection: connection,
    });
    tree.appendReceipt('row-2', 'hash-2');
    const secondDay = await tree.publishHead({
      force: true,
      now: '2026-09-30T12:00:00.000Z',
      solanaConnection: connection,
    });
    assert.equal(connection.sent.length, 2);
    assert.match(secondDay.anchors.solana.memo, new RegExp(`:${first.root}$`));
    tree.appendReceipt('row-3', 'hash-3');
    const grown = await tree.publishHead({
      force: true,
      now: '2026-09-30T18:00:00.000Z',
      solanaConnection: connection,
    });
    assert.equal(connection.sent.length, 2);
    assert.equal(grown.anchors.solana.status, 'pending');
    assert.equal(grown.anchors.solana.reason, 'day_already_anchored');
    assert.equal(grown.anchors.solana.signature, null);
    assert.equal(grown.anchors.solana.prior_signature, secondDay.anchors.solana.signature);
  });
});

test('confirm timeout still records the broadcast signature', async () => {
  const kp = solanaKeypair();
  const connection = mockConnection({ confirmError: 'confirm_timeout' });
  await withEnv({
    SOLANA_ANCHOR_SECRET_KEY: kp.json,
    SOLANA_ANCHOR_CLUSTER: 'devnet',
  }, async () => {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('row-1', 'hash-1');
    await new Promise((resolve) => setImmediate(resolve));
    const head = await tree.publishHead({
      force: true,
      now: '2026-09-30T12:00:00.000Z',
      solanaConnection: connection,
    });
    assert.equal(head.anchors.solana.status, 'anchored');
    assert.equal(head.anchors.solana.slot, null);
    assert.equal(typeof head.anchors.solana.signature, 'string');
  });
});

test('jsonRpcConnection posts memo bytes and reads the slot', async () => {
  const kp = solanaKeypair();
  const calls = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.method);
    if (body.method === 'getLatestBlockhash') {
      return { ok: true, json: async () => ({ result: { value: { blockhash: base58Encode(Buffer.alloc(32, 4)) } } }) };
    }
    if (body.method === 'sendTransaction') {
      const raw = Buffer.from(body.params[0], 'base64');
      assert.equal(raw.includes(Buffer.from('chit402:root:v1:')), true);
      return { ok: true, json: async () => ({ result: base58Encode(Buffer.alloc(64, 3)) }) };
    }
    if (body.method === 'getSignatureStatuses') {
      return { ok: true, json: async () => ({ result: { value: [{ slot: 77, confirmationStatus: 'confirmed', err: null }] } }) };
    }
    throw new Error(body.method);
  };
  await withEnv({
    SOLANA_ANCHOR_SECRET_KEY: kp.base58,
    SOLANA_RPC_URL: 'https://example.invalid',
    SOLANA_ANCHOR_CLUSTER: 'devnet',
  }, async () => {
    const connection = jsonRpcConnection('https://example.invalid', fetchImpl);
    const described = await describeSolanaAnchor({
      rootHex: 'ee'.repeat(32),
      day: '2026-09-30',
      scope: 'smoke',
      connection,
    });
    assert.equal(described.status, 'anchored');
    assert.equal(described.slot, 77);
    assert.equal(described.cluster, 'devnet');
    assert.match(described.memo, /^chit402:root:v1:smoke:2026-09-30:/);
    assert.deepEqual(calls, ['getLatestBlockhash', 'sendTransaction', 'getSignatureStatuses']);
  });
});

test('the devnet smoke script refuses mainnet and a missing key', () => {
  const script = fileURLToPath(new URL('../../../scripts/solana-anchor-smoke', import.meta.url));
  const baseEnv = { ...process.env };
  delete baseEnv.SOLANA_ANCHOR_SECRET_KEY;
  delete baseEnv.SOLANA_RPC_URL;
  const missing = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...baseEnv, SOLANA_ANCHOR_CLUSTER: 'devnet' },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SOLANA_ANCHOR_SECRET_KEY/);
  const mainnet = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...baseEnv, SOLANA_ANCHOR_CLUSTER: 'mainnet-beta', SOLANA_ANCHOR_SECRET_KEY: 'not-a-key' },
  });
  assert.equal(mainnet.status, 2);
  assert.match(mainnet.stderr, /devnet/);
});

test('the anchor module does not read environment files', () => {
  const src = fs.readFileSync(new URL('../src/solana-receipt-anchor.js', import.meta.url), 'utf8');
  assert.equal(src.includes('dotenv'), false);
  assert.equal(src.includes('readFile'), false);
  assert.equal(src.includes('SOLANA_ANCHOR_SECRET_KEY'), true);
});
