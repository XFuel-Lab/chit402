/**
 * Issuer-root verifier matrix and the rules around it.
 * Expected verdicts are the checked-in JSON file, not a function of this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface } from 'ethers';

const {
  verifyIssuerRoot,
  supersessionConfirmed,
  resolvePinnedRoot,
  registryRpcUrls,
  parseRegistryLog,
  activeKidsAtSeq,
  REGISTRY_ABI,
  ZERO_ADDRESS,
  BASE_SEPOLIA_REGISTRY_RPC,
  BASE_MAINNET_REGISTRY_RPC,
  verifyReceipt,
  verifyRefusal,
  hashGenesis,
  hashCommitment,
  kidToBytes32,
  recomputeRootHashes,
  decodeKeyReturn,
} = await import('../dist/index.js');
const { parseIssuerTxt, resolveIssuerTxt } = await import('../dist/issuer-dns.js');
const {
  legacyMerkleRootHex,
  legacyInclusion,
  verifyLegacyInclusion,
  legacyLeaf,
  legacyNode,
} = await import('../dist/legacy-merkle.js');

const GENESIS = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const SECOND = Buffer.alloc(32, 2).toString('base64url');
const HONEST = '0x1111111111111111111111111111111111111111';
const HOSTILE_REG = '0x2222222222222222222222222222222222222222';
const STALE_REG = '0x3333333333333333333333333333333333333333';
const NEXT_REG = '0x4444444444444444444444444444444444444444';
const HIST = `0x${'11'.repeat(32)}`;
const CONTROLLER = '0x5555555555555555555555555555555555555555';
const CHAIN_ID = 84532;
const GENESIS_BLOCK = 1;
const COMMIT_BLOCK = 1000;
const NOT_BEFORE = Math.floor(Date.parse('2026-09-04T08:52:05Z') / 1000);
const IAT = NOT_BEFORE + 86_400;
const NOW = IAT + 3600;
const BLOCK_TS = NOW - 60;
const TTL = 300;

const STATES = ['agree', 'missing', 'stale', 'hostile'];
const expectedRows = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/issuer-root-matrix.expected.json'),
  'utf8',
));

function key(status, extra = {}) {
  const wasActive = extra.wasActive ?? (status === 2 || status === 3);
  return {
    status,
    wasActive,
    notBefore: NOT_BEFORE,
    notAfter: 0,
    revokedAt: 0,
    activatedAt: NOT_BEFORE,
    ...extra,
    wasActive: extra.wasActive ?? wasActive,
  };
}

function honestChain() {
  const genesisKid = kidToBytes32(GENESIS);
  const secondKid = kidToBytes32(SECOND);
  const genesisHash = hashGenesis({
    chainId: CHAIN_ID,
    registry: HONEST,
    controller: CONTROLLER,
    genesisKid,
    genesisNotBefore: NOT_BEFORE,
    activatedAt: NOT_BEFORE,
    blockNumber: GENESIS_BLOCK,
  });
  const commitHash = hashCommitment({
    prevRootHash: genesisHash,
    rootSeq: 1,
    chainId: CHAIN_ID,
    registry: HONEST,
    blockNumber: COMMIT_BLOCK,
    ops: [{ kind: 2, kid: secondKid, timestamp: 0, reasonCode: 0 }],
    freezes: [],
    histVersion: 1,
    histSnapshot: HIST,
  });
  const logs = [
    {
      event: 'GenesisSeeded',
      controller: CONTROLLER,
      kid: GENESIS,
      notBefore: NOT_BEFORE,
      activatedAt: NOT_BEFORE,
      commitBlock: GENESIS_BLOCK,
      rootHash: genesisHash,
      rootSeq: 0,
      blockNumber: GENESIS_BLOCK,
      blockTimestamp: BLOCK_TS - 10,
      logIndex: 0,
    },
    {
      event: 'KeyActivated',
      kid: GENESIS,
      activatedAt: NOT_BEFORE,
      rootSeq: 0,
      blockNumber: GENESIS_BLOCK,
      blockTimestamp: BLOCK_TS - 10,
      logIndex: 1,
    },
    {
      event: 'KeyActivated',
      kid: SECOND,
      activatedAt: NOT_BEFORE,
      rootSeq: 1,
      blockNumber: COMMIT_BLOCK,
      blockTimestamp: BLOCK_TS,
      logIndex: 0,
    },
    {
      event: 'RootCommitted',
      rootSeq: 1,
      rootHash: commitHash,
      historyVersion: 1,
      historySnapshot: HIST,
      commitBlock: COMMIT_BLOCK,
      blockNumber: COMMIT_BLOCK,
      blockTimestamp: BLOCK_TS,
      logIndex: 1,
    },
  ];
  return { genesisHash, commitHash, logs };
}

const HONEST_CHAIN = honestChain();
const ROOT = HONEST_CHAIN.commitHash;

function agreeView(over = {}) {
  return {
    blockNumber: 1000,
    blockTimestamp: BLOCK_TS,
    rootSeq: 1,
    rootHash: ROOT,
    historyVersion: 1,
    historySnapshot: HIST,
    supersededBy: ZERO_ADDRESS,
    keys: {
      [GENESIS]: key(2),
      [SECOND]: key(2),
    },
    logs: HONEST_CHAIN.logs,
    ...over,
  };
}

function rpcReturning(view) {
  return {
    async read(tag) {
      if (tag === 'latest') throw new Error('verifier must not read latest');
      return view;
    },
  };
}

function throwingRpc() {
  return {
    async read() {
      throw new Error('rpc down');
    },
  };
}

function txt(body) {
  return { status: 'ok', ttl: TTL, records: [[body]], dnssec: 'unsigned' };
}

function dnsFor(state) {
  if (state === 'missing') return { status: 'nxdomain' };
  if (state === 'hostile') {
    return txt(
      `v=chit-issuer1; chain=eip155:84532; reg=${HOSTILE_REG}; seq=1; root=${ROOT}; kid=${GENESIS}; kid=${SECOND}`,
    );
  }
  const kids = state === 'stale'
    ? `kid=${GENESIS}`
    : `kid=${GENESIS}; kid=${SECOND}`;
  return txt(
    `v=chit-issuer1; chain=eip155:84532; reg=${HONEST}; seq=1; root=${ROOT}; ${kids}`,
  );
}

function chainFor(state) {
  if (state === 'missing') return [throwingRpc(), throwingRpc()];
  if (state === 'stale') {
    const view = agreeView({
      rootSeq: 0,
      rootHash: HONEST_CHAIN.genesisHash,
      logs: HONEST_CHAIN.logs.filter((log) => (log.rootSeq ?? 0) === 0),
    });
    return [rpcReturning(view), rpcReturning(view)];
  }
  if (state === 'hostile') {
    const view = agreeView({
      rootHash: `0x${'cd'.repeat(32)}`,
      logs: HONEST_CHAIN.logs.map((log) => (
        log.event === 'RootCommitted' ? { ...log, rootHash: `0x${'cd'.repeat(32)}` } : log
      )),
    });
    return [rpcReturning(view), rpcReturning(view)];
  }
  const view = agreeView();
  return [rpcReturning(view), rpcReturning(view)];
}

function pinFor(state) {
  if (state === 'missing') return null;
  const registry = state === 'stale' ? STALE_REG : state === 'hostile' ? HOSTILE_REG : HONEST;
  return { chain: 'eip155:84532', registry, genesis_kid: GENESIS };
}

function baseInput(row) {
  return {
    signatureValid: true,
    jwsKid: GENESIS,
    thumbprint: GENESIS,
    issuerRoot: {
      v: 1,
      chain_id: 'eip155:84532',
      registry: HONEST,
      root_seq: 1,
      root_hash: ROOT,
      kid: GENESIS,
    },
    payloadVersion: 11,
    iat: IAT,
    payloadHash: null,
    pin: pinFor(row.package),
    now: NOW,
    history: { found: true, notBefore: NOT_BEFORE, notAfter: 0, revokedAt: 0, status: 'active' },
    rpcs: chainFor(row.chain),
    dns: dnsFor(row.dns),
  };
}

test('verifier matrix covers chain × DNS × package and matches the checked-in verdicts', async () => {
  assert.equal(expectedRows.length, 64);
  const seen = new Set();
  for (const row of expectedRows) {
    const key = `${row.package}|${row.chain}|${row.dns}`;
    assert.equal(seen.has(key), false, key);
    seen.add(key);
    assert.ok(STATES.includes(row.package) && STATES.includes(row.chain) && STATES.includes(row.dns));
    const result = await verifyIssuerRoot(baseInput(row));
    assert.equal(result.verdict, row.verdict, key);
    assert.equal(result.reason, row.reason, key);
    assert.deepEqual(result.warnings, row.warnings, key);
    if (row.verdict === 'pass' || row.verdict === 'pass_dns_unavailable' || row.verdict === 'pass_legacy_root') {
      assert.equal(result.verdict.startsWith('fail_'), false);
    }
    if (row.verdict === 'unverified_root' || row.verdict === 'unpinned' || row.verdict === 'pin_only') {
      assert.notEqual(result.verdict, 'pass');
    }
  }
  assert.equal(seen.size, 64);
});

test('two RPCs are compared at the minimum finalized head', async () => {
  const good = agreeView({ blockNumber: 100 });
  const ahead = agreeView({
    blockNumber: 110,
    rootHash: `0x${'cd'.repeat(32)}`,
  });
  const tags = [];
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    rpcs: [
      { async read(tag) { tags.push(['a', tag]); return good; } },
      {
        async read(tag) {
          tags.push(['b', tag]);
          if (tag === 'finalized') return ahead;
          if (tag === 100) return good;
          throw new Error(`unexpected ${tag}`);
        },
      },
    ],
  });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.compared_block, 100);
  assert.deepEqual(tags.map((row) => row[1]), ['finalized', 'finalized', 100]);
});

test('a reorg at latest does not move the verifier off finalized', async () => {
  const good = agreeView();
  const latest = agreeView({ rootSeq: 9, rootHash: `0x${'cd'.repeat(32)}` });
  const tags = [];
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    issuerRoot: {
      v: 1,
      chain_id: 'eip155:84532',
      registry: HONEST,
      root_seq: 9,
      root_hash: `0x${'cd'.repeat(32)}`,
      kid: GENESIS,
    },
    rpcs: [
      {
        async read(tag) {
          tags.push(tag);
          if (tag === 'latest') return latest;
          return good;
        },
      },
      {
        async read(tag) {
          tags.push(tag);
          if (tag === 'latest') return latest;
          return good;
        },
      },
    ],
  });
  assert.equal(result.verdict, 'fail_root_from_future');
  assert.deepEqual(tags, ['finalized', 'finalized']);
});

test('RPC disagreement at the shared block fails closed', async () => {
  const left = agreeView();
  const right = agreeView({ rootHash: `0x${'cd'.repeat(32)}` });
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    rpcs: [rpcReturning(left), rpcReturning(right)],
  });
  assert.equal(result.verdict, 'fail_rpc_disagree');
  assert.equal(result.reason, 'rpc_disagree');
});

test('an unsigned cache never upgrades unverified_root to pass', async () => {
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'missing', dns: 'agree' }),
    cache: { asOfBlock: 50, signed: true, signature: '0xdead' },
  });
  assert.equal(result.verdict, 'unverified_root');
  assert.equal(result.reason, 'rpc_unavailable');
  assert.equal(result.note, 'as of block 50, caller cache');
  assert.notEqual(result.verdict, 'pass');
});

test('a cache is ignored when both RPCs agree', async () => {
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    cache: { asOfBlock: 1, signed: true },
  });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.note, null);
});

test('offline is package trust only for the genesis kid', async () => {
  let called = false;
  const offline = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    offline: true,
    rpcs: [{ async read() { called = true; throw new Error('network'); } }],
  });
  assert.equal(offline.verdict, 'pin_only');
  assert.equal(offline.note, 'package trust only');
  assert.equal(called, false);

  const other = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    offline: true,
    jwsKid: SECOND,
    thumbprint: SECOND,
    issuerRoot: {
      v: 1, chain_id: 'eip155:84532', registry: HONEST, root_seq: 1, root_hash: ROOT, kid: SECOND,
    },
  });
  assert.equal(other.verdict, 'fail_key_unknown');
});

test('TXT missing, duplicate, malformed, and unknown v', () => {
  const ok = parseIssuerTxt([[
    'v=chit-issuer1; chain=eip155:84532; reg=0x1111111111111111111111111111111111111111; ',
    `seq=3; root=${ROOT}; kid=${GENESIS}; kid=${SECOND}; standby=${SECOND}`,
  ]]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.txt.kids, [GENESIS, SECOND]);
  assert.deepEqual(ok.txt.standbys, [SECOND]);

  const ambiguous = parseIssuerTxt([
    [`v=chit-issuer1; chain=eip155:84532; reg=${HONEST}; seq=3; root=${ROOT}; kid=${GENESIS}`],
    [`v=chit-issuer1; chain=eip155:84532; reg=${HONEST}; seq=3; root=${ROOT}; kid=${GENESIS}`],
  ]);
  assert.equal(ambiguous.reason, 'dns_ambiguous');

  const malformed = parseIssuerTxt([[
    `chain=eip155:84532; v=chit-issuer1; reg=${HONEST}; seq=3; root=${ROOT}; kid=${GENESIS}`,
  ]]);
  assert.equal(malformed.reason, 'dns_malformed');

  const unknown = parseIssuerTxt([['v=chit-issuer0; chain=eip155:84532; seq=1']]);
  assert.equal(unknown.reason, 'dns_missing');
});

test('NXDOMAIN fails once root checks are on; SERVFAIL and timeout are yellow', async () => {
  const nx = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: { status: 'nxdomain' },
  });
  assert.equal(nx.verdict, 'fail_dns_missing');

  const servfail = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: { status: 'servfail' },
  });
  assert.equal(servfail.verdict, 'pass_dns_unavailable');
  assert.equal(servfail.display, 'yellow');
  assert.equal(servfail.reason, 'dns_unavailable');

  const timeout = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: { status: 'timeout' },
  });
  assert.equal(timeout.verdict, 'pass_dns_unavailable');
  assert.equal(timeout.display, 'yellow');

  const required = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: { status: 'timeout' },
    requireDns: true,
  });
  assert.equal(required.verdict, 'fail_dns_unavailable');

  const dnssec = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    requireDnssec: true,
  });
  assert.equal(dnssec.verdict, 'fail_dnssec_required');
  const validated = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: { ...dnsFor('agree'), dnssec: 'validated' },
    requireDnssec: true,
  });
  assert.equal(validated.verdict, 'pass');
  assert.equal(validated.dnssec, 'validated');
});

test('DNS seq ahead of the chain fails, and the grace window splits lag from disagree', async () => {
  const ahead = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: txt(
      `v=chit-issuer1; chain=eip155:84532; reg=${HONEST}; seq=4; root=${ROOT}; kid=${GENESIS}; kid=${SECOND}`,
    ),
  });
  assert.equal(ahead.verdict, 'fail_dns_ahead_of_chain');

  const lagged = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'stale' }),
  });
  assert.equal(lagged.verdict, 'pass');
  assert.deepEqual(lagged.warnings, ['dns_lagging']);

  const old = agreeView();
  old.logs = old.logs.map((log) => ({ ...log, blockTimestamp: NOW - 100_000 }));
  old.blockTimestamp = NOW - 100_000;
  const pastGrace = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'stale' }),
    rpcs: [rpcReturning(old), rpcReturning(old)],
  });
  assert.equal(pastGrace.verdict, 'fail_dns_chain_disagree');

  const dropped = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: txt(
      `v=chit-issuer1; chain=eip155:84532; reg=${HONEST}; seq=1; root=${ROOT}; kid=${SECOND}`,
    ),
  });
  assert.equal(dropped.verdict, 'fail_dns_chain_disagree');
});

test('a revoked key passes only for iat before revokedAt when it was ever active', async () => {
  function withKey(kid, storage, logs = agreeView().logs) {
    const view = agreeView({
      keys: { ...agreeView().keys, [kid]: storage },
      logs,
    });
    return verifyIssuerRoot({
      ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
      jwsKid: kid,
      thumbprint: kid,
      issuerRoot: {
        v: 1, chain_id: 'eip155:84532', registry: HONEST, root_seq: 1, root_hash: ROOT, kid,
      },
      dns: txt(
        `v=chit-issuer1; chain=eip155:84532; reg=${HONEST}; seq=1; root=${ROOT}; kid=${kid}; kid=${GENESIS}; kid=${SECOND}`,
      ),
      history: {
        found: true,
        notBefore: storage.notBefore,
        notAfter: storage.notAfter,
        revokedAt: 0,
        status: 'active',
      },
      rpcs: [rpcReturning(view), rpcReturning(view)],
    });
  }

  const before = await withKey(GENESIS, key(4, { revokedAt: IAT + 10, wasActive: true }));
  assert.equal(before.verdict, 'pass');

  const after = await withKey(GENESIS, key(4, { revokedAt: IAT }));
  assert.equal(after.verdict, 'fail_key_revoked_at_iat');

  const never = await withKey(SECOND, key(4, { revokedAt: IAT + 10, wasActive: false }));
  assert.equal(never.verdict, 'fail_key_outside_window');

  const unknown = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    jwsKid: Buffer.alloc(32, 9).toString('base64url'),
    thumbprint: Buffer.alloc(32, 9).toString('base64url'),
    issuerRoot: {
      v: 1,
      chain_id: 'eip155:84532',
      registry: HONEST,
      root_seq: 1,
      root_hash: ROOT,
      kid: Buffer.alloc(32, 9).toString('base64url'),
    },
  });
  assert.equal(unknown.verdict, 'fail_key_unknown');
});

test('DNS kid set at a seq is rebuilt from events, not from the pin', () => {
  const logs = [
    { event: 'KeyActivated', kid: GENESIS, activatedAt: NOT_BEFORE, rootSeq: 0, blockNumber: 1, blockTimestamp: 1, logIndex: 0 },
    { event: 'KeyStandby', kid: SECOND, rootSeq: 2, notBefore: NOT_BEFORE, blockNumber: 2, blockTimestamp: 2, logIndex: 0 },
    { event: 'KeyActivated', kid: SECOND, activatedAt: NOT_BEFORE, rootSeq: 3, blockNumber: 3, blockTimestamp: 3, logIndex: 0 },
    { event: 'KeyRetired', kid: GENESIS, rootSeq: 4, notAfter: IAT, blockNumber: 4, blockTimestamp: 4, logIndex: 0 },
  ];
  assert.deepEqual(activeKidsAtSeq(logs, 1), [GENESIS]);
  assert.deepEqual(activeKidsAtSeq(logs, 3).sort(), [GENESIS, SECOND].sort());
  assert.deepEqual(activeKidsAtSeq(logs, 4), [SECOND]);
  assert.deepEqual(activeKidsAtSeq([], 1), []);
});

test('legacy receipts inside the freeze pass, and receipts outside it fail', async () => {
  const hashes = [
    createHash('sha256').update('a').digest(),
    createHash('sha256').update('b').digest(),
    createHash('sha256').update('c').digest(),
  ];
  const root = legacyMerkleRootHex(hashes);
  const proof = legacyInclusion(hashes, hashes[0]);
  assert.ok(root && proof);
  assert.equal(verifyLegacyInclusion(hashes[0], proof.index, proof.leafCount, proof.proof, root), true);
  const outsider = createHash('sha256').update('nope').digest();
  assert.equal(verifyLegacyInclusion(outsider, proof.index, proof.leafCount, proof.proof, root), false);

  const promote = legacyNode(legacyLeaf(hashes[0]), legacyNode(legacyLeaf(hashes[1]), legacyLeaf(hashes[2])));
  assert.notEqual(`0x${promote.toString('hex')}`, root);

  const universeId = `0x${'22'.repeat(32)}`;
  const view = agreeView({
    logs: [
      ...agreeView().logs,
      {
        event: 'Frozen',
        universeId,
        universeHash: root,
        enumeratedCount: 3,
        frozenBlock: 1000,
        rootSeq: 3,
        blockNumber: 1000,
        blockTimestamp: BLOCK_TS,
        logIndex: 2,
      },
    ],
  });
  const shared = {
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    issuerRoot: null,
    payloadVersion: 10,
    payloadHash: `0x${hashes[0].toString('hex')}`,
    rpcs: [rpcReturning(view), rpcReturning(view)],
  };
  const inside = await verifyIssuerRoot({
    ...shared,
    legacyProof: { universeId, index: proof.index, leafCount: proof.leafCount, proof: proof.proof },
  });
  assert.equal(inside.verdict, 'pass_legacy_root');

  const outside = await verifyIssuerRoot({
    ...shared,
    payloadHash: `0x${outsider.toString('hex')}`,
    legacyProof: { universeId, index: proof.index, leafCount: proof.leafCount, proof: proof.proof },
  });
  assert.equal(outside.verdict, 'fail_legacy_not_in_freeze');
});

test('history that disagrees with the chain window fails, and superseded registries fail', async () => {
  const history = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    history: { found: true, notBefore: NOT_BEFORE + 1, notAfter: 0, revokedAt: 0, status: 'active' },
  });
  assert.equal(history.verdict, 'fail_history_chain_disagree');

  const view = agreeView({ supersededBy: NEXT_REG });
  const superseded = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    rpcs: [rpcReturning(view), rpcReturning(view)],
  });
  assert.equal(superseded.verdict, 'fail_superseded_unconfirmed');
  assert.equal(supersessionConfirmed(HONEST, HONEST, NEXT_REG), false);
  assert.equal(supersessionConfirmed(NEXT_REG, NEXT_REG, NEXT_REG), true);
  assert.equal(supersessionConfirmed(NEXT_REG, HONEST, NEXT_REG), false);
});

test('signature and kid failures, and pins that must not be trusted', async () => {
  const badSig = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    signatureValid: false,
  });
  assert.equal(badSig.verdict, 'fail_signature_invalid');

  const kid = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    issuerRoot: {
      v: 1, chain_id: 'eip155:84532', registry: HONEST, root_seq: 1, root_hash: ROOT, kid: SECOND,
    },
  });
  assert.equal(kid.verdict, 'fail_kid_mismatch');

  assert.equal(resolvePinnedRoot(null, {
    CHIT_PINNED_CHAIN: 'eip155:84532',
    CHIT_PINNED_REGISTRY: HONEST,
  }).mode, 'off');
  assert.equal(resolvePinnedRoot(undefined, {}).mode, 'off');
  assert.equal(resolvePinnedRoot({ chain: 'eip155:8453', registry: '0xREGISTRY' }).mode, 'reject');
  assert.equal(resolvePinnedRoot({ chain: 'eip155:8453', registry: ZERO_ADDRESS }).mode, 'reject');
  assert.equal(resolvePinnedRoot({ chain: 'eip155:1', registry: HONEST }).mode, 'reject');
  const on = resolvePinnedRoot(undefined, {
    CHIT_PINNED_CHAIN: 'eip155:84532',
    CHIT_PINNED_REGISTRY: HONEST,
  });
  assert.equal(on.mode, 'on');
  assert.equal(on.pin.chain, 'eip155:84532');

  const urls = registryRpcUrls(on.pin, {});
  assert.equal(urls.primary, BASE_SEPOLIA_REGISTRY_RPC);
  assert.equal(urls.secondary, null);
  const mainnet = registryRpcUrls({ chain: 'eip155:8453', registry: HONEST, genesis_kid: GENESIS }, {
    secondaryUrl: 'https://example.invalid/rpc',
  });
  assert.equal(mainnet.primary, BASE_MAINNET_REGISTRY_RPC);
  assert.equal(mainnet.secondary, 'https://example.invalid/rpc');
  const same = registryRpcUrls(on.pin, { secondaryUrl: BASE_SEPOLIA_REGISTRY_RPC });
  assert.equal(same.secondary, null);
});

test('RootCommitted logs parse from the registry ABI', () => {
  const iface = new Interface(REGISTRY_ABI);
  const encoded = iface.encodeEventLog(iface.getEvent('RootCommitted'), [3n, ROOT, 1n, HIST, 9n]);
  const parsed = parseRegistryLog({
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: 9,
    index: 4,
  }, 123);
  assert.equal(parsed.event, 'RootCommitted');
  assert.equal(parsed.rootSeq, 3);
  assert.equal(parsed.rootHash, ROOT);
  assert.equal(parsed.blockTimestamp, 123);
  assert.equal(parsed.logIndex, 4);
  assert.equal(parsed.commitBlock, 9);
});

test('verifyReceipt without a pin keeps 0.3.0 overall and is not a root pass', async () => {
  const bare = await verifyReceipt({ task_id: 't-unpinned', status: 'ok' });
  assert.equal(bare.root_checked, false);
  assert.equal(bare.issuer_root.verdict, 'unpinned');
  assert.equal(bare.issuer_root.root_checked, false);
  assert.notEqual(bare.issuer_root.verdict, 'pass');
  assert.equal(bare.overall, 'partial');

  const rejected = await verifyReceipt({ task_id: 't-bad-pin', status: 'ok' }, {
    issuerRoot: { pin: { chain: 'eip155:8453', registry: '0xREGISTRY' } },
  });
  assert.equal(rejected.issuer_root.verdict, 'fail_registry_unpinned');
  assert.equal(rejected.overall, 'failed');
});

test('legacy merkle matches the gateway and contract vectors', () => {
  const vectors = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/legacy-merkle-vectors.json'), 'utf8'));
  assert.equal(vectors.empty_root, '0x6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d');
  for (const row of vectors.cases) {
    const hashes = row.payload_hashes.map((hex) => Buffer.from(hex, 'hex'));
    assert.equal(legacyMerkleRootHex(hashes), row.root);
    for (const proof of row.proofs) {
      const leaf = Buffer.from(proof.payload_hash, 'hex');
      assert.equal(verifyLegacyInclusion(leaf, proof.index, row.enumerated_count, proof.proof, row.root), true);
    }
  }
});

test('activatedAt moves the start of the validity window', async () => {
  const late = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    rpcs: [rpcReturning(agreeView({
      keys: { ...agreeView().keys, [GENESIS]: key(2, { activatedAt: IAT + 10 }) },
    })), rpcReturning(agreeView({
      keys: { ...agreeView().keys, [GENESIS]: key(2, { activatedAt: IAT + 10 }) },
    }))],
  });
  assert.equal(late.verdict, 'fail_key_outside_window');
});

test('a log timestamp disagreement is rpc_disagree', async () => {
  const left = agreeView();
  const right = agreeView({
    logs: HONEST_CHAIN.logs.map((log) => (
      log.event === 'RootCommitted' ? { ...log, blockTimestamp: log.blockTimestamp + 5000 } : log
    )),
  });
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    rpcs: [rpcReturning(left), rpcReturning(right)],
  });
  assert.equal(result.verdict, 'fail_rpc_disagree');
});

test('historical receipts stay verifiable up to the supersede block', async () => {
  function at(block) {
    return agreeView({
      blockNumber: block,
      supersededBy: NEXT_REG,
      logs: [
        ...HONEST_CHAIN.logs,
        {
          event: 'Superseded',
          next: NEXT_REG,
          blockNumber: 900,
          blockTimestamp: BLOCK_TS,
          logIndex: 9,
        },
      ],
    });
  }
  const rpcs = [
    { async read(tag) { return tag === 900 ? at(900) : at(1000); } },
    { async read(tag) { return tag === 900 ? at(900) : at(1000); } },
  ];
  const stayed = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    rpcs,
  });
  assert.equal(stayed.verdict, 'pass');
  assert.equal(stayed.compared_block, 900);

  const followed = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    pin: { chain: 'eip155:84532', registry: NEXT_REG, genesis_kid: GENESIS },
    dns: txt(`v=chit-issuer1; chain=eip155:84532; reg=${NEXT_REG}; seq=1; root=${ROOT}; kid=${GENESIS}; kid=${SECOND}`),
    rpcs,
  });
  assert.equal(followed.verdict, 'pass');

  const split = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    pin: { chain: 'eip155:84532', registry: NEXT_REG, genesis_kid: GENESIS },
    rpcs,
  });
  assert.equal(split.verdict, 'fail_superseded_unconfirmed');
});

test('gateway proof field names do not throw', async () => {
  const hashes = [Buffer.from('11'.repeat(32), 'hex'), Buffer.from('22'.repeat(32), 'hex')];
  const root = legacyMerkleRootHex(hashes);
  const proof = legacyInclusion(hashes, hashes[0]);
  const universeId = `0x${'22'.repeat(32)}`;
  const view = agreeView({
    logs: [
      ...HONEST_CHAIN.logs,
      {
        event: 'Frozen',
        universeId,
        universeHash: root,
        enumeratedCount: 2,
        frozenBlock: COMMIT_BLOCK,
        rootSeq: 1,
        blockNumber: COMMIT_BLOCK,
        blockTimestamp: BLOCK_TS,
        logIndex: 8,
      },
    ],
  });
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    issuerRoot: null,
    payloadVersion: 10,
    payloadHash: `0x${hashes[0].toString('hex')}`,
    legacyProof: {
      universe_id: universeId,
      enumerated_count: proof.leafCount,
      index: proof.index,
      proof: proof.proof,
    },
    rpcs: [rpcReturning(view), rpcReturning(view)],
  });
  assert.equal(result.verdict, 'pass_legacy_root');

  const missing = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    issuerRoot: null,
    payloadVersion: 10,
    payloadHash: `0x${hashes[0].toString('hex')}`,
    legacyProof: { index: 0, proof: [] },
    rpcs: [rpcReturning(view), rpcReturning(view)],
  });
  assert.equal(missing.verdict, 'fail_legacy_proof_invalid');
});

test('ECONNREFUSED is not pass_dns_unavailable', async () => {
  const looked = await resolveIssuerTxt('chit402.com', {
    async resolveTxt() {
      const err = new Error('refused');
      err.code = 'ECONNREFUSED';
      throw err;
    },
  });
  assert.equal(looked.status, 'error');
  const result = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    dns: looked,
  });
  assert.equal(result.verdict, 'fail_dns_error');
  assert.notEqual(result.verdict, 'pass_dns_unavailable');
});

test('a gateway-signed chit402.refusal.v2 is not a verified payment', async () => {
  const doc = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/refusal-v2.gateway.json'),
    'utf8',
  ));
  assert.equal(doc.schema, 'chit402.refusal.v2');
  assert.equal(doc.payload_version, 3);
  const jwk = doc.issuer_signature.issuer_jwk;
  const refusal = verifyRefusal(doc, { jwks: { keys: [jwk] }, trustedKids: [doc.issuer_signature.kid] });
  assert.equal(refusal.valid, true, refusal.reason);
  const payment = await verifyReceipt(doc, { jwks: { keys: [jwk] }, trustedKids: [doc.issuer_signature.kid] });
  assert.equal(payment.overall, 'failed');
  assert.ok(payment.errors.some((line) => line.includes('not a payment receipt')));
  assert.notEqual(payment.issuer_root.verdict, 'pass');
});

test('v11 and issuer_root fail closed when the signed iat is missing', async () => {
  const v11 = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    iat: null,
    payloadVersion: 11,
  });
  assert.equal(v11.verdict, 'fail_missing_signed_iat');
  assert.equal(v11.reason, 'missing_signed_iat');

  const rooted = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    iat: null,
    payloadVersion: 10,
  });
  assert.equal(rooted.reason, 'missing_signed_iat');

  const legacy = await verifyIssuerRoot({
    ...baseInput({ package: 'agree', chain: 'agree', dns: 'agree' }),
    iat: null,
    payloadVersion: 9,
    issuerRoot: null,
  });
  assert.notEqual(legacy.reason, 'missing_signed_iat');
});

test('decodeKeyReturn reads the six-word keys tuple', () => {
  const iface = new Interface(REGISTRY_ABI);
  const data = iface.encodeFunctionResult('keys', [2, true, 1788511925, 0, 0, 1788511925]);
  const decoded = decodeKeyReturn(data);
  assert.equal(decoded.status, 2);
  assert.equal(decoded.wasActive, true);
  assert.equal(decoded.notBefore, 1788511925);
  assert.equal(decoded.notAfter, 0);
  assert.equal(decoded.revokedAt, 0);
  assert.equal(decoded.activatedAt, 1788511925);
  assert.equal(recomputeRootHashes(HONEST_CHAIN.logs, CHAIN_ID, HONEST).get(1), ROOT);
});
