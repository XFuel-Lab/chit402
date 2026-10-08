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
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { jcsCanonicalize, jcsRfc8785 } = await import('../src/offer-receipt.js');
const { requestDigest, requestSalt } = await import('../src/request-binding.js');
const { buildPublicPreimages } = await import('../src/receipt-preimage.js');
const { V11_CANONICALIZATION } = await import('../src/canonical-preimage.js');
const {
  buildReceipt,
  decodeReceiptClaims,
  verifyReceiptEcdsa,
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
  historyEntriesSnapshotHash,
  issuerHistoryEntryHash,
  publishedHistoryEntries,
  issuerHistorySnapshotClaim,
  resetIssuerHistoryStore,
  verifyHistorySnapshotClaims,
  verifyIssuerHistory,
} = await import('../src/issuer-history.js');
const { verifyJwsWithJwks, getJwks, getIssuerPublicKeyJwk, initIssuerKey, signJws, _resetIssuerKey } = await import('../src/issuer-key.js');
const {
  assertIssuerRootStartup,
  assertIssuanceOpen,
  readIssuerRootConfig,
  bindIssuerRoot,
  freezeDocumentFor,
  issuerRootActive,
  IssuancePausedError,
  isCutoverPaused,
  legacyProofForReceipt,
  recomputeLegacyCommitment,
  ROOT_COMMITTED_TOPIC,
  SKIP_LOG,
  _resetIssuerRootStartupState,
  KEY_RETIRED_TOPIC,
} = await import('../src/issuer-root.js');
const {
  buildLegacyReceiptSet,
  classifyLegacyRow,
  legacyArtifactCanonical,
  legacyProofFromArtifact,
  verifyLegacyInclusion,
  legacyRootHex,
  legacyUniverseId,
} = await import('../src/legacy-receipt-merkle.js');
const { buildForeignReceipt } = await import('../src/foreign-x402-ingest.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const { assertBroadcastAllowed, invokedAsMain } = await import('../scripts/build-legacy-receipt-set.mjs');
const { createApp } = await import('../src/server.js');

// kind is sha256 because outputHashOf hashed this result with SHA-256.
// #506 labels that digest sha256 instead of guessing keccak256 from the 0x prefix.
// The hash bytes are the same.
const GOLDEN_RECEIPT = '{"action":null,"agent_pubkey":null,"binding":{"expected_commitment":null},"caller_binding":{"agent_pubkey":null,"api_key_hash":null,"payer_wallet":"0x1111111111111111111111111111111111111111"},"claim_id":"4","delegation_hash":null,"dispute_window":null,"fulfillment":{"authorization":{"delegation_hash":null,"issuance_commitment":null,"payer_wallet":"0x1111111111111111111111111111111111111111","payment_ref":"base:0xabababababababababababababababababababababababababababababababab"},"intent":{"attempt_index":null,"intent_id":null,"job_kind":"completions","resource":null},"output_commitment":{"hash":"0x799a395e673139ee9edab8a3f6507144fff52b53a8e89cc480e8f1e5e60db144","kind":"sha256","omission_rule":null,"status":"committed"}},"iat":1790443652,"iss":"chit402","issuance_commitment":null,"issuer_history":{"hash":"PINNED","seq":0,"version":0},"kind":null,"output":{"hash":"0x799a395e673139ee9edab8a3f6507144fff52b53a8e89cc480e8f1e5e60db144"},"parent_receipt_id":null,"payload_version":10,"payment":{"accounting":{"internal_breakdown":{"provider_cogs_amount":"0","receipt_floor_amount":"2000","route_margin_amount":"0","route_margin_bps":100,"tier2_proof_amount":"0"},"kind":"internal","note":"Internal accounting inside the settled amount. Not an on-chain deduction; the payee received settled_amount in full.","scope":"inside_settled_amount"},"asset":"USDC","gross_amount":"2000","payee":"0x2222222222222222222222222222222222222222","rail":"usdc","ref":"base:0xabababababababababababababababababababababababababababababababab","settled_amount":"2000"},"provider_cogs":{"actual":null,"decimals":6,"unit":"atomic_usdc"},"route":{"model":"theta/qwen3","model_commitment":null,"provider":"theta-edgecloud"},"session":null,"session_act":null,"session_expiry":null,"settlement":{"kind":"settled","parent_receipt_id":null},"target_agent":null,"task_id":"xfuel-canonical-golden","tolerance":{"base":300,"solana":150},"tree_head_hash":null}';

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
  'ISSUER_KID',
  'ISSUER_KEY_NOT_BEFORE',
  'NODE_ENV',
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

function clientRequest(body = '{"model":"xfuel/auto"}') {
  return {
    method: 'POST',
    path: '/v1/chat/completions',
    body,
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

const CHAIN = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/issuer-root-chain.json', import.meta.url)), 'utf8'));

function chainFetch({ chainHex = '0x14a34', disagreeUrl = null, frozenLogsFor = null } = {}) {
  const seen = [];
  const calls = [];
  const fetchImpl = async (url, opts) => {
    seen.push(url);
    const body = JSON.parse(opts.body);
    const topic0 = body.method === 'eth_getLogs' ? body.params[0].topics[0] : null;
    calls.push({ url, method: body.method, topic0 });
    const disagree = disagreeUrl && url === disagreeUrl;
    if (body.method === 'eth_chainId') {
      return { ok: true, json: async () => ({ result: chainHex }) };
    }
    if (body.method === 'eth_getBlockByNumber') {
      const tag = body.params[0];
      if (tag === 'finalized') {
        return {
          ok: true,
          json: async () => ({
            result: {
              number: `0x${CHAIN.finalizedNumber.toString(16)}`,
              hash: disagree ? `0x${'11'.repeat(32)}` : CHAIN.finalizedHash,
            },
          }),
        };
      }
      const n = Number(tag);
      if (n === CHAIN.frozenBlock) {
        return {
          ok: true,
          json: async () => ({
            result: { number: CHAIN.frozen.blockNumber, hash: CHAIN.frozenBlockHash },
          }),
        };
      }
      throw new Error(`unexpected block ${tag}`);
    }
    if (body.method === 'eth_getLogs') {
      assert.equal(Number(body.params[0].toBlock), CHAIN.finalizedNumber);
      const topic0 = body.params[0].topics[0];
      if (topic0 === KEY_RETIRED_TOPIC) {
        return { ok: true, json: async () => ({ result: [] }) };
      }
      if (topic0 === CHAIN.frozen.topics[0] && frozenLogsFor) {
        return { ok: true, json: async () => ({ result: frozenLogsFor(url) }) };
      }
      const source = topic0 === CHAIN.frozen.topics[0] ? CHAIN.frozen : CHAIN.rootCommitted;
      return { ok: true, json: async () => ({ result: [source] }) };
    }
    throw new Error(`unexpected ${body.method}`);
  };
  return { fetchImpl, seen, calls };
}

async function armStrict({ chainId = 'eip155:84532', chainHex = '0x14a34' } = {}) {
  writeLegacyArtifact(CHAIN.legacy);
  enableRoot({ hash: CHAIN.rootHash, seq: CHAIN.rootSeq, check: 'strict' });
  process.env.ISSUER_ROOT_CHAIN_ID = chainId;
  process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
  process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
  process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
  await assertIssuerRootStartup({ fetchImpl: chainFetch({ chainHex }).fetchImpl });
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

test('cutover pause signs nothing, then v11 resumes with no hash between the sets', async () => {
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

    await armStrict();
    process.env.ISSUER_ROOT_CUTOVER = 'pause';
    assert.equal(issuerRootActive(), true);
    const resumed = buildReceipt(paidTask('xfuel-cutover-c'), { signingSecret: 's', agentId: 4 });
    const resumedClaims = decodeReceiptClaims(resumed);
    issued.push(resumed.issuer_signature.payload_hash);
    assert.equal(resumedClaims.v, 11);
    assert.equal(Object.prototype.hasOwnProperty.call(resumedClaims, 'issuer_root'), false);
    assert.equal(resumedClaims.kid, resumed.issuer_signature.kid);
    assert.equal(resumedClaims.kid, getIssuerPublicKeyJwk().kid);
    assert.equal(resumedClaims.chain, 'base');
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

    const refusal = issueRefusalReceipt({ ...refusalRow('xfuel-cutover-c'), request: clientRequest() });
    assert.equal(refusal.v, 11);
    assert.equal(refusal.reason, 'cap_exceeded');
    assert.equal(verifyRefusalReceipt(refusal).valid, true);
    assert.equal(refusal.kid, refusal.issuer_signature.kid);
    const refusalPayload = JSON.parse(Buffer.from(refusal.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(refusalPayload.kid, refusal.issuer_signature.kid);
    assert.equal(Object.prototype.hasOwnProperty.call(refusalPayload, 'issuer_root'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(refusalPayload, 'cap_atomic'), false);

    const hist = JSON.parse(currentIssuerHistory().body);
    assert.equal(verifyIssuerHistory(hist).valid, true);
    const histPayload = verifyJwsWithJwks(hist.issuer_signature.jws, getJwks()).payload;
    assert.equal(histPayload.issuer_root.kid, hist.issuer_signature.kid);
  } finally {
    restoreEnv(prev);
  }
});

test('strict startup rejects RPCs that are not two independent providers', async () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    writeLegacyArtifact(CHAIN.legacy);
    enableRoot({ hash: CHAIN.rootHash, seq: CHAIN.rootSeq, check: 'strict' });
    process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
    const attacks = [
      ['https://rpc.provider-a.example/v2/key-a', 'https://rpc.provider-a.example/v2/key-b', /same host/],
      ['https://rpc1.alchemy.com/v2/a', 'https://rpc2.alchemy.com/v2/b', /same registrable domain/],
      ['https://rpc.provider-a.example:8545/v1', 'https://rpc.provider-a.example:8546/v1', /same host/],
      ['https://RPC.Provider-A.EXAMPLE./v2/a', 'https://rpc.provider-a.example/v2/b', /same host/],
      ['http://127.0.0.1:8545', 'http://localhost:8546', /localhost or IP alias/],
      ['http://[::1]:8545', 'http://127.0.0.1:8545', /localhost or IP alias/],
      ['http://127.0.0.1:9', 'http://127.0.0.2:10', /localhost or IP alias/],
      ['http://foo.localhost/rpc', 'http://bar.localhost/rpc', /localhost or IP alias/],
      ['http://Foo.LOCALHOST.:8545/v1', 'http://bar.localhost:8546/v1', /localhost or IP alias/],
      ['http://api.gateway.localhost/v1', 'http://[::1]:8545', /localhost or IP alias/],
      ['http://127.255.255.255:8545', 'http://127.0.0.1:8546', /localhost or IP alias/],
      ['http://0.0.0.0:8545', 'http://[::]:8546', /localhost or IP alias/],
      ['http://[::ffff:127.0.0.1]:8545', 'http://127.0.0.1:8546', /localhost or IP alias/],
      ['http://[::ffff:0.0.0.0]:8545', 'http://0.0.0.0:8546', /localhost or IP alias/],
      ['http://[::ffff:7f00:1]:8545', 'http://[::]:8546', /localhost or IP alias/],
      ['https://rpc.provider-a.example/v1', 'not a url', /unparseable URL/],
      ['ftp://rpc.provider-a.example/v1', 'https://rpc.provider-b.test/v1', /unparseable URL/],
    ];
    for (const [left, right, pattern] of attacks) {
      process.env.ISSUER_ROOT_RPC_URL = left;
      process.env.ISSUER_ROOT_RPC_URL_2 = right;
      _resetIssuerRootStartupState();
      let called = 0;
      const fetchImpl = async () => {
        called += 1;
        throw new Error('rpc should not be called');
      };
      await assert.rejects(() => assertIssuerRootStartup({ fetchImpl }), pattern);
      assert.equal(called, 0, `${left} vs ${right}`);
      assert.equal(readIssuerRootConfig().rpcIndependence.ok, false, `${left} vs ${right}`);
    }
    process.env.ISSUER_ROOT_RPC_URL = 'https://base-mainnet.g.alchemy.com/v2/key';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'https://base-mainnet.infura.io/v3/key';
    _resetIssuerRootStartupState();
    const agreed = chainFetch();
    assert.equal(readIssuerRootConfig().rpcIndependence.ok, true);
    const started = await assertIssuerRootStartup({ fetchImpl: agreed.fetchImpl });
    assert.equal(started.checked, true);
    assert.ok(agreed.seen.includes('https://base-mainnet.g.alchemy.com/v2/key'));
    assert.ok(agreed.seen.includes('https://base-mainnet.infura.io/v3/key'));
  } finally {
    restoreEnv(prev);
  }
});

test('startup reads two RPCs at one finalized block and signing does not call them again', async () => {
  const prev = snapshotEnv();
  const originalFetch = globalThis.fetch;
  try {
    useStableKey();
    assert.equal(CHAIN.rootCommitted.topics[0], ROOT_COMMITTED_TOPIC);
    writeLegacyArtifact(CHAIN.legacy);
    enableRoot({ hash: CHAIN.rootHash, seq: CHAIN.rootSeq, check: 'strict' });
    process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
    process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
    const agreed = chainFetch();
    const started = await assertIssuerRootStartup({ fetchImpl: agreed.fetchImpl });
    assert.equal(started.checked, true);
    assert.equal(started.blockNumber, CHAIN.finalizedNumber);
    assert.ok(agreed.seen.includes('http://rpc.provider-a.example:9'));
    assert.ok(agreed.seen.includes('http://rpc.provider-b.test:10'));
    const callsAtStartup = agreed.seen.length;

    globalThis.fetch = async () => {
      agreed.seen.push('signing');
      throw new Error('rpc unreachable');
    };
    const receipt = buildReceipt(paidTask('xfuel-rpc-down'), { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(receipt).v, 11);
    assert.equal(agreed.seen.length, callsAtStartup);

    const drifted = chainFetch({ disagreeUrl: 'http://rpc.provider-b.test:10' });
    await assert.rejects(() => assertIssuerRootStartup({ fetchImpl: drifted.fetchImpl }), /disagree/);

    enableRoot({ hash: `0x${'ef'.repeat(32)}`, seq: CHAIN.rootSeq, check: 'strict' });
    process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
    process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
    writeLegacyArtifact(CHAIN.legacy);
    await assert.rejects(() => assertIssuerRootStartup({ fetchImpl: chainFetch().fetchImpl }), /hash mismatch/);

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
    writeLegacyArtifact(CHAIN.legacy);
    assert.throws(() => buildReceipt(paidTask('xfuel-rpc-skip'), { signingSecret: 's', agentId: 4 }), (err) => err.code === 'issuer_root_cutover_pause');
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:8453';
    assert.throws(() => buildReceipt(paidTask('xfuel-mainnet-skip'), { signingSecret: 's', agentId: 4 }), (err) => err.code === 'issuer_root_cutover_pause');
    assert.equal(skipCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(prev);
  }
});

test('an empty issuer key in production refuses to boot and signs nothing', () => {
  const prev = snapshotEnv();
  try {
    for (const key of ROOT_ENV) delete process.env[key];
    process.env.NODE_ENV = 'production';
    process.env.ISSUER_PRIVATE_KEY = '';
    process.env.ISSUER_ROOT_ENABLED = 'false';
    process.env.ISSUER_ROOT_ALLOW_SKIP = 'I_UNDERSTAND';
    _resetIssuerKey();
    assert.throws(() => initIssuerKey(), (err) => err.code === 'issuer_key_missing');
    assert.throws(
      () => buildReceipt(paidTask('xfuel-empty-issuer-key'), { signingSecret: 's', agentId: 4 }),
      (err) => err.code === 'issuer_key_missing',
    );
  } finally {
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

test('enabled without a legacy snapshot refuses to issue', async () => {
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
    await armStrict();
    const receipt = buildReceipt(paidTask('xfuel-after-snapshot'), { signingSecret: 's', agentId: 4 });
    assert.equal(decodeReceiptClaims(receipt).v, 11);
  } finally {
    restoreEnv(prev);
  }
});

test('repeated history reads do not mint a version when the key set is unchanged', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    enableRoot();
    resetIssuerHistoryStore();
    const first = currentIssuerHistory();
    const second = currentIssuerHistory();
    const third = currentIssuerHistory();
    assert.equal(second.version, first.version);
    assert.equal(third.version, first.version);
    assert.equal(second.hash, first.hash);
    assert.equal(third.body, first.body);
  } finally {
    restoreEnv(prev);
  }
});

test('v11 signs canonicalization and a history snapshot that checks offline', async () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    await armStrict();
    assert.equal(jcsCanonicalize({ s: 'a"b\\c/d\n' }), '{"s":"a\\"b\\\\c/d\\u000a"}');
    const controlVector = { s: '\t\n\u0001\u{1F600}' };
    const legacy = jcsCanonicalize(controlVector);
    assert.equal(
      Buffer.from(legacy, 'utf8').toString('hex'),
      '7b2273223a225c75303030395c75303030615c7530303031f09f9880227d',
    );
    const rfc = jcsRfc8785(controlVector);
    assert.equal(
      Buffer.from(rfc, 'utf8').toString('hex'),
      '7b2273223a225c745c6e5c7530303031f09f9880227d',
    );
    assert.equal(Buffer.byteLength(rfc, 'utf8'), 22);
    const receipt = buildReceipt(paidTask('xfuel-v11-embed'), { signingSecret: 's', agentId: 4 });
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.v, 11);
    for (const key of ['canonicalization', 'policy', 'issuer_root', 'issuer_history', 'issuer_history_snapshot', 'provider', 'model']) {
      assert.equal(Object.hasOwn(claims, key), false, key);
    }
    assert.equal(verifyReceiptEcdsa(receipt, getIssuerPublicKeyJwk()).valid, true);
    const payloadText = Buffer.from(receipt.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8');
    assert.equal(payloadText, jcsRfc8785(JSON.parse(payloadText)));
    const history = currentIssuerHistory();
    const publishedEntries = JSON.parse(history.body).entries;
    const snap = issuerHistorySnapshotClaim();
    assert.equal(snap.schema, 'chit402.issuer_history_embed.v1');
    assert.equal(snap.snapshot_hash, history.entries_snapshot_hash);
    assert.equal(snap.snapshot_hash, historyEntriesSnapshotHash(publishedEntries));
    assert.notEqual(snap.snapshot_hash, history.hash);
    assert.equal(history.body, jcsCanonicalize(JSON.parse(history.body)));
    const kidEntry = snap.entries.find((entry) => entry.kid === getIssuerPublicKeyJwk().kid);
    assert.ok(kidEntry);
    assert.equal(Object.hasOwn(kidEntry, 'custody'), false);
    const historyClaims = {
      issuer_history: { hash: snap.snapshot_hash, version: snap.version, seq: snap.seq },
      issuer_history_snapshot: snap,
    };
    assert.equal(verifyHistorySnapshotClaims(historyClaims, { publishedEntries }).ok, true);

    const boundRequest = clientRequest();
    const refusal = issueRefusalReceipt({ ...refusalRow('xfuel-v11-embed'), request: boundRequest });
    const refusalClaims = JSON.parse(Buffer.from(refusal.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(refusalClaims.v, 11);
    assert.equal(refusalClaims.reason, 'cap_exceeded');
    assert.equal(refusal.request_digest, requestDigest(boundRequest));
    assert.equal(JSON.stringify(refusal).includes(requestSalt(boundRequest)), false);
    assert.equal(Object.hasOwn(refusal, 'request_preimage'), false);
    assert.equal(verifyRefusalReceipt(refusal).valid, true);
  } finally {
    restoreEnv(prev);
  }
});

test('a forged history embed cannot match snapshot_hash without changing the signed pin', async () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    await armStrict();
    const receipt = buildReceipt(paidTask('xfuel-snapshot-bind'), { signingSecret: 's', agentId: 4 });
    const claims = decodeReceiptClaims(receipt);
    assert.equal(Object.hasOwn(claims, 'issuer_history'), false);
    assert.equal(verifyReceiptEcdsa(receipt, getIssuerPublicKeyJwk()).valid, true);
    const snap = issuerHistorySnapshotClaim();
    const pin = snap.snapshot_hash;
    const published = JSON.parse(currentIssuerHistory().body).entries;
    assert.equal(pin, historyEntriesSnapshotHash(published));
    const forged = {
      payload_version: 11,
      canonicalization: V11_CANONICALIZATION,
      issuer_history: { hash: pin, version: snap.version, seq: snap.seq },
      issuer_history_snapshot: structuredClone(snap),
    };
    const entry = forged.issuer_history_snapshot.entries.at(-1);
    entry.not_before = '2020-01-01T00:00:00.000Z';
    entry.jwk = { ...entry.jwk, x: 'A'.repeat(entry.jwk.x.length) };
    entry.entry_hash = issuerHistoryEntryHash(entry);
    forged.issuer_history_snapshot.head_hash = entry.entry_hash;
    assert.equal(issuerHistoryEntryHash(entry), entry.entry_hash);
    const forgedHash = historyEntriesSnapshotHash(forged.issuer_history_snapshot.entries);
    assert.notEqual(forgedHash, pin);
    forged.issuer_history_snapshot.snapshot_hash = pin;
    assert.equal(verifyHistorySnapshotClaims(forged, { publishedEntries: published }).reason, 'snapshot_hash_mismatch');
    forged.issuer_history_snapshot.snapshot_hash = forgedHash;
    assert.equal(forged.issuer_history.hash, pin);
    assert.equal(verifyHistorySnapshotClaims(forged, { publishedEntries: published }).reason, 'snapshot_pin_mismatch');

    const refusal = issueRefusalReceipt({ ...refusalRow('xfuel-snapshot-bind-refusal'), request: clientRequest() });
    assert.equal(verifyRefusalReceipt(refusal).valid, true);
    const refusalClaims = JSON.parse(Buffer.from(refusal.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(refusalClaims.v, 11);
    const bad = { ...refusalClaims, cap: '1' };
    const { jws } = signJws(bad, { typ: 'chit402-refusal+jwt' });
    const checked = verifyRefusalReceipt({
      ...refusal,
      v: 11,
      issuer_signature: { ...refusal.issuer_signature, jws },
    });
    assert.equal(checked.valid, false);
    assert.equal(checked.reason, 'v11_disallowed_field');
  } finally {
    restoreEnv(prev);
  }
});

test('v11 seals controls as RFC 8785; a flag-off receipt keeps chit402-jcs-v1', async () => {
  const prev = snapshotEnv();
  const taskId = 'xfuel-\t\n\u0001\u{1F600}';
  try {
    for (const key of ROOT_ENV) delete process.env[key];
    _resetIssuerKey();
    resetIssuerHistoryStore();
    const off = buildReceipt(paidTask(taskId), { signingSecret: 's', agentId: 4 });
    const offText = off.issuer_signature.canonical_preimage;
    assert.equal(decodeReceiptClaims(off).payload_version, 10);
    assert.equal(offText, jcsCanonicalize(JSON.parse(offText)));
    assert.notEqual(offText, jcsRfc8785(JSON.parse(offText)));
    assert.match(offText, /\\u0009\\u000a\\u0001/);

    useStableKey();
    await armStrict();
    const on = buildReceipt(paidTask(taskId), { signingSecret: 's', agentId: 4 });
    const onText = Buffer.from(on.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8');
    assert.equal(decodeReceiptClaims(on).v, 11);
    assert.equal(onText, jcsRfc8785(JSON.parse(onText)));
    assert.notEqual(onText, jcsCanonicalize(JSON.parse(onText)));
    assert.match(onText, /\\t\\n\\u0001/);
    assert.doesNotMatch(onText, /\\u0009/);
  } finally {
    restoreEnv(prev);
  }
});

test('a stored v11 JWS is unchanged across key rotation and a tree-head update', async () => {
  const prev = snapshotEnv();
  resetReceiptMerkleTree();
  try {
    useStableKey();
    await armStrict();
    const taskId = 'xfuel-immutable-jws';
    const task = paidTask(taskId);
    const receipt = buildReceipt(task, { signingSecret: 's', agentId: 4 });
    const jws = receipt.issuer_signature.jws;
    const payloadHash = receipt.issuer_signature.payload_hash;
    const kid = receipt.issuer_signature.kid;
    task.issuerSignature = receipt.issuer_signature;

    useStableKey();
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

test('explicit chain id and kid binding', async () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    await armStrict({ chainId: 'eip155:8453', chainHex: '0x2105' });
    const receipt = buildReceipt(paidTask('xfuel-chain-explicit'), { signingSecret: 's', agentId: 4 });
    const jwk = getIssuerPublicKeyJwk();
    assert.equal(decodeReceiptClaims(receipt).v, 11);
    assert.equal(decodeReceiptClaims(receipt).chain, 'base');
    assert.equal(decodeReceiptClaims(receipt).kid, jwk.kid);
    assert.equal(Object.prototype.hasOwnProperty.call(decodeReceiptClaims(receipt), 'issuer_root'), false);
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

test('legacy builder invoked by path writes the artifact and an import does not exit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cli-'));
  try {
    const script = fileURLToPath(new URL('../scripts/build-legacy-receipt-set.mjs', import.meta.url));
    const href = pathToFileURL(script).href;
    assert.equal(invokedAsMain(script, href, 'linux'), true);
    assert.equal(invokedAsMain(script.toUpperCase(), href, 'win32'), true);
    assert.equal(invokedAsMain(script.toUpperCase(), href, 'linux'), script === script.toUpperCase());
    assert.equal(invokedAsMain(path.join(path.dirname(script), 'other.mjs'), href, 'linux'), false);
    assert.equal(invokedAsMain(undefined, href, 'linux'), false);

    const ledger = path.join(dir, 'usage-settled.jsonl');
    const out = path.join(dir, 'set.json');
    fs.writeFileSync(ledger, `${JSON.stringify({
      task_id: 'xfuel-cli',
      issuer_signature: { payload_version: 10, payload_hash: 'ab'.repeat(32), jws: 'h.p.s' },
    })}\n`);
    const built = spawnSync(process.execPath, [script, '--ledger', ledger, '--out', out], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.existsSync(out), true);
    const artifact = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(artifact.enumerated_count, 1);
    assert.equal(artifact.leaves[0].task_id, 'xfuel-cli');
    assert.match(artifact.root, /^0x[0-9a-f]{64}$/);
    assert.match(built.stdout, /legacy_receipts_pre_v11/);

    const imported = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(href)}); console.log('imported-not-main');`,
    ], { encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /imported-not-main/);
    assert.doesNotMatch(imported.stdout, /legacy_receipts_pre_v11/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    const artifact = CHAIN.legacy;
    const hash = artifact.leaves[0].payload_hash;
    const setFile = path.join(dir, 'set.json');
    fs.writeFileSync(setFile, JSON.stringify(artifact));
    const freezeRow = {
      universe_id: artifact.universe_id,
      universe_hash: artifact.root,
      enumerated_count: artifact.enumerated_count,
      freeze_head: {
        chain_id: 'eip155:84532',
        frozenBlock: CHAIN.frozenBlock,
        blockhash: CHAIN.frozenBlockHash,
      },
      tx_hash: `0x${'ef'.repeat(32)}`,
    };
    const freezeFile = path.join(dir, 'freeze.json');
    const badFile = path.join(dir, 'freeze-bad.json');
    fs.writeFileSync(badFile, JSON.stringify({
      freezes: [{ ...freezeRow, enumerated_count: freezeRow.enumerated_count + 1 }],
    }));
    fs.writeFileSync(freezeFile, JSON.stringify({ freezes: [freezeRow] }));
    enableRoot({ hash: CHAIN.rootHash, seq: CHAIN.rootSeq, check: 'strict' });
    process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
    process.env.ISSUER_ROOT_FREEZE_FILE = badFile;
    process.env.ISSUER_ROOT_LEGACY_SET = setFile;
    process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: chainFetch().fetchImpl }),
      /does not match the Frozen log/,
    );
    assert.equal(freezeDocumentFor(artifact.universe_id), null);
    process.env.ISSUER_ROOT_FREEZE_FILE = freezeFile;
    await assertIssuerRootStartup({ fetchImpl: chainFetch().fetchImpl });

    const freeze = await fetch(`http://127.0.0.1:${port}/freeze/${artifact.universe_id}`);
    assert.equal(freeze.status, 200);
    const freezeBody = await freeze.json();
    assert.equal(freezeBody.schema, 'chit402.freeze.v1');
    assert.equal(freezeBody.universe_hash, artifact.root);
    assert.equal(freezeBody.freeze_head.frozenBlock, CHAIN.frozenBlock);
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

const RPC_A = 'http://rpc.provider-a.example:9';
const RPC_B = 'http://rpc.provider-b.test:10';

function frozenLogCalls(calls) {
  return calls.filter((call) => call.topic0 === CHAIN.frozen.topics[0]);
}

async function prepareStrictLegacy() {
  useStableKey();
  writeLegacyArtifact(CHAIN.legacy);
  enableRoot({ hash: CHAIN.rootHash, seq: CHAIN.rootSeq, check: 'strict' });
  process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
  process.env.ISSUER_ROOT_RPC_URL = RPC_A;
  process.env.ISSUER_ROOT_RPC_URL_2 = RPC_B;
}

test('a Frozen log count other than one on both RPCs does not skip the dual-RPC check', async () => {
  const prev = snapshotEnv();
  try {
    await prepareStrictLegacy();
    const split = chainFetch({
      frozenLogsFor: (url) => (url === RPC_A ? [] : [CHAIN.frozen]),
    });
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: split.fetchImpl, log() {} }),
      /disagree on the legacy Frozen log/,
    );
    assert.equal(new Set(frozenLogCalls(split.calls).map((call) => call.url)).size, 2);
    assert.equal(isCutoverPaused(), true);

    await prepareStrictLegacy();
    const oneSided = chainFetch({
      frozenLogsFor: (url) => (url === RPC_A ? [CHAIN.frozen, CHAIN.frozen] : [CHAIN.frozen]),
    });
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: oneSided.fetchImpl, log() {} }),
      /disagree on the legacy Frozen log/,
    );
    assert.equal(new Set(frozenLogCalls(oneSided.calls).map((call) => call.url)).size, 2);

    await prepareStrictLegacy();
    const doubled = chainFetch({
      frozenLogsFor: () => [CHAIN.frozen, { ...CHAIN.frozen, logIndex: '0x1' }],
    });
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: doubled.fetchImpl, log() {} }),
      /not a single finalized log/,
    );
    assert.equal(new Set(frozenLogCalls(doubled.calls).map((call) => call.url)).size, 2);
    assert.equal(isCutoverPaused(), true);

    await prepareStrictLegacy();
    const missing = chainFetch({ frozenLogsFor: () => [] });
    const started = await assertIssuerRootStartup({ fetchImpl: missing.fetchImpl, log() {} });
    assert.equal(started.checked, true);
    assert.equal(new Set(frozenLogCalls(missing.calls).map((call) => call.url)).size, 2);
    assert.equal(isCutoverPaused(), true);
    assert.throws(() => assertIssuanceOpen(), (err) => err instanceof IssuancePausedError);
  } finally {
    restoreEnv(prev);
    _resetIssuerRootStartupState();
  }
});

test('legacy proofs are refused unless the artifact leaves are the sorted Frozen order', async () => {
  const artifact = buildLegacyReceiptSet([
    { task_id: 'xfuel-leaf-a', issuer_signature: { payload_version: 10, payload_hash: '22'.repeat(32), jws: 'h.p.s' } },
    { task_id: 'xfuel-leaf-b', issuer_signature: { payload_version: 10, payload_hash: '11'.repeat(32), jws: 'h.p.s' } },
  ]);
  assert.equal(legacyArtifactCanonical(artifact), true);
  assert.equal(artifact.leaves[0].index, 0);
  assert.ok(artifact.leaves[0].payload_hash < artifact.leaves[1].payload_hash);
  const proof = legacyProofFromArtifact(artifact, 'xfuel-leaf-b');
  assert.equal(artifact.leaves[0].task_id, 'xfuel-leaf-b');
  assert.equal(verifyLegacyInclusion(artifact.leaves[0].payload_hash, proof.proof, artifact.root), true);
  assert.equal(verifyLegacyInclusion('22'.repeat(32), proof.proof, proof.root), false);
  assert.equal(verifyLegacyInclusion('11'.repeat(32), proof.proof, proof.root), true);
  assert.equal(proof.root, legacyRootHex(artifact.leaves.map((leaf) => leaf.payload_hash)));

  const shuffled = structuredClone(artifact);
  shuffled.leaves.reverse();
  shuffled.leaves.forEach((leaf, index) => { leaf.index = index; });
  assert.equal(legacyArtifactCanonical(shuffled), false);
  assert.equal(recomputeLegacyCommitment(shuffled), null);
  assert.equal(legacyProofFromArtifact(shuffled, 'xfuel-leaf-a'), null);

  const prev = snapshotEnv();
  try {
    await prepareStrictLegacy();
    const bad = structuredClone(CHAIN.legacy);
    bad.leaves[0].index = 1;
    writeLegacyArtifact(bad);
    await assert.rejects(
      () => assertIssuerRootStartup({ fetchImpl: chainFetch().fetchImpl, log() {} }),
      /not in sorted canonical order/,
    );
    assert.equal(legacyProofForReceipt(bad.leaves[0].task_id), null);
    assert.equal(isCutoverPaused(), true);
  } finally {
    restoreEnv(prev);
    _resetIssuerRootStartupState();
  }
});
