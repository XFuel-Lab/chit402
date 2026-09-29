import { pathToFileURL } from 'node:url';
import { formatAtomicUsd, SURPLUS_CAP_ATOMIC } from './caps.js';

export const SURPLUS_ORIGIN = 'https://api.surplusintelligence.ai';

const PAYMENT_HEADERS = ['payment-signature', 'x-payment', 'payment-nonce', 'x-payment-nonce'];

/**
 * Fetch `/.well-known/x402` and attach a price to each paid endpoint.
 * Prices come from the manifest when it publishes `accepts[]`. Otherwise this
 * sends an unpaid request and reads the 402 challenge. It never sets a payment header.
 */
export async function listPaidEndpoints({
  fetch: fetchImpl = globalThis.fetch,
  origin = SURPLUS_ORIGIN,
  signal,
} = {}) {
  const manifestUrl = `${String(origin).replace(/\/$/, '')}/.well-known/x402`;
  const res = await fetchImpl(manifestUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET ${manifestUrl} failed: HTTP ${res.status}`);
  }
  const manifest = await res.json();
  const entries = resourcesFromManifest(manifest, origin);
  const rows = [];
  for (const entry of entries) {
    if (entry.accepts.length > 0) {
      rows.push({ ...entry, pricedFrom: 'manifest', status: 200 });
      continue;
    }
    rows.push(await probePrice(entry, fetchImpl, signal));
  }
  return { manifestUrl, rows };
}

export function formatPaidEndpoints({ manifestUrl, rows }) {
  const lines = [`Surplus x402  ${manifestUrl}`, ''];
  for (const row of rows) {
    lines.push(`${String(row.method || 'GET').padEnd(4)}  ${row.url}`);
    if (row.probedUrl && row.probedUrl !== row.url) {
      lines.push(`      priced from ${row.probedUrl}`);
    }
    if (!row.accepts?.length) {
      lines.push(`      no price (unpaid probe HTTP ${row.status ?? '?'})`);
      lines.push('');
      continue;
    }
    for (const accept of row.accepts) {
      const amount = accept.amount ?? accept.maxAmountRequired ?? '';
      const atomic = /^[0-9]+$/.test(String(amount));
      const usd = atomic ? formatAtomicUsd(amount) : '?';
      const over = atomic && BigInt(amount) > SURPLUS_CAP_ATOMIC
        ? '  over 0.05 USDC cap'
        : '';
      lines.push(
        `      ${String(accept.scheme || '?').padEnd(6)}  ${String(amount).padStart(8)} atomic USDC  $${usd}  ${accept.network || ''}${over}`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function resourcesFromManifest(manifest, origin) {
  const resources = manifest?.resources ?? manifest?.endpoints ?? [];
  if (!Array.isArray(resources)) return [];
  return resources.map((entry) => normalizeResource(entry, origin)).filter((entry) => entry.url);
}

function normalizeResource(entry, origin) {
  if (typeof entry === 'string') {
    return { url: absoluteUrl(entry, origin), method: undefined, accepts: [] };
  }
  if (!entry || typeof entry !== 'object') {
    return { url: '', method: undefined, accepts: [] };
  }
  const raw = entry.resource || entry.url || entry.endpoint || '';
  return {
    url: absoluteUrl(String(raw), origin),
    method: typeof entry.method === 'string' ? entry.method.toUpperCase() : undefined,
    accepts: Array.isArray(entry.accepts) ? entry.accepts : [],
  };
}

function absoluteUrl(value, origin) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const path = value.startsWith('/') ? value : `/${value}`;
  return `${String(origin).replace(/\/$/, '')}${path}`;
}

async function probePrice(entry, fetchImpl, signal) {
  const target = probeUrl(entry.url);
  const attempts = probeAttempts(entry, target);
  let lastStatus = 0;
  for (const attempt of attempts) {
    const headers = { accept: 'application/json' };
    if (attempt.body != null) headers['content-type'] = 'application/json';
    for (const name of PAYMENT_HEADERS) delete headers[name];
    const res = await fetchImpl(target, {
      method: attempt.method,
      headers,
      body: attempt.body,
      signal,
    });
    lastStatus = res.status;
    if (res.status !== 402) {
      await res.text().catch(() => {});
      continue;
    }
    const accepts = await acceptsFrom402(res);
    return {
      url: entry.url,
      method: attempt.method,
      accepts,
      pricedFrom: '402',
      status: 402,
      probedUrl: target === entry.url ? undefined : target,
    };
  }
  return {
    url: entry.url,
    method: entry.method || attempts[0]?.method || 'GET',
    accepts: [],
    pricedFrom: '402',
    status: lastStatus,
  };
}

function probeUrl(url) {
  const withParams = url.replace(/:([A-Za-z0-9_]+)/g, 'example');
  const parsed = new URL(withParams);
  if (parsed.pathname.endsWith('/tweets/search/recent') && !parsed.searchParams.has('query')) {
    parsed.searchParams.set('query', 'hello');
  }
  if (/\/venice-rpc\/?$/.test(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/base`;
  }
  return parsed.toString();
}

function probeAttempts(entry, url) {
  if (entry.method) {
    return [{ method: entry.method, body: entry.method === 'GET' ? undefined : defaultBody(url) }];
  }
  const path = new URL(url).pathname;
  if (/\/chat\/completions$/.test(path)) {
    return [{
      method: 'POST',
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    }];
  }
  if (/\/completions$/.test(path)) {
    return [{
      method: 'POST',
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        prompt: 'ping',
        max_tokens: 1,
      }),
    }];
  }
  if (/\/venice-rpc(\/[^/]+)?$/i.test(path)) {
    return [{
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    }];
  }
  return [
    { method: 'GET' },
    { method: 'POST', body: '{}' },
  ];
}

function defaultBody(url) {
  const path = new URL(url).pathname;
  if (/\/chat\/completions$/.test(path)) {
    return JSON.stringify({
      model: 'llama-3.3-70b',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    });
  }
  if (/\/completions$/.test(path)) {
    return JSON.stringify({ model: 'llama-3.3-70b', prompt: 'ping', max_tokens: 1 });
  }
  if (/\/venice-rpc(\/[^/]+)?$/i.test(path)) {
    return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
  }
  return '{}';
}

async function acceptsFrom402(res) {
  const header = res.headers.get('payment-required') || res.headers.get('x-payment-required');
  if (header) {
    try {
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      if (Array.isArray(decoded?.accepts)) return decoded.accepts;
    } catch {
      // Fall through to the JSON body.
    }
  }
  try {
    const body = await res.json();
    if (Array.isArray(body?.accepts)) return body.accepts;
  } catch {
    return [];
  }
  return [];
}

async function main() {
  const listed = await listPaidEndpoints();
  process.stdout.write(formatPaidEndpoints(listed));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
