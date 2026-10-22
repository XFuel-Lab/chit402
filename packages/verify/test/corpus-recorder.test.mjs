/**
 * Corpus recorder (test/corpus/tape-preload.mjs, record mode) never follows
 * a redirect. Run against local servers only: CHIT_CORPUS_RECORD_LOCAL_PORT
 * limits recording to http://127.0.0.1:<port>. No public host is contacted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const preload = pathToFileURL(fileURLToPath(new URL('./corpus/tape-preload.mjs', import.meta.url))).href;

function listen(handler) {
  return new Promise((resolve) => {
    const hits = [];
    const server = createServer((req, res) => { hits.push(req.url); handler(req, res); });
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }));
  });
}

function child(env, urls) {
  const code = `for (const u of ${JSON.stringify(urls)}) {
    try { const r = await fetch(u); console.log(JSON.stringify({ u, status: r.status, body: await r.text() })); }
    catch (e) { console.log(JSON.stringify({ u, error: String(e.cause?.message || e.message) })); }
  }`;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--import', preload, '--input-type=module', '-e', code], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  });
}

test('3xx answers are stored as errors, never followed, and replay as errors', async () => {
  const other = await listen((req, res) => { res.end('{"followed":true}'); });
  const main = await listen((req, res) => {
    const m = /^\/r(\d{3})(x?)$/.exec(req.url);
    if (m) {
      const to = m[2] ? `http://127.0.0.1:${other.port}/landing` : '/ok';
      res.writeHead(Number(m[1]), { location: to });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    const tape = join(mkdtempSync(join(tmpdir(), 'corpus-rec-')), 'tape.json');
    const base = `http://127.0.0.1:${main.port}`;
    const urls = [`${base}/ok`, ...['301', '302', '303', '307', '308'].flatMap((s) => [`${base}/r${s}`, `${base}/r${s}x`])];
    const rec = await child({ CHIT_CORPUS_MODE: 'record', CHIT_CORPUS_TAPE: tape, CHIT_CORPUS_RECORD_LOCAL_PORT: String(main.port) }, urls);
    assert.equal(rec[0].status, 200);
    for (const r of rec.slice(1)) assert.match(r.error, /redirect not followed: 30\d/, r.u);
    // Nothing went to the redirect target, same-origin or cross-origin.
    assert.deepEqual(other.hits, []);
    assert.equal(main.hits.filter((h) => h === '/ok').length, 1);

    const saved = JSON.parse(readFileSync(tape, 'utf8'));
    for (const s of ['301', '302', '303', '307', '308']) {
      for (const suffix of ['', 'x']) {
        const e = saved.entries[`GET ${base}/r${s}${suffix}`];
        assert.equal(e.status, Number(s));
        assert.match(e.error, /redirect not followed/);
        assert.equal(e.body, undefined);
      }
    }
    // Replay answers the same way, with no server involved.
    const hitsBefore = main.hits.length;
    const rep = await child({ CHIT_CORPUS_MODE: 'replay', CHIT_CORPUS_TAPE: tape }, urls);
    assert.equal(rep[0].status, 200);
    for (const r of rep.slice(1)) assert.match(r.error, /redirect not followed/, r.u);
    assert.equal(main.hits.length, hitsBefore);
  } finally {
    main.server.close();
    other.server.close();
  }
});

test('record mode refuses hosts outside the allowed set', async () => {
  const srv = await listen((req, res) => { res.end('{}'); });
  try {
    const tape = join(mkdtempSync(join(tmpdir(), 'corpus-rec-')), 'tape.json');
    // Local port allowed is a different one, so this server is not recordable.
    const rec = await child({ CHIT_CORPUS_MODE: 'record', CHIT_CORPUS_TAPE: tape, CHIT_CORPUS_RECORD_LOCAL_PORT: '9' }, [`http://127.0.0.1:${srv.port}/x`]);
    assert.match(rec[0].error, /host not recorded/);
    assert.deepEqual(srv.hits, []);
  } finally {
    srv.server.close();
  }
});

test('replay of an older tape entry holding a 3xx answer is an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-rec-'));
  const tape = join(dir, 'tape.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tape, JSON.stringify({ recorded_at: null, entries: { 'GET https://api.chit402.com/x': { status: 302, body: '' } } }));
  const rep = await child({ CHIT_CORPUS_MODE: 'replay', CHIT_CORPUS_TAPE: tape }, ['https://api.chit402.com/x']);
  assert.match(rep[0].error, /redirect not followed: 302/);
});
