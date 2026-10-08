import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /stats?format=json is a coarse receipt bucket', async () => {
  const res = await fetch(`${base}/stats?format=json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json();
  assert.match(body.receipts, /^(<100|<1k|<10k|>=10k) receipts$/);
  assert.equal(Object.keys(body).join(','), 'receipts');
});

test('GET /stats returns a coarse HTML page', async () => {
  const res = await fetch(`${base}/stats`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Receipt volume/);
  assert.match(html, /receipts/);
});

test('GET /stats/door is the same coarse bucket', async () => {
  const res = await fetch(`${base}/stats/door`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.receipts, /receipts$/);
  assert.equal(Object.keys(body).join(','), 'receipts');
});
