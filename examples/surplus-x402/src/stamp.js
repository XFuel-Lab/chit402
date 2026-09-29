import { privateKeyToAccount } from 'viem/accounts';
import {
  STAMP_CAP_ATOMIC,
  STAMP_CAP_USD,
  affordableExactAccepts,
} from './caps.js';

/**
 * Stamp-fee signer for `POST /v1/agents/:agent_id/book/ingest`.
 * Matches the book ingest client: possession session, payment_required plus
 * payment_response, then one x402 retry with `X-PAYMENT` after HTTP 402.
 * The 2000-atomic cap is applied before `signTypedData`.
 */

const USDC = {
  base: { chainId: 8453, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2' },
  'eip155:8453': { chainId: 8453, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2' },
  'base-sepolia': { chainId: 84532, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2' },
  'eip155:84532': { chainId: 84532, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2' },
};

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export class IngestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'IngestError';
    this.status = status;
  }
}

export function ingestUrl(apiUrl, agentId) {
  const origin = String(apiUrl).replace(/\/$/, '');
  return `${origin}/v1/agents/${agentId}/book/ingest`;
}

export function normalizePrivateKey(value, envName) {
  const trimmed = String(value || '').trim();
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${envName} must be a 32-byte hex private key`);
  }
  return `0x${hex}`;
}

export function accountFromSigner(signer, envName) {
  if (typeof signer === 'string') {
    return privateKeyToAccount(normalizePrivateKey(signer, envName));
  }
  if (signer && typeof signer.address === 'string' && typeof signer.signTypedData === 'function') {
    return signer;
  }
  throw new Error(`${envName} must be a hex private key or a viem account`);
}

/**
 * Sign the ingest stamp. Reads the challenge amount and returns before
 * `signTypedData` when it is above 2000 atomic USDC.
 */
export async function signStampChallenge(account, challenge) {
  const [accept] = affordableExactAccepts(challenge, {
    cap: STAMP_CAP_ATOMIC,
    usd: STAMP_CAP_USD,
    label: 'Chit stamp fee',
  });

  const net = USDC[accept.network];
  const chainId = net?.chainId ?? chainIdFromCaip(accept.network);
  const verifyingContract = usdcAddress(accept, net?.usdc);
  const name = accept.extra?.name || net?.name || 'USD Coin';
  const version = accept.extra?.version || net?.version || '2';
  if (!chainId || !verifyingContract) {
    throw new Error(`unsupported stamp network "${accept.network}"`);
  }
  if (!accept.payTo) throw new Error('stamp challenge is missing payTo');

  const amount = String(accept.amount ?? accept.maxAmountRequired);
  const from = account.address;
  const now = Math.floor(Date.now() / 1000);
  const validBefore = now + 3600;
  const eipNonce = randomBytes32();
  const domain = { name, version, chainId, verifyingContract };
  const message = {
    from,
    to: accept.payTo,
    value: BigInt(amount),
    validAfter: 0n,
    validBefore: BigInt(validBefore),
    nonce: eipNonce,
  };
  const signature = await account.signTypedData({
    domain,
    types: EIP3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const header = encodeBase64Json({
    x402Version: challenge.x402Version ?? 1,
    scheme: accept.scheme,
    network: accept.network,
    asset: accept.asset,
    amount,
    payTo: accept.payTo,
    nonce: accept.extra?.nonce,
    authorization: {
      type: 'eip3009-transferWithAuthorization',
      domain,
      message: {
        from,
        to: accept.payTo,
        value: amount,
        validAfter: 0,
        validBefore,
        nonce: eipNonce,
      },
      signature,
    },
    ...(challenge.resource ? { resource: challenge.resource } : {}),
    ...(challenge.extensions ? { extensions: challenge.extensions } : {}),
  });
  return { header, nonce: accept.extra?.nonce };
}

export async function ingestSettledPayment({
  fetchImpl,
  apiUrl,
  agentId,
  session,
  apiKey,
  stampAccount,
  paymentRequired,
  paymentResponse,
  signal,
}) {
  const url = ingestUrl(apiUrl, agentId);
  const body = {
    session,
    payment_required: paymentRequired,
    payment_response: paymentResponse,
    job_kind: 'other',
  };
  const payload = JSON.stringify(body);
  const baseHeaders = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-xfuel-session': session,
  };
  if (apiKey) baseHeaders['x-api-key'] = apiKey;

  const post = (extra) => fetchImpl(url, {
    method: 'POST',
    headers: extra ? { ...baseHeaders, ...extra } : baseHeaders,
    body: payload,
    signal,
  });

  const first = await post();
  const firstParsed = await readJson(first);
  if (first.status === 201 || first.ok) return verifyUrlOf(firstParsed, apiUrl, paymentResponse.tx);
  if (first.status === 409) return byTxUrl(apiUrl, paymentResponse.tx);
  if (first.status !== 402) {
    throw ingestFailure(first.status, firstParsed);
  }

  const challenge = challengeFromResponse(firstParsed, first.headers.get('payment-required'));
  if (!challenge) {
    throw new IngestError('ingest 402 had no x402 stamp challenge', 402);
  }

  // Cap check is inside signStampChallenge, before signTypedData.
  const payment = await signStampChallenge(stampAccount, challenge);
  const paid = await post({
    'X-PAYMENT': payment.header,
    ...(payment.nonce ? { 'X-PAYMENT-NONCE': payment.nonce } : {}),
  });
  const paidParsed = await readJson(paid);
  if (paid.status === 201 || paid.ok) return verifyUrlOf(paidParsed, apiUrl, paymentResponse.tx);
  if (paid.status === 409) return byTxUrl(apiUrl, paymentResponse.tx);
  throw ingestFailure(paid.status, paidParsed);
}

function challengeFromResponse(body, paymentRequiredHeader) {
  if (body && Array.isArray(body.accepts) && body.accepts.length > 0) return body;
  if (!paymentRequiredHeader) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString('utf8'));
    if (decoded && Array.isArray(decoded.accepts) && decoded.accepts.length > 0) return decoded;
  } catch {
    return undefined;
  }
  return undefined;
}

function verifyUrlOf(body, apiUrl, tx) {
  const direct = typeof body?.verify_url === 'string' ? body.verify_url.trim() : '';
  if (direct) return direct;
  const taskId = typeof body?.task_id === 'string' ? body.task_id.trim() : '';
  if (taskId) return `${String(apiUrl).replace(/\/$/, '')}/receipt/${encodeURIComponent(taskId)}`;
  return byTxUrl(apiUrl, tx);
}

function byTxUrl(apiUrl, tx) {
  return `${String(apiUrl).replace(/\/$/, '')}/receipt/by-tx?tx=${encodeURIComponent(tx)}`;
}

function ingestFailure(status, body) {
  const error = typeof body?.error === 'string' ? body.error : `HTTP ${status}`;
  const message = typeof body?.message === 'string' ? body.message : error;
  return new IngestError(`book ingest failed: ${message}`, status);
}

async function readJson(res) {
  try {
    const body = await res.json();
    if (body && typeof body === 'object') return body;
  } catch {
    return undefined;
  }
  return undefined;
}

function usdcAddress(accept, fallback) {
  if (typeof accept.asset === 'string' && /^0x[0-9a-fA-F]{40}$/.test(accept.asset)) {
    return accept.asset;
  }
  return fallback;
}

function chainIdFromCaip(network) {
  const match = /^eip155:(\d+)$/.exec(String(network || ''));
  if (!match) return undefined;
  return Number(match[1]);
}

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

function encodeBase64Json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}
