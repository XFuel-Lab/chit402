/**
 * Per-agent book webhook — possession-gated register + signed push on row write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';
import { AgentRegistry } from '../src/agent-registry.js';
import {
  UsageSettledLedger,
  recordCollectedSpend,
  recordSettleBookRow,
  setBookRowWrittenHook,
} from '../src/usage-settled.js';
import { bindBookVerifier } from '../src/agent-book.js';
import { recordBookInflow } from '../src/book-inflow.js';
import {
  BookWebhookRegistry,
  manageBookWebhook,
  scheduleBookWebhook,
  validateWebhookUrl,
  buildBookWebhookEnvelope,
  deliverBookWebhook,
  BOOK_WEBHOOK_SCHEMA,
} from '../src/book-webhook.js';

process.env.NODE_ENV = 'test';

function collectedReceipt(over = {}) {
  return {
    task_id: over.task_id || 'task-wh-1',
    payment: {
      rail: over.rail || 'usdc',
      ref: over.ref || 'base:0xwh1',
      collected: true,
      gross_amount: over.amount || '10000',
    },
    route: { model: over.model || 'xfuel/auto', hub: over.hub || 'mock' },
  };
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

test('validateWebhookUrl rejects http outside test-only paths in production mode', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.throws(() => validateWebhookUrl('http://example.com/hook'), /https/);
  assert.throws(() => validateWebhookUrl('https://localhost/hook'), /localhost/);
  process.env.NODE_ENV = prev;
});

test('validateWebhookUrl allows http in NODE_ENV=test', () => {
  assert.doesNotThrow(() => validateWebhookUrl('http://127.0.0.1:9999/hook'));
});

test('manageBookWebhook possession gate — 401 without session', () => {
  const registry = new BookWebhookRegistry();
  const reg = new AgentRegistry();
  const verify = bindBookVerifier(reg);
  reg.allocate({ taskId: 't1', paymentRef: 'base:0x1' });

  const result = manageBookWebhook(1, 'GET', {}, {}, { verify, registry });
  assert.equal(result.status, 401);
  assert.equal(result.body, null);
});

test('manageBookWebhook register/get/delete with possession', () => {
  const registry = new BookWebhookRegistry();
  const reg = new AgentRegistry();
  const identity = reg.allocate({ taskId: 't1', paymentRef: 'base:0x1' });
  const verify = bindBookVerifier(reg);

  const put = manageBookWebhook(
    identity.agent_id,
    'PUT',
    { session: identity.session },
    { url: 'http://127.0.0.1:8080/hook', secret: 'my-secret' },
    { verify, registry },
  );
  assert.equal(put.status, 200);
  assert.equal(put.body.webhook.url_host, '127.0.0.1:8080');
  assert.equal(put.body.webhook.has_secret, true);
  assert.ok(!put.body.secret_once, 'no secret_once when caller supplied secret');

  const get = manageBookWebhook(
    identity.agent_id,
    'GET',
    { session: identity.session },
    {},
    { verify, registry },
  );
  assert.equal(get.status, 200);
  assert.equal(get.body.webhook.events.length, 4);
  assert.ok(!get.body.webhook.secret);

  const del = manageBookWebhook(
    identity.agent_id,
    'DELETE',
    { session: identity.session },
    {},
    { verify, registry },
  );
  assert.equal(del.status, 200);
  assert.equal(del.body.status, 'removed');

  const getEmpty = manageBookWebhook(
    identity.agent_id,
    'GET',
    { session: identity.session },
    {},
    { verify, registry },
  );
  assert.equal(getEmpty.body.webhook, null);
});

test('register rejects invalid http url in production NODE_ENV', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const registry = new BookWebhookRegistry();
  const reg = new AgentRegistry();
  const identity = reg.allocate({ taskId: 't1', paymentRef: 'base:0x1' });
  const verify = bindBookVerifier(reg);

  const result = manageBookWebhook(
    identity.agent_id,
    'PUT',
    { session: identity.session },
    { url: 'http://insecure.example/hook' },
    { verify, registry },
  );
  assert.equal(result.status, 400);
  assert.match(result.body.message, /https/);
  process.env.NODE_ENV = prev;
});

test('no fire when webhook unset', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200).end('ok');
  });
  await new Promise(r => server.listen(0, r));
  const { port } = server.address();

  const registry = new BookWebhookRegistry();
  const ledger = new UsageSettledLedger();
  const reg = new AgentRegistry();

  setBookRowWrittenHook((entry) => {
    scheduleBookWebhook(entry, { registry, baseUrl: 'https://api.chit402.com' });
  });

  recordCollectedSpend(collectedReceipt({ task_id: 'no-hook-1', ref: 'base:0xnohook' }), {
    ledger,
    registry: reg,
  });

  await wait(50);
  server.close();
  assert.equal(hits, 0);
  setBookRowWrittenHook(null);
});

test('fire on synthetic book write — mock server receives envelope + valid HMAC', async () => {
  const secret = 'wh-test-secret';
  let received = null;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      received = {
        chitSig: req.headers['x-chit-signature'],
        xfuelSig: req.headers['x-xfuel-signature'],
        event: req.headers['x-chit-event'],
        body: JSON.parse(body),
      };
      res.writeHead(200).end('ok');
    });
  });
  await new Promise(r => server.listen(0, r));
  const { port } = server.address();
  const hookUrl = `http://127.0.0.1:${port}/treasury`;

  const registry = new BookWebhookRegistry();
  const ledger = new UsageSettledLedger();
  const reg = new AgentRegistry();
  const identity = reg.allocate({ taskId: 'wh-fire-1', paymentRef: 'base:0xfire1' });
  registry.upsert(identity.agent_id, { url: hookUrl, secret, events: ['collected'] });

  setBookRowWrittenHook((entry) => {
    scheduleBookWebhook(entry, { registry, baseUrl: 'https://api.chit402.com' });
  });

  const recorded = recordCollectedSpend(
    collectedReceipt({ task_id: 'wh-fire-1', ref: 'base:0xfire1', amount: '25000' }),
    { ledger, registry: reg, agentId: identity.agent_id },
  );
  assert.equal(recorded.agent_id, identity.agent_id);

  await wait(100);
  server.close();
  setBookRowWrittenHook(null);

  assert.ok(received, 'webhook POST received');
  assert.equal(received.body.schema, BOOK_WEBHOOK_SCHEMA);
  assert.equal(received.body.event, 'collected');
  assert.equal(received.body.agent_id, recorded.agent_id);
  assert.equal(received.body.task_id, 'wh-fire-1');
  assert.equal(received.body.amount, '25000');
  assert.equal(received.body.payment_ref, 'base:0xfire1');
  assert.ok(received.body.delivery_id);
  assert.ok(received.body.verify_url.includes('wh-fire-1'));

  const raw = JSON.stringify(received.body);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(received.chitSig, expected);
  assert.equal(received.xfuelSig, expected);
  assert.equal(received.event, 'collected');
});

test('settle row maps to settle event', async () => {
  const registry = new BookWebhookRegistry();
  const ledger = new UsageSettledLedger();
  const reg = new AgentRegistry();
  const recorded = recordSettleBookRow({
    taskId: 'settle-wh-1',
    paymentRef: 'base:0xsettle1',
    amount: '5000',
    ledger,
    registry: reg,
  });
  const envelope = buildBookWebhookEnvelope(recorded.entry, 'https://api.chit402.com');
  assert.equal(envelope.event, 'settle');
  assert.equal(envelope.evidence, 'RECORDED_BY_SETTLE');
  assert.equal(envelope.recorded_by, 'settle');
});

test('inflow row maps to inflow event', () => {
  const ledger = new UsageSettledLedger();
  const reg = new AgentRegistry();
  const identity = reg.allocate({ taskId: 'inflow-1', paymentRef: 'base:0xinflow' });
  const verify = bindBookVerifier(reg);

  recordBookInflow(
    identity.agent_id,
    {
      session: identity.session,
      task_id: 'inflow-wh-1',
      bucket: 'patron',
      allocation: '15000',
    },
    { ledger, registry: reg, verify, claim: { session: identity.session } },
  );

  const entry = ledger.findByTask('inflow-wh-1');
  const envelope = buildBookWebhookEnvelope(entry, 'https://api.chit402.com');
  assert.equal(envelope.event, 'inflow');
  assert.equal(envelope.evidence, 'inflow_claimed');
  assert.equal(envelope.bucket, 'patron');
  assert.ok(envelope.inflow_claim?.signature);
});

test('deliverBookWebhook signs with X-Chit-Signature', async () => {
  const secret = 'deliver-test';
  let sig = null;
  const server = http.createServer((req, res) => {
    sig = req.headers['x-chit-signature'];
    res.writeHead(200).end('ok');
  });
  await new Promise(r => server.listen(0, r));
  const { port } = server.address();

  const envelope = {
    schema: BOOK_WEBHOOK_SCHEMA,
    delivery_id: 'd1',
    event: 'collected',
    agent_id: 1,
    task_id: 't1',
  };
  const res = await deliverBookWebhook(`http://127.0.0.1:${port}/h`, envelope, secret, 't1');
  server.close();

  assert.equal(res.ok, true);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(envelope)).digest('hex');
  assert.equal(sig, expected);
});
