import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bookRowHash, formatReport, verifyLink } from '../../../scripts/verify-1f916-link.mjs';

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

function foreignPayoutHarness() {
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
      fingerprint: FINGERPRINT,
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
  return { fetchImpl, specimen, responses };
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

test('the public unsigned receipt shell fails closed with a clear reason, not a verify_url mismatch', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    schema: 'chit402.receipt_shell.v1',
    unsigned: true,
    receipt_id: 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    verify_url: null,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await verifyLink(load(positivePath), { fetchImpl, rpcUrl: 'https://rpc.test/base' });
  assert.equal(result.steps.fetch_receipt.status, 'FAIL');
  assert.match(result.steps.fetch_receipt.detail, /public_receipt_is_unsigned_shell/);
  for (const name of ['issuer_signature', 'receipt_chain', 'on_chain_tx']) {
    assert.equal(result.steps[name].status, 'FAIL', name);
  }
  assert.equal(result.verdict, 'FAIL');
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

function assertShellFail(result) {
  const report = formatReport(result);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.steps.fetch_receipt.status, 'FAIL');
  assert.match(result.steps.fetch_receipt.detail, /public_receipt_is_unsigned_shell/);
  assert.equal(report.includes('VERIFIED'), false, report);
  assert.equal(report.includes('VERDICT PASS'), false, report);
  assert.match(report, /VERDICT FAIL/);
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
    assertShellFail(result);
    assert.match(result.steps.fetch_receipt.detail, /public_receipt_is_unsigned_shell/, name);
  }
});

test('T9 and R3 CLI: shell fixture exits 1 and never prints VERDICT PASS; a signed fixture prints only FIXTURE_PASS', () => {
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
  assert.equal(shell.status, 1, shellOut);
  assert.match(shellOut, /public_receipt_is_unsigned_shell/);
  assert.equal(shellOut.includes('VERIFIED'), false, shellOut);
  assert.equal(shellOut.includes('VERDICT PASS'), false, shellOut);
  assert.match(shellOut, /VERDICT FAIL/);
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
