import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';
import {
  WebhookRegistry,
  WebhookDispatcher,
  deliverWebhook,
  WEBHOOK_EVENTS,
} from '../src/webhooks.js';

test('register normalizes events and dedupes by url', () => {
  const reg = new WebhookRegistry();
  const a = reg.register({ url: 'https://agent.example/hook', secret: 's1' });
  assert.equal(a.events.sort().join(','), 'A2ASettled,TaskSettled');
  assert.equal(a.has_secret, true);

  const b = reg.register({ url: 'https://agent.example/hook', events: ['TaskSettled'] });
  assert.equal(a.id, b.id, 'same url -> same id (update, not duplicate)');
  assert.equal(reg.list().length, 1);
  assert.deepEqual(b.events, ['TaskSettled']);
});

test('register rejects bad urls and unknown events', () => {
  const reg = new WebhookRegistry();
  assert.throws(() => reg.register({ url: 'ftp://x' }), /http or https/);
  assert.throws(() => reg.register({ url: 'not-a-url' }), /valid absolute URL/);
  assert.throws(() => reg.register({ url: 'https://x', events: ['Nope'] }), /unknown event/);
});

test('remove by id and url', () => {
  const reg = new WebhookRegistry();
  const h = reg.register({ url: 'https://a.example/h' });
  assert.ok(reg.remove(h.id));
  assert.equal(reg.list().length, 0);
  reg.register({ url: 'https://b.example/h' });
  assert.ok(reg.removeByUrl('https://b.example/h'));
  assert.equal(reg.list().length, 0);
});

test('subscribersFor filters by event', () => {
  const reg = new WebhookRegistry();
  reg.register({ url: 'https://all.example/h' });
  reg.register({ url: 'https://only-a2a.example/h', events: ['A2ASettled'] });
  assert.equal(reg.subscribersFor(WEBHOOK_EVENTS.TASK_SETTLED).length, 1);
  assert.equal(reg.subscribersFor(WEBHOOK_EVENTS.A2A_SETTLED).length, 2);
});

test('deliverWebhook signs payload with HMAC-SHA256 and posts', async () => {
  const secret = 'topsecret';
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      received = { sig: req.headers['x-xfuel-signature'], event: req.headers['x-xfuel-event'], body };
      res.writeHead(200).end('ok');
    });
  });
  await new Promise(r => server.listen(0, r));
  const { port } = server.address();

  const payload = { event: WEBHOOK_EVENTS.TASK_SETTLED, task_id: 't1' };
  const res = await deliverWebhook(`http://127.0.0.1:${port}/hook`, payload, secret, 't1');
  server.close();

  assert.equal(res.ok, true);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  assert.equal(received.sig, expected, 'signature matches HMAC of body');
  assert.equal(received.event, WEBHOOK_EVENTS.TASK_SETTLED);
});

test('dispatcher fires once per terminal task to subscribers + callback', async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => { hits.push({ url: req.url, body: JSON.parse(body) }); res.writeHead(200).end('ok'); });
  });
  await new Promise(r => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const reg = new WebhookRegistry();
  reg.register({ url: `${base}/global` });

  const activeTasks = new Map();
  activeTasks.set('task-1', {
    taskId: 'task-1', status: 'completed', intent: { type: 'inference_request', amount: '1000' },
    meta: { chain: 'theta' }, feeAmount: '5', netAmount: '995', feeBps: 50,
    callbackUrl: `${base}/per-task`,
  });

  const dispatcher = new WebhookDispatcher(reg, { activeTasks }, { intervalMs: 50 });
  await dispatcher._scan();
  await dispatcher._scan(); // second scan must NOT re-fire
  dispatcher.stop();
  await new Promise(r => setTimeout(r, 100));
  server.close();

  const urls = hits.map(h => h.url).sort();
  assert.deepEqual(urls, ['/global', '/per-task'], 'fired global + per-task exactly once each');
  assert.equal(hits[0].body.event, WEBHOOK_EVENTS.TASK_SETTLED);
  assert.equal(hits[0].body.task_id, 'task-1');
});
