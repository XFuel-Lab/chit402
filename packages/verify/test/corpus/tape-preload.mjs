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
 * Redirects are never followed: a 3xx is stored as an error entry.
 * Nothing else is sent: any other method or host, including chain JSON-RPC,
 * is recorded as a network error, so replay answers it the same way.
 * The first answer to a request is reused for the whole session, so every
 * case sees one consistent snapshot of the log.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GET_HOSTS } from './tape-hosts.mjs';

const MODE = process.env.CHIT_CORPUS_MODE || 'replay';
const TAPE = process.env.CHIT_CORPUS_TAPE || '';
const realFetch = globalThis.fetch.bind(globalThis);


// Tests of the recorder point it at a local server instead of the public
// hosts: CHIT_CORPUS_RECORD_LOCAL_PORT allows http://127.0.0.1:<port> only.
const LOCAL_PORT = /^\d{2,5}$/.test(process.env.CHIT_CORPUS_RECORD_LOCAL_PORT || '') ? process.env.CHIT_CORPUS_RECORD_LOCAL_PORT : null;

function recordHostAllowed(url) {
  const u = new URL(url);
  if (LOCAL_PORT) return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === LOCAL_PORT;
  return u.protocol === 'https:' && GET_HOSTS.has(u.hostname);
}

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

export function respond(entry) {
  if (entry.error) throw networkError(entry.error);
  // An older tape could hold a 3xx answer. Replay never hands one back.
  if (entry.status >= 300 && entry.status < 400) throw networkError(`redirect not followed: ${entry.status}`);
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

  // A redirect is never followed. It is stored as an error entry, so replay
  // fails the read the same way a fetch with redirect: 'error' does.
  async function getText(url) {
    const host = new URL(url).hostname;
    if (!recordHostAllowed(url)) return { error: `host not recorded: ${host}` };
    const res = await realFetch(url, { method: 'GET', redirect: 'manual', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* nothing to drain */ }
      return { error: `redirect not followed: ${res.status}${location ? ` to ${location}` : ''}`, status: res.status, location: location || null };
    }
    return { status: res.status, contentType: res.headers.get('content-type') || '', body: await res.text() };
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
