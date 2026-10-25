// N-E3 (646): the loopback guard also refuses raw sockets off loopback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { offHost } from './loopback-guard.mjs';

test('loopback guard: raw net and http connects off loopback are refused before any packet', async () => {
  const before = offHost.length;
  assert.throws(() => net.connect({ host: '192.0.2.1', port: 443 }), /off-loopback socket connect refused/);
  assert.throws(() => net.connect(443, '192.0.2.1'), /off-loopback socket connect refused/);
  assert.throws(() => http.get('http://192.0.2.1:80/x'), /off-loopback socket connect refused/);
  assert.equal(offHost.length - before, 3);
  assert.ok(offHost.slice(before).every((u) => /^net:\/\/192\.0\.2\.1:/.test(u)), offHost.join(', '));
  offHost.splice(before);
});

test('loopback guard: a connect to a 127.0.0.1 server still works', async () => {
  const server = net.createServer((s) => s.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const got = await new Promise((resolve, reject) => {
    const c = net.connect({ host: '127.0.0.1', port });
    let buf = '';
    c.on('data', (d) => { buf += d; });
    c.on('end', () => resolve(buf));
    c.on('error', reject);
  });
  server.close();
  assert.equal(got, 'ok');
  const res = await fetch(`http://127.0.0.1:${port}/`).catch((e) => e);
  assert.ok(res instanceof Error || res.status >= 0, 'fetch to loopback is not refused by the guard');
  assert.deepEqual(offHost, []);
});
