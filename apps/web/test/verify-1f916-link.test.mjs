import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { bookRowHash, classifyFetchError, formatReport, runCli, verifyLink } from '../../../scripts/verify-1f916-link.mjs';

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
  assert.equal(result.steps.entry_fingerprint.status, 'PASS');
  assert.equal(result.verdict, 'FAIL');
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

function foreignPayoutHarness({ signedFingerprint = FINGERPRINT } = {}) {
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
    agent_record_entry: {
      schema: 'chit402.agent_record_entry.v0',
      signed: false,
      registry: '1f916',
      fingerprint: signedFingerprint,
      fingerprint_alg: '1f916-entry-hash',
    },
  };
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
          events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }],
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
      registry: '1f916', handle: 'chit402', log: 'identity_events', event_id: 20498, kind: 'listing',
    },
    agent_record_entry: {
      signed: false, registry: '1f916', fingerprint, fingerprint_alg: '1f916-entry-hash',
    },
  });
  const responses = {
    [`https://api.chit402.com/receipt/${taskId}?format=json`]: receipt,
    'https://api.chit402.com/.well-known/jwks.json': { keys: [jwk] },
    'https://1f916.ai/api/record/chit402': {
      events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }],
      events_has_more: false,
    },
    'https://rpc.test/base': {
      result: {
        status: '0x1',
        logs: [{
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          topics: [topic, pad(payer), pad(payTo)],
          data: `0x${(1000000n).toString(16).padStart(64, '0')}`,
        }],
      },
    },
  };
  return { fetchImpl, specimen, responses, receipt };
}

test('a foreign-ingest payout receipt with an issuer JWS passes while status is still pending_first_stamp', async () => {
  const { fetchImpl, specimen } = foreignPayoutHarness();
  const result = await verifyLink(specimen(FINGERPRINT), {
    rpcUrl: 'https://rpc.test/base',
    fetchImpl,
  });
  assert.equal(result.verdict, 'PASS', formatReport(result));
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

test('N-6 an uppercase signed fingerprint matches its lowercase claim and still catches a mismatch', async () => {
  const { fetchImpl, specimen } = foreignPayoutHarness({ signedFingerprint: FINGERPRINT.toUpperCase() });
  const ok = await verifyLink(specimen(FINGERPRINT), { rpcUrl: 'https://rpc.test/base', fetchImpl });
  assert.equal(ok.verdict, 'PASS', formatReport(ok));
  let recordFetches = 0;
  const counting = async (url, init) => {
    if (String(url).includes('1f916.ai')) recordFetches += 1;
    return fetchImpl(url, init);
  };
  const bad = await verifyLink(specimen(TAMPERED), { rpcUrl: 'https://rpc.test/base', fetchImpl: counting });
  assert.equal(bad.steps.entry_fingerprint.status, 'FAIL', formatReport(bad));
  assert.ok(/ jws .* claimed /.test(bad.steps.entry_fingerprint.detail), bad.steps.entry_fingerprint.detail);
  assert.equal(recordFetches, 0, 'a signed mismatch fails before the 1f916.ai fetch');
});

test('N-8 an empty or malformed signed fingerprint is FAIL before the record fetch, not absent', async () => {
  for (const [label, signed] of [['empty string', ''], ['63 hex', FINGERPRINT.slice(1)], ['number', 7]]) {
    const { fetchImpl, specimen } = foreignPayoutHarness({ signedFingerprint: signed });
    let recordFetches = 0;
    const counting = async (url, init) => {
      if (String(url).includes('1f916.ai')) recordFetches += 1;
      return fetchImpl(url, init);
    };
    const result = await verifyLink(specimen(FINGERPRINT), { rpcUrl: 'https://rpc.test/base', fetchImpl: counting });
    assert.equal(result.steps.issuer_signature.status, 'PASS', `${label}: ${formatReport(result)}`);
    assert.equal(result.steps.entry_fingerprint.status, 'FAIL', `${label}: ${formatReport(result)}`);
    assert.ok(/^signed_fingerprint_malformed:/.test(result.steps.entry_fingerprint.detail), result.steps.entry_fingerprint.detail);
    assert.equal(result.verdict, 'FAIL');
    assert.equal(recordFetches, 0, label);
  }
  const { fetchImpl, specimen } = foreignPayoutHarness({ signedFingerprint: null });
  const absent = await verifyLink(specimen(FINGERPRINT), { rpcUrl: 'https://rpc.test/base', fetchImpl });
  assert.equal(absent.verdict, 'PASS', `a null signed fingerprint is absent: ${formatReport(absent)}`);
});

test('the public unsigned receipt shell fails closed with a clear reason, not a verify_url mismatch', async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('1f916.ai')) {
      return new Response(JSON.stringify({
        events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }],
        events_has_more: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      schema: 'chit402.receipt_shell.v1',
      unsigned: true,
      receipt_id: 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
      verify_url: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await verifyLink(load(positivePath), { fetchImpl, rpcUrl: 'https://rpc.test/base' });
  assert.equal(result.steps.fetch_receipt.status, 'COULD_NOT_CHECK');
  assert.match(result.steps.fetch_receipt.detail, /public_receipt_is_unsigned_shell/);
  for (const name of ['issuer_signature', 'receipt_chain', 'on_chain_tx']) {
    assert.equal(result.steps[name].status, 'COULD_NOT_CHECK', name);
  }
  assert.equal(result.verdict, 'COULD_NOT_CHECK');
});

// Live network: fetches api.chit402.com, the 1F916 proof API and Base RPC. Since #519
// (deployed 2026-10-08) the public receipt route serves an unsigned shell, so these can
// no longer pass against prod and they made Web Tests red on every push to main.
// The same PASS/tampered logic runs hermetically above (foreign-ingest harness).
// Run by hand with CHIT_LIVE_TESTS=1 once a public signed path exists again.
describe('verifier fixture, not a public specimen (live network)', { skip: process.env.CHIT_LIVE_TESTS !== '1' && 'set CHIT_LIVE_TESTS=1 to run against prod' }, () => {
  test('fixture passes every step', { timeout: 60000 }, async () => {
    const result = await verifyLink(load(positivePath));
    assert.equal(formatReport(result).includes('VERDICT PASS'), true, formatReport(result));
    for (const name of ['fetch_receipt', 'issuer_signature', 'receipt_chain', 'on_chain_tx', 'entry_fingerprint']) {
      assert.equal(result.steps[name].status, 'PASS', `${name}: ${result.steps[name].detail}`);
    }
    assert.match(result.steps.entry_fingerprint.detail, new RegExp(FINGERPRINT));
    assert.equal(result.verdict, 'PASS');
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
  });

  test('CLI prints PASS for the fixture and FAIL for the tampered fixture', { timeout: 90000 }, () => {
    const script = join(root, 'scripts/verify-1f916-link.mjs');
    const ok = spawnSync(process.execPath, [script, positivePath], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASS entry_fingerprint/);
    assert.match(ok.stdout, /VERDICT PASS/);

    const bad = spawnSync(process.execPath, [script, tamperedPath], { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /PASS on_chain_tx/);
    assert.match(bad.stdout, /FAIL entry_fingerprint\s+fingerprint_mismatch/);
    assert.match(bad.stdout, /VERDICT FAIL/);
  });
});

test('M4 the public page says specimens cannot be verified from the shell', () => {
  const page = readFileSync(join(root, 'apps/web/src/pages/OneF916Link.tsx'), 'utf8');
  assert.match(page, /can&apos;t be publicly verified right now/);
  assert.match(page, /public_receipt_is_unsigned_shell/);
  assert.match(page, /not VERIFIED/);
  assert.doesNotMatch(page, /prints PASS or FAIL/);
});

function assertShellUnchecked(result) {
  const report = formatReport(result);
  assert.equal(result.verdict, 'COULD_NOT_CHECK');
  assert.equal(result.steps.fetch_receipt.status, 'COULD_NOT_CHECK');
  assert.match(result.steps.fetch_receipt.detail, /public_receipt_is_unsigned_shell/);
  assert.equal(report.includes('VERIFIED'), false, report);
  assert.equal(report.includes('VERDICT PASS'), false, report);
  assert.equal(report.includes('FAIL'), false, report);
  assert.equal(report.includes('INVALID'), false, report);
  assert.match(report, /VERDICT COULD_NOT_CHECK/);
}

test('T10 a shell fails closed with unsigned flipped, schema stripped, or a fake jws', async () => {
  const specimen = load(specimen1Path);
  const id = specimen.chit_receipt_id;
  const verifyUrl = `https://api.chit402.com/receipt/${id}`;
  const cases = [
    {
      name: 'schema with unsigned false',
      body: { schema: 'chit402.receipt_shell.v1', unsigned: false, receipt_id: id, verify_url: verifyUrl },
    },
    {
      name: 'unsigned true without the shell schema',
      body: { unsigned: true, receipt_id: id, verify_url: verifyUrl },
    },
    {
      name: 'shell plus a fake jws',
      body: {
        schema: 'chit402.receipt_shell.v1',
        unsigned: true,
        receipt_id: id,
        verify_url: verifyUrl,
        jws: 'eyJhbGciOiJub25lIn0.eyJ2ZXJkaWN0IjoiUEFTUyJ9.sig',
        issuer_signature: { alg: 'ES256', kid: 'fake', jws: 'aaa.bbb.ccc' },
      },
    },
  ];
  for (const { name, body } of cases) {
    const result = await verifyLink(specimen, {
      fetchImpl: async (url) => {
        const target = String(url);
        if (target.includes('1f916.ai')) {
          return {
            ok: true,
            json: async () => ({
              events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }],
              events_has_more: false,
            }),
          };
        }
        if (target.includes('/receipt/')) return { ok: true, json: async () => body };
        throw new Error(`unexpected fetch ${target}`);
      },
      allowUnsigned: true,
      acceptShell: true,
      forceVerdict: 'PASS',
      rpcUrl: 'https://rpc.test/base',
    });
    assertShellUnchecked(result);
    assert.match(result.steps.fetch_receipt.detail, /public_receipt_is_unsigned_shell/, name);
  }
});

test('T9 and R3 CLI: shell fixture exits 2 COULD_NOT_CHECK and never prints VERDICT PASS; a signed fixture prints only FIXTURE_PASS', () => {
  const script = join(root, 'scripts/verify-1f916-link.mjs');
  const shellFixture = join(root, 'scripts/fixtures/1f916-link-1-public-shell.json');
  const shell = spawnSync(process.execPath, [script, specimen1Path, '--verdict=PASS'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      CHIT_VERIFY_FETCH_FIXTURE: shellFixture,
      CHIT_VERIFY_ALLOW_SHELL: '1',
      CHIT_LIVE_TESTS: '1',
    },
  });
  const shellOut = `${shell.stdout || ''}${shell.stderr || ''}`;
  assert.equal(shell.status, 2, shellOut);
  assert.match(shellOut, /public_receipt_is_unsigned_shell/);
  assert.equal(shellOut.includes('VERIFIED'), false, shellOut);
  assert.equal(shellOut.includes('VERDICT PASS'), false, shellOut);
  assert.equal(shellOut.includes('VERDICT FAIL'), false, shellOut);
  assert.equal(shellOut.includes('INVALID'), false, shellOut);
  assert.match(shellOut, /VERDICT COULD_NOT_CHECK/);
  assert.match(shellOut, /^FIXTURE MODE: /m);

  const { responses, specimen } = foreignPayoutHarness();
  const dir = mkdtempSync(join(tmpdir(), 'chit-verify-'));
  try {
    const specimenPath = join(dir, 'specimen.json');
    const fixturePath = join(dir, 'fetch.json');
    writeFileSync(specimenPath, JSON.stringify(specimen(FINGERPRINT)));
    writeFileSync(fixturePath, JSON.stringify({ responses }));
    const ok = spawnSync(process.execPath, [script, specimenPath], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        CHIT_VERIFY_FETCH_FIXTURE: fixturePath,
        BASE_RPC_URL: 'https://rpc.test/base',
      },
    });
    const okOut = `${ok.stdout || ''}${ok.stderr || ''}`;
    assert.equal(ok.status, 0, okOut);
    // The harness signs with a key it just generated. Fixture mode must say so
    // and must never print a bare VERDICT PASS that reads as a verification.
    assert.match(ok.stdout, /^FIXTURE MODE: /m);
    assert.match(ok.stderr, /^FIXTURE MODE: /m);
    assert.match(okOut, /VERDICT FIXTURE_PASS \(test run, not a verification\)/);
    assert.equal(/^VERDICT PASS$/m.test(okOut), false, okOut);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T12 CI web job does not set CHIT_LIVE_TESTS and still runs when the verifier script changes', () => {
  const yml = readFileSync(join(root, '.github/workflows/test.yml'), 'utf8');
  assert.equal(yml.includes('CHIT_LIVE_TESTS'), false);
  assert.match(yml, /scripts\/verify-1f916-link\.mjs/);
  assert.match(yml, /scripts\/fixtures\/1f916\*/);
});

// S5: transport errors are COULD_NOT_CHECK (exit 2). HTTP 4xx, a body that is
// not JSON, a refused redirect and a fixture miss stay FAIL (exit 1).
// Every request below goes to a loopback server on 127.0.0.1. The real host is
// kept as the first path segment so one server can answer for every origin.
async function loopback(routes) {
  const server = createServer((req, res) => {
    const host = req.url.split('/')[1];
    const mode = routes[host] || 'ok';
    if (typeof mode === 'function') return mode(req, res);
    if (mode === 'hang') return undefined;
    if (mode === 'stall_body') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"events":');
      return undefined;
    }
    if (mode === 'reset_body') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
      res.write('{"events":');
      setTimeout(() => req.socket.destroy(), 20);
      return undefined;
    }
    if (mode === 'redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' });
      return res.end();
    }
    if (mode === 'not_json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('<html>not json</html>');
    }
    const status = Number(mode);
    res.writeHead(Number.isInteger(status) ? status : 500, { 'content-type': 'application/json' });
    return res.end('{}');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  const closed = createServer();
  await new Promise((done) => closed.listen(0, '127.0.0.1', done));
  const deadPort = closed.address().port;
  await new Promise((done) => closed.close(done));
  const base = `http://127.0.0.1:${port}`;
  const forward = (url, init) => {
    const u = new URL(String(url));
    const mode = routes[u.host];
    const origin = mode === 'refused' ? `http://127.0.0.1:${deadPort}` : base;
    const target = new URL(`${origin}/${u.host}${u.pathname}${u.search}`);
    assert.equal(target.hostname, '127.0.0.1', 'tests only reach loopback');
    return fetch(target, init);
  };
  const close = () => new Promise((done) => {
    server.closeAllConnections?.();
    server.close(done);
  });
  return { forward, close };
}

const SHELL = {
  schema: 'chit402.receipt_shell.v1',
  unsigned: true,
  receipt_id: 'foreign-x402-muq262x0-1467b076fc62',
  verify_url: null,
};

/** Shell receipt and 1F916 record from local bodies; selected hosts go to loopback. */
function shellFetch(forward, loopHosts, { recordHash = FINGERPRINT } = {}) {
  return async (url, init) => {
    const u = new URL(String(url));
    if (loopHosts.includes(u.host)) return forward(url, init);
    if (u.host === 'api.chit402.com') return { ok: true, status: 200, json: async () => SHELL };
    if (u.host === '1f916.ai') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ events: [{ id: 20498, kind: 'listing', hash: recordHash }], events_has_more: false }),
      };
    }
    throw new Error(`unexpected fetch ${u.host}`);
  };
}

describe('S5 transport errors vs real failures (loopback only)', () => {
  const receiptCases = [
    ['HTTP 500', '500', 'COULD_NOT_CHECK', /http_500/],
    ['HTTP 503', '503', 'COULD_NOT_CHECK', /http_503/],
    ['connection refused', 'refused', 'COULD_NOT_CHECK', /./],
    ['timeout', 'hang', 'COULD_NOT_CHECK', /^timeout$/],
    ['body stalls after headers', 'stall_body', 'COULD_NOT_CHECK', /^timeout$/],
    ['socket reset mid-body', 'reset_body', 'COULD_NOT_CHECK', /^UND_ERR_SOCKET$/],
    ['HTTP 404', '404', 'FAIL', /http_404/],
    ['HTTP 400', '400', 'FAIL', /http_400/],
    ['body not JSON', 'not_json', 'FAIL', /body_not_json/],
    ['redirect', 'redirect', 'FAIL', /redirect_refused/],
  ];
  for (const [label, mode, status, detail] of receiptCases) {
    test(`receipt fetch ${label} is ${status}`, { timeout: 10000 }, async () => {
      const lb = await loopback({ 'api.chit402.com': mode });
      try {
        const result = await verifyLink(load(specimen1Path), {
          fetchImpl: shellFetch(lb.forward, ['api.chit402.com']),
          rpcUrl: 'https://rpc.test/base',
          timeoutMs: 300,
        });
        assert.equal(result.steps.fetch_receipt.status, status, formatReport(result));
        assert.ok(detail.test(result.steps.fetch_receipt.detail), result.steps.fetch_receipt.detail);
        assert.equal(result.steps.entry_fingerprint.status, 'PASS', formatReport(result));
        assert.equal(result.verdict, status, formatReport(result));
        const report = formatReport(result);
        assert.equal(report.includes('VERDICT PASS'), false, report);
      } finally {
        await lb.close();
      }
    });
  }

  for (const [label, mode, status] of [
    ['HTTP 502', '502', 'COULD_NOT_CHECK'],
    ['refused', 'refused', 'COULD_NOT_CHECK'],
    ['HTTP 404', '404', 'FAIL'],
    ['HTTP 408', '408', 'COULD_NOT_CHECK'],
    ['HTTP 425', '425', 'COULD_NOT_CHECK'],
    ['HTTP 429', '429', 'COULD_NOT_CHECK'],
    ['HTTP 499', '499', 'FAIL'],
    ['HTTP 599', '599', 'COULD_NOT_CHECK'],
  ]) {
    test(`1F916 record fetch ${label} is ${status}`, { timeout: 10000 }, async () => {
      const lb = await loopback({ '1f916.ai': mode });
      try {
        const result = await verifyLink(load(specimen1Path), {
          fetchImpl: shellFetch(lb.forward, ['1f916.ai']),
          rpcUrl: 'https://rpc.test/base',
          timeoutMs: 300,
        });
        assert.equal(result.steps.fetch_receipt.status, 'COULD_NOT_CHECK');
        assert.equal(result.steps.entry_fingerprint.status, status, formatReport(result));
        assert.ok(/record_fetch:/.test(result.steps.entry_fingerprint.detail), result.steps.entry_fingerprint.detail);
        assert.equal(result.verdict, status, formatReport(result));
      } finally {
        await lb.close();
      }
    });
  }

  test('N-D2 a shell with a mismatched 1F916 fingerprint is FAIL exit 1, not COULD_NOT_CHECK', async () => {
    const result = await verifyLink(load(specimen1Path), {
      fetchImpl: shellFetch(null, [], { recordHash: TAMPERED }),
      rpcUrl: 'https://rpc.test/base',
    });
    assert.equal(result.steps.fetch_receipt.status, 'COULD_NOT_CHECK');
    assert.equal(result.steps.entry_fingerprint.status, 'FAIL');
    assert.ok(/fingerprint_mismatch/.test(result.steps.entry_fingerprint.detail), result.steps.entry_fingerprint.detail);
    assert.equal(result.verdict, 'FAIL');
    const lines = [];
    const code = await runCli([specimen1Path], {
      fetchImpl: shellFetch(null, [], { recordHash: TAMPERED }),
      log: (line) => lines.push(line),
      error: () => {},
    });
    assert.equal(code, 1, lines.join('\n'));
    assert.ok(/^VERDICT FAIL$/m.test(lines.join('\n')), lines.join('\n'));
  });

  for (const [label, host, mode, status, steps] of [
    ['JWKS HTTP 502', 'api.chit402.com', '502', 'COULD_NOT_CHECK', ['issuer_signature', 'receipt_chain', 'on_chain_tx']],
    ['JWKS HTTP 404', 'api.chit402.com', '404', 'FAIL', ['issuer_signature', 'receipt_chain', 'on_chain_tx']],
    ['RPC HTTP 503', 'rpc.test', '503', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC refused', 'rpc.test', 'refused', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC timeout', 'rpc.test', 'hang', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC HTTP 400', 'rpc.test', '400', 'FAIL', ['on_chain_tx']],
    ['RPC HTTP 408', 'rpc.test', '408', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC HTTP 425', 'rpc.test', '425', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC HTTP 429', 'rpc.test', '429', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC HTTP 499', 'rpc.test', '499', 'FAIL', ['on_chain_tx']],
    ['RPC HTTP 599', 'rpc.test', '599', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC body stalls after headers', 'rpc.test', 'stall_body', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC socket reset mid-body', 'rpc.test', 'reset_body', 'COULD_NOT_CHECK', ['on_chain_tx']],
    ['RPC redirect', 'rpc.test', 'redirect', 'FAIL', ['on_chain_tx']],
    ['RPC body not JSON', 'rpc.test', 'not_json', 'FAIL', ['on_chain_tx']],
  ]) {
    test(`signed receipt: ${label} is ${status}`, { timeout: 10000 }, async () => {
      const { fetchImpl, specimen } = foreignPayoutHarness();
      const lb = await loopback({ [host]: mode });
      try {
        const wrapped = async (url, init) => {
          const target = String(url);
          if (host === 'api.chit402.com' && target.endsWith('/.well-known/jwks.json')) return lb.forward(url, init);
          if (host === 'rpc.test' && target.startsWith('https://rpc.test/')) return lb.forward(url, init);
          return fetchImpl(url, init);
        };
        const result = await verifyLink(specimen(FINGERPRINT), {
          fetchImpl: wrapped,
          rpcUrl: 'https://rpc.test/base',
          timeoutMs: 300,
        });
        for (const name of steps) assert.equal(result.steps[name].status, status, `${name}: ${formatReport(result)}`);
        const rpcDetail = { stall_body: /^rpc:timeout$/, reset_body: /^rpc:UND_ERR_SOCKET$/, redirect: /^rpc:redirect_refused$/ }[mode];
        if (host === 'rpc.test' && rpcDetail) {
          assert.ok(rpcDetail.test(result.steps.on_chain_tx.detail), result.steps.on_chain_tx.detail);
        }
        assert.equal(result.verdict, status, formatReport(result));
      } finally {
        await lb.close();
      }
    });
  }

  // M-1: the signed JWS binds fingerprint A and the specimen claims B. That is
  // FAIL exit 1 whatever 1f916.ai does, including when it is down.
  for (const [label, mode] of [['answers', 'up'], ['HTTP 502', '502'], ['refused', 'refused'], ['timeout', 'hang']]) {
    test(`M-1 signed fingerprint contradicts the claim, 1f916.ai ${label}: FAIL exit 1`, { timeout: 10000 }, async () => {
      const { fetchImpl, specimen } = foreignPayoutHarness();
      const lb = mode === 'up' ? null : await loopback({ '1f916.ai': mode });
      const claimed = specimen(TAMPERED);
      const wrapped = async (url, init) => {
        const u = new URL(String(url));
        if (u.host === '1f916.ai' && lb) return lb.forward(url, init);
        if (u.host === 'www.chit402.com') return { ok: true, status: 200, json: async () => claimed };
        return fetchImpl(url, init);
      };
      try {
        const result = await verifyLink(claimed, { fetchImpl: wrapped, rpcUrl: 'https://rpc.test/base', timeoutMs: 300 });
        for (const name of ['fetch_receipt', 'issuer_signature', 'receipt_chain', 'on_chain_tx']) {
          assert.equal(result.steps[name].status, 'PASS', `${name}: ${formatReport(result)}`);
        }
        assert.equal(result.steps.entry_fingerprint.status, 'FAIL', formatReport(result));
        assert.ok(/fingerprint_mismatch/.test(result.steps.entry_fingerprint.detail), result.steps.entry_fingerprint.detail);
        assert.equal(result.verdict, 'FAIL', formatReport(result));
        const lines = [];
        const prevRpc = process.env.BASE_RPC_URL;
        process.env.BASE_RPC_URL = 'https://rpc.test/base';
        let code;
        try {
          code = await runCli(['https://www.chit402.com/specimens/1f916-link-1.json'], {
            fetchImpl: wrapped,
            timeoutMs: 300,
            log: (line) => lines.push(line),
            error: () => {},
          });
        } finally {
          if (prevRpc === undefined) delete process.env.BASE_RPC_URL;
          else process.env.BASE_RPC_URL = prevRpc;
        }
        assert.equal(code, 1, lines.join('\n'));
        assert.ok(/^VERDICT FAIL$/m.test(lines.join('\n')), lines.join('\n'));
      } finally {
        await lb?.close();
      }
    });
  }

  const specimenUrl = 'https://www.chit402.com/specimens/1f916-link-1.json';
  for (const [label, mode, code, verdict] of [
    ['HTTP 500', '500', 2, 'COULD_NOT_CHECK'],
    ['refused', 'refused', 2, 'COULD_NOT_CHECK'],
    ['timeout', 'hang', 2, 'COULD_NOT_CHECK'],
    ['HTTP 404', '404', 1, 'FAIL'],
    ['body not JSON', 'not_json', 1, 'FAIL'],
  ]) {
    test(`CLI: specimen URL ${label} exits ${code} ${verdict}`, { timeout: 10000 }, async () => {
      const lb = await loopback({ 'www.chit402.com': mode });
      const lines = [];
      try {
        const got = await runCli([specimenUrl], {
          fetchImpl: lb.forward,
          timeoutMs: 300,
          log: (line) => lines.push(line),
          error: () => {},
        });
        const out = lines.join('\n');
        assert.equal(got, code, out);
        assert.ok(new RegExp(`^VERDICT ${verdict}$`, 'm').test(out), out);
        assert.equal(out.includes('VERDICT PASS'), false, out);
      } finally {
        await lb.close();
      }
    });
  }

  test('CLI: a missing local specimen file and a fixture miss stay FAIL exit 1', async () => {
    const lines = [];
    const io = { log: (line) => lines.push(line), error: () => {} };
    assert.equal(await runCli([join(tmpdir(), `no-such-specimen-${process.pid}.json`)], io), 1, lines.join('\n'));
    const miss = async (url) => {
      const err = new Error(`fixture_miss:${url}`);
      err.code = 'fixture_miss';
      throw err;
    };
    assert.equal(await runCli([specimenUrl], { ...io, fetchImpl: miss }), 1, lines.join('\n'));
    const result = await verifyLink(load(specimen1Path), { fetchImpl: miss, rpcUrl: 'https://rpc.test/base' });
    assert.equal(result.steps.fetch_receipt.status, 'FAIL');
    assert.equal(result.verdict, 'FAIL');
  });

  test('N-2 classifyFetchError: only network codes, TLS codes and timeouts are transport', () => {
    const coded = (code, message = 'x') => Object.assign(new Error(message), { code });
    const fetchFailed = (cause) => new TypeError('fetch failed', { cause });
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ECONNABORTED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED']) {
      const got = classifyFetchError(fetchFailed(coded(code)));
      assert.equal(got.transport, true, code);
      assert.equal(got.message, code);
    }
    const agg = Object.assign(new AggregateError([coded('ECONNREFUSED')], 'all failed'), {});
    assert.equal(classifyFetchError(fetchFailed(agg)).transport, true, 'AggregateError member code');
    const timeout = new DOMException('timed out', 'TimeoutError');
    assert.equal(classifyFetchError(timeout).message, 'timeout');
    assert.equal(classifyFetchError(new DOMException('aborted', 'AbortError')).transport, true);
    // M-2: a TLS failure is COULD_NOT_CHECK with a tls: detail, on the cause or on the error.
    for (const code of ['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_TLS_HANDSHAKE_TIMEOUT']) {
      for (const err of [fetchFailed(coded(code)), coded(code)]) {
        const got = classifyFetchError(err);
        assert.equal(got.transport, true, code);
        assert.equal(got.message, `tls:${code}`);
      }
    }
    const redirect = classifyFetchError(fetchFailed(new Error('unexpected redirect')));
    assert.equal(redirect.transport, undefined);
    assert.equal(redirect.message, 'redirect_refused');
    for (const [label, err] of [
      ['harness bug', new Error('unexpected fetch rpc.test')],
      ['unlisted cause code', fetchFailed(coded('ERR_SOMETHING_ELSE'))],
      ['near-miss TLS prefix', fetchFailed(coded('ERR_TLSX'))],
      ['bad port', fetchFailed(new Error('bad port'))],
      ['redirect text without a cause', new Error('unexpected redirect')],
      ['numeric code', Object.assign(new Error('odd'), { code: 23 })],
      ['undefined', undefined],
    ]) {
      const got = classifyFetchError(err);
      assert.notEqual(got.transport, true, label);
      assert.ok(/^fetch_error:/.test(got.message), `${label}: ${got.message}`);
    }
    assert.equal(classifyFetchError(fetchFailed(coded('ERR_SOMETHING_ELSE'))).message, 'fetch_error:fetch failed:ERR_SOMETHING_ELSE');
    assert.equal(classifyFetchError(fetchFailed(new Error('bad port'))).message, 'fetch_error:fetch failed');
    const miss = Object.assign(new Error('fixture_miss:https://x.test/'), { code: 'fixture_miss' });
    assert.equal(classifyFetchError(miss), miss, 'a fixture miss keeps its own error');
  });

  test('N-2 a fetchImpl bug on the 1F916 step is FAIL, not COULD_NOT_CHECK', async () => {
    const { fetchImpl, specimen } = foreignPayoutHarness();
    const wrapped = async (url, init) => {
      if (String(url).includes('1f916.ai')) throw new Error('unexpected fetch 1f916.ai');
      return fetchImpl(url, init);
    };
    const result = await verifyLink(specimen(FINGERPRINT), { fetchImpl: wrapped, rpcUrl: 'https://rpc.test/base' });
    assert.equal(result.steps.entry_fingerprint.status, 'FAIL', formatReport(result));
    assert.ok(/fetch_error:unexpected fetch/.test(result.steps.entry_fingerprint.detail), result.steps.entry_fingerprint.detail);
    assert.equal(result.verdict, 'FAIL');
  });

  // M-2: TLS and unreachable-network failures are COULD_NOT_CHECK exit 2, while a
  // signed fingerprint mismatch is still FAIL exit 1 before any fetch.
  async function runHarnessCli({ claimed = FINGERPRINT, record }) {
    const { fetchImpl, specimen } = foreignPayoutHarness();
    const body = specimen(claimed);
    const wrapped = async (url, init) => {
      const u = new URL(String(url));
      if (u.host === '1f916.ai') return record(u, init);
      if (u.host === 'www.chit402.com') return { ok: true, status: 200, json: async () => body };
      return fetchImpl(url, init);
    };
    const result = await verifyLink(body, { fetchImpl: wrapped, rpcUrl: 'https://rpc.test/base', timeoutMs: 2000 });
    const lines = [];
    const prevRpc = process.env.BASE_RPC_URL;
    process.env.BASE_RPC_URL = 'https://rpc.test/base';
    let code;
    try {
      code = await runCli(['https://www.chit402.com/specimens/1f916-link-1.json'], {
        fetchImpl: wrapped,
        timeoutMs: 2000,
        log: (line) => lines.push(line),
        error: () => {},
      });
    } finally {
      if (prevRpc === undefined) delete process.env.BASE_RPC_URL;
      else process.env.BASE_RPC_URL = prevRpc;
    }
    return { result, code, out: lines.join('\n') };
  }

  function openssl(args, cwd) {
    const r = spawnSync('openssl', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `openssl ${args[0]} failed: ${r.error?.message || r.stderr}`);
  }

  /** A throwaway P-256 cert for CN=1f916.ai, made in a private temp dir and removed. */
  function throwawayCert({ expired }) {
    const dir = mkdtempSync(join(tmpdir(), 'link-tls-'));
    try {
      const keyArgs = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'key.pem', '-subj', '/CN=1f916.ai'];
      if (expired) {
        writeFileSync(join(dir, 'index.txt'), '');
        writeFileSync(join(dir, 'serial'), '01\n');
        writeFileSync(join(dir, 'ca.cnf'), '[ ca ]\ndefault_ca = d\n[ d ]\ndir = .\ndatabase = ./index.txt\nnew_certs_dir = .\nserial = ./serial\ndefault_md = sha256\npolicy = p\n[ p ]\ncommonName = supplied\n');
        openssl(['req', '-new', ...keyArgs, '-out', 'req.csr'], dir);
        openssl(['ca', '-batch', '-selfsign', '-config', 'ca.cnf', '-keyfile', 'key.pem', '-in', 'req.csr', '-out', 'cert.pem', '-startdate', '20200101000000Z', '-enddate', '20200102000000Z', '-notext'], dir);
      } else {
        openssl(['req', '-x509', ...keyArgs, '-out', 'cert.pem', '-days', '2'], dir);
      }
      return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async function tlsRecordHost(opts) {
    const server = createHttpsServer(throwawayCert(opts), (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }], events_has_more: false }));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address();
    const record = (u, init) => {
      const target = new URL(`https://127.0.0.1:${port}${u.pathname}${u.search}`);
      assert.equal(target.hostname, '127.0.0.1', 'tests only reach loopback');
      return fetch(target, init);
    };
    const close = () => new Promise((done) => {
      server.closeAllConnections?.();
      server.close(done);
    });
    return { record, close };
  }

  for (const [label, opts, code] of [
    ['self-signed', { expired: false }, 'DEPTH_ZERO_SELF_SIGNED_CERT'],
    ['expired', { expired: true }, 'CERT_HAS_EXPIRED'],
  ]) {
    test(`M-2 1f916.ai with a ${label} cert is COULD_NOT_CHECK exit 2 (tls:${code}); a signed mismatch is still FAIL exit 1`, { timeout: 20000 }, async () => {
      const host = await tlsRecordHost(opts);
      try {
        const ok = await runHarnessCli({ record: host.record });
        assert.equal(ok.result.steps.entry_fingerprint.status, 'COULD_NOT_CHECK', formatReport(ok.result));
        assert.equal(ok.result.steps.entry_fingerprint.detail, `record_fetch:tls:${code}`);
        assert.equal(ok.result.verdict, 'COULD_NOT_CHECK');
        assert.equal(ok.code, 2, ok.out);
        assert.ok(/^VERDICT COULD_NOT_CHECK$/m.test(ok.out), ok.out);
        const bad = await runHarnessCli({ claimed: TAMPERED, record: host.record });
        assert.equal(bad.result.steps.entry_fingerprint.status, 'FAIL', formatReport(bad.result));
        assert.ok(/fingerprint_mismatch .* jws .* claimed /.test(bad.result.steps.entry_fingerprint.detail), bad.result.steps.entry_fingerprint.detail);
        assert.equal(bad.code, 1, bad.out);
      } finally {
        await host.close();
      }
    });
  }

  for (const code of ['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ECONNABORTED', 'EPIPE']) {
    test(`M-2 a 1f916.ai fetch that fails with ${code} is COULD_NOT_CHECK exit 2; a signed mismatch is still FAIL exit 1`, async () => {
      const record = async () => {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error(code.toLowerCase()), { code }) });
      };
      const ok = await runHarnessCli({ record });
      assert.equal(ok.result.steps.entry_fingerprint.detail, `record_fetch:${code}`, formatReport(ok.result));
      assert.equal(ok.result.verdict, 'COULD_NOT_CHECK');
      assert.equal(ok.code, 2, ok.out);
      const bad = await runHarnessCli({ claimed: TAMPERED, record });
      assert.equal(bad.result.steps.entry_fingerprint.status, 'FAIL', formatReport(bad.result));
      assert.equal(bad.code, 1, bad.out);
    });
  }

  // N-7: JWS structure and kid shape are checked before the JWKS fetch, so a
  // JWKS outage cannot turn them into COULD_NOT_CHECK.
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const [label, target, edit, reason, jwksFetched] of [
    ['issuer JWS with two parts', 'issuer', (sig) => { sig.jws = sig.jws.split('.').slice(0, 2).join('.'); }, /^malformed_jws$/, false],
    ['issuer JWS header not JSON', 'issuer', (sig) => { const p = sig.jws.split('.'); sig.jws = `bm90IGpzb24.${p[1]}.${p[2]}`; }, /^json_parse_error$/, false],
    ['issuer JWS alg HS256', 'issuer', (sig) => { const p = sig.jws.split('.'); sig.jws = `${b64({ alg: 'HS256', kid: sig.kid })}.${p[1]}.${p[2]}`; }, /^unsupported_alg:HS256$/, false],
    ['issuer kid not a thumbprint', 'issuer', (sig) => { sig.kid = 'not-a-thumbprint'; }, /^kid_not_in_jwks:not-a-thumbprint$/, false],
    ['issuer header kid differs from the outer kid', 'issuer', (sig) => { const p = sig.jws.split('.'); sig.jws = `${b64({ alg: 'ES256', kid: 'A'.repeat(43) })}.${p[1]}.${p[2]}`; }, /^kid_mismatch$/, false],
    ['chain JWS with two parts', 'chain', (sig) => { sig.jws = sig.jws.split('.').slice(0, 2).join('.'); }, /^malformed_jws$/, true],
    ['chain kid not a thumbprint', 'chain', (sig) => { sig.kid = 'short'; }, /^kid_not_in_jwks:short$/, true],
    ['book_chain missing', 'drop_chain', null, /^book_chain_missing$/, true],
  ]) {
    test(`N-7 ${label} is FAIL even with the JWKS host at 502`, { timeout: 10000 }, async () => {
      const { fetchImpl, specimen, receipt } = foreignPayoutHarness();
      if (target === 'issuer') edit(receipt.issuer_signature);
      if (target === 'chain') edit(receipt.book_chain.issuer_signature);
      if (target === 'drop_chain') delete receipt.book_chain;
      const lb = await loopback({ 'api.chit402.com': '502' });
      let jwksFetches = 0;
      try {
        const wrapped = async (url, init) => {
          if (String(url).endsWith('/.well-known/jwks.json')) {
            jwksFetches += 1;
            return lb.forward(url, init);
          }
          return fetchImpl(url, init);
        };
        const result = await verifyLink(specimen(FINGERPRINT), { fetchImpl: wrapped, rpcUrl: 'https://rpc.test/base', timeoutMs: 300 });
        const name = target === 'issuer' ? 'issuer_signature' : 'receipt_chain';
        assert.equal(result.steps[name].status, 'FAIL', formatReport(result));
        assert.ok(reason.test(result.steps[name].detail), result.steps[name].detail);
        assert.equal(result.verdict, 'FAIL', formatReport(result));
        if (target === 'issuer') {
          assert.equal(result.steps.receipt_chain.status, 'FAIL', formatReport(result));
          assert.equal(result.steps.on_chain_tx.status, 'FAIL', formatReport(result));
        } else {
          assert.equal(result.steps.issuer_signature.status, 'COULD_NOT_CHECK', formatReport(result));
        }
        assert.equal(jwksFetches > 0, jwksFetched, `JWKS fetched ${jwksFetches} times`);
      } finally {
        await lb.close();
      }
    });
  }

  test('CLI: no argument is usage, exit 2', async () => {
    assert.equal(await runCli([], { log: () => {}, error: () => {} }), 2);
  });
});
