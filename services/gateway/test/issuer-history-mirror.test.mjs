/**
 * The mirror is a commit pin the operator publishes. The gateway does not
 * push. /.well-known/issuer-history.json stays the announcement copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { jcsRfc8785 } = await import('../src/offer-receipt.js');
const {
  assertIssuerHistoryMirrorBoot,
  issuerHistoryMirrorAnnouncement,
  issuerHistoryMirrorClaim,
  issuerHistoryMirrorFileBytes,
  readIssuerHistoryMirrorConfig,
  writeIssuerHistoryMirror,
  ISSUER_HISTORY_MIRROR_SCHEMA,
} = await import('../src/issuer-history-mirror.js');
const {
  currentIssuerHistory,
  resetIssuerHistoryStore,
} = await import('../src/issuer-history.js');
const { buildReceipt, decodeReceiptClaims } = await import('../src/receipt.js');
const { assertIssuerRootStartup, _resetIssuerRootStartupState, KEY_RETIRED_TOPIC } = await import('../src/issuer-root.js');
const { _resetIssuerKey } = await import('../src/issuer-key.js');
const { buildLegacyReceiptSet } = await import('../src/legacy-receipt-merkle.js');

const CHAIN = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/issuer-root-chain.json', import.meta.url)), 'utf8'));
const MIRROR_SOURCE = fs.readFileSync(fileURLToPath(new URL('../src/issuer-history-mirror.js', import.meta.url)), 'utf8');

const ENV_KEYS = [
  'ISSUER_ROOT_ENABLED',
  'ISSUER_ROOT_CHAIN_ID',
  'ISSUER_ROOT_REGISTRY',
  'ISSUER_ROOT_SEQ',
  'ISSUER_ROOT_HASH',
  'ISSUER_ROOT_STARTUP_CHECK',
  'ISSUER_ROOT_RPC_URL',
  'ISSUER_ROOT_RPC_URL_2',
  'ISSUER_ROOT_CUTOVER',
  'ISSUER_ROOT_LEGACY_SET',
  'ISSUER_PRIVATE_KEY',
  'ISSUER_KEY_NOT_BEFORE',
  'ISSUER_HISTORY_MIRROR_REPO',
  'ISSUER_HISTORY_MIRROR_COMMIT',
  'ISSUER_HISTORY_MIRROR_SHA256',
  'ISSUER_HISTORY_MIRROR_PATH',
];

function snapshotEnv() {
  const prev = {};
  for (const key of ENV_KEYS) prev[key] = process.env[key];
  return prev;
}

function restoreEnv(prev) {
  for (const key of ENV_KEYS) {
    if (prev[key] == null) delete process.env[key];
    else process.env[key] = prev[key];
  }
  _resetIssuerKey();
  resetIssuerHistoryStore();
  _resetIssuerRootStartupState();
}

function useStableKey() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.ISSUER_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
  _resetIssuerKey();
  resetIssuerHistoryStore();
}

function paidTask(taskId) {
  return {
    taskId,
    status: 'completed',
    createdAt: '2026-09-26T17:27:32Z',
    updatedAt: '2026-09-26T17:27:32Z',
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:0x${'ab'.repeat(32)}`,
      amount: '2000',
      modelId: 'theta/qwen3',
    },
    meta: {
      payerWallet: '0x1111111111111111111111111111111111111111',
      payTo: '0x2222222222222222222222222222222222222222',
      provider: 'theta-edgecloud',
      agentId: 4,
      quotedAmount: '2000',
      boundSettledAmount: '2000',
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3', output: 'private' },
  };
}

function pinMirror(record, { repo = 'example-org/issuer-history', commit = 'a'.repeat(40), mirrorPath = '' } = {}) {
  process.env.ISSUER_HISTORY_MIRROR_REPO = repo;
  process.env.ISSUER_HISTORY_MIRROR_COMMIT = commit;
  process.env.ISSUER_HISTORY_MIRROR_SHA256 = record.hash;
  if (mirrorPath) process.env.ISSUER_HISTORY_MIRROR_PATH = mirrorPath;
  else delete process.env.ISSUER_HISTORY_MIRROR_PATH;
}

test('the mirror module does not push or fetch', () => {
  assert.equal(MIRROR_SOURCE.includes('child_process'), false);
  assert.equal(MIRROR_SOURCE.includes('git push'), false);
  assert.equal(MIRROR_SOURCE.includes('fetch('), false);
  assert.equal(readIssuerHistoryMirrorConfig({}).configured, false);
  assert.equal(assertIssuerHistoryMirrorBoot({}), null);
});

test('a partial pin fails closed and a github URL normalizes to owner/name', () => {
  assert.throws(
    () => assertIssuerHistoryMirrorBoot({ ISSUER_HISTORY_MIRROR_REPO: 'example-org/issuer-history' }),
    /incomplete/,
  );
  assert.throws(
    () => assertIssuerHistoryMirrorBoot({
      ISSUER_HISTORY_MIRROR_REPO: 'example-org/issuer-history',
      ISSUER_HISTORY_MIRROR_COMMIT: 'main',
      ISSUER_HISTORY_MIRROR_SHA256: 'ab'.repeat(32),
    }),
    /ISSUER_HISTORY_MIRROR_COMMIT/,
  );
  assert.throws(
    () => assertIssuerHistoryMirrorBoot({
      ISSUER_HISTORY_MIRROR_REPO: 'https://user:token@github.com/example-org/issuer-history',
      ISSUER_HISTORY_MIRROR_COMMIT: 'a'.repeat(40),
      ISSUER_HISTORY_MIRROR_SHA256: 'ab'.repeat(32),
    }),
    /ISSUER_HISTORY_MIRROR_REPO/,
  );
  const cfg = assertIssuerHistoryMirrorBoot({
    ISSUER_HISTORY_MIRROR_REPO: 'https://github.com/example-org/issuer-history.git',
    ISSUER_HISTORY_MIRROR_COMMIT: 'a'.repeat(40),
    ISSUER_HISTORY_MIRROR_SHA256: 'ab'.repeat(32),
    ISSUER_HISTORY_MIRROR_PATH: 'docs/issuer-history.json',
  });
  assert.equal(cfg.repo, 'example-org/issuer-history');
  assert.equal(cfg.path, 'docs/issuer-history.json');
  assert.throws(
    () => assertIssuerHistoryMirrorBoot({
      ISSUER_HISTORY_MIRROR_REPO: 'example-org/issuer-history',
      ISSUER_HISTORY_MIRROR_COMMIT: 'b'.repeat(40),
      ISSUER_HISTORY_MIRROR_SHA256: 'cd'.repeat(32),
      ISSUER_HISTORY_MIRROR_PATH: '../issuer-history.json',
    }),
    /ISSUER_HISTORY_MIRROR_PATH/,
  );
});

test('flag-off receipts omit the pin and the history document is not the custodian', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    const plain = buildReceipt(paidTask('xfuel-mirror-off'), { signingSecret: 's', agentId: 4 });
    const record = currentIssuerHistory();
    pinMirror(record);
    const again = buildReceipt(paidTask('xfuel-mirror-off-2'), { signingSecret: 's', agentId: 4 });
    const claims = decodeReceiptClaims(again);
    assert.equal(claims.payload_version, 10);
    assert.equal(Object.hasOwn(claims, 'issuer_history_mirror'), false);
    assert.equal(again.issuer_signature.canonical_preimage.includes('issuer_history_mirror'), false);
    assert.equal(plain.issuer_signature.canonical_preimage.includes('issuer_history_mirror'), false);
    const history = currentIssuerHistory();
    assert.equal(history.body.includes('example-org/issuer-history'), false);
    assert.equal(history.body.includes('issuer_history_mirror'), false);
    const announced = issuerHistoryMirrorAnnouncement(history);
    assert.equal(announced.custodian, false);
    assert.equal(announced.role, 'announcement');
    assert.equal(announced.sha256, history.hash);
    assert.equal(issuerHistoryMirrorFileBytes(history), history.body);
    assert.notEqual(announced.sha256, history.entries_snapshot_hash);
  } finally {
    restoreEnv(prev);
  }
});

test('a stale sha256 is not announced and a matching pin is', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    const record = currentIssuerHistory();
    pinMirror(record, { mirrorPath: 'issuer-history.json' });
    process.env.ISSUER_HISTORY_MIRROR_SHA256 = 'ab'.repeat(32);
    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      status(code) { this.statusCode = code; return this; },
      set(name, value) { this.headers[name.toLowerCase()] = value; },
      type() { return this; },
      send(body) { this.body = Buffer.isBuffer(body) ? body.toString('utf8') : body; },
      json(body) { this.body = JSON.stringify(body); },
    };
    writeIssuerHistoryMirror(res, record);
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error, 'issuer_history_mirror_stale');
    assert.throws(() => issuerHistoryMirrorClaim(record), (err) => {
      assert.equal(err.code, 'issuer_history_mirror_stale');
      return true;
    });
    process.env.ISSUER_HISTORY_MIRROR_SHA256 = record.hash;
    const ok = {
      statusCode: 200,
      headers: {},
      body: '',
      status(code) { this.statusCode = code; return this; },
      set(name, value) { this.headers[name.toLowerCase()] = value; },
      type() { return this; },
      send(body) { this.body = Buffer.isBuffer(body) ? body.toString('utf8') : body; },
      json(body) { this.body = JSON.stringify(body); },
    };
    writeIssuerHistoryMirror(ok, record);
    const doc = JSON.parse(ok.body);
    assert.equal(ok.body, jcsRfc8785(doc));
    assert.equal(doc.schema, ISSUER_HISTORY_MIRROR_SCHEMA);
    assert.equal(doc.custodian, false);
    assert.equal(doc.repo, 'example-org/issuer-history');
    assert.equal(doc.commit, 'a'.repeat(40));
    assert.equal(doc.path, 'issuer-history.json');
    assert.equal(doc.sha256, record.hash);
    assert.equal(ok.headers['x-chit-mirror-custodian'], 'false');
  } finally {
    restoreEnv(prev);
  }
});

test('a matching mirror pin lets v11 issue, and the receipt does not carry the pin', async () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-mirror-'));
    const file = path.join(dir, 'set.json');
    fs.writeFileSync(file, JSON.stringify(CHAIN.legacy || buildLegacyReceiptSet([])));
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
    process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
    process.env.ISSUER_ROOT_SEQ = CHAIN.rootSeq;
    process.env.ISSUER_ROOT_HASH = CHAIN.rootHash;
    process.env.ISSUER_ROOT_STARTUP_CHECK = 'strict';
    process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
    process.env.ISSUER_ROOT_LEGACY_SET = file;
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_chainId') return { ok: true, json: async () => ({ result: '0x14a34' }) };
      if (body.method === 'eth_getBlockByNumber') {
        const tag = body.params[0];
        if (tag === 'finalized') {
          return { ok: true, json: async () => ({ result: { number: `0x${CHAIN.finalizedNumber.toString(16)}`, hash: CHAIN.finalizedHash } }) };
        }
        if (Number(tag) === CHAIN.frozenBlock) {
          return { ok: true, json: async () => ({ result: { number: CHAIN.frozen.blockNumber, hash: CHAIN.frozenBlockHash } }) };
        }
        throw new Error(`unexpected block ${tag}`);
      }
      if (body.method === 'eth_getLogs') {
        const topic0 = body.params[0].topics[0];
        if (topic0 === KEY_RETIRED_TOPIC) return { ok: true, json: async () => ({ result: [] }) };
        const source = topic0 === CHAIN.frozen.topics[0] ? CHAIN.frozen : CHAIN.rootCommitted;
        return { ok: true, json: async () => ({ result: [source] }) };
      }
      throw new Error(`unexpected ${body.method}`);
    };
    await assertIssuerRootStartup({ fetchImpl, log() {} });
    const record = currentIssuerHistory();
    const without = record.entries_snapshot_hash;
    pinMirror(record);
    const receipt = buildReceipt(paidTask('xfuel-mirror-v11'), { signingSecret: 's', agentId: 4 });
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.v, 11);
    assert.equal(Object.hasOwn(claims, 'issuer_history_mirror'), false);
    assert.equal(JSON.stringify(receipt).includes('example-org/issuer-history'), false);
    const published = currentIssuerHistory();
    assert.equal(published.body.includes('issuer_history_mirror'), false);
    assert.equal(published.body.includes('example-org/issuer-history'), false);
    assert.equal(published.hash, record.hash);
    assert.equal(published.entries_snapshot_hash, without);
    process.env.ISSUER_HISTORY_MIRROR_SHA256 = 'ab'.repeat(32);
    assert.throws(
      () => buildReceipt(paidTask('xfuel-mirror-stale'), { signingSecret: 's', agentId: 4 }),
      (err) => err.code === 'issuer_history_mirror_stale',
    );
  } finally {
    restoreEnv(prev);
  }
});
