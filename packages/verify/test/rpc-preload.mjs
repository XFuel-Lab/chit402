/**
 * In-process stand-in for a loopback JSON-RPC server.
 * A child CLI cannot complete a TCP connection to a server in the test
 * process in this environment, so the CLI's fetch is answered here.
 * Only 127.0.0.1 and localhost are handled. Every other URL uses fetch.
 */
import { readFileSync } from 'node:fs';

const realFetch = globalThis.fetch.bind(globalThis);

function hostOf(input) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  try {
    return { url: String(url), host: new URL(url).hostname };
  } catch {
    return { url: String(url || ''), host: '' };
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const { url, host } = hostOf(input);
  if (host !== '127.0.0.1' && host !== 'localhost') return realFetch(input, init);
  const mode = process.env.CHIT_RPC_MODE || 'null';
  if (mode === 'hang') {
    await new Promise((resolve, reject) => {
      const signal = init.signal;
      const fail = () => {
        const reason = signal?.reason instanceof Error
          ? signal.reason
          : Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
        reject(reason);
      };
      if (signal?.aborted) return fail();
      signal?.addEventListener('abort', fail, { once: true });
    });
  }
  if ((init.method || 'GET').toUpperCase() === 'GET' || !init.body) {
    if (url.includes('/inclusion')) return jsonResponse({ error: 'not_in_tree' }, 404);
    if (url.includes('/tree/head') && process.env.CHIT_HEAD_FILE) {
      return jsonResponse(JSON.parse(readFileSync(process.env.CHIT_HEAD_FILE, 'utf8')));
    }
    if (url.includes('/tree/epoch') && process.env.CHIT_EPOCH_FILE) {
      return jsonResponse(JSON.parse(readFileSync(process.env.CHIT_EPOCH_FILE, 'utf8')));
    }
    return jsonResponse({ error: 'not_in_tree' }, 404);
  }
  if (mode === 'error') return jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } });
  if (mode === 'nobody') {
    return jsonResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { status: '0x1', logs: [] },
    });
  }
  if (mode === 'omit') return jsonResponse({ jsonrpc: '2.0', id: 1 });
  if (mode === 'null') return jsonResponse({ jsonrpc: '2.0', id: 1, result: null });
  const result = process.env.CHIT_RPC_BODY ? JSON.parse(process.env.CHIT_RPC_BODY) : null;
  return jsonResponse({ jsonrpc: '2.0', id: 1, result });
};
