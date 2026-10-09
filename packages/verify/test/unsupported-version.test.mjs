/**
 * M10: versions the gateway never issued fail closed.
 * Each T-* row must be unsupported_version or version_mismatch, exit 1,
 * before any RPC. Exact JSON numbers only. No Number() coercion.
 * OV519-ACCEPT is the supported-shell row in receipt-shell.test.mjs.
 * This file only adds the unknown-version half of that rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const {
  verifyReceipt,
  verifyReceiptUpToV10,
  verifyRefusal,
  reconcileSettledTransfer,
  classifySignedClaims,
  signedClaimsOnAllowlist,
  SUPPORTED_RECEIPT_VERSIONS,
  VERIFIER_MIN,
} = await import('../dist/index.js');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const exported = publicKey.export({ format: 'jwk' });
const kid = 'm10-version-kid';
const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig', kid };
const jwks = { keys: [jwk] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm10-ver-'));
const jwksPath = path.join(dir, 'jwks.json');
const historyPath = path.join(dir, 'history.json');
const inclusionPath = path.join(dir, 'inclusion.json');
const headPath = path.join(dir, 'head.json');
fs.writeFileSync(jwksPath, JSON.stringify(jwks));
fs.writeFileSync(historyPath, '{}');
fs.writeFileSync(inclusionPath, '{}');
fs.writeFileSync(headPath, '{}');

const HINT = 'this receipt requires a verifier newer than @xfuel/verify 0.3.5';
const VERSION_REASONS = new Set(['unsupported_version', 'version_mismatch']);

function signText(payloadText, headerExtra = {}) {
  const header = Buffer.from(JSON.stringify({
    alg: 'ES256',
    typ: 'chit402-receipt+jwt',
    kid,
    ...headerExtra,
  })).toString('base64url');
  const body = Buffer.from(payloadText).toString('base64url');
  const input = `${header}.${body}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function signClaims(claims, headerExtra) {
  return signText(JSON.stringify(claims), headerExtra);
}

function v11ish(v) {
  const claims = {
    v,
    receipt_id: 'xfuel-v11-m10',
    iss: 'chit402',
    kid,
    issued_at: '2026-09-26T17:27Z',
    asset: 'USDC',
    chain: 'base',
    pay_to: `0x${'22'.repeat(20)}`,
    amount_gross: '2000',
    amount_settled: '2000',
    payment_tx: `0x${'ab'.repeat(32)}`,
    payer: `0x${'11'.repeat(20)}`,
    book_ref: 'ab'.repeat(16),
    seq: 1,
    request_digest: '11'.repeat(32),
    output_commitment: '22'.repeat(32),
    accounting_commitment: '33'.repeat(32),
    routing_commitment: '44'.repeat(32),
    product: 'completions',
    proof_tier: null,
    covers: ['payment'],
  };
  if (v === undefined) delete claims.v;
  return claims;
}

function legacyClaims(version, extra = {}) {
  const claims = {
    task_id: 'task-m10-legacy',
    iss: 'chit402',
    iat: 1,
    payload_version: version,
    payment: {
      rail: 'usdc',
      ref: `base:0x${'11'.repeat(32)}`,
      gross_amount: '2000',
      net_amount: '1900',
      payee: `0x${'22'.repeat(20)}`,
    },
    caller_binding: { payer_wallet: `0x${'11'.repeat(20)}` },
    ...extra,
  };
  if (version === undefined) delete claims.payload_version;
  return claims;
}

function withHead(claims) {
  return {
    ...claims,
    tree_head_hash: 'ab'.repeat(32),
    tolerance: { base: 300, solana: 150 },
    issuer_history: { hash: 'cd'.repeat(32), version: 1, seq: 1 },
  };
}

function receiptFor(claims, { outerPv, outerV, header, raw } = {}) {
  const jws = raw ? signText(raw, header) : signClaims(claims, header);
  const doc = {
    ...claims,
    task_id: claims.task_id || 'task-outer',
    issuer_signature: { alg: 'ES256', kid, jws, issuer_jwk: jwk },
  };
  if (outerV !== undefined) doc.v = outerV;
  const pv = outerPv !== undefined ? outerPv : claims.payload_version;
  if (pv !== undefined) doc.issuer_signature.payload_version = pv;
  return doc;
}

function writeJson(name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function runCli(args, timeout = 6000) {
  const started = Date.now();
  const proc = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout });
  return { ...proc, elapsed: Date.now() - started, text: `${proc.stdout || ''}\n${proc.stderr || ''}` };
}

async function assertApi(receipt, reason) {
  let fetches = 0;
  const boom = async () => {
    fetches += 1;
    throw new Error('rpc');
  };
  const result = await verifyReceipt(receipt, {
    jwks,
    trustedKids: [kid],
    fetchImpl: boom,
    fetchBaseReceipt: boom,
    fetchSolanaTransaction: boom,
    checkPayer: true,
    rpcUrl: 'http://127.0.0.1:9',
  });
  assert.equal(fetches, 0, 'RPC before the version gate');
  assert.equal(result.overall, 'failed');
  assert.equal(result.errors[0], reason);
  assert.equal(result.issuer_signature.valid, false);
  assert.equal(result.amount_usdc, null);
  assert.equal(result.tx, null);
  if (reason === 'unsupported_version') assert.equal(result.errors.at(-1), HINT);
  else assert.equal(result.errors.includes(HINT), false);
  const capped = await verifyReceiptUpToV10(receipt, { jwks, trustedKids: [kid], fetchImpl: boom });
  assert.equal(fetches, 0);
  assert.equal(capped.overall, 'failed');
  assert.equal(capped.errors[0], reason);
  return result;
}

function assertCli(args, reason) {
  const proc = runCli(args);
  assert.equal(proc.status, 1, proc.text);
  assert.ok(proc.elapsed < 5000, `hung ${proc.elapsed}ms\n${proc.text}`);
  assert.doesNotMatch(proc.text, /Overall:\s*VERIFIED/);
  assert.doesNotMatch(proc.text, /INCLUDED_SHELL/);
  assert.doesNotMatch(proc.text, /PARTIAL/);
  if (args.includes('--json')) {
    const parsed = JSON.parse(proc.stdout);
    assert.equal(parsed.overall, 'failed');
    assert.equal(parsed.errors[0], reason);
    assert.equal(parsed.issuer_signature.valid, false);
    assert.equal(parsed.amount_usdc, null);
    return parsed;
  }
  assert.equal(proc.stdout.trim().split('\n')[0], reason, proc.text);
  return proc;
}

function assertPaths(receipt, reason, { history = false, ownerJws = true } = {}) {
  return (async () => {
    await assertApi(receipt, reason);
    const receiptPath = writeJson('receipt.json', receipt);
    const holderPath = writeJson('holder.json', receipt);
    const ownerPath = writeJson('owner.json', { jws: receipt.issuer_signature.jws, salt: null });
    const shellPath = writeJson('shell.json', {
      schema: 'chit402.receipt_shell.v1',
      receipt_id: 'shell-1',
      payload_version: 8,
    });
    const common = ['--jwks-file', jwksPath, '--no-trusted-kid'];
    if (history) common.push('--issuer-history-file', historyPath);
    assertCli([receiptPath, ...common], reason);
    assertCli([receiptPath, '--json', ...common], reason);
    assertCli([shellPath, '--jws', holderPath, ...common], reason);
    if (ownerJws) {
      assertCli([shellPath, '--jws', ownerPath, ...common], reason);
    } else {
      // A {jws} owner view has no separate outer stamp. The saved holder above
      // is the owner-view file that still carries the disagreeing copy.
      const owner = runCli([shellPath, '--jws', ownerPath, ...common]);
      assert.notEqual(owner.status, 0, owner.text);
      assert.doesNotMatch(owner.text, /Overall:\s*VERIFIED/);
      assert.doesNotMatch(owner.text, /INCLUDED_SHELL/);
      assert.doesNotMatch(owner.text, /PARTIAL/);
    }
    assertCli([shellPath, '--accept-shell', '--jws', holderPath, ...common], reason);
    assertCli([
      receiptPath, inclusionPath, headPath, '--rpc', 'http://127.0.0.1:9', ...common,
    ], reason);
  })();
}

test('supported versions are exported and printed', () => {
  assert.deepEqual(SUPPORTED_RECEIPT_VERSIONS.v, [11]);
  assert.deepEqual([...SUPPORTED_RECEIPT_VERSIONS.payload_version].slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(VERIFIER_MIN, '0.3.5');
  const help = runCli(['--help'], 8000);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /payload_version: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10/);
  assert.match(help.stdout, /11 only with a signed issuer_root/);
  const version = runCli(['--version'], 8000);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /@xfuel\/verify 0\.3\.6/);
  assert.match(version.stdout, /v: 11/);
});

test('T-V12 signed v 12 is unsupported_version on every path', async () => {
  await assertPaths(receiptFor(v11ish(12), { outerV: 12 }), 'unsupported_version');
});

test('T-V13 T-V99 T-V2P53 signed v 13, 99, and 2^53 are unsupported_version', async () => {
  for (const v of [13, 99, 2 ** 53]) {
    await assertPaths(receiptFor(v11ish(v), { outerV: v }), 'unsupported_version');
  }
});

test('T-VSTR signed v string 11 is unsupported_version', async () => {
  await assertPaths(receiptFor(v11ish('11'), { outerV: '11' }), 'unsupported_version');
});

test('T-VPAD padded v strings are unsupported_version', async () => {
  for (const v of ['011', ' 11', '11 ', 'v11', '0x0b']) {
    await assertPaths(receiptFor(v11ish(v), { outerV: v }), 'unsupported_version');
  }
});

test('T-VFLOAT signed v 11.5 is unsupported_version', async () => {
  await assertPaths(receiptFor(v11ish(11.5), { outerV: 11.5 }), 'unsupported_version');
});

test('T-VNUMFORM raw JSON 11.0 and 1.1e1 are the number 11', async () => {
  const { createHmac, hkdfSync } = await import('node:crypto');
  const salt = '0123456789abcdef'.repeat(4);
  const commit = (label, message) => {
    const sub = Buffer.from(hkdfSync('sha256', Buffer.from(salt, 'hex'), Buffer.alloc(0), Buffer.from(label), 32));
    return createHmac('sha256', sub).update(message).digest('hex');
  };
  const output = Buffer.from('ok');
  const claims = {
    ...v11ish(11),
    output_commitment: commit('v11/output', output),
    accounting_commitment: commit('v11/accounting', '{"floor":null,"internal_breakdown":null,"margin":null,"per_call_cost":null}'),
    routing_commitment: commit('v11/routing', '{"model":"m","provider":"p"}'),
  };
  const canonical = JSON.stringify(claims);
  assert.match(canonical, /"v":11[,}]/);
  for (const form of ['11.0', '1.1e1']) {
    const raw = canonical.replace('"v":11', `"v":${form}`);
    assert.notEqual(raw, canonical);
    const receipt = receiptFor(claims, { raw, outerV: 11 });
    const result = await verifyReceipt(receipt, {
      jwks,
      trustedKids: [],
      salt,
      open: {
        output,
        accounting: '{"internal_breakdown":null,"per_call_cost":null,"floor":null,"margin":null}',
        routing: '{"provider":"p","model":"m"}',
      },
    });
    assert.notEqual(result.errors[0], 'unsupported_version', result.errors.join(','));
    assert.equal(result.overall, 'verified', result.errors.join(','));
    assert.equal(result.receipt_version, 11);
    assert.equal(result.version_source, 'signed');
  }
});

test('T-VNULL T-VZERO T-VNEG T-VBOOL T-VARR T-V10 junk v is unsupported_version', async () => {
  const cases = [
    ['T-VNULL', null],
    ['T-VZERO', 0],
    ['T-VNEG', -11],
    ['T-VBOOL', true],
    ['T-VARR', [11]],
    ['T-V10', 10],
  ];
  for (const [, v] of cases) {
    await assertPaths(receiptFor(v11ish(v), { outerV: v }), 'unsupported_version');
  }
});

test('T-VMISSING-V11SHAPE v11 fields with no version are unsupported_version', async () => {
  await assertPaths(receiptFor(v11ish(undefined)), 'unsupported_version');
});

test('T-PV12 T-PV13 T-PV99 T-PV2P53 pinned legacy versions above 10 are unsupported_version', async () => {
  for (const version of [12, 13, 99, 2 ** 53]) {
    const claims = withHead(legacyClaims(version));
    await assertPaths(receiptFor(claims), 'unsupported_version', { history: true });
  }
});

test('T-PVSTR payload_version strings are unsupported_version', async () => {
  for (const version of ['8', '10', '12']) {
    const claims = version === '8' ? legacyClaims(version) : withHead(legacyClaims(version));
    await assertPaths(receiptFor(claims), 'unsupported_version', { history: true });
  }
});

test('T-PVPAD padded payload_version strings are unsupported_version', async () => {
  for (const version of ['08', ' 8', 'v8', '0x8']) {
    await assertPaths(receiptFor(legacyClaims(version)), 'unsupported_version');
  }
});

test('T-PVFLOAT payload_version 8.5 and 10.5 are unsupported_version', async () => {
  for (const version of [8.5, 10.5]) {
    await assertPaths(receiptFor(legacyClaims(version)), 'unsupported_version');
  }
});

test('T-PVJUNK null, 0, -1, true, [8], and 1e21 are unsupported_version', async () => {
  for (const version of [null, 0, -1, true, [8], 1e21]) {
    const result = await assertApi(receiptFor(legacyClaims(version)), 'unsupported_version');
    assert.equal(result.errors.some((line) => /payload v9 requires/.test(line)), false);
    await assertPaths(receiptFor(legacyClaims(version)), 'unsupported_version');
  }
});

test('T-PVMISSING unversioned receipts follow the v4/v5 outer rule', async () => {
  await assertPaths(receiptFor(v11ish(undefined)), 'unsupported_version');
  const modern = legacyClaims(undefined, {
    payment: {
      rail: 'usdc',
      ref: `base:0x${'11'.repeat(32)}`,
      gross_amount: '2000',
      settled_amount: '2000',
    },
  });
  await assertApi(receiptFor(modern, { outerPv: 4 }), 'unsupported_version');
  await assertApi(receiptFor(legacyClaims(undefined), { outerPv: 6 }), 'unsupported_version');
  await assertApi(receiptFor(legacyClaims(undefined), { outerPv: '5' }), 'unsupported_version');

  for (const outer of [4, 5]) {
    const claims = {
      task_id: 'task-unversioned',
      iss: 'chit402',
      iat: 1,
      payment: {
        rail: 'usdc',
        ref: `base:0x${'11'.repeat(32)}`,
        gross_amount: '2000',
        net_amount: '1900',
      },
      caller_binding: { payer_wallet: `0x${'11'.repeat(20)}` },
    };
    const receipt = receiptFor(claims, { outerPv: outer });
    const result = await verifyReceipt(receipt, { jwks, trustedKids: [kid] });
    assert.notEqual(result.errors[0], 'unsupported_version', result.errors.join('; '));
    assert.equal(result.overall, 'verified', result.errors.join('; '));
    assert.equal(result.version_source, 'inferred');
    assert.equal(result.receipt_version, outer);
  }
});

test('T-PV11-ROOT payload_version 11 requires a signed issuer_root', async () => {
  await assertPaths(receiptFor(withHead(legacyClaims(11))), 'unsupported_version');
  const rooted = withHead(legacyClaims(11, { issuer_root: { hash: 'ee'.repeat(32) } }));
  assert.equal(signedClaimsOnAllowlist(rooted), true);
  const accepted = await verifyReceipt(receiptFor(rooted), {
    jwks,
    trustedKids: [kid],
    skipIssuerHistory: true,
  });
  assert.notEqual(accepted.errors[0], 'unsupported_version', accepted.errors.join('; '));
  const capped = await verifyReceiptUpToV10(receiptFor(rooted), { jwks, trustedKids: [kid] });
  assert.equal(capped.errors[0], 'unsupported_version');
});

test('T-MM-OUTERPV outer issuer payload_version that differs is version_mismatch', async () => {
  const claims = legacyClaims(8);
  for (const outerPv of [12, 7, '8']) {
    await assertPaths(receiptFor(claims, { outerPv }), 'version_mismatch', { ownerJws: false });
  }
});

test('T-MM-OUTERV outer v that differs in value or type is version_mismatch', async () => {
  await assertPaths(receiptFor(v11ish(11), { outerV: 12 }), 'version_mismatch', { ownerJws: false });
  await assertPaths(receiptFor(v11ish(11), { outerV: '11' }), 'version_mismatch', { ownerJws: false });
  await assertPaths(receiptFor(legacyClaims(8), { outerV: 11 }), 'version_mismatch', { ownerJws: false });
});

test('T-MM-BOTH both version fields are unsupported_version', async () => {
  const bothV11 = { ...v11ish(11), payload_version: 10 };
  const v11Result = await assertApi(receiptFor(bothV11, { outerV: 11, outerPv: 10 }), 'unsupported_version');
  assert.equal(v11Result.errors.includes('v11_disallowed_field'), true);
  const bothLegacy = { ...legacyClaims(8), v: 12 };
  await assertPaths(receiptFor(bothLegacy, { outerV: 12 }), 'unsupported_version');
});

test('T-MM-HDR a version on the JWS header is ignored', async () => {
  const claims = legacyClaims(8);
  const receipt = receiptFor(claims, { header: { v: 12, payload_version: 12 } });
  const result = await verifyReceipt(receipt, { jwks, trustedKids: [kid] });
  assert.equal(result.overall, 'verified', result.errors.join('; '));
  assert.equal(result.receipt_version, 8);
  const receiptPath = writeJson('hdr-receipt.json', receipt);
  const proc = runCli([receiptPath, '--jwks-file', jwksPath, '--no-trusted-kid', '--json']);
  assert.equal(proc.status, 0, proc.text);
  assert.equal(JSON.parse(proc.stdout).overall, 'verified');
  assert.doesNotMatch(proc.text, /unsupported_version/);
  const shellPath = writeJson('hdr-shell.json', {
    schema: 'chit402.receipt_shell.v1',
    receipt_id: receipt.task_id,
    payload_version: 8,
  });
  const shell = runCli([shellPath, '--jws', receiptPath, '--jwks-file', jwksPath, '--no-trusted-kid']);
  assert.doesNotMatch(shell.text, /unsupported_version/);
  const log = runCli([
    receiptPath, inclusionPath, headPath, '--rpc', 'http://127.0.0.1:9',
    '--jwks-file', jwksPath, '--no-trusted-kid',
  ]);
  assert.doesNotMatch(log.text, /unsupported_version/);
});

test('T-RECON a string signed version does not fall back to the outer version', async () => {
  const claims = legacyClaims('7', {
    payment: {
      rail: 'usdc',
      ref: `base:0x${'11'.repeat(32)}`,
      gross_amount: '2000',
      net_amount: '100',
      settled_amount: '2000',
      payee: `0x${'22'.repeat(20)}`,
    },
  });
  const receipt = receiptFor(claims, { outerPv: 8 });
  const recon = reconcileSettledTransfer(receipt, [{
    address: `0x${'33'.repeat(20)}`,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      `0x${'00'.repeat(12)}${'11'.repeat(20)}`,
      `0x${'00'.repeat(12)}${'22'.repeat(20)}`,
    ],
    data: `0x${(2000n).toString(16).padStart(64, '0')}`,
  }], { jwks, trustedKids: [kid] });
  assert.equal(recon.checked, false);
  assert.equal(recon.matches, false);
  assert.equal(recon.reason, 'unsupported_version');
  assert.equal(recon.signed_field, null);
  assert.equal(recon.signed_amount, null);
  assert.equal(recon.payload_version, 0);
});

test('T-REFUSAL refusal versions use the exact-type rule', async () => {
  function refusal(version, outerVersion = version) {
    const claims = {
      schema: 'chit402.refusal.v1',
      payload_version: version,
      kind: 'refusal',
      refusal_id: 'rfs-m10',
      nonce: 'n'.repeat(32),
      issued_at: '2026-10-03T00:00:00.000Z',
      refusal_code: 'daily_cap_exceeded',
      reason: 'over the daily cap',
      agent_id: 7,
      book_id: 7,
      task_id: 'blocked-1',
      amount_requested: '2000',
      asset: 'USDC',
      charged: false,
      amount_charged: '0',
      chain_id: 8453,
      anchor: { status: 'observed', rail: 'base', chain_id: 8453 },
      book_row: { task_id: 'blocked-1', seq: 4, prev_hash: null, row_hash: 'a'.repeat(64), event: 'policy_blocked' },
    };
    if (version && typeof version === 'object' && version.v != null) {
      delete claims.payload_version;
      claims.v = version.v;
      claims.reason = 'cap_exceeded';
    }
    const jws = signClaims(claims);
    return {
      ...claims,
      payload_version: outerVersion,
      issuer_signature: { alg: 'ES256', kid, jws },
    };
  }
  for (const version of ['2', true, 2.5, 4]) {
    const doc = refusal(version);
    const result = verifyRefusal(doc, { jwks, trustedKids: [kid] });
    assert.equal(result.valid, false);
    assert.equal(result.errors[0], 'unsupported_version');
    const file = writeJson(`refusal-${String(version).replace(/\s/g, '_')}.json`, doc);
    assertCli([file, '--jwks-file', jwksPath, '--no-trusted-kid', '--json'], 'unsupported_version');
  }
  const mismatched = refusal(2, 9);
  mismatched.issuer_signature.payload_version = 9;
  const direct = verifyRefusal(mismatched, { jwks, trustedKids: [kid] });
  assert.equal(direct.reason, 'payload_version_mismatch');
  const file = writeJson('refusal-outer.json', mismatched);
  assertCli([file, '--json', '--jwks-file', jwksPath, '--no-trusted-kid'], 'version_mismatch');
  const v12 = refusal({ v: 12 });
  const v12Result = verifyRefusal(v12, { jwks, trustedKids: [kid] });
  assert.equal(v12Result.errors[0], 'unsupported_version');
  await assertPaths(v12, 'unsupported_version');
});

test('T-FLAGS no flag reaches RPC or turns an unknown version into a pass', async () => {
  const samples = [
    receiptFor(v11ish(12), { outerV: 12 }),
    receiptFor(withHead(legacyClaims(12))),
  ];
  for (const receipt of samples) {
    let fetches = 0;
    const boom = async () => {
      fetches += 1;
      throw new Error('rpc');
    };
    const result = await verifyReceipt(receipt, {
      jwks,
      trustedKids: [],
      checkPayer: true,
      rpcUrl: 'http://127.0.0.1:9',
      fetchImpl: boom,
      fetchBaseReceipt: boom,
      fetchSolanaTransaction: boom,
      skipIssuerHistory: true,
      fetchJwks: true,
      jwksUri: 'https://127.0.0.1:9/jwks.json',
    });
    assert.equal(fetches, 0);
    assert.equal(result.errors[0], 'unsupported_version');
    const receiptPath = writeJson(`flags-${receipt.issuer_signature.jws.slice(-8)}.json`, receipt);
    const holderPath = writeJson('flags-holder.json', receipt);
    const shellPath = writeJson('flags-shell.json', {
      schema: 'chit402.receipt_shell.v1',
      receipt_id: 'shell-1',
      payload_version: 8,
    });
    const sets = [
      ['--check-payer', '--rpc', 'http://127.0.0.1:9'],
      ['--no-issuer-history'],
      ['--no-preimage'],
      ['--no-trusted-kid'],
      ['--jwks-url', 'https://127.0.0.1:9/jwks.json', '--fetch-jwks'],
      ['--issuer-history-file', historyPath],
    ];
    for (const extra of sets) {
      assertCli([receiptPath, ...extra], 'unsupported_version');
      assertCli([receiptPath, '--json', ...extra], 'unsupported_version');
    }
    assertCli([
      shellPath, '--accept-shell', '--jws', holderPath, '--jwks-file', jwksPath, '--no-trusted-kid',
    ], 'unsupported_version');
    assertCli([
      receiptPath, inclusionPath, headPath, '--rpc', 'http://127.0.0.1:9',
    ], 'unsupported_version');
  }
});

test('T-ACCEPT-BARE unknown shell versions do not exit 0', () => {
  const shellPath = writeJson('bare-shell.json', {
    schema: 'chit402.receipt_shell.v1',
    receipt_id: 'shell-12',
    payload_version: 12,
  });
  const proc = runCli([shellPath, '--accept-shell']);
  assert.notEqual(proc.status, 0);
  assert.equal(proc.status, 1, proc.text);
  assert.doesNotMatch(proc.text, /INCLUDED_SHELL/);
  assert.doesNotMatch(proc.text, /VERIFIED/);
  assert.match(proc.stdout, /unsupported_version/);
  const supported = writeJson('bare-shell-8.json', {
    schema: 'chit402.receipt_shell.v1',
    receipt_id: 'shell-8',
    payload_version: 8,
  });
  const ok = runCli([supported, '--accept-shell']);
  assert.equal(ok.status, 0, ok.text);
  assert.match(ok.stdout, /INCLUDED_SHELL/);
});

test('T-UPTO10 verifyReceiptUpToV10 rejects junk and v11', async () => {
  const cases = [
    v11ish('v11'),
    v11ish(null),
    v11ish(0),
    v11ish(true),
    v11ish(undefined),
    legacyClaims(null),
    legacyClaims(0),
    legacyClaims(true),
    legacyClaims(undefined, { payment: { settled_amount: '1', rail: 'usdc' } }),
  ];
  for (const claims of cases) {
    const receipt = receiptFor(claims, {
      outerV: Object.prototype.hasOwnProperty.call(claims, 'v') ? claims.v : undefined,
    });
    const result = await verifyReceiptUpToV10(receipt, { jwks, trustedKids: [kid] });
    assert.equal(result.overall, 'failed');
    assert.equal(result.errors[0], 'unsupported_version', JSON.stringify(claims.v ?? claims.payload_version));
    assert.equal(result.issuer_signature.valid, false);
  }
});

test('T-NOTHROW non-object and undecodable payloads return failed', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid })).toString('base64url');
  const cases = [
    [`${header}.${Buffer.from('[]').toString('base64url')}.sig`, 'unsupported_version'],
    [`${header}.${Buffer.from('"str"').toString('base64url')}.sig`, 'unsupported_version'],
    [`${header}.${Buffer.from('123').toString('base64url')}.sig`, 'unsupported_version'],
    [`${header}.%%%.sig`, 'invalid_jws'],
    ['not-a-jws', 'invalid_jws'],
    [123, 'invalid_jws'],
    [true, 'invalid_jws'],
    [{}, 'invalid_jws'],
    [['a.b.c'], 'invalid_jws'],
  ];
  for (const [jws, reason] of cases) {
    const receipt = { task_id: 'task-outer', issuer_signature: { jws, kid } };
    let thrown = null;
    let result;
    try {
      result = await verifyReceipt(receipt, { jwks, trustedKids: [kid] });
    } catch (err) {
      thrown = err;
    }
    assert.equal(thrown, null);
    assert.equal(result.overall, 'failed');
    assert.equal(result.errors[0], reason);
    const capped = await verifyReceiptUpToV10(receipt, { jwks, trustedKids: [kid] });
    assert.equal(capped.overall, 'failed');
    assert.equal(capped.errors[0], reason);
  }
});

test('P-CTL-LEGACY payload versions 6 through 10 still verify', async () => {
  for (const version of [6, 7, 8, 9, 10]) {
    let claims = legacyClaims(version);
    claims.task_id = `task-pv-${version}`;
    if (version >= 8) {
      claims = {
        ...claims,
        payment: {
          rail: 'usdc',
          ref: `base:0x${'11'.repeat(32)}`,
          gross_amount: '2000',
          settled_amount: '2000',
          payee: `0x${'22'.repeat(20)}`,
        },
      };
      delete claims.payment.net_amount;
    }
    if (version >= 9) {
      claims.tree_head_hash = 'ab'.repeat(32);
      claims.tolerance = { base: 300, solana: 150 };
    }
    const receipt = receiptFor(claims);
    const result = await verifyReceipt(receipt, { jwks, trustedKids: [kid], skipIssuerHistory: true });
    assert.equal(result.overall, 'verified', `pv ${version}: ${result.errors.join('; ')}`);
    assert.equal(result.receipt_version, version);
    assert.equal(result.version_source, 'signed');
    assert.equal(result.errors.includes('unsupported_version'), false);
  }
  const eight = JSON.stringify(legacyClaims(8)).replace('"payload_version":8', '"payload_version":8.0');
  const parsed = JSON.parse(eight);
  const decimal = receiptFor(parsed, { raw: eight });
  const decimalResult = await verifyReceipt(decimal, { jwks, trustedKids: [kid] });
  assert.equal(decimalResult.overall, 'verified', decimalResult.errors.join('; '));
  assert.equal(decimalResult.receipt_version, 8);

  const hmac = receiptFor(legacyClaims(6));
  hmac.hmac_attestation = { payload_version: 8 };
  const hmacResult = await verifyReceipt(hmac, { jwks, trustedKids: [kid] });
  assert.equal(hmacResult.overall, 'verified', hmacResult.errors.join('; '));
  assert.notEqual(hmacResult.errors[0], 'version_mismatch');

  const fixtures = [
    ['chit-4d6e8331.json', true],
    ['chit-5d775d12.v7.json', false],
    ['public/chit-1ebc5616.json', true],
    ['public/chit-39af100b.json', false],
  ];
  for (const [name, mustVerify] of fixtures) {
    const receipt = JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
    const result = await verifyReceipt(receipt, {});
    assert.notEqual(result.errors[0], 'unsupported_version', name);
    assert.notEqual(result.errors[0], 'version_mismatch', name);
    if (mustVerify) assert.equal(result.overall, 'verified', `${name}: ${result.errors.join('; ')}`);
  }
});

test('P-CTL-V11 a signed v11 receipt verifies and UpToV10 refuses it', async () => {
  const { createHmac, hkdfSync } = await import('node:crypto');
  const salt = 'cd'.repeat(32);
  const commit = (label, message) => {
    const sub = Buffer.from(hkdfSync('sha256', Buffer.from(salt, 'hex'), Buffer.alloc(0), Buffer.from(label), 32));
    const bytes = Buffer.isBuffer(message) ? message : Buffer.from(message);
    return createHmac('sha256', sub).update(bytes).digest('hex');
  };
  const output = Buffer.from('ok');
  const claims = {
    ...v11ish(11),
    output_commitment: commit('v11/output', output),
    accounting_commitment: commit('v11/accounting', '{"floor":null,"internal_breakdown":null,"margin":null,"per_call_cost":null}'),
    routing_commitment: commit('v11/routing', '{"model":"m","provider":"p"}'),
  };
  const receipt = receiptFor(claims, { outerV: 11 });
  const opened = await verifyReceipt(receipt, {
    jwks,
    trustedKids: [],
    salt,
    open: {
      output,
      accounting: '{"internal_breakdown":null,"per_call_cost":null,"floor":null,"margin":null}',
      routing: '{"provider":"p","model":"m"}',
    },
  });
  assert.equal(opened.overall, 'verified', opened.errors.join(','));
  const old = await verifyReceiptUpToV10(receipt, { jwks, trustedKids: [] });
  assert.equal(old.errors[0], 'unsupported_version');
  const shellPath = writeJson('v11-shell.json', {
    schema: 'chit402.receipt_shell.v1',
    receipt_id: 'xfuel-v11-m10',
    v: 11,
  });
  const holderPath = writeJson('v11-holder.json', receipt);
  const shell = runCli([shellPath, '--jws', holderPath, '--jwks-file', jwksPath, '--no-trusted-kid']);
  assert.doesNotMatch(shell.text, /unsupported_version/);
  assert.doesNotMatch(shell.text, /Overall:\s*VERIFIED/);
  assert.match(shell.text, /shell_jws_mismatch/);
  assert.equal(shell.status, 1);
});

test('P-PV11 payload_version 11 with issuer_root stays on the allowlist', () => {
  const claims = { payload_version: 11, issuer_root: { seq: 1 }, task_id: 'pin' };
  const decision = classifySignedClaims(claims, null);
  assert.equal(decision.ok, true);
  assert.equal(decision.family, 'legacy');
  assert.equal(decision.version, 11);
  assert.equal(classifySignedClaims({ payload_version: 11, task_id: 'pin' }, null).ok, false);
});
