/**
 * chit402-verify 0.5.0 issuer-history ceremony tooling.
 * Offline: dummy test keys, the bundled snapshot, and recorded v13 worlds.
 * No production fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loopbackGuardImport } from './loopback-guard.mjs';
import { tempDir } from './tmp-dirs.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const helper = join(pkgDir, 'scripts', 'issuer-history.mjs');
const snapshotPath = join(pkgDir, 'issuer-history.snapshot.json');
const cli = join(pkgDir, 'dist', 'cli.js');
const signingDocPath = fileURLToPath(new URL('./fixtures/issuer-history-050/signing-input-doc.json', import.meta.url));
const signingRefPath = fileURLToPath(new URL('./fixtures/issuer-history-050/signing-input.ref', import.meta.url));

const {
  verifyIssuerHistoryDocument,
  issuerHistoryEntryHash,
  sealedSnapshotForPin,
  checkReceiptIssuerHistory,
  loadBundledIssuerHistory,
} = await import('../dist/issuer-history.js');
const {
  POST_HARDENING_RUNTIME_HASHES,
  PRE_HARDENING_RUNTIME_HASHES,
  contractsFromPayload,
  classifyCanonical,
  runV13,
  TRANSFER_TOPIC0,
  AUTHORIZATION_USED_TOPIC0,
} = await import('../dist/v13/core/decide.js');
const { VERSION_WINDOWS_PRODUCTION_KID } = await import('../dist/version-windows.js');

const PROD = VERSION_WINDOWS_PRODUCTION_KID;
const POST_HASH = POST_HARDENING_RUNTIME_HASHES[0];
const PRE_HASH = PRE_HARDENING_RUNTIME_HASHES[0];
const ZERO = `0x${'00'.repeat(20)}`;
const TYP = 'chit402-issuer-history+jwt';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const bundledBytes = readFileSync(snapshotPath, 'utf8');
const bundled = JSON.parse(bundledBytes);
const V2_PIN = Object.freeze({ hash: sha256(bundledBytes), version: 2, seq: 2 });

function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(',')}}`;
}

function b64(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({ crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y })).digest('base64url');
  return {
    privateKey,
    kid,
    publicJwk: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' },
  };
}

const GENESIS = 1700000000;
const MAINNET_CODEHASH = '0xbaad531853ab89c65eeddee489d0290f41a623f785ded9855e80aefee9fb087f';

function mainnetPin(over = {}) {
  return {
    chainId: 8453,
    address: '0xc16010f028a00a3addb37609c38d010ec1df93b1',
    codeHash: MAINNET_CODEHASH,
    predecessor: ZERO,
    checkpoint: '0x7a8d6426e1057535a5442ba526ec9f317a9d9026',
    genesisHourStart: GENESIS,
    retireHourStart: null,
    checkpointVersions: [1],
    ...over,
  };
}

function goodPin(over = {}) {
  return mainnetPin(over);
}

function compactJws(header, payload, sig = 'A'.repeat(86)) {
  return `${b64(header)}.${b64(payload)}.${sig}`;
}

function withPayload(doc, payload, kid) {
  const next = structuredClone(doc);
  if (Object.prototype.hasOwnProperty.call(payload, 'contracts')) next.contracts = payload.contracts;
  next.issuer_signature = {
    ...(next.issuer_signature || {}),
    alg: 'ES256',
    typ: TYP,
    payload_version: 1,
    jws: compactJws({ alg: 'ES256', typ: TYP, kid }, payload),
    kid,
  };
  return next;
}

function runCheck(doc, extra = ['--expect-genesis', String(GENESIS)]) {
  const dir = tempDir('ih050-');
  const file = join(dir, 'doc.json');
  writeFileSync(file, JSON.stringify(doc));
  const proc = spawnSync(process.execPath, [helper, 'check', file, ...extra], { encoding: 'utf8' });
  return { status: proc.status, stderr: proc.stderr, stdout: proc.stdout };
}

function historyEntry(key, prev = null) {
  const body = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: '2026-10-16T00:00:00Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    prev_hash: prev,
  };
  return { ...body, entry_hash: issuerHistoryEntryHash(body) };
}

function signHistory(doc, key) {
  const header = { alg: 'ES256', typ: TYP, kid: key.kid };
  const input = `${b64(header)}.${b64({
    schema: doc.schema,
    payload_version: 1,
    entry_count: doc.entries.length,
    head_hash: doc.head_hash,
    version: doc.version,
    seq: doc.seq,
  })}`;
  const signature = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return {
    ...doc,
    issuer_signature: {
      alg: 'ES256',
      typ: TYP,
      payload_version: 1,
      jws: `${input}.${signature}`,
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

test('signing-input matches the reference JCS/JWS fixture', () => {
  const got = execFileSync(process.execPath, [helper, 'signing-input', signingDocPath, 'test-issuer-history-050'], { encoding: 'utf8' });
  const pinned = readFileSync(signingRefPath, 'utf8');
  assert.equal(got, pinned);
  const [headerB64, payloadB64] = got.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  const payloadText = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const payload = JSON.parse(payloadText);
  assert.deepEqual(header, { alg: 'ES256', typ: TYP, kid: 'test-issuer-history-050' });
  assert.equal(payloadText, jcs(payload));
  assert.equal(payload.schema, 'chit402.issuer_history.v1');
  assert.equal(payload.entry_count, 1);
  assert.equal(payload.version, 3);
  assert.equal(payload.seq, 3);
  assert.equal(payload.contracts[0].genesisHourStart, 1699999200);
  assert.equal(payload.contracts[0].chainId, 8453);
});

test('signing-input keeps seq when it differs from version', () => {
  const dir = tempDir('ih050-seq-');
  const doc = JSON.parse(readFileSync(signingDocPath, 'utf8'));
  doc.version = 3;
  doc.seq = 4;
  const body = join(dir, 'body.json');
  writeFileSync(body, JSON.stringify(doc));
  const input = execFileSync(process.execPath, [helper, 'signing-input', body, 'test-issuer-history-050'], { encoding: 'utf8' });
  const payload = JSON.parse(Buffer.from(input.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.version, 3);
  assert.equal(payload.seq, 4);
  assert.equal(Buffer.from(input.split('.')[1], 'base64url').toString('utf8'), jcs(payload));
});

test('assemble plus a test-key signature verifies and contracts round-trip', () => {
  const key = keyPair();
  const entry = historyEntry(key, null);
  const pin = goodPin();
  const doc = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: 3,
    seq: 3,
    entries: [entry],
    head_hash: entry.entry_hash,
    contracts: [pin],
  };
  const dir = tempDir('ih050-asm-');
  const bodyPath = join(dir, 'body.json');
  const outPath = join(dir, 'out.json');
  writeFileSync(bodyPath, JSON.stringify(doc));
  const input = execFileSync(process.execPath, [helper, 'signing-input', bodyPath, key.kid], { encoding: 'utf8' });
  const sig = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  execFileSync(process.execPath, [helper, 'assemble', bodyPath, key.kid, sig, outPath], { encoding: 'utf8' });
  const assembled = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.equal(assembled.issuer_signature.jws.startsWith(`${input}.`), true);
  const short = spawnSync(process.execPath, [helper, 'assemble', bodyPath, key.kid, 'abc', join(dir, 'short.json')], { encoding: 'utf8' });
  assert.equal(short.status, 1);
  assert.match(short.stderr, /64 bytes/);
  const forked = { ...doc, head_hash: 'ab'.repeat(32) };
  const forkPath = join(dir, 'fork.json');
  writeFileSync(forkPath, JSON.stringify(forked));
  const head = spawnSync(process.execPath, [helper, 'assemble', forkPath, key.kid, sig, join(dir, 'fork-out.json')], { encoding: 'utf8' });
  assert.equal(head.status, 1);
  assert.match(head.stderr, /head_hash does not match/);
  const verified = verifyIssuerHistoryDocument(assembled, { trustedKids: [key.kid] });
  assert.equal(verified.valid, true, verified.reason);
  const payload = JSON.parse(Buffer.from(assembled.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
  const parsed = contractsFromPayload(payload);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pins.length, 1);
  assert.equal(parsed.pins[0].chainId, pin.chainId);
  assert.equal(parsed.pins[0].address, pin.address);
  assert.equal(parsed.pins[0].codeHash, pin.codeHash);
  assert.equal(parsed.pins[0].predecessor, pin.predecessor);
  assert.equal(parsed.pins[0].checkpoint, pin.checkpoint);
  assert.equal(parsed.pins[0].genesisHourStart, pin.genesisHourStart);
  assert.equal(parsed.pins[0].retireHourStart, null);
});

test('check exits 1 for each publish refusal', () => {
  const bundledRun = spawnSync(process.execPath, [helper, 'check'], { encoding: 'utf8' });
  assert.equal(bundledRun.status, 1);
  assert.match(bundledRun.stderr, /contracts\[\] is missing/);

  const basePayload = {
    schema: bundled.schema,
    payload_version: 1,
    entry_count: bundled.entries.length,
    head_hash: bundled.head_hash,
    version: 3,
    seq: 3,
    contracts: [goodPin()],
  };
  const ready = structuredClone(bundled);
  ready.version = 3;
  ready.seq = 3;

  const empty = runCheck(withPayload(ready, { ...basePayload, contracts: [] }, PROD));
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /contracts\[\] is missing/);

  const fraction = runCheck(withPayload(ready, {
    ...basePayload,
    contracts: [goodPin({ genesisHourStart: 1.5 })],
  }, PROD));
  assert.equal(fraction.status, 1);
  assert.match(fraction.stderr, /genesisHourStart is not an integer/);

  const hash = runCheck(withPayload(ready, {
    ...basePayload,
    contracts: [goodPin({ codeHash: PRE_HASH })],
  }, PROD));
  assert.equal(hash.status, 1);
  assert.match(hash.stderr, /code hash is not the mainnet runtime/);

  const second = goodPin({ codeHash: PRE_HASH, address: `0x${'ab'.repeat(20)}` });
  const two = runCheck(withPayload(ready, { ...basePayload, contracts: [goodPin(), second] }, PROD));
  assert.equal(two.status, 1);
  assert.match(two.stderr, /code hash is not the mainnet runtime/);

  const stuck = structuredClone(bundled);
  const stuckRun = runCheck(withPayload(stuck, { ...basePayload, version: 2, seq: 2 }, PROD));
  assert.equal(stuckRun.status, 1);
  assert.match(stuckRun.stderr, /version\/seq did not increase/);

  const seqOnly = structuredClone(ready);
  seqOnly.seq = 2;
  const seqRun = runCheck(withPayload(seqOnly, { ...basePayload, seq: 2 }, PROD));
  assert.equal(seqRun.status, 1);
  assert.match(seqRun.stderr, /version\/seq did not increase/);

  const versionOnly = structuredClone(ready);
  versionOnly.version = 2;
  const versionRun = runCheck(withPayload(versionOnly, { ...basePayload, version: 2 }, PROD));
  assert.equal(versionRun.status, 1);
  assert.match(versionRun.stderr, /version\/seq did not increase/);

  const forked = structuredClone(ready);
  forked.entries = [{ ...bundled.entries[0], entry_hash: 'cd'.repeat(32) }];
  const forkRun = runCheck(withPayload(forked, { ...basePayload, head_hash: 'cd'.repeat(32) }, PROD));
  assert.equal(forkRun.status, 1);
  assert.match(forkRun.stderr, /entries do not extend/);

  const unset = runCheck(withPayload(ready, basePayload, PROD), []);
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /genesisHourStart is not set/);

  const otherKid = runCheck(withPayload(ready, basePayload, 'test-not-prod'));
  assert.equal(otherKid.status, 1);
  assert.match(otherKid.stderr, /kid is not the production issuer key/);

  const testSigned = runCheck(withPayload(ready, basePayload, PROD));
  assert.equal(testSigned.status, 1);
  assert.match(testSigned.stderr, /snapshot is test-signed/);
});

test('prepublishOnly runs issuer-history check and the helper usage is unchanged', () => {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.prepublishOnly, /node scripts\/version-windows\.mjs check && node scripts\/issuer-history\.mjs check && npm test/);
  const usage = spawnSync(process.execPath, [helper], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /signing-input\|assemble\|check/);
});

test('a v1 pin and a v2 pin still resolve, and a later body stands in for v2', async () => {
  assert.equal(V2_PIN.hash, 'b5ecff74a0c5a493268c100ab164b641a5cb2bed8792d0526a997d9d5aa7b07d');
  const loaded = loadBundledIssuerHistory();
  assert.equal(sha256(loaded.bytes), V2_PIN.hash);
  const receiptRef = { verify_url: 'https://example.test/receipt/pin' };
  const issuedAt = '2026-10-08T05:32:21Z';
  const v2 = await checkReceiptIssuerHistory(receiptRef, {
    document: bundled,
    documentBytes: bundledBytes,
    kid: PROD,
    issuedAt,
    pin: V2_PIN,
    requirePin: true,
  });
  assert.equal(v2.ok, true, v2.reason);
  assert.equal(v2.document.version, 2);

  const v1Bytes = readFileSync(join(pkgDir, 'issuer-history.v1.snapshot.json'), 'utf8');
  const v1Pin = { hash: sha256(v1Bytes), version: 1, seq: 1 };
  assert.equal(v1Pin.hash, 'e20d606904df1fe71ab96d8f71100d50ce1a3686fa099b3af3d92b8d8b79f1e8');
  const v1 = await checkReceiptIssuerHistory(receiptRef, {
    document: bundled,
    documentBytes: bundledBytes,
    kid: PROD,
    issuedAt,
    pin: v1Pin,
    requirePin: true,
  });
  assert.equal(v1.ok, true, v1.reason);

  const key = keyPair();
  const dir = tempDir('ih050-v3-');
  const bodyPath = join(dir, 'body.json');
  const outPath = join(dir, 'out.json');
  const ceremony = {
    ...structuredClone(bundled),
    version: 3,
    seq: 3,
    contracts: [mainnetPin()],
  };
  delete ceremony.issuer_signature;
  writeFileSync(bodyPath, JSON.stringify(ceremony));
  const input = execFileSync(process.execPath, [helper, 'signing-input', bodyPath, key.kid], { encoding: 'utf8' });
  const sig = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  execFileSync(process.execPath, [helper, 'assemble', bodyPath, key.kid, sig, outPath], { encoding: 'utf8' });
  const successor = JSON.parse(readFileSync(outPath, 'utf8'));
  successor.issuer_signature.issuer_jwk = key.publicJwk;
  const original = readFileSync(snapshotPath);
  try {
    writeFileSync(snapshotPath, `${JSON.stringify(successor)}\n`);
    const stood = sealedSnapshotForPin(V2_PIN, successor, { trustedKids: [PROD, key.kid] });
    assert.ok(stood, 'sealed v2 row');
    assert.equal(stood.version, 2);
    assert.equal(stood.head_hash, bundled.head_hash);
    const resolved = await checkReceiptIssuerHistory(receiptRef, {
      document: successor,
      documentBytes: JSON.stringify(successor),
      kid: PROD,
      issuedAt,
      pin: V2_PIN,
      requirePin: true,
      trustedKids: [PROD, key.kid],
    });
    assert.equal(resolved.ok, true, resolved.reason);
    assert.equal(resolved.document.head_hash, bundled.head_hash);
    const replaced = loadBundledIssuerHistory();
    assert.notEqual(sha256(replaced.bytes), V2_PIN.hash);
    const frozen = readFileSync(join(pkgDir, 'issuer-history.v2.snapshot.json'));
    assert.equal(sha256(frozen), V2_PIN.hash);
    const gate = spawnSync(process.execPath, [
      helper, 'check', '--expect-genesis', String(GENESIS), '--test-signer',
    ], { encoding: 'utf8', cwd: pkgDir });
    assert.equal(gate.status, 0, gate.stderr);
  } finally {
    writeFileSync(snapshotPath, original);
  }
});

test('contractsFromPayload accepts a pin and rejects a broken list', () => {
  const pin = goodPin({ checkpointVersions: [1] });
  const parsed = contractsFromPayload({ contracts: [pin] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pins[0].genesisHourStart, pin.genesisHourStart);
  assert.deepEqual(parsed.pins[0].checkpointVersions, [1]);
  assert.deepEqual(contractsFromPayload({ schema: 'chit402.issuer_history.v1' }), { ok: true, pins: [] });
  assert.equal(contractsFromPayload({ contracts: { chainId: 1 } }).ok, false);
  assert.equal(contractsFromPayload({ contracts: ['nope'] }).ok, false);
  assert.equal(contractsFromPayload({ contracts: [goodPin({ note: 'extra' })] }).ok, false);
  assert.equal(contractsFromPayload({ contracts: [goodPin({ genesisHourStart: 1.5 })] }).ok, false);
  assert.equal(contractsFromPayload({ contracts: [goodPin({ retireHourStart: 1 })] }).ok, false);
  assert.equal(contractsFromPayload({ contracts: [goodPin({ checkpointVersions: '1' })] }).ok, false);
  const dropped = contractsFromPayload({ contracts: [{ ...goodPin(), address: undefined }] });
  assert.equal(dropped.ok, false);
});

function worldReceipt(over = {}) {
  return {
    v: 13,
    schema: 'chit402.cs2.receipt.v1',
    line: 'ab'.repeat(1024),
    index: 0,
    epoch: 1,
    contract: `0x${'33'.repeat(20)}`,
    proof: [],
    paymentProof: 'cd'.repeat(32),
    saltedBook: 'ef'.repeat(32),
    ...over,
  };
}

function fixtureWorld(patch = {}) {
  const contract = `0x${'33'.repeat(20)}`;
  const from = `0x${'11'.repeat(20)}`;
  const to = `0x${'44'.repeat(20)}`;
  const usdc = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
  const nonce = `0x${'ab'.repeat(32)}`;
  const blockHash = `0x${'12'.repeat(32)}`;
  const pin = {
    chainId: 84532,
    address: contract,
    codeHash: PRE_HASH,
    predecessor: ZERO,
    checkpoint: `0x${'55'.repeat(20)}`,
    genesisHourStart: 1700000000,
    retireHourStart: null,
  };
  const base = {
    history: { ok: true, reason: null, source: 'bundled', headHash: bundled.head_hash, entryCount: 1, asOf: null },
    snapshotSigned: true,
    bundledPayload: { contracts: [pin] },
    narrowing: [],
    liveExtension: null,
    rpcConfigured: true,
    rpcReason: null,
    getterReason: null,
    finalizedNumber: 200,
    headAbsent: false,
    checkpointVersion: 1,
    events: [{
      epoch: 1n,
      hourStart: 1700000000n,
      size: 1n,
      root: 'aa'.repeat(32),
      stateRoot: 'bb'.repeat(32),
      kind: 0,
      blockNumber: 150,
      blockHash: `0x${'ee'.repeat(32)}`,
      txHash: `0x${'ff'.repeat(32)}`,
      logIndex: 0,
      address: contract,
    }],
    codeHash: PRE_HASH,
    successor: 'not_required',
    chainGenesis: null,
    line: {
      chainId: 84532,
      blockHash,
      blockNumber: 100,
      blockTime: 1700000100,
      txIndex: 0,
      localLogIndex: 1,
      txHash: `0x${'99'.repeat(32)}`,
      token: usdc,
      from,
      to,
      value: 1000n,
      method: 1,
      authorizer: from,
      nonce,
      bytes: new Uint8Array(32),
    },
    lineReason: null,
    rotatedTo: null,
    canonical: 'ok',
    payment: {
      blockHash,
      txIndexMatch: true,
      txTo: usdc,
      input: '0x',
      chainNumber: 100,
      chainTime: 1700000100,
      logs: [
        {
          index: 0,
          address: usdc,
          topics: [AUTHORIZATION_USED_TOPIC0, `0x${from.slice(2).padStart(64, '0')}`, nonce],
          data: '0x',
        },
        {
          index: 1,
          address: usdc,
          topics: [
            TRANSFER_TOPIC0,
            `0x${from.slice(2).padStart(64, '0')}`,
            `0x${to.slice(2).padStart(64, '0')}`,
          ],
          data: `0x${(1000n).toString(16).padStart(64, '0')}`,
        },
      ],
    },
    frozen: 'no',
    frozenEpoch: null,
    keyCutoff: { retired: false, epoch: 0 },
  };
  return { ...base, ...patch };
}

const passHooks = {
  leafHash: () => ({ ok: true, hash: new Uint8Array(32) }),
  verifyInclusion: (_leaf, _index, _size, _root, proof) => ({ ok: proof.length === 0 }),
  stateOk: () => true,
  paymentOk: () => ({ ok: true, exit: 0, reason: null }),
};

test('v13 fixture world: anchored, altered proof, freeze, retirement, and the exit-2 reads', () => {
  const anchored = runV13(worldReceipt(), fixtureWorld(), passHooks);
  assert.equal(anchored.exit, 0, anchored.reason);
  const genesis = runV13(worldReceipt(), fixtureWorld({ chainGenesis: 1 }), passHooks);
  assert.equal(genesis.exit, 1);
  assert.equal(genesis.reason, 'hour_outside_coverage');
  assert.equal(classifyCanonical({
    rpcError: false,
    block: { number: 10, hash: '0xabc' },
    finalizedNumber: null,
    canonicalHash: '0xabc',
    wantHash: '0xabc',
  }), 'finality_unavailable');

  const altered = runV13(worldReceipt({ proof: ['ab'.repeat(32)] }), fixtureWorld(), passHooks);
  assert.equal(altered.exit, 1);
  assert.equal(altered.reason, 'not_in_log');

  const frozen = runV13(worldReceipt(), fixtureWorld({ frozen: 'yes', frozenEpoch: 0 }), passHooks);
  assert.equal(frozen.exit, 1);
  assert.equal(frozen.reason, 'anchor_frozen');

  const retired = runV13(worldReceipt(), fixtureWorld({ keyCutoff: { retired: true, epoch: 0 } }), passHooks);
  assert.equal(retired.exit, 1);
  assert.equal(retired.reason, 'key_retired');

  const absent = runV13(worldReceipt(), fixtureWorld({ headAbsent: true, events: [] }), passHooks);
  assert.equal(absent.exit, 2);
  assert.equal(absent.reason, 'not_anchored');

  const early = runV13(worldReceipt(), fixtureWorld({ events: [] }), passHooks);
  assert.equal(early.exit, 2);
  assert.equal(early.reason, 'pre_anchor');

  const pending = runV13(worldReceipt(), fixtureWorld({
    events: [{ ...fixtureWorld().events[0], kind: 1 }],
  }), {
    ...passHooks,
    stateOk: () => ({ ok: false, exit: 1, reason: 'state_unproven' }),
  });
  assert.equal(pending.exit, 2);
  assert.equal(pending.reason, 'pending_hourly_close');

  const split = runV13(worldReceipt(), fixtureWorld({ rpcReason: 'rpc_disagreement' }), passHooks);
  assert.equal(split.exit, 2);
  assert.equal(split.reason, 'rpc_disagreement');

  const postPin = goodPin({
    chainId: 84532,
    address: `0x${'33'.repeat(20)}`,
    codeHash: POST_HASH,
    predecessor: ZERO,
  });
  const unread = runV13(worldReceipt(), fixtureWorld({
    codeHash: POST_HASH,
    bundledPayload: { contracts: [postPin] },
    frozen: 'unreadable',
    keyCutoff: 'unreadable',
  }), passHooks);
  assert.equal(unread.exit, 2);
  assert.equal(unread.reason, 'anchor_state_unreadable');
});

test('cli flags stay --issuer-history and --json, and v10-v12 --json output is byte-pinned', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--issuer-history <file>/);
  assert.match(help.stdout, /--json/);
  const removed = spawnSync(process.execPath, [cli, '--no-issuer-history'], { encoding: 'utf8' });
  assert.equal(removed.status, 1);
  const extra = spawnSync(process.execPath, [cli, 'one', 'two'], { encoding: 'utf8' });
  assert.equal(extra.status, 1);

  for (const version of [10, 11, 12]) {
    const receipt = fileURLToPath(new URL(`./fixtures/issuer-history-050/cli-v${version}.json`, import.meta.url));
    const pinned = readFileSync(fileURLToPath(new URL(`./fixtures/issuer-history-050/cli-v${version}.stdout`, import.meta.url)), 'utf8');
    const proc = spawnSync(process.execPath, [
      '--import', loopbackGuardImport,
      cli,
      receipt,
      '--issuer-history', snapshotPath,
      '--json',
    ], { encoding: 'utf8', timeout: 20000 });
    assert.equal(proc.stderr, '', `v${version} stderr`);
    assert.equal(proc.status, version === 10 ? 1 : 2);
    // The pin is the JSON. Git on Windows checks the fixture out with CRLF;
    // the CLI prints LF. Compare the normalized text.
    assert.equal(proc.stdout.replace(/\r\n/g, '\n'), pinned.replace(/\r\n/g, '\n'));
  }
});
