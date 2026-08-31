/**
 * XFuel Sidecar Ingest Client
 *
 * Posts sidecar receipts to the XFuel book/ingest endpoint.
 * This makes the receipt queryable via verify_url and part of the agent's book.
 *
 * Per whitepaper: ingest is possession-gated. The agent's session token is required.
 */

import type { SidecarReceipt } from './receipt.js';

export interface IngestConfig {
  /** XFuel API base URL (default: https://api.xfuel.app) */
  xfuelBaseUrl?: string;
  /** Agent API key */
  apiKey: string;
  /** Agent ID for the book */
  agentId: number | string;
  /** Session token for possession proof */
  session: string;
}

export interface IngestPayload {
  /** The 402 challenge from the upstream (payment_required envelope) */
  payment_required: {
    resource: string;
    amount: string;
    payTo: string;
    network?: string;
    asset?: string;
  };
  /** The payment response (what we paid) */
  payment_response: {
    tx: string;
    payer: string;
    network?: string;
  };
}

export interface IngestResult {
  ok: boolean;
  status: number;
  task_id?: string;
  verify_url?: string;
  error?: string;
  message?: string;
  body?: Record<string, unknown>;
}

/**
 * Post a foreign x402 payment to the XFuel book.
 * This requires a real on-chain USDC transfer — the gateway verifies it.
 */
export async function ingestToBook(
  payload: IngestPayload,
  config: IngestConfig
): Promise<IngestResult> {
  const baseUrl = (config.xfuelBaseUrl || 'https://api.xfuel.app').replace(/\/$/, '');
  const url = `${baseUrl}/v1/agents/${config.agentId}/book/ingest`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
        'X-Xfuel-Session': config.session,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (body.error as string) || 'ingest_failed',
        message: (body.message as string) || `HTTP ${res.status}`,
        body,
      };
    }

    const taskId = body.task_id as string | undefined;
    const verifyUrl = taskId ? `${baseUrl}/receipt/${taskId}` : undefined;

    return {
      ok: true,
      status: res.status,
      task_id: taskId,
      verify_url: verifyUrl,
      body,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message: msg,
    };
  }
}

/**
 * Build an ingest payload from a sidecar receipt.
 * Only works for collected receipts (with a payment_ref).
 */
export function receiptToIngestPayload(
  receipt: SidecarReceipt,
  payTo: string
): IngestPayload | null {
  if (!receipt.payment.ref || !receipt.payment.payer) {
    return null;
  }

  const [network, tx] = receipt.payment.ref.includes(':')
    ? receipt.payment.ref.split(':')
    : ['base', receipt.payment.ref];

  return {
    payment_required: {
      resource: receipt.route.resource || `https://${receipt.route.hub}/v1/chat/completions`,
      amount: receipt.payment.gross_amount,
      payTo,
      network,
    },
    payment_response: {
      tx,
      payer: receipt.payment.payer,
      network,
    },
  };
}

/**
 * Register an agent and get a session for book access.
 * This is a convenience wrapper around POST /v1/agents/register.
 */
export async function registerAgent(
  config: { xfuelBaseUrl?: string; apiKey: string }
): Promise<{ ok: boolean; agent_id?: number; session?: string; error?: string }> {
  const baseUrl = (config.xfuelBaseUrl || 'https://api.xfuel.app').replace(/\/$/, '');
  const url = `${baseUrl}/v1/agents/register`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
      body: JSON.stringify({}),
    });

    const body = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok) {
      return {
        ok: false,
        error: (body.error as string) || `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      agent_id: body.agent_id as number,
      session: body.session as string,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
