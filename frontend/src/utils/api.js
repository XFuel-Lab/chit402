import axios from 'axios';

/**
 * XFuel M2M API client.
 *
 * All requests go through the backend server.js (default http://localhost:3002).
 * Auth via X-API-Key header.
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3002';

/**
 * Create an Axios instance pre-configured with the API URL and optional key.
 */
export function createApiClient(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return axios.create({
    baseURL: API_URL,
    timeout: 30000,
    headers,
  });
}

// ─── Constants (sync with server.js) ────────────────────────────────────────

export const MESSAGE_TYPES = {
  COMPUTE_BID: 'compute_bid',
  COMPUTE_RESULT: 'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY: 'capability_query',
  DATA_ATTESTATION: 'data_attestation',
};

export const CHAIN_IDS = {
  THETA: 'theta',
  OSMOSIS: 'osmosis',
  AKASH: 'akash',
  BITTENSOR: 'bittensor',
  PERSISTENCE: 'persistence',
};

export const ESCROW_RULES = {
  [MESSAGE_TYPES.COMPUTE_BID]: { required: true, label: 'Yes — agent must lock funds before bidding' },
  [MESSAGE_TYPES.INFERENCE_REQUEST]: { required: true, label: 'Yes — budget must be escrowed' },
  [MESSAGE_TYPES.COMPUTE_RESULT]: { required: false, label: 'No — provider attests completion' },
  [MESSAGE_TYPES.CAPABILITY_QUERY]: { required: false, mustBeZero: true, label: 'No — read-only, must be zero' },
  [MESSAGE_TYPES.DATA_ATTESTATION]: { required: false, label: 'No — provenance certification only' },
};

export const FEE_CONFIG = {
  defaultBps: 50,
  minBps: 50,
  maxBps: 100,
  a2aRelayBps: 10,
  denominator: 10000,
  minTaskAmount: 10000,
};

export const REVENUE_SPLIT = {
  bbb: { label: 'Buyback & Burn', pct: 30, color: '#ff5252' },
  lp: { label: 'LP Reinvestment', pct: 30, color: '#69f0ae' },
  vexf: { label: 'veXF Stakers', pct: 25, color: '#00e5ff' },
  treasury: { label: 'Treasury', pct: 15, color: '#b388ff' },
};

// ─── Fee Calculation (mirrors server.js / main.rs) ──────────────────────────

export function calculateTaskFee(grossAmount, feeBps = FEE_CONFIG.defaultBps) {
  const gross = BigInt(grossAmount || 0);
  const bps = BigInt(Math.min(Math.max(feeBps, FEE_CONFIG.minBps), FEE_CONFIG.maxBps));
  const fee = (gross * bps) / BigInt(FEE_CONFIG.denominator);
  const net = gross - fee;
  return {
    grossAmount: gross.toString(),
    feeAmount: fee.toString(),
    netAmount: net.toString(),
    feeBps: Number(bps),
    feePct: (Number(bps) / 100).toFixed(1),
  };
}

export function calculateRelayFee(escrowAmount) {
  const escrow = BigInt(escrowAmount || 0);
  if (escrow <= 0n) return '0';
  return ((escrow * 10n) / 10000n).toString();
}

// ─── API Methods ────────────────────────────────────────────────────────────

/**
 * POST /task-request — Submit an AI intent
 */
export async function submitTaskRequest(client, payload) {
  const res = await client.post('/task-request', payload);
  return res.data;
}

/**
 * GET /task-status — Query task or A2A message status
 */
export async function getTaskStatus(client, { taskId, messageId }) {
  const params = {};
  if (taskId) params.task_id = taskId;
  if (messageId) params.message_id = messageId;
  const res = await client.get('/task-status', { params });
  return res.data;
}

/**
 * GET /prove-result — Retrieve ZK settlement proof
 */
export async function getProveResult(client, taskId) {
  const res = await client.get('/prove-result', { params: { task_id: taskId } });
  return res.data;
}

/**
 * POST /a2a-message — Send A2A message with escrow
 */
export async function sendA2AMessage(client, payload) {
  const res = await client.post('/a2a-message', payload);
  return res.data;
}

/**
 * GET /health — Server health and metrics
 */
export async function getHealth(client) {
  const res = await client.get('/health');
  return res.data;
}
