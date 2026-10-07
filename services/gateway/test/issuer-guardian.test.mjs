/**
 * v11 history references the guardian set by hash. A registry retirement
 * shows its block. The signing key cannot be a guardian and cannot sign
 * after KeyRetired. Throwaway public keys only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Interface } from 'ethers';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { jcsRfc8785 } = await import('../src/offer-receipt.js');
const {
  buildIssuerHistory,
  historyEntriesSnapshotHash,
  issuerHistoryEntryHash,
  resetIssuerHistoryStore,
} = await import('../src/issuer-history.js');
const {
  assertSigningKeyNotGuardian,
  currentGuardianSetHash,
  guardianSetHash,
  guardianSetPreimage,
  GUARDIAN_SET_SCHEMA,
  parseGuardianSet,
} = await import('../src/issuer-guardian.js');
const {
  assertIssuanceOpen,
  assertIssuerRootStartup,
  registryKidFromThumbprint,
  retirementsFromLogs,
  retirementBlockForKid,
  thumbprintFromRegistryKid,
  KEY_RETIRED_TOPIC,
  _recordRegistryRetirement,
  _resetIssuerRootStartupState,
} = await import('../src/issuer-root.js');
const {
  computeJwkThumbprint,
  getIssuerKid,
  getIssuerPublicKeyJwk,
  _resetIssuerKey,
} = await import('../src/issuer-key.js');
const { buildReceipt } = await import('../src/receipt.js');
const { buildLegacyReceiptSet } = await import('../src/legacy-receipt-merkle.js');

const ARTIFACT = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../abi/ChitIssuerRoot.json', import.meta.url)), 'utf8'));
const CHAIN = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/issuer-root-chain.json', import.meta.url)), 'utf8'));
const IFACE = new Interface(ARTIFACT.abi);

const ENV_KEYS = [
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
  'ISSUER_ROOT_LEGACY_SET',
  'ISSUER_PRIVATE_KEY',
  'ISSUER_KEY_NOT_BEFORE',
  'ISSUER_GUARDIAN_SET_FILE',
  'ISSUER_HISTORY_EXTRA',
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
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.ISSUER_PRIVATE_KEY = Buffer.from(pem).toString('base64');
  process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
  _resetIssuerKey();
  resetIssuerHistoryStore();
}

function publicGuardian() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y };
  return { kid: computeJwkThumbprint(jwk), jwk };
}

function writeSet(guardians, threshold = 2) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-set-')), 'set.json');
  const doc = { schema: GUARDIAN_SET_SCHEMA, threshold, guardians };
  fs.writeFileSync(file, JSON.stringify(doc));
  process.env.ISSUER_GUARDIAN_SET_FILE = file;
  return doc;
}

function historyEntry(guardian) {
  return {
    kid: guardian.kid,
    jwk: { ...guardian.jwk, kid: guardian.kid, alg: 'ES256', use: 'sig' },
    alg: 'ES256',
    not_before: '2026-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'throwaway public key',
  };
}

function enableRoot() {
  process.env.ISSUER_ROOT_ENABLED = 'true';
  process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
  process.env.ISSUER_ROOT_REGISTRY = '0x1111111111111111111111111111111111111111';
  process.env.ISSUER_ROOT_SEQ = '1';
  process.env.ISSUER_ROOT_HASH = `0x${'ab'.repeat(32)}`;
  process.env.ISSUER_ROOT_STARTUP_CHECK = 'skip';
  process.env.ISSUER_ROOT_ALLOW_SKIP = 'I_UNDERSTAND';
  delete process.env.ISSUER_ROOT_CUTOVER;
}

function retiredLog(guardian, blockNumber, notAfter = 1700000000) {
  const registryKid = registryKidFromThumbprint(guardian.kid);
  const encoded = IFACE.encodeEventLog(IFACE.getEvent('KeyRetired'), [registryKid, notAfter, 4]);
  return {
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: `0x${blockNumber.toString(16)}`,
    logIndex: '0x0',
  };
}

test('guardian_set_hash is the RFC 8785 set, and a private key is refused', () => {
  const left = publicGuardian();
  const right = publicGuardian();
  const doc = parseGuardianSet({ schema: GUARDIAN_SET_SCHEMA, threshold: 2, guardians: [right, left] });
  const preimage = guardianSetPreimage(doc);
  assert.equal(preimage.guardians[0].kid < preimage.guardians[1].kid, true);
  assert.equal(jcsRfc8785(preimage), jcsRfc8785({
    schema: GUARDIAN_SET_SCHEMA,
    threshold: 2,
    guardians: [...preimage.guardians],
  }));
  assert.equal(guardianSetHash(doc), crypto.createHash('sha256').update(jcsRfc8785(preimage), 'utf8').digest('hex'));
  assert.equal(Object.hasOwn(preimage.guardians[0].jwk, 'd'), false);
  assert.throws(
    () => parseGuardianSet({ schema: GUARDIAN_SET_SCHEMA, threshold: 1, guardians: [left, right] }),
    /threshold/,
  );
  const leaked = { schema: GUARDIAN_SET_SCHEMA, threshold: 2, guardians: [{ ...left, jwk: { ...left.jwk, d: 'secret' } }, right] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-secret-')), 'set.json');
  fs.writeFileSync(file, JSON.stringify(leaked));
  const prev = process.env.ISSUER_GUARDIAN_SET_FILE;
  process.env.ISSUER_GUARDIAN_SET_FILE = file;
  try {
    assert.throws(() => currentGuardianSetHash(), (err) => {
      assert.equal(err.code, 'guardian_key_material');
      return true;
    });
  } finally {
    if (prev == null) delete process.env.ISSUER_GUARDIAN_SET_FILE;
    else process.env.ISSUER_GUARDIAN_SET_FILE = prev;
  }
});

test('v11 entries reference the guardian set and show the retirement block', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    enableRoot();
    const prior = publicGuardian();
    const other = publicGuardian();
    const doc = writeSet([prior, other]);
    const setHash = guardianSetHash(doc);
    _recordRegistryRetirement({ kid: prior.kid, blockNumber: 42, notAfter: 1700000000 });
    const history = buildIssuerHistory({ entries: [historyEntry(prior)] });
    const retired = history.entries.find((entry) => entry.kid === prior.kid);
    const live = history.entries.at(-1);
    assert.equal(retired.status, 'retired');
    assert.equal(retired.retirement_block, 42);
    assert.equal(retired.not_after, '2023-11-14T22:13:20.000Z');
    assert.equal(retired.guardian_set_hash, setHash);
    assert.equal(live.guardian_set_hash, setHash);
    assert.equal(Object.hasOwn(live, 'retirement_block'), false);
    assert.equal(live.kid, getIssuerKid());
    assert.equal(issuerHistoryEntryHash(retired), retired.entry_hash);
    assert.equal(historyEntriesSnapshotHash(history.entries), historyEntriesSnapshotHash(history.entries.map((entry) => ({ ...entry }))));
    const embed = historyEntriesSnapshotHash(history.entries);
    assert.match(jcsRfc8785(history.entries.map((entry) => entry.kid === prior.kid ? entry : entry)), /guardian_set_hash/);
    assert.equal(typeof embed, 'string');
  } finally {
    restoreEnv(prev);
  }
});

test('flag-off history omits guardian_set_hash and retirement_block', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    delete process.env.ISSUER_ROOT_ENABLED;
    const prior = publicGuardian();
    const other = publicGuardian();
    writeSet([prior, other]);
    _recordRegistryRetirement({ kid: prior.kid, blockNumber: 42, notAfter: 1700000000 });
    const history = buildIssuerHistory({ entries: [historyEntry(prior)] });
    const row = history.entries.find((entry) => entry.kid === prior.kid);
    assert.equal(row.status, 'active');
    assert.equal(Object.hasOwn(row, 'guardian_set_hash'), false);
    assert.equal(Object.hasOwn(row, 'retirement_block'), false);
    assert.equal(JSON.stringify(history).includes('guardian_set_hash'), false);
  } finally {
    restoreEnv(prev);
  }
});

test('a retired signing key and a guardian signing key cannot sign', () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    enableRoot();
    _recordRegistryRetirement({ kid: getIssuerKid(), blockNumber: 77, notAfter: 1700000000 });
    assert.throws(() => assertIssuanceOpen(), (err) => {
      assert.equal(err.code, 'issuer_key_retired');
      return true;
    });
    assert.throws(() => buildIssuerHistory(), (err) => {
      assert.equal(err.code, 'issuer_key_retired');
      return true;
    });
    assert.throws(() => buildReceipt({
      taskId: 'xfuel-retired-key',
      status: 'completed',
      createdAt: '2026-09-26T17:27:32Z',
      updatedAt: '2026-09-26T17:27:32Z',
      intent: { type: 'inference_request', paymentRail: 'usdc', paymentRef: `base:0x${'ab'.repeat(32)}`, amount: '2000', modelId: 'theta/qwen3' },
      meta: { payerWallet: '0x1111111111111111111111111111111111111111', payTo: '0x2222222222222222222222222222222222222222', provider: 'theta-edgecloud', agentId: 4 },
      result: { provider: 'theta-edgecloud', model: 'theta/qwen3', output: 'private' },
    }, { signingSecret: 's', agentId: 4 }), (err) => {
      assert.equal(err.code, 'issuer_key_retired');
      return true;
    });
    _resetIssuerRootStartupState();
    const issuer = getIssuerPublicKeyJwk();
    const issuerGuardian = { kid: issuer.kid, jwk: { kty: issuer.kty, crv: issuer.crv, x: issuer.x, y: issuer.y } };
    writeSet([issuerGuardian, publicGuardian()]);
    assert.throws(() => assertSigningKeyNotGuardian(), (err) => {
      assert.equal(err.code, 'issuer_key_is_guardian');
      return true;
    });
    assert.throws(() => buildIssuerHistory(), (err) => {
      assert.equal(err.code, 'issuer_key_is_guardian');
      return true;
    });
  } finally {
    restoreEnv(prev);
  }
});

test('KeyRetired logs decode from the artifact and both RPCs must agree', async () => {
  const prev = snapshotEnv();
  try {
    useStableKey();
    const retired = publicGuardian();
    const log = retiredLog(retired, 16);
    assert.equal(log.topics[0], KEY_RETIRED_TOPIC);
    const rows = retirementsFromLogs([log]);
    assert.equal(rows[0].kid, retired.kid);
    assert.equal(rows[0].blockNumber, 16);
    assert.equal(thumbprintFromRegistryKid(rows[0].registry_kid), retired.kid);
    assert.equal(registryKidFromThumbprint(retired.kid), rows[0].registry_kid);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-retired-'));
    const file = path.join(dir, 'set.json');
    fs.writeFileSync(file, JSON.stringify(CHAIN.legacy || buildLegacyReceiptSet([])));
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
    process.env.ISSUER_ROOT_REGISTRY = CHAIN.registry;
    process.env.ISSUER_ROOT_SEQ = CHAIN.rootSeq;
    process.env.ISSUER_ROOT_HASH = CHAIN.rootHash;
    process.env.ISSUER_ROOT_STARTUP_CHECK = 'strict';
    process.env.ISSUER_ROOT_RPC_URL = 'http://127.0.0.1:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://127.0.0.1:10';
    process.env.ISSUER_ROOT_LEGACY_SET = file;
    delete process.env.ISSUER_ROOT_CUTOVER;

    const fetchImpl = (retiredByUrl) => async (url, opts) => {
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
        if (topic0 === KEY_RETIRED_TOPIC) {
          return { ok: true, json: async () => ({ result: retiredByUrl(url) }) };
        }
        const source = topic0 === CHAIN.frozen.topics[0] ? CHAIN.frozen : CHAIN.rootCommitted;
        return { ok: true, json: async () => ({ result: [source] }) };
      }
      throw new Error(`unexpected ${body.method}`);
    };

    await assert.rejects(
      () => assertIssuerRootStartup({
        fetchImpl: fetchImpl((url) => (url.endsWith(':10') ? [retiredLog(retired, 17)] : [log])),
        log() {},
      }),
      /KeyRetired/,
    );
    _resetIssuerRootStartupState();
    await assertIssuerRootStartup({
      fetchImpl: fetchImpl(() => [log]),
      log() {},
    });
    assert.equal(retirementBlockForKid(retired.kid), 16);
  } finally {
    restoreEnv(prev);
  }
});
