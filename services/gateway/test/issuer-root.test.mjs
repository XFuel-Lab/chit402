/**
 * Issuer root v11 is off unless ISSUER_ROOT_ENABLED=true.
 * Flag-off canonical bytes match the pre-change golden preimage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interface } from 'ethers';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { jcsCanonicalize } = await import('../src/offer-receipt.js');
const {
  buildReceipt,
  decodeReceiptClaims,
  treeHeadRestampAllowed,
  stampCoveringTreeHead,
  RECEIPT_PAYLOAD_VERSION,
  COVERING_HEAD_SCHEMA,
} = await import('../src/receipt.js');
const {
  issueRefusalReceipt,
  verifyRefusalReceipt,
  REFUSAL_SCHEMA,
  REFUSAL_PAYLOAD_VERSION,
} = await import('../src/refusal-receipt.js');
const {
  buildIssuerHistory,
  currentIssuerHistory,
  resetIssuerHistoryStore,
  verifyIssuerHistory,
} = await import('../src/issuer-history.js');
const { verifyJwsWithJwks, getJwks, getIssuerPublicKeyJwk, initIssuerKey, _resetIssuerKey } = await import('../src/issuer-key.js');
const {
  assertIssuerRootStartup,
  assertIssuanceOpen,
  bindIssuerRoot,
  freezeDocumentFor,
  issuerRootActive,
  IssuancePausedError,
  legacyProofForReceipt,
  ROOT_COMMITTED_TOPIC,
  SKIP_LOG,
  _resetIssuerRootStartupState,
} = await import('../src/issuer-root.js');
const {
  buildLegacyReceiptSet,
  classifyLegacyRow,
  verifyLegacyInclusion,
  legacyRootHex,
  legacyUniverseId,
} = await import('../src/legacy-receipt-merkle.js');
const { buildForeignReceipt } = await import('../src/foreign-x402-ingest.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const { assertBroadcastAllowed } = await import('../scripts/build-legacy-receipt-set.mjs');
const { createApp } = await import('../src/server.js');

const GOLDEN_RECEIPT = '{"action":null,"agent_pubkey":null,"binding":{"expected_commitment":null},"caller_binding":{"agent_pubkey":null,"api_key_hash":null,"payer_wallet":"0x1111111111111111111111111111111111111111"},"claim_id":"4","delegation_hash":null,"dispute_window":null,"fulfillment":{"authorization":{"delegation_hash":null,"issuance_commitment":null,"payer_wallet":"0x1111111111111111111111111111111111111111","payment_ref":"base:0xabababababababababababababababababababababababababababababababab"},"intent":{"attempt_index":null,"intent_id":null,"job_kind":"completions","resource":null},"output_commitment":{"hash":"0x799a395e673139ee9edab8a3f6507144fff52b53a8e89cc480e8f1e5e60db144","kind":"keccak256","omission_rule":null,"status":"committed"}},"iat":1790443652,"iss":"chit402","issuance_commitment":null,"issuer_history":{"hash":"PINNED","seq":0,"version":0},"kind":null,"output":{"hash":"0x799a395e673139ee9edab8a3f6507144fff52b53a8e89cc480e8f1e5e60db144"},"parent_receipt_id":null,"payload_version":10,"payment":{"accounting":{"internal_breakdown":{"provider_cogs_amount":"0","receipt_floor_amount":"2000","route_margin_amount":"0","route_margin_bps":100,"tier2_proof_amount":"0"},"kind":"internal","note":"Internal accounting inside the settled amount. Not an on-chain deduction; the payee received settled_amount in full.","scope":"inside_settled_amount"},"asset":"USDC","gross_amount":"2000","payee":"0x2222222222222222222222222222222222222222","rail":"usdc","ref":"base:0xabababababababababababababababababababababababababababababababab","settled_amount":"2000"},"provider_cogs":{"actual":null,"decimals":6,"unit":"atomic_usdc"},"route":{"model":"theta/qwen3","model_commitment":null,"provider":"theta-edgecloud"},"session":null,"session_act":null,"session_expiry":null,"settlement":{"kind":"settled","parent_receipt_id":null},"target_agent":null,"task_id":"xfuel-canonical-golden","tolerance":{"base":300,"solana":150},"tree_head_hash":null}';

const GOLDEN_REFUSAL = '{"agent_id":4,"amount_charged":"0","amount_requested":"2000","anchor":{"block_hash":null,"block_number":null,"chain_id":null,"observed_at":null,"rail":"base","reason":"no_observation","state_root":null,"status":"UNAVAILABLE"},"asset":"USDC","attempt_index":null,"book_id":4,"book_row":{"event":"policy_blocked","prev_hash":null,"row_hash":"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd","seq":1,"task_id":"xfuel-canonical-golden"},"cap_atomic":"1000","chain_id":null,"charged":false,"hub":"theta","intent_id":null,"issued_at":"2026-09-26T17:27:32Z","issuer_history":{"hash":"PINNED","seq":0,"version":0},"kind":"refusal","model":"theta/qwen3","nonce":"NONCE","payload_version":2,"period_start":"2026-09-26T00:00:00Z","policy_key":"cap","reason":"cap","refusal_code":"policy_blocked","refusal_id":"RID","schema":"chit402.refusal.v1","spent_atomic":"0","task_id":"xfuel-canonical-golden"}';

const ROOT_ENV = [
  'ISSUER_ROOT_ENABLED',
  'ISSUER_ROOT_CHAIN_ID',
  'ISSUER_ROOT_REGISTRY',
  'ISSUER_ROOT_SEQ',
  'ISSUER_ROOT_HASH',
  'ISSUER_ROOT_STARTUP_CHECK',
  'ISSUER_ROOT_RPC_URL',
  'ISSUER_ROOT_RPC_URL_2',
  'ISSUER_ROOT_ALLOW_SKIP',
  'ISSUER_ROOT_CUTOVER',
  'ISSUER_ROOT_FREEZE_FILE',
  'ISSUER_ROOT_LEGACY_SET',
  'ISSUER_PRIVATE_KEY',
  'ISSUER_KEY_NOT_BEFORE',
];

function snapshotEnv() {
  const prev = {};
  for (const key of ROOT_ENV) prev[key] = process.env[key];
  return prev;
}

function restoreEnv(prev) {
  for (const key of ROOT_ENV) {
    if (prev[key] == null) delete process.env[key];
    else process.env[key] = prev[key];
  }
  _resetIssuerKey();
  resetIssuerHistoryStore();
  _resetIssuerRootStartupState();
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
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      amount: '2000',
      modelId: 'theta/qwen3',
      prompt: 'super-secret-prompt-text',
    },
    meta: {
      payerWallet: '0x1111111111111111111111111111111111111111',
      payTo: '0x2222222222222222222222222222222222222222',
      provider: 'theta-edgecloud',
      agentId: 4,
    },
    result: {
      provider: 'theta-edgecloud',
      model: 'theta/qwen3',
      output: 'private',
    },
  };
}

function refusalRow(taskId) {
  return {
    policy_code: 'policy_blocked',
    reason: 'cap',
    agent_id: 4,
    task_id: taskId,
    amount_requested: '2000',
    model: 'theta/qwen3',
    hub: 'theta',
    policy_key: 'cap',
    spent_atomic: '0',
    cap_atomic: '1000',
    period_start: '2026-09-26T00:00:00Z',
    collected_at: '2026-09-26T17:27:32Z',
    seq: 1,
    prev_hash: null,
    row_hash: 'cd'.repeat(32),
    anchor: { status: 'UNAVAILABLE', reason: 'no_observation' },
  };
}

function normalizeReceipt(preimage) {
  const obj = JSON.parse(preimage);
  obj.issuer_history = { hash: 'PINNED', version: 0, seq: 0 };
  return jcsCanonicalize(obj);
}

function normalizeRefusal(preimage) {
  const obj = JSON.parse(preimage);
  obj.issuer_history = { hash: 'PINNED', version: 0, seq: 0 };
  obj.nonce = 'NONCE';
  obj.refusal_id = 'RID';
  return jcsCanonicalize(obj);
}

function useStableKey() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.ISSUER_PRIVATE_KEY = Buffer.from(pem).toString('base64');
  process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
  _resetIssuerKey();
  resetIssuerHistoryStore();
}

function writeLegacyArtifact(artifact = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-required-'));
  const file = path.join(dir, 'set.json');
  const body = artifact || buildLegacyReceiptSet([]);
  fs.writeFileSync(file, JSON.stringify(body));
  process.env.ISSUER_ROOT_LEGACY_SET = file;
  return file;
}

function enableRoot({ seq = '1', hash = `0x${'ab'.repeat(32)}`, check = 'skip' } = {}) {
  process.env.ISSUER_ROOT_ENABLED = 'true';
  process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
  process.env.ISSUER_ROOT_REGISTRY = '0x1111111111111111111111111111111111111111';
  process.env.ISSUER_ROOT_SEQ = seq;
  process.env.ISSUER_ROOT_HASH = hash;
  process.env.ISSUER_ROOT_STARTUP_CHECK = check;
  delete process.env.ISSUER_ROOT_CUTOVER;
  _resetIssuerKey();
  resetIssuerHistoryStore();
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

const COMMITTED = new Interface([
  'event RootCommitted(uint64 indexed rootSeq, bytes32 rootHash, uint64 historyVersion, bytes32 historySnapshot)',
]);
const FROZEN = new Interface([
  'event Frozen(bytes32 indexed universeId, bytes32 universeHash, uint64 enumeratedCount, uint64 frozenBlock, uint64 indexed rootSeq)',
]);

function committedLog(seq, rootHash) {
  return COMMITTED.encodeEventLog('RootCommitted', [seq, rootHash, 1, `0x${'cd'.repeat(32)}`]);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function independentRoot(sortedHex) {
  if (!sortedHex.length) return sha256(Buffer.from([0x00]));
  let level = sortedHex.map((hex) => sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(hex, 'hex')])));
  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, level[level.length - 1]];
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256(Buffer.concat([Buffer.from([0x01]), level[i], level[i + 1]])));
    }
    level = next;
  }
  return level[0];
}

test('flag off: receipt, refusal, and history bytes match the current golden', () => {
  const prev = snapshotEnv();
  try {
    for (const key of ROOT_ENV) delete process.env[key];
    process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
    _resetIssuerKey();
    resetIssuerHistoryStore();
    assert.equal(issuerRootActive(), false);
    assert.equal(RECEIPT_PAYLOAD_VERSION, 10);
    const receipt = buildReceipt(paidTask('xfuel-canonical-golden'), { signingSecret: 'canonical-secret', agentId: 4 });
    const again = buildReceipt(paidTask('xfuel-canonical-golden'), { signingSecret: 'canonical-secret', agentId: 4 });
    assert.equal(receipt.issuer_signature.canonical_preimage, again.issuer_signature.canonical_preimage);
    assert.equal(normalizeReceipt(receipt.issuer_signature.canonical_preimage), GOLDEN_RECEIPT);
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.payload_version, 10);
    assert.equal(receipt.issuer_signature.payload_version, 10);
    assert.equal(Object.prototype.hasOwnProperty.call(claims, 'issuer_root'), false);
    assert.equal(receipt.issuer_signature.canonical_preimage.includes('issuer_root'), false);

    const refusal = issueRefusalReceipt(refusalRow('xfuel-canonical-golden'));
    assert.equal(refusal.schema, REFUSAL_SCHEMA);
    assert.equal(refusal.payload_version, REFUSAL_PAYLOAD_VERSION);
    assert.equal(normalizeRefusal(refusal.canonical_preimage), GOLDEN_REFUSAL);
    assert.equal(verifyRefusalReceipt(refusal).valid, true);

    const hist = buildIssuerHistory({ version: 1, seq: 1 });
    const verified = verifyJwsWithJwks(hist.issuer_signature.jws, getJwks());
    assert.deepEqual(Object.keys(verified.payload).sort(), ['entry_count', 'head_hash', 'payload_version', 'schema', 'seq', 'version']);
    assert.equal(verifyIssuerHistory(hist).valid, true);
  } finally {
    restoreEnv(prev);
  }
});

test('cutover pause signs nothing, then v11 resumes with no hash between the sets', () => {
  const prev = snapshotEnv();
  try {
    for (const key of ROOT_ENV) delete process.env[key];
    useStableKey();
    const issued = [];
    const first = buildReceipt(paidTask('xfuel-cutover-a'), { signingSecret: 's', agentId: 4 });
    issued.push(first.issuer_signature.payload_hash);
    assert.equal(decodeReceiptClaims(first).payload_version, 10);
    const jwsBefore = first.issuer_signature.jws;

    process.env.ISSUER_ROOT_CUTOVER = 'pause';
    assert.throws(() => buildReceipt(paidTask('xfuel-cutover-b'), { signingSecret: 's', agentId: 4 }), (err) => {
      assert.equal(err.code, 'issuer_root_cutover_pause');
      assert.ok(err instanceof IssuancePausedError);
      return true;
    });
    assert.throws(() => issueRefusalReceipt(refusalRow('xfuel-cutover-b')), (err) => err.code === 'issuer_root_cutover_pause');
    assert.throws(() => buildForeignReceipt({
      taskId: 'xfuel-cutover-foreign',
      paymentRequired: { resource: 'https://example.test/v1', amount: '1', payTo: '0x2222222222222222222222222222222222222222' },
      paymentResponse: { tx: `0x${'ab'.repeat(32)}`, payer: '0x1111111111111111111111111111111111111111', network: 'base' },
      rail: 'usdc',
    }), (err) => err.code === 'issuer_root_cutover_pause');
    assert.equal(treeHeadRestampAllowed(first), false);
    assert.equal(issued.length, 1);

    const artifact = buildLegacyReceiptSet([{
      task_id: first.task_id,
      issuer_signature: first.issuer_signature,
    }]);
    assert.equal(artifact.enumerated_count, 1);
    assert.equal(artifact.leaves[0].payload_hash, issued[0]);
    assert.equal(verifyLegacyInclusion(issued[0], [], artifact.root), true);

    writeLegacyArtifact(artifact);
    enableRoot();
    process.env.ISSUER_ROOT_CUTOVER = 'pause';
    assert.equal(issuerRootActive(), true);
    const resumed = buildReceipt(paidTask('xfuel-cutover-c'), { signingSecret: 's', agentId: 4 });
    const resumedClaims = decodeReceiptClaims(resumed);
    issued.push(resumed.issuer_signature.payload_hash);
    assert.equal(resumedClaims.payload_version, 11);
    assert.equal(resumedClaims.issuer_root.v, 1);
    assert.equal(resumedClaims.issuer_root.chain_id, 'eip155:84532');
    assert.equal(resumedClaims.issuer_root.root_seq, 1);
    assert.equal(resumedClaims.issuer_root.kid, resumed.issuer_signature.kid);
    assert.equal(resumedClaims.issuer_root.kid, getIssuerPublicKeyJwk().kid);
    assert.equal(artifact.leaves.some((leaf) => leaf.payload_hash === resumed.issuer_signature.payload_hash), false);
    assert.equal(classifyLegacyRow({ task_id: resumed.task_id, issuer_signature: resumed.issuer_signature }).class, 'v11');

    const inSet = issued.filter((hash) => artifact.leaves.some((leaf) => leaf.payload_hash === hash));
    const v11 = issued.filter((hash) => hash === resumed.issuer_signature.payload_hash);
    assert.deepEqual(inSet, [first.issuer_signature.payload_hash]);
    assert.equal(v11.length, 1);
    assert.equal(issued.length, 2);

    const replay = buildReceipt({ ...paidTask('xfuel-cutover-a'), issuerSignature: first.issuer_signature }, { signingSecret: 's', agentId: 4 });
    assert.equal(replay.issuer_signature.jws, jwsBefore);
    assert.equal(replay.issuer_signature.canonical_preimage, first.issuer_signature.canonical_preimage);
    assert.equal(treeHeadRestampAllowed(first), false);
    assert.equal(treeHeadRestampAllowed(resumed), false);

    const refusal = issueRefusalReceipt(refusalRow('xfuel-cutover-c'));
    assert.equal(refusal.schema, 'chit402.refusal.v2');
    assert.equal(refusal.payload_version, 3);
    assert.equal(verifyRefusalReceipt(refusal).valid, true);
    assert.equal(refusal.issuer_root.kid, refusal.issuer_signature.kid);
    const refusalPayload = JSON.parse(Buffer.from(refusal.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(refusalPayload.issuer_root.kid, refusal.issuer_signature.kid);
    assert.equal(JSON.parse(refusal.canonical_preimage).issuer_root.root_seq, 1);

    const hist = JSON.parse(currentIssuerHistory().body);
    assert.equal(verifyIssuerHistory(hist).valid, true);
    const histPayload = verifyJwsWithJwks(hist.issuer_signature.jws, getJwks()).payload;
    assert.equal(histPayload.issuer_root.kid, hist.issuer_signature.kid);
  } finally {
    restoreEnv(prev);
  }
});

function pairFetch(encoded, { blockNumber = '0xa', blockHash = `0x${'cd'.repeat(32)}`, disagreeUrl = null, frozen = null } = {}) {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push(url);
    const body = JSON.parse(opts.body);
    const disagree = disagreeUrl && url === disagreeUrl;
    if (body.method === 'eth_chainId') {
      return { ok: true, json: async () => ({ result: '0x14a34' }) };
    }
    if (body.method === 'eth_getBlockByNumber') {
      return {
        ok: true,
        json: async () => ({
          result: {
            number: blockNumber,
            hash: disagree ? `0x${'11'.repeat(32)}` : blockHash,
          },
        }),
      };
    }
    if (body.method === 'eth_getLogs') {
      assert.equal(Number(body.params[0].toBlock), 10);
      const topic0 = body.params[0].topics[0];
      const source = frozen && topic0 === frozen.topics[0] ? frozen : encoded;
      const log = {
        topics: source.topics,
        data: source.data,
        blockNumber,
        blockHash,
      };
      return { ok: true, json: async () => ({ result: [log] }) };
    }
    throw new Error(`unexpected ${body.method}`);
  };
  return { fetchImpl, seen };
}

test('startup reads two RPCs at one finalized block and signing does not call them again', async () => {
  const prev = snapshotEnv();
  const originalFetch = globalThis.fetch;
  try {
    useStableKey();
    writeLegacyArtifact();
    const hash = `0x${'ab'.repeat(32)}`;
    enableRoot({ hash, check: 'strict' });
    process.env.ISSUER_ROOT_RPC_URL = 'http://127.0.0.1:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://127.0.0.1:10';
    const encoded = committedLog(1, hash);
    assert.equal(encoded.topics[0], ROOT_COMMITTED_TOPIC);
    const agreed = pairFetch(encoded);
    const started = await assertIssuerRootStartup({ fetchImpl: agreed.fetchImpl });
    assert.equal(started.checked, true);
    assert.equal(started.blockNumber, 10);
    assert.ok(agreed.seen.includes('http://127.0.0.1:9'));
    assert.ok(agreed.seen.includes('http://127.0.0.1:10'));
    const callsAtStartup = agreed.seen.length;

    globalThis.fetch = async () => {
      agreed.seen.push('signing');
      throw new Error('rpc unreachable');
    };
    const receipt = buildReceipt(paidTask('xfuel-rpc-down'), { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(receipt).payload_version, 11);
    assert.equal(agreed.seen.length, callsAtStartup);

    const drifted = pairFetch(committedLog(1, hash), { disagreeUrl: 'http://127.0.0.1:10' });
    await assert.rejects(() => assertIssuerRootStartup({ fetchImpl: drifted.fetchImpl }), /disagree/);

    enableRoot({ hash: `0x${'ef'.repeat(32)}`, check: 'strict' });
    process.env.ISSUER_ROOT_RPC_URL = 'http://127.0.0.1:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://127.0.0.1:10';
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: pairFetch(encoded).fetchImpl }),
      /hash mismatch/,
    );

    enableRoot({ check: 'strict' });
    delete process.env.ISSUER_ROOT_RPC_URL_2;
    await assert.rejects(() => assertIssuerRootStartup({ fetchImpl: agreed.fetchImpl }), /two independent RPCs/);

    enableRoot({ check: 'skip' });
    await assert.rejects(() => assertIssuerRootStartup(), /I_UNDERSTAND/);
    process.env.ISSUER_ROOT_ALLOW_SKIP = 'I_UNDERSTAND';
    const logs = [];
    let skipCalls = 0;
    globalThis.fetch = async () => {
      skipCalls += 1;
      throw new Error('rpc unreachable');
    };
    const skipped = await assertIssuerRootStartup({
      log: (_fields, message) => logs.push(message),
    });
    assert.equal(skipped.reason, 'skip');
    assert.equal(logs[0], SKIP_LOG);
    writeLegacyArtifact();
    const skippedReceipt = buildReceipt(paidTask('xfuel-rpc-skip'), { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(skippedReceipt).issuer_root.chain_id, 'eip155:84532');
    assert.equal(skipCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(prev);
  }
});

test('enabled without a stable issuer key refuses to start', async () => {
  const prev = snapshotEnv();
  try {
    for (const key of ROOT_ENV) delete process.env[key];
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_REGISTRY = '0x1111111111111111111111111111111111111111';
    process.env.ISSUER_ROOT_SEQ = '1';
    process.env.ISSUER_ROOT_HASH = `0x${'ab'.repeat(32)}`;
    process.env.ISSUER_ROOT_STARTUP_CHECK = 'skip';
    _resetIssuerKey();
    await assert.rejects(() => assertIssuerRootStartup(), /ISSUER_PRIVATE_KEY/);
    assert.throws(() => initIssuerKey(), /ephemeral issuer key/);
    assert.throws(() => assertIssuanceOpen(), /ISSUER_PRIVATE_KEY|ISSUER_ROOT_ENABLED|incomplete|requires/);
  } finally {
    restoreEnv(prev);
  }
});

test('enabled without a legacy snapshot refuses to issue', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    enableRoot();
    delete process.env.ISSUER_ROOT_CUTOVER;
    delete process.env.ISSUER_ROOT_LEGACY_SET;
    assert.throws(() => buildReceipt(paidTask('xfuel-no-snapshot'), { signingSecret: 's', agentId: 4 }), (err) => {
      assert.equal(err.code, 'issuer_root_cutover_pause');
      return true;
    });
    writeLegacyArtifact();
    const receipt = buildReceipt(paidTask('xfuel-after-snapshot'), { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(receipt).payload_version, 11);
  } finally {
    restoreEnv(prev);
  }
});

test('a stored v11 JWS is unchanged across key rotation and a tree-head update', () => {
  const prev = snapshotEnv();
  resetReceiptMerkleTree();
  try {
    useStableKey();
    writeLegacyArtifact();
    enableRoot();
    const taskId = 'xfuel-immutable-jws';
    const task = paidTask(taskId);
    const receipt = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    const jws = receipt.issuer_signature.jws;
    const payloadHash = receipt.issuer_signature.payload_hash;
    const kid = receipt.issuer_signature.kid;
    task.issuerSignature = receipt.issuer_signature;

    useStableKey();
    writeLegacyArtifact();
    enableRoot();
    assert.notEqual(getIssuerPublicKeyJwk().kid, kid);
    getReceiptMerkleTree().appendReceipt(taskId, 'row-after-rotation');
    const entry = { receipt_snapshot: { issuer_signature: { ...receipt.issuer_signature } } };
    stampCoveringTreeHead(receipt);
    assert.equal(receipt.issuer_signature.jws, jws);
    assert.equal(receipt.issuer_signature.payload_hash, payloadHash);
    assert.equal(receipt.issuer_signature.kid, kid);
    assert.equal(receipt.covering_head.schema, COVERING_HEAD_SCHEMA);
    assert.equal(receipt.covering_head.signed, false);
    assert.notEqual(receipt.covering_head.tree_head_hash, decodeReceiptClaims(receipt).tree_head_hash);
    assert.equal(JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8')).tree_head_hash, decodeReceiptClaims(receipt).tree_head_hash);

    const again = buildReceipt(task, { signingSecret: 's', agentId: 4, persistSignature: true });
    assert.equal(again.issuer_signature.jws, jws);
    assert.equal(again.issuer_signature.payload_hash, payloadHash);
    assert.equal(task.issuerSignature.jws, jws);
    assert.equal(entry.receipt_snapshot.issuer_signature.jws, jws);
  } finally {
    resetReceiptMerkleTree();
    restoreEnv(prev);
  }
});

test('explicit chain id and kid binding', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    writeLegacyArtifact();
    enableRoot();
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:8453';
    const receipt = buildReceipt(paidTask('xfuel-chain-explicit'), { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(receipt).issuer_root.chain_id, 'eip155:8453');
    const jwk = getIssuerPublicKeyJwk();
    assert.throws(() => bindIssuerRoot({ issuer_root: { kid: 'not-the-kid' } }, jwk.kid, jwk), /thumbprint/);
    delete process.env.ISSUER_ROOT_CHAIN_ID;
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:1';
    assert.throws(() => buildReceipt(paidTask('xfuel-bad-chain'), { signingSecret: 's', agentId: 4 }), /CHAIN_ID|incomplete|requires/);
  } finally {
    restoreEnv(prev);
  }
});

test('legacy merkle vectors match an independent implementation', () => {
  const file = fileURLToPath(new URL('./fixtures/legacy-merkle-vectors.json', import.meta.url));
  const vectors = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(vectors.universe_id, legacyUniverseId());
  assert.equal(vectors.universe_id, 'b623c1816e895dd967c4e51f0e066dafda546195a909e9b51283be4b5109caf4');
  assert.equal(vectors.odd.includes('duplicate'), true);
  for (const row of vectors.cases) {
    const root = `0x${independentRoot(row.sorted).toString('hex')}`;
    assert.equal(root, row.root);
    assert.equal(legacyRootHex(row.sorted), row.root);
    for (const proof of row.proofs) {
      assert.equal(verifyLegacyInclusion(proof.payload_hash, proof.proof, row.root), true);
    }
  }
  const odd = vectors.cases.find((row) => row.enumerated_count === 3);
  assert.ok(odd);
  const last = odd.proofs[odd.proofs.length - 1];
  const leaf = sha256(Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(last.payload_hash, 'hex'),
  ])).toString('hex');
  assert.equal(last.proof[0].hash, leaf);
  assert.equal(last.proof[0].position, 'right');
});

test('legacy builder is read-only and fails closed without a stored hash', () => {
  const prev = snapshotEnv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-set-'));
  try {
    const ledger = path.join(dir, 'usage-settled.jsonl');
    const out = path.join(dir, 'set.json');
    const hash = '11'.repeat(32);
    const rows = [
      { task_id: 'xfuel-legacy-a', issuer_signature: { payload_version: 10, payload_hash: hash, jws: 'h.p.s' } },
      { task_id: 'xfuel-legacy-v11', issuer_signature: { payload_version: 11, payload_hash: '22'.repeat(32), jws: 'h.p.s' } },
      { task_id: 'not-a-receipt', evidence: 'collected' },
    ];
    fs.writeFileSync(ledger, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    const before = fs.statSync(ledger).mtimeMs;
    const script = fileURLToPath(new URL('../scripts/build-legacy-receipt-set.mjs', import.meta.url));
    const built = spawnSync(process.execPath, [script, '--ledger', ledger, '--out', out], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.statSync(ledger).mtimeMs, before);
    const artifact = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(artifact.enumerated_count, 1);
    assert.equal(artifact.leaves[0].task_id, 'xfuel-legacy-a');
    assert.equal(artifact.universe_id, legacyUniverseId());
    assert.equal(artifact.skipped_v11_count, 1);

    const missing = path.join(dir, 'missing.jsonl');
    const missingOut = path.join(dir, 'missing-out.json');
    fs.writeFileSync(missing, `${JSON.stringify({ task_id: 'xfuel-no-hash', issuer_signature: { payload_version: 7, jws: 'not-a-jws' } })}\n`);
    const failed = spawnSync(process.execPath, [script, '--ledger', missing, '--out', missingOut], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(fs.existsSync(missingOut), false);

    const broadcast = spawnSync(process.execPath, [script, '--broadcast'], { encoding: 'utf8' });
    assert.equal(broadcast.status, 2);
    assert.match(broadcast.stderr, /84532|read-only/);
    assert.throws(() => assertBroadcastAllowed(8453), /84532/);
    assert.throws(() => assertBroadcastAllowed(1), /84532/);
    assert.doesNotThrow(() => assertBroadcastAllowed(84532));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    restoreEnv(prev);
  }
});

test('freeze and legacy-proof routes are 404 until the flag is on', async () => {
  const prev = snapshotEnv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issuer-root-http-'));
  const { server, port } = await listen(createApp());
  try {
    for (const key of ['ISSUER_ROOT_ENABLED', 'ISSUER_ROOT_FREEZE_FILE', 'ISSUER_ROOT_LEGACY_SET']) {
      delete process.env[key];
    }
    const offFreeze = await fetch(`http://127.0.0.1:${port}/freeze/${'ab'.repeat(32)}`);
    const offProof = await fetch(`http://127.0.0.1:${port}/receipt/xfuel-legacy-a/legacy-proof`);
    const offLlms = await fetch(`http://127.0.0.1:${port}/llms.txt`);
    const offApi = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    assert.equal(offFreeze.status, 404);
    assert.equal(offProof.status, 404);
    const llmsOff = await offLlms.text();
    assert.equal(llmsOff.includes('legacy-proof'), false);
    const specOff = await offApi.json();
    assert.equal(specOff.paths['/freeze/{universeId}'], undefined);
    assert.equal(specOff.paths['/receipt/{taskId}/legacy-proof'], undefined);

    useStableKey();
    const hash = '11'.repeat(32);
    const artifact = buildLegacyReceiptSet([{
      task_id: 'xfuel-legacy-a',
      issuer_signature: { payload_version: 10, payload_hash: hash, jws: 'h.p.s' },
    }]);
    const setFile = path.join(dir, 'set.json');
    fs.writeFileSync(setFile, JSON.stringify(artifact));
    const freezeFile = path.join(dir, 'freeze.json');
    fs.writeFileSync(freezeFile, JSON.stringify({
      freezes: [{
        universe_id: artifact.universe_id,
        universe_hash: artifact.root,
        enumerated_count: artifact.enumerated_count,
        freeze_head: {
          chain_id: 'eip155:84532',
          frozenBlock: 10,
          blockhash: `0x${'cd'.repeat(32)}`,
        },
        tx_hash: `0x${'ef'.repeat(32)}`,
      }],
    }));
    enableRoot({ check: 'strict' });
    process.env.ISSUER_ROOT_FREEZE_FILE = freezeFile;
    process.env.ISSUER_ROOT_LEGACY_SET = setFile;
    process.env.ISSUER_ROOT_RPC_URL = 'http://127.0.0.1:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://127.0.0.1:10';
    const frozen = FROZEN.encodeEventLog('Frozen', [
      `0x${artifact.universe_id}`,
      artifact.root,
      artifact.enumerated_count,
      10,
      1,
    ]);
    const committed = committedLog(1, process.env.ISSUER_ROOT_HASH);
    const mismatched = FROZEN.encodeEventLog('Frozen', [
      `0x${artifact.universe_id}`,
      artifact.root,
      artifact.enumerated_count + 1,
      10,
      1,
    ]);
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: pairFetch(committed, { frozen: mismatched }).fetchImpl }),
      /does not match the Frozen log/,
    );
    assert.equal(freezeDocumentFor(artifact.universe_id), null);
    await assertIssuerRootStartup({ fetchImpl: pairFetch(committed, { frozen }).fetchImpl });

    const freeze = await fetch(`http://127.0.0.1:${port}/freeze/${artifact.universe_id}`);
    assert.equal(freeze.status, 200);
    const freezeBody = await freeze.json();
    assert.equal(freezeBody.schema, 'chit402.freeze.v1');
    assert.equal(freezeBody.universe_hash, artifact.root);
    assert.equal(freezeBody.freeze_head.frozenBlock, 10);
    assert.equal(freezeBody.issuer_root.kid, freezeBody.issuer_signature.kid);
    const freezeCheck = verifyJwsWithJwks(freezeBody.issuer_signature.jws, getJwks());
    assert.equal(freezeCheck.valid, true);
    assert.equal(freezeCheck.payload.tx_hash, `0x${'ef'.repeat(32)}`);

    const unknown = await fetch(`http://127.0.0.1:${port}/freeze/${'00'.repeat(32)}`);
    assert.equal(unknown.status, 404);

    const proof = await fetch(`http://127.0.0.1:${port}/receipt/chit-legacy-a/legacy-proof`);
    assert.equal(proof.status, 200);
    const proofBody = await proof.json();
    assert.equal(proofBody.schema, 'chit402.legacy_proof.v1');
    assert.equal(proofBody.payload_hash, hash);
    assert.equal(verifyLegacyInclusion(proofBody.payload_hash, proofBody.proof, proofBody.root), true);
    const missing = await fetch(`http://127.0.0.1:${port}/receipt/xfuel-not-in-set/legacy-proof`);
    assert.equal(missing.status, 404);

    const llmsOn = await (await fetch(`http://127.0.0.1:${port}/llms.txt`)).text();
    assert.equal(llmsOn.includes('legacy-proof'), true);
    const specOn = await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json();
    assert.ok(specOn.paths['/freeze/{universeId}']);
    assert.equal(freezeDocumentFor('nope'), null);
    assert.equal(legacyProofForReceipt('xfuel-not-in-set'), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
    restoreEnv(prev);
  }
});
