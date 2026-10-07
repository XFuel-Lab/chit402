/**
 * Issuer key pin. Throwaway P-256 keys, generated in process.
 * No receipt is minted. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  assessIssuerPin,
  canonicalPublicKey,
  issuerPinContentUrl,
  issuerPinFileHash,
  loadIssuerPinBytes,
  registrationPreimage,
  rotationStatement,
  serializeIssuerPin,
  verifyAnchoredRoot,
  CITIZEN_FREEZE_PURPOSE,
  CITIZEN_FREEZE_SCHEMA,
  ISSUER_PIN_CHAIN_ID,
  ISSUER_PIN_CHAIN_REFUSED,
  ISSUER_PIN_DOWNGRADE,
  ISSUER_PIN_HASH_MISMATCH,
  ISSUER_PIN_MISMATCH,
  ISSUER_PIN_MUTABLE_REF,
  ISSUER_PIN_PATH,
  PUBLISHED_ISSUER_PIN_KID,
  ISSUER_PIN_SCHEMA,
  ISSUER_REGISTRATION_CONTEXT,
  ISSUER_ROTATION_UNCONTROLLED,
  ISSUER_SELF_SIG_INVALID,
} = await import('../dist/index.js');
const { jwkThumbprint } = await import('../dist/jws.js');

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const CREATED = '2026-10-07T18:00:00.000Z';
const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig' };
  jwk.kid = jwkThumbprint(jwk);
  return { privateKey, jwk, kid: jwk.kid };
}

function signRaw(privateKey, message) {
  return sign('sha256', Buffer.from(message, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

function pinDoc(key, { createdAt = CREATED, selfSignature = undefined, control = null, chainId = ISSUER_PIN_CHAIN_ID } = {}) {
  const signature = selfSignature === undefined
    ? signRaw(key.privateKey, registrationPreimage({ kid: key.kid, createdAt, jwk: key.jwk }))
    : selfSignature;
  return {
    schema: ISSUER_PIN_SCHEMA,
    version: 1,
    chain_id: chainId,
    created_at: createdAt,
    jwk: key.jwk,
    self_signature: signature,
    control,
  };
}

function pinBytes(key, opts) {
  return serializeIssuerPin(pinDoc(key, opts));
}

function refFor(bytes, commit = COMMIT_A) {
  return { commit, path: ISSUER_PIN_PATH, sha256: issuerPinFileHash(bytes) };
}

function signFreeze(privateKey, kid, payload) {
  const header = { alg: 'ES256', typ: 'chit402-freeze+jwt', kid };
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${signRaw(privateKey, `${h}.${p}`)}`;
}

function controlFor(prior, next, nextBytes, commit) {
  const pinSha256 = issuerPinFileHash(nextBytes);
  const statement = rotationStatement({
    priorKid: prior.kid,
    nextKid: next.kid,
    pinSha256,
    pinCommit: commit,
    createdAt: CREATED,
  });
  const payload = {
    schema: CITIZEN_FREEZE_SCHEMA,
    purpose: CITIZEN_FREEZE_PURPOSE,
    chain_id: ISSUER_PIN_CHAIN_ID,
    prior_kid: prior.kid,
    next_kid: next.kid,
    pin_sha256: pinSha256,
    pin_commit: commit,
    created_at: CREATED,
    statement,
  };
  return { payload, jws: signFreeze(prior.privateKey, prior.kid, payload), pinSha256 };
}

test('happy path matches the pin, issuer root, and witnesses source', () => {
  const key = makeKey();
  const bytes = pinBytes(key);
  const ref = refFor(bytes);
  const result = assessIssuerPin({
    receipt: {
      issuer_signature: { kid: key.kid, issuer_jwk: key.jwk },
      issuer_root: { kid: key.kid },
      issuer_key_pin: { era: 1, ...ref },
    },
    pinBytes: bytes,
    sigBytes: `${JSON.parse(bytes).self_signature}\n`,
    ref,
    witnesses: { source: '/api/witnesses', kid: key.kid, witnesses: [{ jwk: key.jwk }] },
    required: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, null);
  assert.equal(result.checked, true);
});

test('a receipt key that is not the pin is ISSUER_PIN_MISMATCH', () => {
  const pinKey = makeKey();
  const other = makeKey();
  const bytes = pinBytes(pinKey);
  const result = assessIssuerPin({
    receipt: {
      issuer_signature: { kid: other.kid, issuer_jwk: other.jwk },
      issuer_root: { kid: pinKey.kid },
      issuer_key_pin: { era: 1 },
    },
    pinBytes: bytes,
    ref: refFor(bytes),
    required: true,
  });
  assert.equal(result.code, ISSUER_PIN_MISMATCH);
});

test('a swapped pin file fails the content hash', () => {
  const a = makeKey();
  const b = makeKey();
  const bytesA = pinBytes(a);
  const bytesB = pinBytes(b);
  const result = assessIssuerPin({
    receipt: { issuer_signature: { kid: b.kid, issuer_jwk: b.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: bytesB,
    ref: refFor(bytesA),
    required: true,
  });
  assert.equal(result.code, ISSUER_PIN_HASH_MISMATCH);
  assert.notEqual(issuerPinFileHash(bytesA), issuerPinFileHash(bytesB));
});

test('a branch ref is refused and nothing is fetched', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Uint8Array();
  };
  for (const commit of ['main', 'HEAD', 'refs/heads/main', 'cursor/issuer-key-pin-7ba5']) {
    const loaded = await loadIssuerPinBytes(
      { commit, path: ISSUER_PIN_PATH, sha256: 'ab'.repeat(32) },
      fetchImpl,
    );
    assert.equal(loaded.ok, false);
    assert.equal(loaded.code, ISSUER_PIN_MUTABLE_REF);
    assert.equal(issuerPinContentUrl(commit).ok, false);
  }
  assert.equal(calls, 0);
  const key = makeKey();
  const bytes = pinBytes(key);
  const moved = assessIssuerPin({
    receipt: { issuer_signature: { kid: key.kid, issuer_jwk: key.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: bytes,
    ref: { commit: 'main', path: ISSUER_PIN_PATH, sha256: issuerPinFileHash(bytes) },
    required: true,
  });
  assert.equal(moved.code, ISSUER_PIN_MUTABLE_REF);
});

test('a self-signature under another context is ISSUER_SELF_SIG_INVALID', () => {
  const key = makeKey();
  const forged = [
    'chit402-witness-register-v1',
    '1',
    key.kid,
    CREATED,
    canonicalPublicKey(key.jwk),
  ].join('\n');
  assert.notEqual(forged.split('\n')[0], ISSUER_REGISTRATION_CONTEXT);
  const bytes = pinBytes(key, { selfSignature: signRaw(key.privateKey, forged) });
  const result = assessIssuerPin({
    receipt: { issuer_signature: { kid: key.kid, issuer_jwk: key.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: bytes,
    ref: refFor(bytes),
    required: true,
  });
  assert.equal(result.code, ISSUER_SELF_SIG_INVALID);
});

test('a self-signature for another key or a flipped byte fails', () => {
  const key = makeKey();
  const other = makeKey();
  const stolen = pinBytes(other, {
    selfSignature: signRaw(key.privateKey, registrationPreimage({
      kid: key.kid,
      createdAt: CREATED,
      jwk: key.jwk,
    })),
  });
  assert.equal(assessIssuerPin({
    receipt: { issuer_signature: { kid: other.kid, issuer_jwk: other.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: stolen,
    ref: refFor(stolen),
    required: true,
  }).code, ISSUER_SELF_SIG_INVALID);

  const honest = JSON.parse(pinBytes(key));
  honest.self_signature = `${honest.self_signature.slice(0, -2)}aa`;
  const flipped = serializeIssuerPin(honest);
  assert.equal(assessIssuerPin({
    receipt: { issuer_signature: { kid: key.kid, issuer_jwk: key.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: flipped,
    ref: refFor(flipped),
    required: true,
  }).code, ISSUER_SELF_SIG_INVALID);
});

test('a missing self-signature stays unchecked and a missing pin on a non-era receipt is legacy', () => {
  const key = makeKey();
  const bytes = pinBytes(key, { selfSignature: null });
  const open = assessIssuerPin({
    receipt: { issuer_signature: { kid: key.kid, issuer_jwk: key.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: bytes,
    ref: refFor(bytes),
    required: true,
  });
  assert.equal(open.ok, true);
  assert.equal(open.code, null);

  const legacy = assessIssuerPin({ receipt: { task_id: 'task-1', row_hash: 'row' } });
  assert.equal(legacy.checked, false);
  assert.equal(legacy.ok, true);
});

test('a pinned era that omits the pin is a downgrade', () => {
  const result = assessIssuerPin({
    head: { issuer_key_pin: { era: 1, commit: COMMIT_A, path: ISSUER_PIN_PATH, sha256: 'ab'.repeat(32) } },
  });
  assert.equal(result.checked, true);
  assert.equal(result.code, ISSUER_PIN_DOWNGRADE);
});

test('a rotated key without an updated pin fails closed', () => {
  const current = makeKey();
  const rotated = makeKey();
  const bytes = pinBytes(current);
  const result = assessIssuerPin({
    receipt: {
      issuer_signature: { kid: rotated.kid, issuer_jwk: rotated.jwk },
      issuer_root: { kid: rotated.kid },
      issuer_key_pin: { era: 1 },
    },
    pinBytes: bytes,
    ref: refFor(bytes),
    required: true,
  });
  assert.equal(result.code, ISSUER_PIN_MISMATCH);
});

test('a pin that is not the published kid fails closed without the previous pin', () => {
  const key = makeKey();
  const bytes = pinBytes(key);
  const result = assessIssuerPin({
    receipt: { issuer_signature: { kid: key.kid, issuer_jwk: key.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: bytes,
    ref: refFor(bytes),
    required: true,
    anchorToPublished: true,
  });
  assert.equal(result.code, ISSUER_ROTATION_UNCONTROLLED);
  assert.notEqual(key.kid, PUBLISHED_ISSUER_PIN_KID);
});

test('an edited pin without the citizen freeze is not a rotation', () => {
  const prior = makeKey();
  const next = makeKey();
  const priorBytes = pinBytes(prior);
  const nextBytes = pinBytes(next);
  const result = assessIssuerPin({
    receipt: { issuer_signature: { kid: next.kid, issuer_jwk: next.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: nextBytes,
    ref: refFor(nextBytes, COMMIT_B),
    priorPinBytes: priorBytes,
    priorRef: refFor(priorBytes, COMMIT_A),
    required: true,
  });
  assert.equal(result.code, ISSUER_ROTATION_UNCONTROLLED);
});

test('a citizen freeze signed by the prior key accepts the rotation', () => {
  const prior = makeKey();
  const next = makeKey();
  const priorBytes = pinBytes(prior);
  const nextBytes = pinBytes(next);
  const signed = controlFor(prior, next, nextBytes, COMMIT_B);
  const pinnedRef = refFor(nextBytes, COMMIT_B);
  const result = assessIssuerPin({
    receipt: {
      issuer_signature: { kid: next.kid, issuer_jwk: next.jwk },
      issuer_root: { kid: next.kid },
      issuer_key_pin: { era: 1, ...pinnedRef },
    },
    pinBytes: nextBytes,
    ref: pinnedRef,
    priorPinBytes: priorBytes,
    priorRef: refFor(priorBytes),
    controlJws: signed.jws,
    witnesses: { kid: next.kid },
    required: true,
  });
  assert.equal(result.ok, true, result.code);
  assert.equal(signed.payload.purpose, CITIZEN_FREEZE_PURPOSE);
  assert.equal(signed.payload.schema, CITIZEN_FREEZE_SCHEMA);
});

test('a rotation signed by the new key, or under another context, is refused', () => {
  const prior = makeKey();
  const next = makeKey();
  const priorBytes = pinBytes(prior);
  const nextBytes = pinBytes(next);
  const nextHash = issuerPinFileHash(nextBytes);
  const attackerPayload = {
    schema: CITIZEN_FREEZE_SCHEMA,
    purpose: CITIZEN_FREEZE_PURPOSE,
    chain_id: ISSUER_PIN_CHAIN_ID,
    prior_kid: prior.kid,
    next_kid: next.kid,
    pin_sha256: nextHash,
    pin_commit: COMMIT_B,
    created_at: CREATED,
    statement: rotationStatement({
      priorKid: prior.kid,
      nextKid: next.kid,
      pinSha256: nextHash,
      pinCommit: COMMIT_B,
      createdAt: CREATED,
    }),
  };
  const attackerJws = signFreeze(next.privateKey, next.kid, attackerPayload);
  assert.equal(assessIssuerPin({
    receipt: { issuer_signature: { kid: next.kid, issuer_jwk: next.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: nextBytes,
    ref: refFor(nextBytes, COMMIT_B),
    priorPinBytes: priorBytes,
    controlJws: attackerJws,
    required: true,
  }).code, ISSUER_ROTATION_UNCONTROLLED);

  const replay = rotationStatement({
    priorKid: prior.kid,
    nextKid: next.kid,
    pinSha256: nextHash,
    pinCommit: COMMIT_B,
    createdAt: CREATED,
  }).replace('chit402-issuer-rotation-v1', 'chit402-issuer-rotation-v0');
  const replayPayload = {
    schema: CITIZEN_FREEZE_SCHEMA,
    purpose: CITIZEN_FREEZE_PURPOSE,
    chain_id: ISSUER_PIN_CHAIN_ID,
    prior_kid: prior.kid,
    next_kid: next.kid,
    pin_sha256: nextHash,
    pin_commit: COMMIT_B,
    created_at: CREATED,
    statement: replay,
  };
  const replayJws = signFreeze(prior.privateKey, prior.kid, replayPayload);
  assert.equal(assessIssuerPin({
    receipt: { issuer_signature: { kid: next.kid, issuer_jwk: next.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: nextBytes,
    ref: refFor(nextBytes, COMMIT_B),
    priorPinBytes: priorBytes,
    controlJws: replayJws,
    required: true,
  }).code, ISSUER_ROTATION_UNCONTROLLED);
});

test('mainnet chain id on the pin is refused', () => {
  const key = makeKey();
  const bytes = pinBytes(key, { chainId: 'eip155:8453' });
  const result = assessIssuerPin({
    receipt: { issuer_signature: { kid: key.kid, issuer_jwk: key.jwk }, issuer_key_pin: { era: 1 } },
    pinBytes: bytes,
    ref: refFor(bytes),
    required: true,
  });
  assert.equal(result.code, ISSUER_PIN_CHAIN_REFUSED);
});

test('anchor mode fails closed on a downgrade and stays quiet when no era is claimed', async () => {
  const bare = { task_id: 'task-1', row_hash: 'row-hash-1' };
  const inclusion = { error: 'not_in_tree', task_id: 'task-1', leaf_index: 0, tree_size: 1, root: 'ab'.repeat(32), proof: [] };
  const head = { root: 'ab'.repeat(32), tree_size: 1, schema: 'chit402.tree_head.v1', payload_version: 1 };
  const legacy = await verifyAnchoredRoot({ receipt: bare, inclusion, head });
  assert.equal(legacy.issuer_pin.checked, false);
  assert.equal(legacy.errors.includes(ISSUER_PIN_DOWNGRADE), false);

  const downgraded = await verifyAnchoredRoot({
    receipt: bare,
    inclusion,
    head: { ...head, issuer_key_pin: { era: 1 } },
  });
  assert.equal(downgraded.overall, 'failed');
  assert.equal(downgraded.issuer_pin.code, ISSUER_PIN_DOWNGRADE);
  assert.ok(downgraded.errors.includes(ISSUER_PIN_DOWNGRADE));
});

test('anchor mode accepts a matching sepolia pin without fetching a branch', async () => {
  const key = makeKey();
  const bytes = pinBytes(key);
  const ref = refFor(bytes);
  const taskId = 'task-1';
  const rowHash = 'row-hash-1';
  const leaf = createHash('sha256').update(Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(`${taskId}|${rowHash}`),
  ])).digest();
  const root = leaf.toString('hex');
  const memo = `chit402:root:v1:global:2026-10-07:${root}:${'0'.repeat(64)}`;
  let fetched = 0;
  const result = await verifyAnchoredRoot({
    receipt: {
      task_id: taskId,
      row_hash: rowHash,
      issuer_signature: { kid: key.kid, issuer_jwk: key.jwk },
      issuer_root: { kid: key.kid },
      issuer_key_pin: { era: 1, ...ref },
    },
    inclusion: { task_id: taskId, leaf_index: 0, tree_size: 1, root, leaf: root, proof: [] },
    head: {
      schema: 'chit402.tree_head.v1',
      payload_version: 1,
      root,
      tree_size: 1,
      anchors: {
        base: { status: 'anchored', tx: `0x${'ab'.repeat(32)}`, calldata: `0x${root}`, chain_id: 8453 },
        solana: { status: 'anchored', signature: 'sig1', slot: 99, cluster: 'devnet', memo },
      },
    },
    issuerPin: { pinBytes: bytes, ref, witnesses: { kid: key.kid } },
    fetchSolanaTx: async () => {
      fetched += 1;
      return {
        slot: 99,
        meta: { err: null },
        transaction: { message: { instructions: [{ programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: memo }] } },
      };
    },
    fetchGenesis: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    fetchBaseTx: async () => {
      fetched += 1;
      return { hash: `0x${'ab'.repeat(32)}`, input: `0x${root}`, chainId: 8453 };
    },
  });
  assert.equal(result.overall, 'verified', result.errors.join(','));
  assert.equal(result.issuer_pin.ok, true);
  assert.equal(fetched, 2);
  assert.equal(issuerPinContentUrl('main').ok, false);
});

test('the published sepolia pin is a public registration, not the production kid', () => {
  const pinPath = fileURLToPath(new URL('../../../docs/well-known/issuer-key.json', import.meta.url));
  const sigPath = fileURLToPath(new URL('../../../docs/well-known/issuer-key.sig', import.meta.url));
  const bytes = readFileSync(pinPath, 'utf8');
  const sig = readFileSync(sigPath, 'utf8');
  assert.equal(bytes.includes('\r'), false);
  assert.equal(sig.includes('\r'), false);
  const doc = JSON.parse(bytes);
  assert.equal(doc.schema, ISSUER_PIN_SCHEMA);
  assert.equal(doc.chain_id, ISSUER_PIN_CHAIN_ID);
  assert.equal(doc.jwk.kid === PRODUCTION_KID, false);
  assert.equal(Object.hasOwn(doc.jwk, 'd'), false);
  assert.equal(sig.trim(), doc.self_signature);
  const ref = refFor(bytes, COMMIT_A);
  const result = assessIssuerPin({
    receipt: { issuer_signature: { kid: doc.jwk.kid, issuer_jwk: doc.jwk }, issuer_key_pin: { era: 1, ...ref } },
    pinBytes: bytes,
    sigBytes: sig,
    ref,
    required: true,
    anchorToPublished: true,
  });
  assert.equal(doc.jwk.kid, PUBLISHED_ISSUER_PIN_KID);
  assert.equal(result.ok, true, result.code);
});

test('anchor CLI reports a downgrade without a network fetch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issuer-pin-'));
  const receipt = join(dir, 'receipt.json');
  const inclusion = join(dir, 'inclusion.json');
  const head = join(dir, 'head.json');
  writeFileSync(receipt, `${JSON.stringify({ task_id: 'task-1', row_hash: 'row' })}\n`);
  writeFileSync(inclusion, `${JSON.stringify({ error: 'not_in_tree', task_id: 'task-1', leaf_index: 0, tree_size: 1, root: 'ab'.repeat(32), proof: [] })}\n`);
  writeFileSync(head, `${JSON.stringify({ root: 'ab'.repeat(32), tree_size: 1, schema: 'chit402.tree_head.v1', payload_version: 1, issuer_key_pin: { era: 1 } })}\n`);
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = spawnSync(process.execPath, [cli, receipt, inclusion, head, '--rpc', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stderr);
  const body = JSON.parse(run.stdout);
  assert.equal(body.issuer_pin.code, ISSUER_PIN_DOWNGRADE);
  assert.equal(body.overall, 'failed');
});
