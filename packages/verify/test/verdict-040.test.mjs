/**
 * @xfuel/verify 0.4.0 locked verdict.
 * History is always on. Removed flags error. verified means every check passed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const snapshotPath = fileURLToPath(new URL('../issuer-history.snapshot.json', import.meta.url));
const {
  BUNDLED_HISTORY_AS_OF,
  historyPrefixExtends,
  loadBundledIssuerHistory,
  resolveIssuerHistory,
  verifyIssuerHistoryDocument,
  issuerHistoryEntryHash,
} = await import('../dist/issuer-history.js');
const { buildVerifyVerdict } = await import('../dist/verdict.js');

const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

function runCli(args) {
  const proc = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 8000 });
  return { ...proc, text: `${proc.stdout || ''}\n${proc.stderr || ''}` };
}

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y });
  const kid = createHash('sha256').update(canonical).digest('base64url');
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, publicJwk };
}

function signClaims(claims, key, typ) {
  const header = { alg: 'ES256', typ, kid: key.kid };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

function historyFor(key, notBefore = '2020-01-01T00:00:00.000Z') {
  const body = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: notBefore,
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'test custody',
    prev_hash: null,
  };
  const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: 1,
    head_hash: entry.entry_hash,
    version: 1,
    seq: 1,
  };
  return {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: 1,
    seq: 1,
    entries: [entry],
    head_hash: entry.entry_hash,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-issuer-history+jwt',
      payload_version: 1,
      jws: signClaims(claims, key, 'chit402-issuer-history+jwt'),
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

function receiptFor(key) {
  const claims = {
    task_id: 'task-verdict-040',
    iss: 'chit402',
    iat: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000),
    payload_version: 8,
    payment: {
      rail: 'usdc',
      ref: `base:0x${'ab'.repeat(32)}`,
      gross_amount: '2000',
      settled_amount: '2000',
      payee: `0x${'22'.repeat(20)}`,
    },
    caller_binding: { payer_wallet: `0x${'11'.repeat(20)}` },
    tree_head_hash: 'ab'.repeat(32),
    tolerance: { base: 300, solana: 150 },
  };
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      kid: key.kid,
      jws: signClaims(claims, key, 'chit402-receipt+jwt'),
      issuer_jwk: key.publicJwk,
      payload_version: 8,
    },
  };
}

test('the shipped snapshot is signed and chain-checked', () => {
  const loaded = loadBundledIssuerHistory();
  const onDisk = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  assert.equal(loaded.document.head_hash, onDisk.head_hash);
  assert.equal(BUNDLED_HISTORY_AS_OF, '2026-09-04');
  const signed = verifyIssuerHistoryDocument(loaded.document, { trustedKids: [PRODUCTION_KID] });
  assert.equal(signed.valid, true, signed.reason);
  assert.equal(loaded.document.entries[0].kid, PRODUCTION_KID);
  assert.equal(historyPrefixExtends(loaded.document, loaded.document), true);
  const broken = structuredClone(loaded.document);
  broken.entries[0].entry_hash = 'ab'.repeat(32);
  assert.equal(historyPrefixExtends(loaded.document, broken), false);
});

test('a live body must prefix-extend the bundled snapshot', async () => {
  const bundled = loadBundledIssuerHistory();
  const receipt = { verify_url: 'https://api.chit402.com/receipt/chit-1ebc5616' };
  let calls = 0;
  const live = await resolveIssuerHistory({
    receipt,
    trustedKids: [PRODUCTION_KID],
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, text: async () => bundled.bytes };
    },
  });
  assert.equal(calls, 1);
  assert.equal(live.source, 'live');
  assert.equal(live.asOf, null);
  assert.equal(live.headHash, bundled.document.head_hash);

  const moved = structuredClone(bundled.document);
  moved.entries[0].entry_hash = 'cd'.repeat(32);
  moved.head_hash = moved.entries[0].entry_hash;
  const fellBack = await resolveIssuerHistory({
    receipt,
    trustedKids: [PRODUCTION_KID],
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(moved) }),
  });
  assert.equal(fellBack.source, 'bundled');
  assert.equal(fellBack.asOf, '2026-09-04');
  assert.equal(fellBack.headHash, bundled.document.head_hash);

  const offline = await resolveIssuerHistory({
    receipt: {},
    trustedKids: [PRODUCTION_KID],
    fetchImpl: async () => { throw new Error('no network'); },
  });
  assert.equal(offline.source, 'bundled');
  assert.equal(offline.asOf, '2026-09-04');
});

test('a supplied history file that does not verify is invalid', async () => {
  const bad = await resolveIssuerHistory({
    fileBytes: '{"schema":"chit402.issuer_history.v1","entries":[{"kid":"x"}]}',
    trustedKids: [PRODUCTION_KID],
  });
  assert.equal(bad.source, 'file');
  assert.equal(bad.invalid, true);
  assert.notEqual(bad.reason, null);
});

test('removed flags exit 1 with the 0.4 reason', () => {
  const cases = [
    ['--strict', 'removed in 0.4: a skipped key window is no longer a separate result'],
    ['--no-issuer-history', 'removed in 0.4: the history check is always on'],
    ['--accept-no-key-window', 'removed in 0.4: VERIFIED_NO_KEY_WINDOW is retired'],
    ['--accept-shell', 'removed in 0.4: a shell is not a verified payment'],
  ];
  for (const [flag, message] of cases) {
    const run = runCli([flag]);
    assert.equal(run.status, 1, run.text);
    assert.equal(run.stderr.trim(), message);
    assert.doesNotMatch(run.stdout, /VERIFIED_NO_KEY_WINDOW/);
  }
});

test('--json uses the 0.4 schema and a missing kid is exit 2', () => {
  const key = issuerKey();
  const dir = mkdtempSync(join(tmpdir(), 'chit-verdict-040-'));
  const receiptPath = join(dir, 'receipt.json');
  const jwksPath = join(dir, 'jwks.json');
  writeFileSync(receiptPath, JSON.stringify(receiptFor(key)));
  writeFileSync(jwksPath, JSON.stringify({ keys: [key.publicJwk] }));
  const run = runCli([receiptPath, '--json', '--jwks-file', jwksPath, '--trusted-kid', key.kid]);
  assert.equal(run.status, 2, run.text);
  const body = JSON.parse(run.stdout);
  for (const keyName of [
    'result', 'exit_code', 'reason', 'message', 'next_step', 'receipt_id', 'display_id',
    'payload_version', 'checks', 'history', 'log', 'verifier',
  ]) {
    assert.equal(Object.hasOwn(body, keyName), true, keyName);
  }
  for (const check of ['signature', 'key_window', 'payment_binding', 'log_inclusion', 'anchor', 'shape']) {
    assert.equal(Object.hasOwn(body.checks, check), true, check);
  }
  assert.equal(body.result, 'could_not_check');
  assert.equal(body.exit_code, 2);
  assert.equal(body.reason, 'kid_not_in_history');
  assert.equal(body.message, 'No issuer history covers this key.');
  assert.match(body.next_step, /--issuer-history/);
  assert.equal(body.checks.key_window, 'could_not_check');
  assert.equal(body.checks.signature, 'pass');
  assert.equal(body.result === 'verified', false);
  assert.equal(body.verifier.name, '@xfuel/verify');
  assert.equal(body.verifier.version, '0.4.0');
  assert.equal(body.history.source, 'bundled');
  assert.equal(body.history.as_of, '2026-09-04');
  assert.doesNotMatch(run.stdout, /verified_no_key_window/);

  const historyPath = join(dir, 'history.json');
  writeFileSync(historyPath, JSON.stringify(historyFor(key)));
  const covered = runCli([
    receiptPath, '--json', '--jwks-file', jwksPath, '--trusted-kid', key.kid,
    '--issuer-history', historyPath,
  ]);
  assert.equal(covered.status, 0, covered.text);
  const ok = JSON.parse(covered.stdout);
  assert.equal(ok.result, 'verified');
  assert.equal(ok.exit_code, 0);
  assert.equal(ok.message, 'Every check passed.');
  assert.equal(ok.history.source, 'file');
  assert.equal(ok.history.as_of, null);
  for (const check of Object.values(ok.checks)) assert.equal(check, 'pass');
});

test('verified is absent unless every check passed', () => {
  const missed = buildVerifyVerdict({
    version: '0.4.0',
    signatureValid: true,
    signatureChecked: true,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'fail',
    logReason: 'not_in_log',
    anchor: 'pass',
  });
  assert.equal(missed.result, 'invalid');
  assert.equal(missed.exit_code, 1);
  assert.equal(missed.reason, 'not_in_log');
  assert.match(missed.message, /payment row in the book is unchanged/);

  const unreachable = buildVerifyVerdict({
    version: '0.4.0',
    signatureValid: false,
    signatureChecked: true,
    historyMissing: true,
    logInclusion: 'could_not_check',
    anchor: 'could_not_check',
    logReason: 'log_unreachable',
  });
  assert.equal(unreachable.result, 'invalid');
  assert.equal(unreachable.exit_code, 1);

  const upgrade = buildVerifyVerdict({
    version: '0.4.0',
    errors: ['unsupported_version'],
    historyMissing: true,
  });
  assert.equal(upgrade.result, 'could_not_check');
  assert.equal(upgrade.exit_code, 2);
  assert.equal(upgrade.reason, 'unsupported_version');
  assert.equal(upgrade.next_step, 'Upgrade @xfuel/verify.');
});
