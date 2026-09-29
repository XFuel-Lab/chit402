import { x402Client, x402HTTPClient } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import {
  SURPLUS_CAP_ATOMIC,
  SURPLUS_CAP_USD,
  affordableExactAccepts,
} from './caps.js';
import { decodeSettlementHeader, settlementHeaderFrom } from './payment-response.js';
import {
  accountFromSigner,
  ingestSettledPayment,
} from './stamp.js';

export const CHIT_API_URL = 'https://api.chit402.com';

export const ENV = {
  surplusKey: 'SURPLUS_PAYER_PRIVATE_KEY',
  stampKey: 'CHIT_STAMP_PRIVATE_KEY',
  agentId: 'CHIT_AGENT_ID',
  session: 'CHIT_BOOK_SESSION',
  apiKey: 'CHIT_API_KEY',
};

const PAYMENT_HEADERS = ['payment-signature', 'x-payment', 'payment-nonce', 'x-payment-nonce'];

/**
 * Pay `url` on Surplus (x402 exact, USDC on Base), decode `PAYMENT-RESPONSE`,
 * and stamp the settlement on the Chit book.
 *
 * Both caps refuse before any signature:
 * - Surplus price above 0.05 USDC (50000 atomic)
 * - Chit stamp above 2000 atomic USDC
 *
 * Keys are read from the environment when `opts` does not pass them.
 * This module does not load `.env` files.
 *
 * @returns {Promise<{ data: unknown, verify_url: string }>}
 */
export async function chitSurplusFetch(url, opts = {}) {
  if (!url || typeof url !== 'string') throw new Error('url is required');
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  const unpaid = unpaidInit(opts, signal);

  const probe = await fetchImpl(url, unpaid);
  const probeBody = await readBody(probe);
  if (probe.status !== 402) {
    throw new Error(`Surplus endpoint did not return HTTP 402 (got ${probe.status})`);
  }
  const challenge = readChallenge(probe, probeBody);

  // Price check before the payer account is used and before createPaymentPayload.
  const affordable = affordableExactAccepts(challenge, {
    cap: SURPLUS_CAP_ATOMIC,
    usd: SURPLUS_CAP_USD,
    label: 'Surplus payment',
  });
  const priced = { ...challenge, accepts: affordable };

  const creds = resolveCreds(opts);
  const payment = await payExactChallenge(priced, creds.surplusAccount);
  const paid = await fetchImpl(url, {
    ...unpaid,
    headers: { ...unpaid.headers, ...payment.headers },
  });

  if (paid.status === 402) {
    throw new Error('Surplus still returned 402 after the capped payment');
  }
  const paidBody = await readBody(paid);
  if (!paid.ok) {
    const message = paidBody.json?.error?.message || paidBody.json?.message || `HTTP ${paid.status}`;
    throw new Error(`Surplus payment was not accepted: ${message}`);
  }

  // A bad or missing settlement stops here, before the book ingest or the stamp signature.
  const settlement = decodeSettlementHeader(settlementHeaderFrom(paid.headers));
  const accepted = payment.accepted || affordable[0];
  const amount = settlement.amount && /^[0-9]+$/.test(settlement.amount)
    ? settlement.amount
    : String(accepted.amount ?? accepted.maxAmountRequired);

  const verify_url = await ingestSettledPayment({
    fetchImpl,
    apiUrl: creds.apiUrl,
    agentId: creds.agentId,
    session: creds.session,
    apiKey: creds.apiKey,
    stampAccount: creds.stampAccount,
    signal,
    paymentRequired: {
      resource: resourceOf(priced, url),
      amount,
      payTo: accepted.payTo,
      network: settlement.network || accepted.network,
      asset: 'USDC',
    },
    paymentResponse: {
      tx: settlement.tx,
      payer: settlement.payer,
      network: settlement.network,
    },
  });

  return {
    data: paidBody.json !== undefined ? paidBody.json : paidBody.text,
    verify_url,
  };
}

function unpaidInit(opts, signal) {
  const headers = new Headers(opts.headers || {});
  for (const name of PAYMENT_HEADERS) headers.delete(name);
  let body = opts.body;
  if (body != null && typeof body !== 'string' && !isBinary(body)) {
    body = JSON.stringify(body);
  }
  if (body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  const method = opts.method || (body != null ? 'POST' : 'GET');
  const plain = {};
  headers.forEach((value, key) => {
    plain[key] = value;
  });
  return { method, headers: plain, body: body ?? undefined, signal };
}

function isBinary(value) {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(value)
    || value instanceof Uint8Array
    || value instanceof ArrayBuffer;
}

async function payExactChallenge(challenge, account) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  client.setSpendControls({
    maxAmountPerPayment: `$${SURPLUS_CAP_USD}`,
    allowedAssets: true,
  });
  const http = new x402HTTPClient(client);
  const payload = await client.createPaymentPayload(challenge);
  return {
    headers: http.encodePaymentSignatureHeader(payload),
    accepted: payload.accepted,
  };
}

function readChallenge(response, parsed) {
  const header = response.headers.get('payment-required') || response.headers.get('x-payment-required');
  if (header) {
    const http = new x402HTTPClient(new x402Client());
    try {
      return http.getPaymentRequiredResponse((name) => response.headers.get(name), parsed.json);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`402 response had an unreadable PAYMENT-REQUIRED header: ${detail}`);
    }
  }
  if (parsed.json && Array.isArray(parsed.json.accepts)) return parsed.json;
  throw new Error('402 response had no PAYMENT-REQUIRED challenge');
}

function resourceOf(challenge, url) {
  const resource = challenge?.resource;
  if (typeof resource === 'string' && resource) return resource;
  if (resource && typeof resource === 'object' && typeof resource.url === 'string') return resource.url;
  return url;
}

function resolveCreds(opts) {
  const agentId = text(opts.agentId, ENV.agentId);
  const session = text(opts.session, ENV.session);
  const apiKey = text(opts.apiKey, ENV.apiKey);
  const apiUrl = (text(opts.apiUrl, 'CHIT_API_URL') || CHIT_API_URL).replace(/\/$/, '');
  if (!agentId || !/^[1-9][0-9]*$/.test(agentId)) {
    throw new Error(`${ENV.agentId} must be the registered book id. Refusing before signature.`);
  }
  if (!session) {
    throw new Error(
      `${ENV.session} is required (possession session for book ingest). Refusing before signature.`,
    );
  }
  const surplusRaw = opts.surplusSigner ?? readEnv(ENV.surplusKey);
  const stampRaw = opts.stampSigner ?? readEnv(ENV.stampKey);
  if (surplusRaw == null || surplusRaw === '') {
    throw new Error(`${ENV.surplusKey} is not set. Refusing before signature.`);
  }
  if (stampRaw == null || stampRaw === '') {
    throw new Error(`${ENV.stampKey} is not set. Refusing before signature.`);
  }
  const surplusAccount = accountFromSigner(surplusRaw, ENV.surplusKey);
  const stampAccount = accountFromSigner(stampRaw, ENV.stampKey);
  return { agentId, session, apiKey, apiUrl, surplusAccount, stampAccount };
}

async function readBody(response) {
  const textBody = await response.text();
  if (!textBody) return { text: '', json: undefined };
  try {
    return { text: textBody, json: JSON.parse(textBody) };
  } catch {
    return { text: textBody, json: undefined };
  }
}

function text(explicit, envName) {
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  return readEnv(envName);
}

function readEnv(name) {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
