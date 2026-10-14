/**
 * @xfuel/verify 0.4.0 locked verdict.
 * History is always on. Removed flags error. verified means every check passed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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
const { buildVerifyVerdict, VERDICT_DOC_ANCHORS } = await import('../dist/verdict.js');

const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

function runCli(args) {
  const proc = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 8000 });
  return { ...proc, text: `${proc.stdout || ''}\n${proc.stderr || ''}` };
}

function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr, text: `${stdout}\n${stderr}` }));
  });
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
  assert.equal(BUNDLED_HISTORY_AS_OF, '2026-10-14');
  assert.equal(loaded.document.version, 2);
  assert.equal(loaded.document.head_hash, '349d7bb495bad55aaa25d05ee91134575e6e7d300795b37b41f4bcf29af80f0e');
  const signed = verifyIssuerHistoryDocument(loaded.document, { trustedKids: [PRODUCTION_KID] });
  assert.equal(signed.valid, true, signed.reason);
  assert.equal(loaded.document.entries[0].kid, PRODUCTION_KID);
  assert.equal(historyPrefixExtends(loaded.document, loaded.document), true);
  const v1 = JSON.parse(readFileSync(new URL('./fixtures/issuer-history-v1-bundle.json', import.meta.url), 'utf8'));
  assert.equal(historyPrefixExtends(v1, loaded.document), true);
  assert.equal(historyPrefixExtends(loaded.document, v1), false);
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
  assert.equal(fellBack.asOf, '2026-10-14');
  assert.equal(fellBack.headHash, bundled.document.head_hash);

  const offline = await resolveIssuerHistory({
    receipt: {},
    trustedKids: [PRODUCTION_KID],
    fetchImpl: async () => { throw new Error('no network'); },
  });
  assert.equal(offline.source, 'bundled');
  assert.equal(offline.asOf, '2026-10-14');
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

test('a history file that does not extend the snapshot is invalid', async () => {
  const v1 = readFileSync(new URL('./fixtures/issuer-history-v1-bundle.json', import.meta.url), 'utf8');
  const rolled = await resolveIssuerHistory({
    fileBytes: v1,
    trustedKids: [PRODUCTION_KID],
  });
  assert.equal(rolled.invalid, true);
  assert.equal(rolled.reason, 'issuer_history_not_extension');
});

test('--json uses the 0.4 schema and a log that did not run is exit 2', () => {
  const house = JSON.parse(readFileSync(new URL('./fixtures/public/chit-1ebc5616.json', import.meta.url), 'utf8'));
  delete house.verify_url;
  if (house.verification) delete house.verification.jwks_uri;
  const dir = mkdtempSync(join(tmpdir(), 'chit-verdict-040-'));
  const receiptPath = join(dir, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(house));
  const run = runCli([receiptPath, '--json']);
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
  assert.equal(body.reason, 'log_unreachable');
  assert.equal(body.checks.log_inclusion, 'could_not_check');
  assert.equal(body.checks.anchor, 'could_not_check');
  assert.equal(body.checks.signature, 'pass');
  assert.equal(body.checks.key_window, 'pass');
  assert.equal(body.result === 'verified', false);
  assert.equal(body.verifier.name, 'chit402-verify');
  assert.equal(body.verifier.version, '0.4.0');
  assert.equal(body.history.source, 'bundled');
  assert.equal(body.history.as_of, '2026-10-14');
  assert.doesNotMatch(run.stdout, /verified_no_key_window/);
  assert.doesNotMatch(run.stdout, /VERIFIED_CARRIED_FORWARD/);

  const text = runCli([receiptPath]);
  assert.equal(text.status, 2, text.text);
  assert.match(text.stdout, /^COULD_NOT_CHECK\n/);
  assert.match(text.stdout, /NOT found invalid/);
  assert.match(text.stdout, /Details: https:\/\/chit402\.com\/docs\/verify#log_unreachable/);
  assert.match(text.stdout, /Issuer history: as of 2026-10-14/);
  assert.doesNotMatch(text.stdout, /INCLUDED_SHELL/);

  const v1 = readFileSync(new URL('./fixtures/issuer-history-v1-bundle.json', import.meta.url), 'utf8');
  const historyPath = join(dir, 'history.json');
  writeFileSync(historyPath, v1);
  const rolled = runCli([receiptPath, '--json', '--issuer-history', historyPath]);
  assert.equal(rolled.status, 1, rolled.text);
  const bad = JSON.parse(rolled.stdout);
  assert.equal(bad.result, 'invalid');
  assert.equal(bad.reason, 'issuer_history_not_extension');

  const bogus = runCli([receiptPath, '--json', '--jwks-file', historyPath]);
  assert.equal(bogus.status, 1, bogus.text);
  const flag = JSON.parse(bogus.stdout);
  assert.equal(flag.exit_code, 1);
  assert.match(flag.message, /removed in 0\.4: --jwks-file is not a verifier flag/);
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

  const unclaimed = buildVerifyVerdict({
    version: '0.4.0',
    signatureValid: true,
    signatureChecked: true,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'unclaimed',
    anchor: 'unclaimed',
  });
  assert.equal(unclaimed.result, 'could_not_check');
  assert.equal(unclaimed.exit_code, 2);
  assert.equal(unclaimed.checks.log_inclusion, 'could_not_check');
  assert.equal(unclaimed.checks.anchor, 'could_not_check');

  const passed = buildVerifyVerdict({
    version: '0.4.0',
    signatureValid: true,
    signatureChecked: true,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'pass',
    anchor: 'pass',
  });
  assert.equal(passed.result, 'verified');
  assert.equal(passed.exit_code, 0);
  assert.equal(passed.verifier.name, 'chit402-verify');
});

test('chit- uuid on v10 and intent on a legacy payload are invalid', async () => {
  const { verifyReceipt } = await import('../dist/index.js');
  const key = issuerKey();
  const chitId = 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
  const chit = receiptFor(key);
  chit.task_id = chitId;
  const chitClaims = {
    task_id: chitId,
    iss: 'chit402',
    iat: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000),
    payload_version: 8,
    payment: chit.payment,
    caller_binding: chit.caller_binding,
    tree_head_hash: chit.tree_head_hash,
    tolerance: chit.tolerance,
  };
  chit.issuer_signature.jws = signClaims(chitClaims, key, 'chit402-receipt+jwt');
  const prefixed = await verifyReceipt(chit, { trustedKids: [key.kid], skipIssuerHistory: true });
  assert.equal(prefixed.errors.includes('id_prefix_version_mismatch'), true, prefixed.errors.join('; '));

  const intentClaims = { ...chitClaims, task_id: 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96', intent: { amount: '1' } };
  const intentReceipt = receiptFor(key);
  intentReceipt.task_id = intentClaims.task_id;
  intentReceipt.intent = intentClaims.intent;
  intentReceipt.issuer_signature.jws = signClaims(intentClaims, key, 'chit402-receipt+jwt');
  const intent = await verifyReceipt(intentReceipt, { trustedKids: [key.kid], skipIssuerHistory: true });
  assert.equal(intent.errors.includes('intent_on_legacy_version'), true, intent.errors.join('; '));

  const v12Claims = { ...chitClaims, task_id: 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96', payload_version: 12 };
  const v12 = receiptFor(key);
  v12.task_id = v12Claims.task_id;
  v12.issuer_signature.jws = signClaims(v12Claims, key, 'chit402-receipt+jwt');
  v12.issuer_signature.payload_version = 12;
  const later = await verifyReceipt(v12, { trustedKids: [key.kid], skipIssuerHistory: true });
  assert.equal(later.errors.includes('id_prefix_version_mismatch'), true, later.errors.join('; '));
  assert.equal(later.errors.includes('unsupported_version'), false);
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('--issuer-history-file is not accepted', () => {
  const run = runCli(['--issuer-history-file', 'history.json']);
  assert.equal(run.status, 1, run.text);
  assert.match(run.stderr, /removed in 0\.4: --issuer-history-file/);
});

test('a receipt URL requests JSON, and a non-JSON body or a failed fetch is exit 2', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.url} ${req.headers.accept || ''}`);
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const wantsJson = url.searchParams.get('format') === 'json' || String(req.headers.accept || '').includes('application/json');
    if (!wantsJson) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><p>receipt</p></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      schema: 'chit402.receipt_shell.v1',
      unsigned: true,
      task_id: 'xfuel-661ca345-973c-4cb6-b073-8ae0c7b37944',
      receipt_id: 'xfuel-661ca345-973c-4cb6-b073-8ae0c7b37944',
      inclusion: { leaf_hash: 'ab'.repeat(32), proof: [], signed_head: { root: 'cd'.repeat(32), signature: 'sig' } },
    }));
  });
  const port = await listen(server);
  try {
    const bare = `http://127.0.0.1:${port}/receipt/xfuel-661ca345-973c-4cb6-b073-8ae0c7b37944`;
    const run = await runCliAsync([bare, '--json']);
    assert.equal(run.status, 2, run.text);
    const body = JSON.parse(run.stdout);
    assert.equal(body.reason, 'signed_receipt_unavailable');
    assert.equal(body.result, 'could_not_check');
    assert.match(body.next_step, /owner view/);
    assert.doesNotMatch(body.next_step || '', /issuer-history/);
    assert.match(seen.join('\n'), /format=json/);
    assert.match(seen.join('\n'), /application\/json/);

    const htmlOnly = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>no</html>');
    });
    const htmlPort = await listen(htmlOnly);
    try {
      const html = await runCliAsync([`http://127.0.0.1:${htmlPort}/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96`]);
      assert.equal(html.status, 2, html.text);
      assert.match(html.stdout, /^COULD_NOT_CHECK\n/);
      assert.match(html.stdout, /NOT found invalid/);
      assert.doesNotMatch(html.text, /Unexpected token/);
    } finally {
      await new Promise((resolve) => htmlOnly.close(resolve));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const down = runCli(['http://127.0.0.1:9/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96', '--json']);
  assert.equal(down.status, 2, down.text);
  const missed = JSON.parse(down.stdout);
  assert.equal(missed.result, 'could_not_check');
  assert.equal(missed.exit_code, 2);
  assert.match(missed.message, /NOT found invalid/);
  const human = runCli(['http://127.0.0.1:9/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96']);
  assert.equal(human.status, 2, human.text);
  assert.match(human.stdout, /NOT found invalid/);
});

test('a null-inclusion shell is NOT_IN_LOG only beside a verified head', async () => {
  const signedHead = JSON.parse(readFileSync(new URL('./fixtures/pardal-head-honest.json', import.meta.url), 'utf8'));
  const task = 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
  let signed = false;
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.includes('/inclusion')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_in_tree' }));
      return;
    }
    if (url.includes('/tree/head')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(signed ? signedHead : { schema: 'chit402.tree_head.v2', tree_size: 1, root: 'ab'.repeat(32) }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      schema: 'chit402.receipt_shell.v1',
      unsigned: true,
      task_id: task,
      receipt_id: task,
      inclusion: { leaf_hash: null, proof: null, signed_head: null },
    }));
  });
  const port = await listen(server);
  try {
    const target = `http://127.0.0.1:${port}/receipt/${task}`;
    const alone = await runCliAsync([target, '--json']);
    assert.equal(alone.status, 2, alone.text);
    const shell = JSON.parse(alone.stdout);
    assert.equal(shell.reason, 'signed_receipt_unavailable');
    assert.notEqual(shell.reason, 'kid_not_in_history');

    signed = true;
    const logged = await runCliAsync([target, '--json']);
    assert.equal(logged.status, 1, logged.text);
    const body = JSON.parse(logged.stdout);
    assert.equal(body.reason, 'not_in_log');
    assert.equal(body.result, 'invalid');
    assert.match(logged.stdout, /payment row in the book is unchanged/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('docs/verify publishes an anchor for every verdict reason', () => {
  const page = readFileSync(new URL('../../../apps/web/src/pages/VerifyDocs.tsx', import.meta.url), 'utf8');
  for (const id of VERDICT_DOC_ANCHORS) {
    assert.ok(page.includes(`id: '${id}'`) || page.includes(`id: "${id}"`), id);
  }
});
