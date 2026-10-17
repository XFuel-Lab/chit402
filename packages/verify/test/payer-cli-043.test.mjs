/**
 * CLI payer check is on. Exit 0 needs the check to have passed.
 * Chain reads stay on loopback. No production RPC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const { RPC_TIMEOUT_MS } = await import('../dist/rpc-deadline.js');
const { checkReceiptInput } = await import('../dist/check-input.js');
const { verifyReceipt, DEFAULT_TRUSTED_ISSUER_KIDS } = await import('../dist/index.js');
const { ERC20_TRANSFER_TOPIC } = await import('../dist/base-payer.js');

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const PRODUCTION = DEFAULT_TRUSTED_ISSUER_KIDS[0];

const FIXTURES = [
  ['xfuel-4d6e8331-c30f-400d-a76e-fcce0cfde209', 'chit-4d6e8331.json'],
  ['xfuel-5d775d12-f43a-460f-8b4a-9299b4eedf20', 'chit-5d775d12.v7.json'],
  ['xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96', 'public/chit-1ebc5616.json'],
  ['xfuel-39af100b-23dd-4d86-a16b-4556ca6796af', 'public/chit-39af100b.json'],
  ['foreign-x402-muy1hh8y-66555d036df8', 'public/foreign-x402-muy1hh8y.json'],
];

function loadFixture(rel) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${rel}`, import.meta.url), 'utf8'));
}

function claimsOf(receipt) {
  const jws = receipt.issuer_signature.jws;
  return JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
}

function topicAddress(addr) {
  return `0x${addr.replace(/^0x/i, '').toLowerCase().padStart(64, '0')}`;
}

function transferLog(payer, payee, amount) {
  const value = BigInt(amount).toString(16).padStart(64, '0');
  return {
    address: USDC.toLowerCase(),
    topics: [ERC20_TRANSFER_TOPIC, topicAddress(payer), topicAddress(payee)],
    data: `0x${value}`,
  };
}

function ethReceipt(txHash, logs, status = '0x1') {
  return {
    transactionHash: txHash,
    status,
    logs,
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const rpcPreload = fileURLToPath(new URL('./rpc-preload.mjs', import.meta.url));

function runCli(args, env = {}, timeout = 20000) {
  const started = Date.now();
  const nodeArgs = env.CHIT_RPC_MODE ? ['--import', rpcPreload] : [];
  const proc = spawnSync(process.execPath, [...nodeArgs, cli, ...args], {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...env },
  });
  return {
    ...proc,
    elapsed: Date.now() - started,
    text: `${proc.stdout || ''}\n${proc.stderr || ''}`,
  };
}

function thumbprint(jwk) {
  return createHash('sha256').update(JSON.stringify({
    crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y,
  })).digest('base64url');
}

function resign(source, patch) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = thumbprint(exported);
  const issuerJwk = { ...exported, kid, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };
  const payload = claimsOf(source);
  payload.payment = { ...payload.payment, ...(patch.payment || {}) };
  if ('payer' in patch) {
    payload.caller_binding = { ...(payload.caller_binding || {}), payer_wallet: patch.payer };
  }
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const payment = {
    ...(source.payment || payload.payment),
    ...payload.payment,
  };
  const caller = {
    ...(source.caller_binding || {}),
    ...(payload.caller_binding || {}),
  };
  const copy = {
    ...source,
    payment,
    caller_binding: caller,
    issuer_signature: {
      ...source.issuer_signature,
      jws: `${headerB64}.${payloadB64}.${signature}`,
      kid,
      issuer_jwk: issuerJwk,
    },
  };
  delete copy.verify_url;
  if (copy.verification) delete copy.verification.jwks_uri;
  return { receipt: copy, kid, payload };
}

function rpcServer(handler) {
  const seen = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not_in_tree"}');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    seen.push(body.method);
    const result = await handler(body, res);
    if (result === undefined) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, ...result }));
  });
  return { server, seen };
}

test('arguments after -- are rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chit-dash-'));
  const file = join(dir, 'receipt.json');
  writeFileSync(file, '{}\n');
  for (const args of [[file, '--', '--check-payer'], [file, '--', 'anything'], [file, '--json', '--', '--check-payer']]) {
    const run = runCli(args);
    assert.equal(run.status, 1, run.text);
    assert.match(run.text, /arguments after -- are not accepted/);
    assert.doesNotMatch(run.text, /^VERIFIED\n/m);
    if (args.includes('--json')) {
      const body = JSON.parse(run.stdout);
      assert.equal(body.exit_code, 1);
      assert.equal(body.reason, 'removed_flag');
      assert.notEqual(body.result, 'verified');
    }
  }
});

test('a removed payer flag still exits 1', () => {
  const run = runCli(['--check-payer', '--json']);
  assert.equal(run.status, 1, run.text);
  const body = JSON.parse(run.stdout);
  assert.equal(body.reason, 'removed_flag');
  assert.match(body.message, /removed in 0\.4: --check-payer is not a verifier flag/);
  assert.notEqual(body.result, 'verified');
});

test('re-signed 10x amount, wrong payer, and wrong payee exit 1', async () => {
  const source = loadFixture('chit-5d775d12.v7.json');
  const recorded = loadFixture('chit-5d775d12.base-logs.json');
  const original = claimsOf(source);
  const tx = original.payment.ref.slice('base:'.length);
  const { server, seen } = rpcServer(async (body) => {
    if (body.method !== 'eth_getTransactionReceipt') return { error: { code: -32601, message: 'no' } };
    return {
      result: ethReceipt(tx, recorded.logs.map((log) => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
      }))),
    };
  });
  const port = await listen(server);
  const rpcUrl = `http://127.0.0.1:${port}`;
  try {
    const ten = resign(source, { payment: { gross_amount: '20000', settled_amount: '20000' } });
    const wrongPayer = resign(source, { payer: DEAD });
    const wrongPayee = resign(source, { payment: { payee: DEAD } });
    for (const [label, forged, pattern] of [
      ['10x', ten, /transferred_2000_lt_expected_20000/],
      ['payer', wrongPayer, new RegExp(`no_usdc_transfer_from_${DEAD}`, 'i')],
      ['payee', wrongPayee, /payee_mismatch/],
    ]) {
      const checked = await verifyReceipt(forged.receipt, {
        checkPayer: true,
        trustedKids: [forged.kid, PRODUCTION],
        rpcUrl,
        skipIssuerHistory: true,
      });
      assert.match(checked.payer.reason || '', pattern, `${label} ${checked.payer.reason}`);
      assert.equal(checked.payer.outcome, 'fail', label);
      assert.notEqual(checked.overall, 'verified', label);

      const outcome = await checkReceiptInput(JSON.stringify(forged.receipt), {
        publicInput: true,
        trustedKids: [forged.kid, PRODUCTION],
        rpcUrl,
      });
      assert.equal(outcome.verdict.exit_code, 1, `${label} ${JSON.stringify(outcome.verdict)}`);
      assert.equal(outcome.verdict.result, 'invalid', label);
      assert.equal(outcome.verdict.reason, 'payment_mismatch', label);
      assert.equal(outcome.verdict.checks.payment_binding, 'fail', label);
    }
    assert.ok(seen.includes('eth_getTransactionReceipt'));

    const dir = mkdtempSync(join(tmpdir(), 'chit-resign-cli-'));
    const file = join(dir, 'receipt.json');
    writeFileSync(file, JSON.stringify(ten.receipt));
    const cliRun = runCli([file, '--json'], { BASE_RPC_URL: rpcUrl, SOLANA_RPC_URL: rpcUrl });
    assert.equal(cliRun.status, 1, cliRun.text);
    const body = JSON.parse(cliRun.stdout);
    assert.equal(body.reason, 'key untrusted');
    assert.notEqual(body.result, 'verified');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a real receipt whose chain transfer is short exits 1', () => {
  const source = loadFixture('chit-5d775d12.v7.json');
  const original = claimsOf(source);
  const tx = original.payment.ref.slice('base:'.length);
  const dir = mkdtempSync(join(tmpdir(), 'chit-short-'));
  const file = join(dir, 'receipt.json');
  const copy = { ...source };
  delete copy.verify_url;
  if (copy.verification) delete copy.verification.jwks_uri;
  writeFileSync(file, JSON.stringify(copy));
  const run = runCli([file, '--json'], {
    CHIT_RPC_MODE: 'body',
    CHIT_RPC_BODY: JSON.stringify(ethReceipt(tx, [transferLog(
      original.caller_binding.payer_wallet,
      original.payment.payee,
      200,
    )])),
    BASE_RPC_URL: 'http://127.0.0.1:9',
    SOLANA_RPC_URL: 'http://127.0.0.1:9',
  });
  assert.equal(run.status, 1, run.text);
  const body = JSON.parse(run.stdout);
  assert.equal(body.result, 'invalid');
  assert.equal(body.reason, 'payment_mismatch');
  assert.equal(body.checks.payment_binding, 'fail');
  assert.equal(body.checks.signature, 'pass');
});

test('an RPC that never answers is exit 2 inside the deadline', () => {
  const source = loadFixture('chit-5d775d12.v7.json');
  delete source.verify_url;
  if (source.verification) delete source.verification.jwks_uri;
  const dir = mkdtempSync(join(tmpdir(), 'chit-hang-'));
  const file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify(source));
  const run = runCli([file, '--json'], {
    CHIT_RPC_MODE: 'hang',
    BASE_RPC_URL: 'http://127.0.0.1:9',
    SOLANA_RPC_URL: 'http://127.0.0.1:9',
  }, RPC_TIMEOUT_MS + 8000);
  assert.equal(run.status, 2, run.text);
  assert.ok(run.elapsed < RPC_TIMEOUT_MS + 3000, `elapsed ${run.elapsed}`);
  assert.ok(run.elapsed >= RPC_TIMEOUT_MS - 1000, `elapsed ${run.elapsed} did not wait`);
  const body = JSON.parse(run.stdout);
  assert.equal(body.result, 'could_not_check');
  assert.notEqual(body.result, 'verified');
  assert.equal(/invalid/i.test(body.message), false);
  assert.equal(body.checks.payment_binding, 'could_not_check');
});

test('null, error, and a missing receipt are exit 2', () => {
  const source = loadFixture('chit-5d775d12.v7.json');
  delete source.verify_url;
  if (source.verification) delete source.verification.jwks_uri;
  const dir = mkdtempSync(join(tmpdir(), 'chit-null-rpc-'));
  const file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify(source));
  for (const mode of ['null', 'error', 'omit', 'nobody']) {
    const run = runCli([file, '--json'], {
      CHIT_RPC_MODE: mode,
      BASE_RPC_URL: 'http://127.0.0.1:9',
      SOLANA_RPC_URL: 'http://127.0.0.1:9',
    });
    assert.equal(run.status, 2, `${mode} ${run.text}`);
    assert.ok(run.elapsed < 5000, `${mode} elapsed ${run.elapsed}`);
    const body = JSON.parse(run.stdout);
    assert.equal(body.result, 'could_not_check', mode);
    assert.notEqual(body.result, 'verified', mode);
    assert.equal(body.checks.signature, 'pass', mode);
    assert.equal(body.checks.payment_binding, 'could_not_check', mode);
    assert.equal(/invalid/i.test(body.message), false, body.message);
  }
});

test('the five signed fixtures pass the payer check on their transfer', async () => {
  const recorded = loadFixture('chit-5d775d12.base-logs.json');
  for (const [task, rel] of FIXTURES) {
    const source = loadFixture(rel);
    const signed = claimsOf(source);
    const tx = signed.payment.ref.slice('base:'.length);
    const logs = task.startsWith('xfuel-5d775d12')
      ? recorded.logs
      : [transferLog(signed.caller_binding.payer_wallet, signed.payment.payee, signed.payment.gross_amount)];
    const { server } = rpcServer(async (body) => {
      const asked = String(body.params?.[0] || '').toLowerCase();
      if (body.method === 'eth_getTransactionReceipt' && asked === tx.toLowerCase()) {
        return { result: ethReceipt(tx, logs) };
      }
      return { result: null };
    });
    const port = await listen(server);
    const copy = structuredClone(source);
    delete copy.verify_url;
    if (copy.verification) delete copy.verification.jwks_uri;
    try {
      const verified = await verifyReceipt(copy, {
        checkPayer: true,
        rpcUrl: `http://127.0.0.1:${port}`,
        skipIssuerHistory: task.startsWith('foreign-x402'),
      });
      assert.equal(verified.payer.outcome, 'pass', `${task} ${verified.payer.reason} ${verified.errors.join(';')}`);
      assert.equal(verified.issuer_signature.valid, true, task);
      const historyOnly = verified.errors.every((err) => /issuer history/.test(err));
      if (!historyOnly) {
        assert.equal(verified.overall, 'verified', `${task} ${verified.errors.join(';')}`);
      }

      const dir = mkdtempSync(join(tmpdir(), 'chit-five-'));
      const file = join(dir, 'receipt.json');
      writeFileSync(file, JSON.stringify(copy));
      const run = runCli([file, '--json'], {
        CHIT_RPC_MODE: 'body',
        CHIT_RPC_BODY: JSON.stringify(ethReceipt(tx, logs)),
        BASE_RPC_URL: 'http://127.0.0.1:9',
        SOLANA_RPC_URL: 'http://127.0.0.1:9',
      });
      assert.notEqual(run.status, 0, `${task} ${run.text}`);
      const body = JSON.parse(run.stdout);
      assert.equal(body.checks.signature, 'pass', task);
      assert.equal(body.checks.payment_binding, 'pass', `${task} ${body.reason}`);
      assert.notEqual(body.result, 'verified', task);
      if (body.reason === 'issuer_history_pin_mismatch') {
        assert.equal(body.exit_code, 1, task);
      } else {
        assert.equal(body.exit_code, 2, `${task} ${body.reason}`);
        assert.equal(body.reason, 'log_unreachable', task);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('a pre-log receipt stays NOT_IN_LOG when the payer transfer matches', async () => {
  const source = loadFixture('public/chit-1ebc5616.json');
  const signed = claimsOf(source);
  const tx = signed.payment.ref.slice('base:'.length);
  const dir = mkdtempSync(join(tmpdir(), 'chit-prelog-'));
  const file = join(dir, 'receipt.json');
  const headFile = fileURLToPath(new URL('./fixtures/recorded/head-current.json', import.meta.url));
  const copy = structuredClone(source);
  copy.verify_url = `http://127.0.0.1:9/receipt/${source.task_id}`;
  if (copy.verification) delete copy.verification.jwks_uri;
  writeFileSync(file, JSON.stringify(copy));
  const run = runCli([file, '--json'], {
    CHIT_RPC_MODE: 'body',
    CHIT_HEAD_FILE: headFile,
    CHIT_RPC_BODY: JSON.stringify(ethReceipt(tx, [transferLog(
      signed.caller_binding.payer_wallet,
      signed.payment.payee,
      signed.payment.gross_amount,
    )])),
    BASE_RPC_URL: 'http://127.0.0.1:9',
    SOLANA_RPC_URL: 'http://127.0.0.1:9',
  });
  assert.equal(run.status, 1, run.text);
  const body = JSON.parse(run.stdout);
  assert.equal(body.reason, 'not_in_log');
  assert.equal(body.result, 'invalid');
  assert.equal(body.checks.payment_binding, 'pass', body.reason);
  assert.equal(body.checks.signature, 'pass');
  assert.notEqual(body.result, 'verified');
});

test('a null payer receipt is not exit 0 when the log was not the failure', async () => {
  const source = loadFixture('chit-5d775d12.v7.json');
  const signed = claimsOf(source);
  const { server, seen } = rpcServer(async () => ({ result: null }));
  const port = await listen(server);
  try {
    const outcome = await checkReceiptInput(JSON.stringify({
      ...source,
      verify_url: undefined,
    }), {
      publicInput: true,
      rpcUrl: `http://127.0.0.1:${port}`,
    });
    assert.equal(outcome.verdict.exit_code, 2);
    assert.notEqual(outcome.verdict.result, 'verified');
    assert.equal(outcome.verdict.checks.payment_binding, 'could_not_check');
    assert.ok(seen.includes('eth_getTransactionReceipt'));
    assert.equal(signed.payment.gross_amount, '2000');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an unsupported rail and a missing payer field are exit 2', async () => {
  const source = loadFixture('chit-5d775d12.v7.json');
  const rail = resign(source, { payment: { ref: 'card:not-a-chain' } });
  const missing = resign(source, { payer: '' });
  missing.receipt.caller_binding.payer_wallet = '';
  for (const [label, forged] of [['rail', rail], ['missing', missing]]) {
    const outcome = await checkReceiptInput(JSON.stringify(forged.receipt), {
      publicInput: true,
      trustedKids: [forged.kid, PRODUCTION],
      rpcUrl: 'http://127.0.0.1:9',
    });
    assert.equal(outcome.verdict.exit_code, 2, `${label} ${JSON.stringify(outcome.verdict)}`);
    assert.equal(outcome.verdict.result, 'could_not_check', label);
    assert.notEqual(outcome.verdict.result, 'verified', label);
    assert.equal(outcome.verdict.checks.payment_binding, 'could_not_check', label);
  }
});
