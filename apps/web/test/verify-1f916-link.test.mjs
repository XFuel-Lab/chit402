import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bookRowHash, exitCode, formatJson, formatReport, parseArgs, verifyLink } from '../../../scripts/verify-1f916-link.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const positivePath = join(root, 'scripts/fixtures/1f916-link-verifier-fixture.json');
const tamperedPath = join(root, 'scripts/fixtures/1f916-link-verifier-fixture-tampered.json');
const specimen1Path = join(root, 'apps/web/public/specimens/1f916-link-1.json');
const specimen2Path = join(root, 'apps/web/public/specimens/1f916-link-2.json');
const FINGERPRINT = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2';
const TAMPERED = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc3';

function load(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('public payout specimens are stamped and the verifier fixture is not one of them', () => {
  const first = load(specimen1Path);
  const second = load(specimen2Path);
  assert.equal(first.label, 'Specimen 1');
  assert.equal(first.status, 'stamped');
  assert.equal(first.chit_receipt_id, 'foreign-x402-muq262x0-1467b076fc62');
  assert.equal(first.chit_verify_url, 'https://api.chit402.com/receipt/foreign-x402-muq262x0-1467b076fc62');
  assert.equal(first.boundary.includes('pending'), false);
  assert.equal(first.payout_tx, '0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9');
  assert.equal(first.listing_id, 55);
  assert.equal(second.label, 'Specimen 2');
  assert.equal(second.status, 'stamped');
  assert.equal(second.chit_receipt_id, 'foreign-x402-muq264r9-69896464bb19');
  assert.equal(second.chit_verify_url, 'https://api.chit402.com/receipt/foreign-x402-muq264r9-69896464bb19');
  assert.equal(second.boundary.includes('pending'), false);
  assert.equal(second.payout_tx, '0x233acdcf3d78436d63a0dba00092fb9a8fe806a3ecd1b415a4d364144baffebd');
  assert.equal(second.listing_id, 45);
  const page = readFileSync(join(root, 'apps/web/src/pages/OneF916Link.tsx'), 'utf8');
  assert.match(page, /are stamped/);
  assert.match(page, /foreign-x402-muq262x0-1467b076fc62/);
  assert.match(page, /foreign-x402-muq264r9-69896464bb19/);
  assert.match(page, /href=\{VERIFY_1\}/);
  assert.match(page, /href=\{VERIFY_2\}/);
  assert.match(page, /api\.chit402\.com\/receipt\/\$\{RECEIPT_1\}/);
  assert.match(page, /api\.chit402\.com\/receipt\/\$\{RECEIPT_2\}/);
  assert.doesNotMatch(page, /pending first stamp/);
  assert.doesNotMatch(page, /1ebc5616/);
});

test('verifier fixture pins one receipt and a one-nibble fingerprint change', () => {
  const positive = load(positivePath);
  const tampered = load(tamperedPath);
  assert.equal(positive.role, 'verifier_test_fixture');
  assert.equal(tampered.role, 'verifier_test_fixture');
  assert.equal(positive.chit_receipt_id, 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96');
  assert.equal(tampered.chit_receipt_id, positive.chit_receipt_id);
  assert.equal(tampered.chit_verify_url, positive.chit_verify_url);
  assert.equal(positive.entry.event_id, 20498);
  assert.equal(tampered.entry.event_id, 20498);
  assert.equal(positive.entry.handle, 'chit402');
  assert.equal(positive.agent_record_entry.fingerprint, FINGERPRINT);
  assert.equal(positive.agent_record_entry.fingerprint_alg, '1f916-entry-hash');
  assert.equal(positive.agent_record_entry.registry, '1f916');
  assert.equal(positive.agent_record_entry.signed, false);
  assert.equal(tampered.agent_record_entry.fingerprint, TAMPERED);
  assert.equal(tampered.entry.hash, FINGERPRINT);
  const page = readFileSync(join(root, 'apps/web/src/pages/OneF916Link.tsx'), 'utf8');
  assert.match(page, new RegExp(FINGERPRINT));
  assert.match(page, /Who issues the receipt/);
});

test('book row hash matches the Specimen 1 receipt head', () => {
  assert.equal(bookRowHash({
    book_id: 146,
    seq: 1,
    task_id: 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    prev_hash: null,
    event: null,
  }), '43651fc3fbc8c678bd41c40c6158be0878896c213e9b6809cbd4f4851c2c1835');
});

test('a specimen with no receipt id fails fetch and still checks the entry hash', async () => {
  const specimen = load(specimen1Path);
  specimen.chit_receipt_id = null;
  specimen.chit_verify_url = null;
  specimen.status = 'pending_first_stamp';
  const result = await verifyLink(specimen, {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('api.chit402.com')) throw new Error(`unexpected receipt fetch ${target}`);
      assert.match(target, /1f916\.ai\/api\/record\/chit402/);
      return {
        ok: true,
        json: async () => ({
          events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }],
          events_has_more: false,
        }),
      };
    },
  });
  assert.equal(result.steps.fetch_receipt.status, 'FAIL');
  assert.equal(result.steps.fetch_receipt.detail, 'pending_first_stamp');
  assert.equal(result.steps.entry_fingerprint.status, 'UNSIGNED');
  assert.match(formatReport(result), /UNSIGNED \(registry-only\)\s+entry_fingerprint/);
  assert.doesNotMatch(formatReport(result), /^PASS entry_fingerprint/m);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(exitCode(result), 1);
  assert.equal(exitCode(result, { exitPolicy: 'allow-unsigned' }), 1);
});

test('stamp verify_url is accepted with or without format=json and other hosts are rejected', async () => {
  const id = 'foreign-x402-muq262x0-1467b076fc62';
  const bare = `https://api.chit402.com/receipt/${id}`;
  const jsonUrl = `${bare}?format=json`;
  const receipt = { task_id: id, verify_url: bare };

  for (const given of [bare, jsonUrl, null]) {
    const seen = [];
    const result = await verifyLink({
      chit_receipt_id: id,
      chit_verify_url: given,
    }, {
      fetchImpl: async (url) => {
        seen.push(String(url));
        if (String(url) !== jsonUrl) throw new Error(`unexpected fetch ${url}`);
        return { ok: true, json: async () => receipt };
      },
    });
    assert.equal(result.steps.fetch_receipt.status, 'PASS', `${given}: ${result.steps.fetch_receipt.detail}`);
    assert.deepEqual(seen, [jsonUrl]);
  }

  for (const given of [
    `https://evil.example/receipt/${id}`,
    'https://api.chit402.com/receipt/other-id',
    `${bare}?format=html`,
    `${bare}?format=json&extra=1`,
    `${bare}/`,
  ]) {
    const result = await verifyLink({
      chit_receipt_id: id,
      chit_verify_url: given,
    }, {
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });
    assert.equal(result.steps.fetch_receipt.status, 'FAIL', given);
    assert.match(result.steps.fetch_receipt.detail, /not the public receipt URL/);
  }
});

function signEs256(privateKey, kid, payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid, typ: 'chit402-receipt+jwt' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('SHA256');
  signer.update(`${header}.${body}`);
  const sig = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${header}.${body}.${sig}`;
}

function foreignPayoutHarness({
  stampFingerprint = FINGERPRINT,
  publishedHash = FINGERPRINT,
  eventId = 20498,
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({
    crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y,
  })).digest('base64url');
  jwk.kid = kid;
  const tx = `0x${'cd'.repeat(32)}`;
  const payer = '0x9f8951cb8b060f52fdf87297b3c5b00f7aa18f52';
  const payTo = '0x1111111111111111111111111111111111111111';
  const taskId = 'foreign-x402-specimen';
  const chainClaims = {
    schema: 'chit402.book_seq.v1',
    payload_version: 4,
    book_id: 7,
    task_id: taskId,
    seq: 1,
    prev_hash: null,
    row_hash: bookRowHash({
      book_id: 7, seq: 1, task_id: taskId, prev_hash: null, event: null,
    }),
    event: null,
    act: 'spend',
    replay_of: null,
    payment_ref: `base:${tx}`,
  };
  const payoutClaims = {
    iss: 'chit402',
    schema: 'chit402.foreign_payout.v1',
    task_id: taskId,
    chain: 'base',
    tx,
    payment_ref: `base:${tx}`,
    payer,
    payee: payTo,
    amount: '1000000',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  };
  if (typeof stampFingerprint === 'string') {
    payoutClaims.agent_record_entry = {
      schema: 'chit402.agent_record_entry.v0',
      signed: false,
      registry: '1f916',
      fingerprint: stampFingerprint,
      fingerprint_alg: '1f916-entry-hash',
    };
  }
  const receipt = {
    task_id: taskId,
    verify_url: `https://api.chit402.com/receipt/${taskId}`,
    foreign_x402: true,
    evidence: 'foreign_ingest',
    source: 'foreign_ingest',
    verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json', source_of_truth: 'issuer_signature.jws' },
    issuer_signature: { alg: 'ES256', kid, jws: signEs256(privateKey, kid, payoutClaims) },
    book_seq: 1,
    book_chain: {
      ...chainClaims,
      issuer_signature: { alg: 'ES256', kid, jws: signEs256(privateKey, kid, chainClaims) },
    },
    payment: {
      rail: 'usdc',
      network: 'base',
      ref: `base:${tx}`,
      gross_amount: '1000000',
      payer,
      payTo,
      payee: payTo,
    },
    signature: { alg: 'HMAC-SHA256', scope: 'recorded', value: 'sha256=abc' },
  };
  const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const pad = (addr) => `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
  const fetchImpl = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/.well-known/jwks.json')) {
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    }
    if (target.includes('/receipt/')) return { ok: true, json: async () => receipt };
    if (target.includes('1f916.ai')) {
      return {
        ok: true,
        json: async () => ({
          events: [{ id: eventId, kind: 'listing', hash: publishedHash }],
          events_has_more: false,
        }),
      };
    }
    if (init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          result: {
            status: '0x1',
            logs: [{
              address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
              topics: [topic, pad(payer), pad(payTo)],
              data: `0x${(1000000n).toString(16).padStart(64, '0')}`,
            }],
          },
        }),
      };
    }
    throw new Error(`unexpected fetch ${target}`);
  };
  const specimen = (fingerprint) => ({
    status: 'pending_first_stamp',
    chit_receipt_id: taskId,
    chit_verify_url: `https://api.chit402.com/receipt/${taskId}?format=json`,
    payout_tx: tx,
    entry: {
      registry: '1f916', handle: 'chit402', log: 'identity_events', event_id: eventId, kind: 'listing',
    },
    agent_record_entry: {
      signed: false, registry: '1f916', fingerprint, fingerprint_alg: '1f916-entry-hash',
    },
  });
  return { fetchImpl, specimen };
}

test('a foreign-ingest payout receipt with an issuer JWS passes while status is still pending_first_stamp', async () => {
  const { fetchImpl, specimen } = foreignPayoutHarness();
  const result = await verifyLink(specimen(FINGERPRINT), {
    rpcUrl: 'https://rpc.test/base',
    fetchImpl,
  });
  const report = formatReport(result);
  assert.equal(result.verdict, 'PASS', report);
  assert.equal(result.steps.entry_fingerprint.status, 'PASS');
  assert.equal(exitCode(result), 0);
  assert.equal(exitCode(result, { exitPolicy: 'allow-unsigned' }), 0);
  assert.match(report, /^PASS entry_fingerprint/m);
  assert.doesNotMatch(report, /UNSIGNED \(registry-only\)/);
  assert.equal(result.steps.entry_fingerprint.signed_check, 'matched');
  const signedJson = JSON.parse(formatJson(result));
  assert.equal(signedJson.overall, 'pass');
  assert.equal(signedJson.signed_check, 'matched');
  assert.equal(signedJson.exit_policy, 'strict');
  assert.equal(signedJson.allow_unsigned, undefined);
});

test('a tampered entry fingerprint fails only that step on a foreign-ingest payout', async () => {
  const { fetchImpl, specimen } = foreignPayoutHarness();
  const result = await verifyLink(specimen(TAMPERED), {
    rpcUrl: 'https://rpc.test/base',
    fetchImpl,
  });
  for (const name of ['fetch_receipt', 'issuer_signature', 'receipt_chain', 'on_chain_tx']) {
    assert.equal(result.steps[name].status, 'PASS', `${name}: ${result.steps[name].detail}`);
  }
  assert.equal(result.steps.entry_fingerprint.status, 'FAIL');
  assert.match(result.steps.entry_fingerprint.detail, /fingerprint_mismatch/);
  assert.equal(result.verdict, 'FAIL');
});

const SWAPPED = 'b4874aa36c769b41b7566cee64c601e4074ff9b57349bfb5f1eb704bfddc1447';

test('a signed stamp rejects a swapped entry the registry confirms', async () => {
  const { fetchImpl, specimen } = foreignPayoutHarness({
    publishedHash: SWAPPED,
    eventId: 17514,
  });
  const result = await verifyLink(specimen(SWAPPED), {
    rpcUrl: 'https://rpc.test/base',
    fetchImpl,
  });
  assert.equal(result.steps.entry_fingerprint.status, 'FAIL');
  assert.match(result.steps.entry_fingerprint.detail, /fingerprint_mismatch/);
  assert.match(result.steps.entry_fingerprint.detail, /jws/);
  assert.match(result.steps.entry_fingerprint.detail, new RegExp(FINGERPRINT));
  assert.equal(result.verdict, 'FAIL');
});

function policyDiffKeys(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).sort();
}

function fingerprintLine(report) {
  return report.split('\n').find((line) => line.includes('entry_fingerprint'));
}

test('unstamped receipt plus a swapped entry is UNSIGNED, not PASS', async () => {
  const { fetchImpl, specimen } = foreignPayoutHarness({
    stampFingerprint: null,
    publishedHash: SWAPPED,
    eventId: 17514,
  });
  const open = await verifyLink(specimen(SWAPPED), {
    rpcUrl: 'https://rpc.test/base',
    fetchImpl,
  });
  const openReport = formatReport(open);
  const acceptedReport = formatReport(open, { exitPolicy: 'allow-unsigned' });
  assert.equal(open.verdict, 'UNSIGNED', openReport);
  assert.equal(open.steps.entry_fingerprint.status, 'UNSIGNED');
  assert.equal(open.steps.entry_fingerprint.signed_check, 'not_run');
  assert.notEqual(open.steps.entry_fingerprint.status, 'PASS');
  assert.equal(exitCode(open), 2);
  assert.equal(exitCode(open, { exitPolicy: 'allow-unsigned' }), 0);
  assert.match(openReport, /UNSIGNED \(registry-only\)\s+entry_fingerprint/);
  assert.doesNotMatch(openReport, /accepted by --allow-unsigned/);
  assert.match(openReport, /VERDICT UNSIGNED \(registry-only\)/);
  assert.match(openReport, new RegExp(SWAPPED));
  assert.doesNotMatch(openReport, /^PASS entry_fingerprint/m);
  assert.doesNotMatch(openReport, /VERDICT PASS/);
  const acceptedLine = fingerprintLine(acceptedReport);
  assert.equal(acceptedLine.startsWith('UNSIGNED (registry-only; accepted by --allow-unsigned) '), true);
  assert.equal(acceptedLine.includes('PASS'), false);
  assert.match(acceptedReport, /VERDICT UNSIGNED \(registry-only; accepted by --allow-unsigned\)/);
  const plain = JSON.parse(formatJson(open));
  const allowed = JSON.parse(formatJson(open, { exitPolicy: 'allow-unsigned' }));
  assert.equal(plain.overall, 'unsigned');
  assert.equal(plain.verdict, 'unsigned');
  assert.equal(plain.signed_check, 'not_run');
  assert.equal(plain.exit_policy, 'strict');
  assert.equal(plain.exit_code, 2);
  assert.equal(plain.allow_unsigned, undefined);
  assert.equal(plain.steps.entry_fingerprint.status, 'UNSIGNED');
  assert.equal(plain.steps.entry_fingerprint.signed_check, 'not_run');
  assert.deepEqual(policyDiffKeys(plain, allowed), ['exit_code', 'exit_policy']);
  assert.equal(allowed.exit_policy, 'allow-unsigned');
  assert.equal(allowed.exit_code, 0);
  assert.equal(allowed.verdict, 'unsigned');
  assert.equal(allowed.overall, 'unsigned');
});

test('a real fingerprint mismatch stays exit 1 when --allow-unsigned is set', async () => {
  const { fetchImpl, specimen } = foreignPayoutHarness({ stampFingerprint: null });
  const result = await verifyLink(specimen(TAMPERED), {
    rpcUrl: 'https://rpc.test/base',
    fetchImpl,
  });
  assert.equal(result.steps.entry_fingerprint.status, 'FAIL');
  assert.match(result.steps.entry_fingerprint.detail, /fingerprint_mismatch/);
  assert.match(result.steps.entry_fingerprint.detail, new RegExp(TAMPERED));
  assert.equal(result.verdict, 'FAIL');
  assert.equal(exitCode(result), 1);
  assert.equal(exitCode(result, { exitPolicy: 'allow-unsigned' }), 1);
  const parsed = JSON.parse(formatJson(result, { exitPolicy: 'allow-unsigned' }));
  assert.equal(parsed.overall, 'fail');
  assert.equal(parsed.exit_code, 1);
});

test('CLI rejects unknown exit_policy by name and a missing path with exit 3', () => {
  const script = join(root, 'scripts/verify-1f916-link.mjs');
  const named = spawnSync(process.execPath, [script, '--exit-policy', 'loose', positivePath], { encoding: 'utf8' });
  assert.equal(named.status, 3, named.stdout + named.stderr);
  assert.match(named.stderr, /unknown exit_policy loose/);
  const missingValue = spawnSync(process.execPath, [script, '--exit-policy'], { encoding: 'utf8' });
  assert.equal(missingValue.status, 3, missingValue.stdout + missingValue.stderr);
  assert.match(missingValue.stderr, /unknown exit_policy/);
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(missing.status, 3, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /usage:/);
});

test('parseArgs takes --exit-policy and keeps --allow-unsigned as an alias', () => {
  assert.deepEqual(parseArgs(['--exit-policy', 'allow-unsigned', 'specimen.json']), {
    exitPolicy: 'allow-unsigned', json: false, target: 'specimen.json', error: '',
  });
  assert.deepEqual(parseArgs(['--exit-policy', 'strict', 'specimen.json']), {
    exitPolicy: 'strict', json: false, target: 'specimen.json', error: '',
  });
  assert.deepEqual(parseArgs(['--allow-unsigned', 'specimen.json']), {
    exitPolicy: 'allow-unsigned', json: false, target: 'specimen.json', error: '',
  });
  assert.deepEqual(parseArgs(['specimen.json', '--json']), {
    exitPolicy: 'strict', json: true, target: 'specimen.json', error: '',
  });
  assert.equal(parseArgs(['--allow-unsigned', '--exit-policy', 'allow-unsigned', 'a.json']).exitPolicy, 'allow-unsigned');
  assert.equal(parseArgs(['--exit-policy', 'strict', '--allow-unsigned']).error, 'exit_policy is strict; --allow-unsigned sets allow-unsigned');
  assert.equal(parseArgs(['--exit-policy', 'default']).error, 'unknown exit_policy default');
  assert.equal(parseArgs(['--exit-policy', 'loose']).error, 'unknown exit_policy loose');
  assert.match(parseArgs(['--exit-policy']).error, /unknown exit_policy/);
  assert.match(parseArgs(['--strict', 'specimen.json']).error, /unknown flag --strict/);
});

describe('verifier fixture, not a public specimen', () => {
  test('unstamped fixture is UNSIGNED and exits 2', { timeout: 60000 }, async () => {
    const result = await verifyLink(load(positivePath));
    for (const name of ['fetch_receipt', 'issuer_signature', 'receipt_chain', 'on_chain_tx']) {
      assert.equal(result.steps[name].status, 'PASS', `${name}: ${result.steps[name].detail}`);
    }
    assert.equal(result.steps.entry_fingerprint.status, 'UNSIGNED');
    assert.match(result.steps.entry_fingerprint.detail, new RegExp(FINGERPRINT));
    assert.equal(result.verdict, 'UNSIGNED');
    assert.equal(exitCode(result), 2);
    assert.equal(exitCode(result, { exitPolicy: 'allow-unsigned' }), 0);
    const report = formatReport(result);
    assert.match(report, /UNSIGNED \(registry-only\)\s+entry_fingerprint/);
    assert.match(report, /VERDICT UNSIGNED \(registry-only\)/);
    assert.doesNotMatch(report, /^PASS entry_fingerprint/m);
    assert.doesNotMatch(report, /VERDICT PASS/);
  });

  test('tampered fingerprint fails only the fingerprint step', { timeout: 60000 }, async () => {
    const result = await verifyLink(load(tamperedPath));
    for (const name of ['fetch_receipt', 'issuer_signature', 'receipt_chain', 'on_chain_tx']) {
      assert.equal(result.steps[name].status, 'PASS', `${name}: ${result.steps[name].detail}`);
    }
    assert.equal(result.steps.entry_fingerprint.status, 'FAIL');
    assert.match(result.steps.entry_fingerprint.detail, /fingerprint_mismatch/);
    assert.match(result.steps.entry_fingerprint.detail, new RegExp(TAMPERED));
    assert.equal(result.verdict, 'FAIL');
    assert.equal(exitCode(result), 1);
    assert.equal(exitCode(result, { exitPolicy: 'allow-unsigned' }), 1);
  });

  test('CLI exits 2 for the unstamped fixture, 0 with --allow-unsigned, and 1 on a mismatch', { timeout: 180000 }, () => {
    const script = join(root, 'scripts/verify-1f916-link.mjs');
    const open = spawnSync(process.execPath, [script, positivePath], { encoding: 'utf8' });
    assert.equal(open.status, 2, open.stdout + open.stderr);
    assert.match(open.stdout, /UNSIGNED \(registry-only\)\s+entry_fingerprint/);
    assert.match(open.stdout, /VERDICT UNSIGNED \(registry-only\)/);
    assert.doesNotMatch(open.stdout, /^PASS entry_fingerprint/m);
    assert.doesNotMatch(open.stdout, /VERDICT PASS/);

    const allowed = spawnSync(process.execPath, [script, '--exit-policy', 'allow-unsigned', positivePath], { encoding: 'utf8' });
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    const acceptedLine = allowed.stdout.split('\n').find((line) => line.includes('entry_fingerprint'));
    assert.equal(acceptedLine.startsWith('UNSIGNED (registry-only; accepted by --allow-unsigned) '), true, acceptedLine);
    assert.equal(acceptedLine.includes('PASS'), false, acceptedLine);
    assert.match(allowed.stdout, /VERDICT UNSIGNED \(registry-only; accepted by --allow-unsigned\)/);
    assert.doesNotMatch(allowed.stdout, /VERDICT PASS/);

    const json = spawnSync(process.execPath, [script, '--json', positivePath], { encoding: 'utf8' });
    assert.equal(json.status, 2, json.stdout + json.stderr);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.overall, 'unsigned');
    assert.equal(parsed.verdict, 'unsigned');
    assert.equal(parsed.signed_check, 'not_run');
    assert.equal(parsed.exit_policy, 'strict');
    assert.equal(parsed.exit_code, 2);
    assert.equal(parsed.allow_unsigned, undefined);
    assert.equal(parsed.steps.entry_fingerprint.status, 'UNSIGNED');
    assert.equal(parsed.steps.entry_fingerprint.signed_check, 'not_run');
    assert.notEqual(parsed.overall, 'pass');

    const jsonAllowed = spawnSync(process.execPath, [script, '--json', '--exit-policy', 'allow-unsigned', positivePath], { encoding: 'utf8' });
    assert.equal(jsonAllowed.status, 0, jsonAllowed.stdout + jsonAllowed.stderr);
    const allowedJson = JSON.parse(jsonAllowed.stdout);
    assert.deepEqual(policyDiffKeys(parsed, allowedJson), ['exit_code', 'exit_policy']);
    assert.equal(allowedJson.exit_policy, 'allow-unsigned');
    assert.equal(allowedJson.exit_code, 0);
    assert.equal(allowedJson.verdict, 'unsigned');

    const bad = spawnSync(process.execPath, [script, '--exit-policy', 'allow-unsigned', tamperedPath], { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /PASS on_chain_tx/);
    assert.match(bad.stdout, /FAIL entry_fingerprint\s+fingerprint_mismatch/);
    assert.match(bad.stdout, /VERDICT FAIL/);
  });

  test('both public specimens stay signed PASS under either exit_policy', { timeout: 120000 }, async () => {
    for (const path of [specimen1Path, specimen2Path]) {
      const result = await verifyLink(load(path));
      assert.equal(result.verdict, 'PASS', formatReport(result));
      assert.equal(result.steps.entry_fingerprint.status, 'PASS', result.steps.entry_fingerprint.detail);
      assert.equal(result.steps.entry_fingerprint.signed_check, 'matched');
      const strict = JSON.parse(formatJson(result, { exitPolicy: 'strict' }));
      const allowed = JSON.parse(formatJson(result, { exitPolicy: 'allow-unsigned' }));
      assert.equal(strict.overall, 'pass');
      assert.equal(strict.exit_code, 0);
      assert.equal(allowed.exit_code, 0);
      assert.deepEqual(policyDiffKeys(strict, allowed), ['exit_policy']);
      assert.equal(strict.exit_policy, 'strict');
      assert.equal(allowed.exit_policy, 'allow-unsigned');
    }
  });
});
