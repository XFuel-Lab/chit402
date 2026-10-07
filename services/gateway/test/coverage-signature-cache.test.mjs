/**
 * Coverage JWS bytes stay put while the signed claims and issuer key do.
 * GET /receipt/:id calls coverageForLedger, which signs through this cache.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-sig-'));
process.env.COVERAGE_SIG_DIR = dir;

const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const {
  buildExportCoverage,
  coverageClaims,
  coverageForLedger,
  coverageJwsHeader,
  signExportCoverage,
  verifyExportCoverage,
} = await import('../src/export-coverage.js');
const {
  clearCoverageSignatureCache,
  clearCoverageSignatureMemory,
  coverageSignatureDigest,
  coverageSignatureDir,
  coverageSignatureStats,
  resetCoverageSignatureStats,
} = await import('../src/coverage-signature-cache.js');
const {
  _resetIssuerKey,
  getIssuerPublicKeyJwk,
  getJwks,
  verifyJws,
} = await import('../src/issuer-key.js');

function paid(over = {}) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id,
    status: 'completed',
    payment: {
      rail: 'usdc',
      ref: over.ref,
      collected: true,
      gross_amount: over.amount || '2000',
    },
    route: { model: 'xfuel/auto', hub: 'mock' },
  };
}

function bookWith(n, prefix) {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  let recorded = null;
  for (let i = 0; i < n; i++) {
    recorded = recordCollectedSpend(paid({
      task_id: `${prefix}-${i}`,
      ref: `base:0x${prefix}${i}`,
      amount: String(1000 + i),
    }), { ledger, registry, agentId: recorded?.agent_id });
    assert.equal(recorded.ok, true);
  }
  return { ledger, registry, recorded };
}

function fresh() {
  clearCoverageSignatureCache();
  resetCoverageSignatureStats();
}

test('two coverage reads return the same JWS and do not sign again', () => {
  fresh();
  const { ledger, recorded } = bookWith(1, 'stable');
  const first = coverageForLedger(ledger, recorded.agent_id, { subjectTaskId: 'stable-0' });
  const second = coverageForLedger(ledger, recorded.agent_id, { subjectTaskId: 'stable-0' });
  assert.equal(second.issuer_signature.jws, first.issuer_signature.jws);
  assert.equal(second.issuer_signature.kid, first.issuer_signature.kid);
  assert.equal(verifyExportCoverage(first).valid, true);
  assert.equal(verifyExportCoverage(second).valid, true);
  const after = coverageSignatureStats();
  assert.equal(after.signed, 1);
  assert.equal(after.hits, 1);

  clearCoverageSignatureMemory();
  const restarted = coverageForLedger(ledger, recorded.agent_id, { subjectTaskId: 'stable-0' });
  assert.equal(restarted.issuer_signature.jws, first.issuer_signature.jws);
  assert.equal(coverageSignatureStats().signed, 1);
  assert.equal(coverageSignatureStats().hits, 2);
});

test('adding a row changes the claims and the signature', () => {
  fresh();
  const { ledger, registry, recorded } = bookWith(1, 'grow');
  const before = coverageForLedger(ledger, recorded.agent_id, { subjectTaskId: 'grow-0' });
  const added = recordCollectedSpend(paid({
    task_id: 'grow-1',
    ref: 'base:0xgrow1',
    amount: '1001',
  }), { ledger, registry, agentId: recorded.agent_id });
  assert.equal(added.ok, true);
  const after = coverageForLedger(ledger, recorded.agent_id, { subjectTaskId: 'grow-0' });
  assert.notEqual(after.universe_hash, before.universe_hash);
  assert.notEqual(after.enumerated_count, before.enumerated_count);
  assert.notEqual(after.issuer_signature.jws, before.issuer_signature.jws);
  assert.equal(verifyExportCoverage(after).valid, true);
  assert.equal(verifyExportCoverage(before).valid, true);
  assert.notEqual(
    verifyExportCoverage(after).payload.universe_hash,
    verifyExportCoverage(before).payload.universe_hash,
  );
});

test('a changed claim cannot reuse a stored signature', () => {
  fresh();
  const base = buildExportCoverage({
    bookId: 9,
    universe: [],
    enumerated: [],
    scanComplete: true,
    scope: { limit: 1 },
    subjectTaskId: 'claim-a',
  });
  const signed = signExportCoverage(base, { baseUrl: 'https://api.chit402.com' });
  const tampered = {
    ...base,
    universe_hash: 'ff'.repeat(32),
    enumerated_hash: 'ee'.repeat(32),
  };
  const claims = coverageClaims(tampered);
  const publicJwk = getIssuerPublicKeyJwk();
  const header = coverageJwsHeader('https://api.chit402.com', publicJwk.kid);
  const { canonical, digest } = coverageSignatureDigest(claims, { header, publicJwk });
  fs.writeFileSync(path.join(dir, `${digest}.json`), JSON.stringify({
    schema: 'chit402.coverage_signature_cache.v1',
    digest,
    canonical,
    issuer_signature: signed.issuer_signature,
  }));
  clearCoverageSignatureMemory();
  const again = signExportCoverage(tampered, { baseUrl: 'https://api.chit402.com' });
  assert.notEqual(again.issuer_signature.jws, signed.issuer_signature.jws);
  const verified = verifyExportCoverage(again);
  assert.equal(verified.valid, true, verified.reason);
  assert.equal(verified.payload.universe_hash, tampered.universe_hash);
  assert.equal(verifyJws(signed.issuer_signature.jws, publicJwk).payload.universe_hash, base.universe_hash);
});

test('a cache entry from another ledger is not served', () => {
  fresh();
  const a = bookWith(1, 'ledger-a');
  const b = bookWith(1, 'ledger-b');
  const covA = coverageForLedger(a.ledger, a.recorded.agent_id, { subjectTaskId: 'ledger-a-0' });
  const covB = coverageForLedger(b.ledger, b.recorded.agent_id, { subjectTaskId: 'ledger-b-0' });
  assert.notEqual(covA.issuer_signature.jws, covB.issuer_signature.jws);
  assert.notEqual(covA.universe_hash, covB.universe_hash);

  const claimsB = coverageClaims(covB);
  const publicJwk = getIssuerPublicKeyJwk();
  const header = coverageJwsHeader('', publicJwk.kid);
  const { canonical, digest } = coverageSignatureDigest(claimsB, { header, publicJwk });
  fs.writeFileSync(path.join(coverageSignatureDir(), `${digest}.json`), JSON.stringify({
    schema: 'chit402.coverage_signature_cache.v1',
    digest,
    canonical,
    issuer_signature: covA.issuer_signature,
  }));
  clearCoverageSignatureMemory();
  const served = coverageForLedger(b.ledger, b.recorded.agent_id, { subjectTaskId: 'ledger-b-0' });
  assert.notEqual(served.issuer_signature.jws, covA.issuer_signature.jws);
  assert.equal(verifyExportCoverage(served).valid, true);
  assert.equal(verifyExportCoverage(served).payload.book_id, b.recorded.agent_id);
  assert.equal(verifyExportCoverage(served).payload.universe_hash, covB.universe_hash);
});

test('request fields cannot poison the cache or the filename', () => {
  fresh();
  const coverage = buildExportCoverage({
    bookId: 4,
    universe: [],
    enumerated: [],
    scanComplete: true,
    scope: { limit: 1 },
    subjectTaskId: '../../etc/passwd',
  });
  const attackerA = {
    ...coverage,
    issuer_signature: { jws: 'attacker.one.sig', kid: 'not-the-issuer' },
    cache_key: 'other-agent',
  };
  const attackerB = {
    ...coverage,
    issuer_signature: { jws: 'attacker.two.sig', kid: 'also-not' },
    cache_key: '../coverage-signatures',
  };
  const first = signExportCoverage(attackerA, { baseUrl: 'https://api.chit402.com' });
  const second = signExportCoverage(attackerB, { baseUrl: 'https://api.chit402.com' });
  assert.equal(second.issuer_signature.jws, first.issuer_signature.jws);
  assert.notEqual(first.issuer_signature.jws, 'attacker.one.sig');
  assert.equal(verifyExportCoverage(first).valid, true);
  const payload = verifyJws(first.issuer_signature.jws, getIssuerPublicKeyJwk()).payload;
  assert.equal(payload.subject_task_id, '../../etc/passwd');
  assert.equal(payload.issuer_signature, undefined);
  assert.equal(payload.cache_key, undefined);
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  assert.ok(names.length >= 1);
  for (const name of names) assert.match(name, /^[0-9a-f]{64}\.json$/);
  assert.equal(coverageSignatureStats().signed, 1);
});

test('rotating the issuer key invalidates a stored coverage signature', () => {
  fresh();
  const previous = process.env.ISSUER_PRIVATE_KEY;
  const coverage = buildExportCoverage({
    bookId: 11,
    universe: [],
    enumerated: [],
    scanComplete: true,
    scope: { limit: 1 },
  });
  try {
    process.env.ISSUER_PRIVATE_KEY = pemEnv();
    _resetIssuerKey();
    clearCoverageSignatureCache();
    const first = signExportCoverage(coverage, { baseUrl: 'https://api.chit402.com' });
    const kidA = first.issuer_signature.kid;
    const jwkA = getIssuerPublicKeyJwk();
    assert.equal(verifyJws(first.issuer_signature.jws, jwkA).valid, true);

    process.env.ISSUER_PRIVATE_KEY = pemEnv();
    _resetIssuerKey();
    const jwkB = getIssuerPublicKeyJwk();
    assert.notEqual(jwkB.kid, kidA);
    const second = signExportCoverage(coverage, { baseUrl: 'https://api.chit402.com' });
    assert.notEqual(second.issuer_signature.jws, first.issuer_signature.jws);
    assert.equal(second.issuer_signature.kid, jwkB.kid);
    assert.equal(verifyExportCoverage(second).valid, true);
    assert.equal(verifyJws(first.issuer_signature.jws, jwkB).valid, false);
    assert.equal(verifyJws(second.issuer_signature.jws, jwkA).valid, false);

    const claims = coverageClaims(coverage);
    const header = coverageJwsHeader('https://api.chit402.com', jwkB.kid);
    const { canonical, digest } = coverageSignatureDigest(claims, { header, publicJwk: jwkB });
    fs.writeFileSync(path.join(dir, `${digest}.json`), JSON.stringify({
      schema: 'chit402.coverage_signature_cache.v1',
      digest,
      canonical,
      issuer_signature: first.issuer_signature,
    }));
    clearCoverageSignatureMemory();
    const served = signExportCoverage(coverage, { baseUrl: 'https://api.chit402.com' });
    assert.notEqual(served.issuer_signature.jws, first.issuer_signature.jws);
    assert.equal(verifyJws(served.issuer_signature.jws, getJwks().keys[0]).valid, true);
    assert.equal(served.issuer_signature.kid, jwkB.kid);
  } finally {
    if (previous == null) delete process.env.ISSUER_PRIVATE_KEY;
    else process.env.ISSUER_PRIVATE_KEY = previous;
    _resetIssuerKey();
    clearCoverageSignatureCache();
  }
});

test('the cache stays bounded', () => {
  fresh();
  const previous = process.env.COVERAGE_SIG_CACHE_MAX;
  process.env.COVERAGE_SIG_CACHE_MAX = '2';
  try {
    clearCoverageSignatureCache();
    const signed = [1, 2, 3].map((id) => signExportCoverage(buildExportCoverage({
      bookId: id,
      universe: [],
      enumerated: [],
      scanComplete: true,
      scope: { limit: 1 },
      subjectTaskId: `bound-${id}`,
    })));
    const names = fs.readdirSync(dir).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
    assert.equal(names.length, 2);
    const againFirst = signExportCoverage(buildExportCoverage({
      bookId: 1,
      universe: [],
      enumerated: [],
      scanComplete: true,
      scope: { limit: 1 },
      subjectTaskId: 'bound-1',
    }));
    assert.notEqual(againFirst.issuer_signature.jws, signed[0].issuer_signature.jws);
    const againThird = signExportCoverage(buildExportCoverage({
      bookId: 3,
      universe: [],
      enumerated: [],
      scanComplete: true,
      scope: { limit: 1 },
      subjectTaskId: 'bound-3',
    }));
    assert.equal(againThird.issuer_signature.jws, signed[2].issuer_signature.jws);
    const left = fs.readdirSync(dir).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
    assert.ok(left.length <= 2);
  } finally {
    if (previous == null) delete process.env.COVERAGE_SIG_CACHE_MAX;
    else process.env.COVERAGE_SIG_CACHE_MAX = previous;
    clearCoverageSignatureCache();
  }
});

function pemEnv() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return Buffer.from(pem).toString('base64');
}
