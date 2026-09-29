import { priceToAtomicUsdc } from './price.js';
import type {
  ChitEmDashConfig,
  ContentHashInput,
  EmDashSettlement,
  OnSettledContext,
  WaitUntil,
} from './types.js';

/** Response header carrying the book verify_url. */
export const CHIT_RECEIPT_HEADER = 'X-Chit-Receipt';

/** Standard book ingest stamp, USDC, 6 decimals. Gateway publishes the same figure. */
export const STAMP_FEE_USD = '0.002';
export const STAMP_FEE_UNITS = '2000';

export const DEFAULT_API_URL = 'https://api.chit402.com';
export const DEFAULT_TIMEOUT_MS = 1500;
export const DEFAULT_HARD_TIMEOUT_MS = 8000;
export const DEFAULT_NETWORK = 'eip155:8453';

const ENV_API_URL = ['CHIT_API_URL', 'CHIT402_API_URL', 'XFUEL_API_URL'];
const ENV_API_KEY = ['CHIT_API_KEY', 'CHIT402_API_KEY', 'XFUEL_API_KEY'];
const ENV_SESSION = ['CHIT_BOOK_SESSION', 'CHIT402_BOOK_SESSION', 'XFUEL_BOOK_SESSION'];
const ENV_AGENT = ['CHIT_AGENT_ID', 'CHIT402_AGENT_ID'];
const ENV_PAY_TO = ['CHIT_PAY_TO', 'CHIT402_PAY_TO'];

interface ResolvedConfig {
  agentId: string;
  session: string;
  apiKey: string;
  payTo: string;
  network: string;
  defaultPrice: ChitEmDashConfig['defaultPrice'];
  apiUrl: string;
  timeoutMs: number;
  hardTimeoutMs: number;
  waitUntil?: WaitUntil;
  contentHash?: ChitEmDashConfig['contentHash'];
  log: (message: string) => void;
  fetch: typeof fetch;
}

/**
 * POST a paid read to the book ingest door and, when verify_url returns in
 * time, set X-Chit-Receipt on result.responseHeaders.
 * Never throws. Skipped and unpaid results are ignored.
 */
export async function stampSettledRead(
  ctx: OnSettledContext,
  config: ChitEmDashConfig,
): Promise<void> {
  const result = ctx.result;
  if (!result || result.skipped || result.paid !== true) return;
  if (!result.responseHeaders || typeof result.responseHeaders !== 'object') return;

  const resolved = resolveConfig(config);
  const work = runStamp(ctx, resolved).catch((err: unknown) => {
    resolved.log(`stamp failed: ${messageOf(err)}`);
    return undefined;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), resolved.timeoutMs);
  });

  const winner = await Promise.race([
    work.then((verifyUrl) => ({ kind: 'done' as const, verifyUrl })),
    timeout.then((kind) => ({ kind })),
  ]);
  if (timer) clearTimeout(timer);

  if (winner.kind === 'done') {
    if (winner.verifyUrl) result.responseHeaders[CHIT_RECEIPT_HEADER] = winner.verifyUrl;
    return;
  }

  const tail = work.then((verifyUrl) => {
    if (verifyUrl) result.responseHeaders[CHIT_RECEIPT_HEADER] = verifyUrl;
  });
  const waitUntil = resolveWaitUntil(resolved, ctx.request);
  if (waitUntil) {
    try {
      waitUntil(tail);
    } catch (err) {
      resolved.log(`waitUntil rejected the stamp: ${messageOf(err)}`);
    }
    return;
  }
  resolved.log(
    'stamp still in flight after the page timeout; pass waitUntil on Cloudflare Workers so the isolate keeps the request',
  );
  void tail;
}

async function runStamp(
  ctx: OnSettledContext,
  config: ResolvedConfig,
): Promise<string | undefined> {
  if (!config.agentId || !/^[1-9][0-9]*$/.test(config.agentId)) {
    config.log('stamp skipped: agentId must be the registered book id');
    return undefined;
  }
  if (!config.session) {
    config.log('stamp skipped: possession session is required (X-Xfuel-Session)');
    return undefined;
  }
  if (!config.apiKey) {
    config.log('stamp skipped: book API key is required (X-API-Key)');
    return undefined;
  }

  const settlement = ctx.result.settlement;
  if (settlement && settlement.success === false) {
    config.log('stamp skipped: settlement was not successful');
    return undefined;
  }

  const tx = settlementTx(settlement);
  if (!tx) {
    config.log('stamp skipped: settlement has no transaction');
    return undefined;
  }

  const payer = ctx.result.payer || settlement?.payer;
  if (!payer) {
    config.log('stamp skipped: payer is missing');
    return undefined;
  }

  const payTo = ctx.options?.payTo || config.payTo;
  if (!payTo) {
    config.log('stamp skipped: payTo is missing');
    return undefined;
  }

  const network = settlement?.network || ctx.options?.network || config.network;
  const amount = priceToAtomicUsdc(
    ctx.options?.price ?? config.defaultPrice,
    settlement?.amount,
  );
  if (!amount) {
    config.log('stamp skipped: price is missing or not USDC');
    return undefined;
  }

  const resource = resourceOf(ctx.request, ctx.resource);
  const deliverable = await contentHashOf(ctx, config);

  const body: Record<string, unknown> = {
    session: config.session,
    payment_required: {
      resource,
      amount,
      payTo,
      network,
      asset: 'USDC',
    },
    payment_response: {
      tx,
      payer,
      network,
    },
    job_kind: 'other',
  };
  if (deliverable) body.deliverable_hash = deliverable;

  const url = ingestUrl(config.apiUrl, config.agentId);
  let res: Response;
  try {
    res = await config.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': config.apiKey,
        'x-xfuel-session': config.session,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.hardTimeoutMs),
    });
  } catch (err) {
    config.log(`stamp request failed: ${messageOf(err)}`);
    return undefined;
  }

  const parsed = await readJson(res);

  if (res.status === 201 || res.ok) {
    const verifyUrl = verifyUrlFrom(parsed, config.apiUrl);
    if (!verifyUrl) config.log('stamp wrote a row but verify_url was missing');
    return verifyUrl;
  }

  if (res.status === 409) {
    config.log('stamp already recorded for this settlement tx');
    return byTxUrl(config.apiUrl, tx);
  }

  if (res.status === 402) {
    config.log(
      `stamp not written: book ingest charges ${STAMP_FEE_USD} USDC (${STAMP_FEE_UNITS} atomic) via x402 unless this API key is waiver-listed`,
    );
    return undefined;
  }

  const error = typeof parsed?.error === 'string' ? parsed.error : `HTTP ${res.status}`;
  config.log(`stamp not written: ${error}`);
  return undefined;
}

export function ingestUrl(apiUrl: string, agentId: string | number): string {
  const origin = apiUrl.replace(/\/$/, '');
  return `${origin}/v1/agents/${agentId}/book/ingest`;
}

function resolveConfig(config: ChitEmDashConfig): ResolvedConfig {
  const timeoutMs = positiveMs(config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const hardTimeoutMs = Math.max(positiveMs(config.hardTimeoutMs, DEFAULT_HARD_TIMEOUT_MS), timeoutMs);
  const apiUrl = (firstText(config.apiUrl, ...ENV_API_URL) || DEFAULT_API_URL).replace(/\/$/, '');
  return {
    agentId: String(config.agentId ?? firstText(undefined, ...ENV_AGENT) ?? '').trim(),
    session: firstText(config.session, ...ENV_SESSION) || '',
    apiKey: firstText(config.apiKey, ...ENV_API_KEY) || '',
    payTo: firstText(config.payTo, ...ENV_PAY_TO) || '',
    network: (config.network || DEFAULT_NETWORK).trim() || DEFAULT_NETWORK,
    defaultPrice: config.defaultPrice,
    apiUrl,
    timeoutMs,
    hardTimeoutMs,
    waitUntil: config.waitUntil,
    contentHash: config.contentHash,
    log: config.log ?? ((message) => console.warn(`[chit402-emdash] ${message}`)),
    fetch: config.fetch ?? fetch,
  };
}

function resolveWaitUntil(config: ResolvedConfig, request: Request): WaitUntil | undefined {
  if (typeof config.waitUntil === 'function') return config.waitUntil;
  const bag = request as Request & { waitUntil?: WaitUntil };
  if (typeof bag.waitUntil === 'function') return bag.waitUntil.bind(bag);
  return undefined;
}

function settlementTx(settlement: EmDashSettlement | undefined): string | undefined {
  if (!settlement) return undefined;
  const tx = (settlement.transaction || settlement.tx || '').trim();
  if (!tx) return undefined;
  return tx;
}

function resourceOf(request: Request, resource: string | undefined): string {
  if (resource && /^https?:\/\//i.test(resource)) return stripQuery(resource);
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return resource || request.url;
  }
  if (resource && resource.startsWith('/')) {
    const path = resource.split('?')[0] || '/';
    return `${url.origin}${path}`;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function stripQuery(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split('?')[0] || value;
  }
}

async function contentHashOf(
  ctx: OnSettledContext,
  config: ResolvedConfig,
): Promise<string | undefined> {
  const source = config.contentHash;
  if (source == null) return undefined;
  try {
    const value = typeof source === 'function' ? await source(ctx) : source;
    if (value == null) return undefined;
    return normalizeContentHash(value);
  } catch (err) {
    config.log(`content hash skipped: ${messageOf(err)}`);
    return undefined;
  }
}

/** Pass through a sha256 digest, or hash raw text/bytes to `0x` + hex. */
export async function normalizeContentHash(value: ContentHashInput): Promise<string> {
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
    if (/^sha256:[0-9a-fA-F]{64}$/i.test(s)) return s.toLowerCase();
    if (/^[0-9a-fA-F]{64}$/.test(s)) return `0x${s.toLowerCase()}`;
    return hashBytes(new TextEncoder().encode(s));
  }
  return hashBytes(value);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}`;
}

function verifyUrlFrom(
  body: Record<string, unknown> | undefined,
  apiUrl: string,
): string | undefined {
  const direct = body?.verify_url;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const taskId = body?.task_id;
  if (typeof taskId === 'string' && taskId.trim()) {
    return `${apiUrl}/receipt/${encodeURIComponent(taskId.trim())}`;
  }
  return undefined;
}

function byTxUrl(apiUrl: string, tx: string): string {
  return `${apiUrl}/receipt/by-tx?tx=${encodeURIComponent(tx)}`;
}

async function readJson(res: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object') return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return undefined;
}

function firstText(explicit: string | number | undefined, ...envNames: string[]): string | undefined {
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  for (const name of envNames) {
    const value = readEnv(name);
    if (value) return value;
  }
  return undefined;
}

function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function positiveMs(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return fallback;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
