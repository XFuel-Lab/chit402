/**
 * Corpus network tape. Loaded with `node --import` in front of the CLI.
 *
 * CHIT_CORPUS_MODE=replay (default): every fetch is answered from the tape
 * named by CHIT_CORPUS_TAPE. A request that is not on the tape fails like a
 * network error and is listed on stderr, so nothing leaves the machine.
 * The clock is fixed to the tape's recorded time.
 *
 * CHIT_CORPUS_MODE=record: used only by scripts/record (never in CI).
 * GET to the public receipt hosts is passed through and written to the tape.
 * Nothing else is sent: any other method or host, including chain JSON-RPC,
 * is recorded as a network error, so replay answers it the same way.
 * The first answer to a request is reused for the whole session, so every
 * case sees one consistent snapshot of the log.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MODE = process.env.CHIT_CORPUS_MODE || 'replay';
const TAPE = process.env.CHIT_CORPUS_TAPE || '';
const realFetch = globalThis.fetch.bind(globalThis);

const GET_HOSTS = new Set([
  'api.chit402.com', 'chit402.com', 'www.chit402.com',
  'api.xfuel.app', 'xfuel.app', 'www.xfuel.app',
]);

function requestOf(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url || '');
  const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  let rpc = null;
  if (method === 'POST' && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      if (body && body.jsonrpc === '2.0' && typeof body.method === 'string') {
        rpc = { method: body.method, params: Array.isArray(body.params) ? body.params : [] };
      }
    } catch { /* not JSON-RPC */ }
  }
  return { url, method, rpc };
}

export function tapeKey(req) {
  if (req.rpc) {
    let host = '';
    try { host = new URL(req.url).host; } catch { /* keep empty */ }
    return `RPC ${host} ${req.rpc.method} ${JSON.stringify(req.rpc.params)}`;
  }
  return `${req.method} ${req.url}`;
}

function networkError(why) {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(why), { code: 'ECONNREFUSED' });
  return err;
}

function respond(entry) {
  if (entry.error) throw networkError(entry.error);
  return new Response(entry.body, {
    status: entry.status,
    headers: { 'content-type': entry.contentType || 'application/json' },
  });
}

if (MODE === 'replay') {
  const tape = TAPE ? JSON.parse(readFileSync(TAPE, 'utf8')) : { recorded_at: null, entries: {} };
  if (tape.recorded_at) {
    const fixed = Date.parse(tape.recorded_at);
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed);
        else super(...args);
      }
      static now() { return fixed; }
    }
    globalThis.Date = FixedDate;
  }
  globalThis.fetch = async (input, init = {}) => {
    const req = requestOf(input, init);
    const key = tapeKey(req);
    const entry = tape.entries[key];
    if (!entry) {
      process.stderr.write(`corpus-tape-miss ${key}\n`);
      throw networkError('not on tape');
    }
    return respond(entry);
  };
} else if (MODE === 'record') {
  let tape = { recorded_at: new Date().toISOString(), entries: {} };
  if (process.env.CHIT_CORPUS_APPEND === '1' && TAPE) {
    try { tape = JSON.parse(readFileSync(TAPE, 'utf8')); } catch { /* new tape */ }
  }
  const save = () => { if (TAPE) writeFileSync(TAPE, `${JSON.stringify(tape, null, 1)}\n`); };
  process.on('exit', save);

  async function getText(url) {
    let current = url;
    for (let hop = 0; hop < 3; hop += 1) {
      const host = new URL(current).hostname;
      if (!GET_HOSTS.has(host)) return { error: `host not recorded: ${host}` };
      const res = await realFetch(current, { method: 'GET', redirect: 'manual', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).href;
        continue;
      }
      return { status: res.status, contentType: res.headers.get('content-type') || '', body: await res.text() };
    }
    return { error: 'too many redirects' };
  }

  globalThis.fetch = async (input, init = {}) => {
    const req = requestOf(input, init);
    const key = tapeKey(req);
    if (tape.entries[key]) return respond(tape.entries[key]);
    let entry;
    try {
      if (req.rpc) {
        entry = { error: 'chain read not recorded: recording is GET-only' };
      } else if (req.method === 'GET') {
        entry = await getText(req.url);
      } else {
        entry = { error: `${req.method} is never sent` };
      }
    } catch (err) {
      entry = { error: `record failed: ${err?.message || err}` };
    }
    tape.entries[key] = entry;
    save();
    return respond(entry);
  };
} else {
  throw new Error(`unknown CHIT_CORPUS_MODE ${MODE}`);
}
