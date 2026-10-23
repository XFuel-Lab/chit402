/**
 * 0.4.5: signed ids, unsigned row hash, claim_mismatch.
 * Chain reads stay on loopback. No production RPC and no production POST.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './tmp-dirs.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const rpcPreload = new URL('./rpc-preload.mjs', import.meta.url).href;
const { checkReceiptInput } = await import('../dist/check-input.js');
const { verifyReceipt, holderDocumentFromOwnerView } = await import('../dist/index.js');
const { ERC20_TRANSFER_TOPIC } = await import('../dist/base-payer.js');

const SPOOF = 'spoof-display-id';

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
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    topics: [ERC20_TRANSFER_TOPIC, topicAddress(payer), topicAddress(payee)],
    data: `0x${value}`,
  };
}

function ethReceipt(txHash, logs) {
  return { transactionHash: txHash, status: '0x1', logs };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function rpcServer(receiptBody) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not_in_tree"}');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result: receiptBody }));
  });
  return server;
}

function holderFrom(source) {
  const signed = claimsOf(source);
  const owner = {
    jws: source.issuer_signature.jws,
    salt: '11'.repeat(16),
    private_fields: { note: 'holder' },
    row_hash: 'ab'.repeat(32),
  };
  const holder = holderDocumentFromOwnerView(owner);
  delete holder.verify_url;
  // The owner view does not carry a key. The saved fixture embeds the
  // production pin, which is what lets the CLI verify offline.
  holder.issuer_signature.issuer_jwk = source.issuer_signature.issuer_jwk;
  holder.display_id = SPOOF;
  return { holder, signed };
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ['--import', rpcPreload, cli, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, ...env },
  });
}

const source = loadFixture('public/chit-39af100b.json');
const signed = claimsOf(source);
const tx = signed.payment.ref.slice('base:'.length);
const chainReceipt = ethReceipt(tx, [transferLog(
  signed.caller_binding.payer_wallet,
  signed.payment.payee,
  signed.payment.settled_amount,
)]);

test('an honest holder doc is not exit 1, and a spoofed id is not shown', async () => {
  const { holder } = holderFrom(source);
  assert.equal(holder.book_chain.row_hash, 'ab'.repeat(32));
  assert.equal(holder.verify_url, undefined);
  assert.equal(holder.display_id, SPOOF);

  const server = rpcServer(chainReceipt);
  const port = await listen(server);
  const rpcUrl = `http://127.0.0.1:${port}`;
  try {
    const outcome = await checkReceiptInput(JSON.stringify(holder), {
      publicInput: true,
      rpcUrl,
      solanaRpcUrl: rpcUrl,
    });
    assert.notEqual(outcome.verdict.exit_code, 1, JSON.stringify(outcome.verdict));
    assert.equal(outcome.verdict.exit_code, 2);
    assert.equal(outcome.verdict.reason, 'log_unreachable');
    assert.equal(outcome.verdict.checks.signature, 'pass');
    assert.equal(outcome.verdict.checks.payment_binding, 'pass');
    assert.equal(outcome.verdict.receipt_id, signed.task_id);
    assert.equal(outcome.verdict.display_id, signed.task_id);
    assert.equal(JSON.stringify(outcome.verdict).includes(SPOOF), false);

    const lib = await verifyReceipt(holder, {
      checkPayer: true,
      requirePreimages: true,
      rpcUrl,
      solanaRpcUrl: rpcUrl,
    });
    assert.equal(lib.issuer_signature.valid, true);
    assert.equal(lib.receipt_id, signed.task_id);
    assert.equal(lib.payer.outcome, 'pass', lib.payer.reason);
    assert.equal(lib.claim_mismatches.length, 0);
    assert.equal(lib.errors.some((err) => /preimage missing for book_chain\.row_hash/.test(err)), false);
    assert.equal(JSON.stringify(lib.receipt_id).includes(SPOOF), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const dir = tempDir('chit-holder-045-');
  const file = join(dir, 'holder.json');
  writeFileSync(file, JSON.stringify(holder));
  const cliRun = runCli([file, '--json'], {
    CHIT_RPC_MODE: 'body',
    CHIT_RPC_BODY: JSON.stringify(chainReceipt),
    BASE_RPC_URL: 'http://127.0.0.1:9',
    SOLANA_RPC_URL: 'http://127.0.0.1:9',
  });
  assert.equal(cliRun.status, 2, cliRun.stderr || cliRun.stdout);
  const body = JSON.parse(cliRun.stdout);
  assert.equal(body.reason, 'log_unreachable');
  assert.equal(body.receipt_id, signed.task_id);
  assert.equal(body.display_id, signed.task_id);
  assert.equal(cliRun.stdout.includes(SPOOF), false);
});

test('outer amount, task_id, and receipt_id tampers are claim_mismatch', async () => {
  const { holder } = holderFrom(source);
  const server = rpcServer(chainReceipt);
  const port = await listen(server);
  const rpcUrl = `http://127.0.0.1:${port}`;
  try {
    const cases = [];
    const amount = structuredClone(holder);
    amount.payment = { ...amount.payment, gross_amount: '999999', settled_amount: '999999' };
    cases.push(['amount', amount]);
    const task = structuredClone(holder);
    task.task_id = 'xfuel-00000000-0000-4000-8000-000000000099';
    cases.push(['task_id', task]);
    const receiptId = structuredClone(holder);
    receiptId.receipt_id = 'spoof-receipt-id';
    cases.push(['receipt_id', receiptId]);

    for (const [label, doc] of cases) {
      const outcome = await checkReceiptInput(JSON.stringify(doc), {
        publicInput: true,
        rpcUrl,
        solanaRpcUrl: rpcUrl,
      });
      assert.equal(outcome.verdict.exit_code, 1, `${label} ${JSON.stringify(outcome.verdict)}`);
      assert.equal(outcome.verdict.reason, 'claim_mismatch', label);
      assert.equal(outcome.verdict.result, 'invalid', label);
      assert.equal(outcome.verdict.checks.signature, 'pass', label);
      assert.equal(outcome.verdict.checks.payment_binding, 'fail', label);
      assert.equal(outcome.verdict.receipt_id, signed.task_id, label);
      assert.equal(outcome.verdict.display_id, signed.task_id, label);
      assert.equal(JSON.stringify(outcome.verdict).includes('spoof-receipt-id'), false, label);
      assert.equal(JSON.stringify(outcome.verdict).includes('000000000099'), false, label);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a failed signature does not publish an outer id', async () => {
  const { holder } = holderFrom(source);
  const broken = structuredClone(holder);
  const parts = broken.issuer_signature.jws.split('.');
  parts[2] = 'aaaa';
  broken.issuer_signature.jws = parts.join('.');
  broken.task_id = 'spoof-task';
  broken.receipt_id = 'spoof-receipt-id';
  broken.display_id = SPOOF;

  const outcome = await checkReceiptInput(JSON.stringify(broken), {
    publicInput: true,
    rpcUrl: 'http://127.0.0.1:9',
    solanaRpcUrl: 'http://127.0.0.1:9',
  });
  assert.equal(outcome.verdict.checks.signature, 'fail');
  assert.equal(outcome.verdict.receipt_id, null);
  assert.equal(outcome.verdict.display_id, null);
  assert.equal(JSON.stringify(outcome.verdict).includes(SPOOF), false);
  assert.equal(JSON.stringify(outcome.verdict).includes('spoof-receipt-id'), false);
  assert.equal(JSON.stringify(outcome.verdict).includes('spoof-task'), false);

  const lib = await verifyReceipt(broken, { skipIssuerHistory: true, requirePreimages: true });
  assert.equal(lib.issuer_signature.valid, false);
  assert.equal(lib.receipt_id, null);
});
