/**
 * /v1/receipts/check reports the signed task id.
 * The payer read stays on loopback. No production POST.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.TASK_STORE_PERSIST = 'false';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { mountReceiptCheck, receiptFacts } = await import('../src/receipt-check.js');
const { checkReceiptInput } = await import('../../../packages/verify/dist/check-input.js');
const { holderDocumentFromOwnerView } = await import('../../../packages/verify/dist/index.js');
const { ERC20_TRANSFER_TOPIC } = await import('../../../packages/verify/dist/base-payer.js');

const SPOOF = 'spoof-display-id';

function claimsOf(receipt) {
  return JSON.parse(Buffer.from(receipt.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
}

function topicAddress(addr) {
  return `0x${addr.replace(/^0x/i, '').toLowerCase().padStart(64, '0')}`;
}

function listen(appOrServer) {
  return new Promise((resolve, reject) => {
    const httpServer = appOrServer.listen(0, '127.0.0.1');
    httpServer.once('listening', () => {
      const addr = httpServer.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('expected a tcp port'));
        return;
      }
      resolve({ server: httpServer, base: `http://127.0.0.1:${addr.port}` });
    });
    httpServer.once('error', reject);
  });
}

test('receipt facts do not copy an unsigned id', () => {
  const pasted = JSON.stringify({
    task_id: 'spoof-task',
    receipt_id: 'spoof-receipt-id',
    display_id: SPOOF,
    payload_version: 10,
  });
  const missing = receiptFacts(pasted, 'json', { receipt_id: null, payload_version: 10 });
  assert.equal(missing.receipt_id, null);
  assert.equal(missing.receipt_version, 10);
  const signed = receiptFacts(pasted, 'json', { receipt_id: 'xfuel-real-id', payload_version: null });
  assert.equal(signed.receipt_id, 'xfuel-real-id');
  const byId = receiptFacts('spoof-task', 'id', { receipt_id: null });
  assert.equal(byId.receipt_id, null);
  assert.equal(JSON.stringify(missing).includes(SPOOF), false);
  assert.equal(JSON.stringify(signed).includes('spoof-task'), false);
});

test('the check report uses the signed task id and drops a spoof', async () => {
  const source = JSON.parse(readFileSync(new URL(
    '../../../packages/verify/test/fixtures/public/chit-39af100b.json',
    import.meta.url,
  ), 'utf8'));
  const signed = claimsOf(source);
  const holder = holderDocumentFromOwnerView({
    jws: source.issuer_signature.jws,
    salt: '11'.repeat(16),
    private_fields: {},
    row_hash: 'ab'.repeat(32),
  });
  delete holder.verify_url;
  holder.issuer_signature.issuer_jwk = source.issuer_signature.issuer_jwk;
  holder.display_id = SPOOF;
  holder.receipt_id = 'spoof-receipt-id';
  const tx = signed.payment.ref.slice('base:'.length);
  const value = BigInt(signed.payment.settled_amount).toString(16).padStart(64, '0');
  const rpc = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const result = {
      transactionHash: tx,
      status: '0x1',
      logs: [{
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        topics: [
          ERC20_TRANSFER_TOPIC,
          topicAddress(signed.caller_binding.payer_wallet),
          topicAddress(signed.payment.payee),
        ],
        data: `0x${value}`,
      }],
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result }));
  });
  const { server: rpcServer, base: rpcUrl } = await listen(rpc);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  mountReceiptCheck(app, {
    check: (input, opts) => checkReceiptInput(input, { ...opts, rpcUrl, solanaRpcUrl: rpcUrl }),
  });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/v1/receipts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: JSON.stringify(holder), client: 'api' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.verdict.exit_code, 1);
    assert.equal(body.verdict.reason, 'claim_mismatch');
    assert.equal(body.verdict.receipt_id, signed.task_id);
    assert.equal(body.verdict.display_id, signed.task_id);
    assert.equal(body.report.receipt_id, signed.task_id);
    assert.equal(JSON.stringify(body).includes(SPOOF), false);
    assert.equal(JSON.stringify(body).includes('spoof-receipt-id'), false);

    const honest = holderDocumentFromOwnerView({
      jws: source.issuer_signature.jws,
      salt: '11'.repeat(16),
      private_fields: {},
      row_hash: 'cd'.repeat(32),
    });
    delete honest.verify_url;
    honest.issuer_signature.issuer_jwk = source.issuer_signature.issuer_jwk;
    honest.display_id = SPOOF;
    const pass = await fetch(`${base}/v1/receipts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: JSON.stringify(honest), client: 'api' }),
    });
    const passed = await pass.json();
    assert.equal(pass.status, 200, JSON.stringify(passed));
    assert.notEqual(passed.verdict.exit_code, 1, JSON.stringify(passed.verdict));
    assert.equal(passed.verdict.reason, 'log_unreachable');
    assert.equal(passed.verdict.checks.signature, 'pass');
    assert.equal(passed.report.receipt_id, signed.task_id);
    assert.equal(passed.verdict.display_id, signed.task_id);
    assert.equal(JSON.stringify(passed).includes(SPOOF), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => rpcServer.close(resolve));
  }
});
