import { getApiHost } from '../apiHost';
import {
  BOOK_EVIDENCE,
  USDC_DECIMALS,
  computeBurnRate,
  computeModelMix,
  evidenceBadgeTone,
  evidenceHint,
  evidenceLabel,
  formatCollectedAt,
  formatUsdc,
  parseUsdcInput,
  replayParentTaskId,
  resolveRowEvidence,
  summarizePaymentRef,
  verifyUrlFor,
  type BurnRate,
  type ModelMixItem,
} from './agentBookCore.mjs';

export {
  BOOK_EVIDENCE,
  USDC_DECIMALS,
  computeBurnRate,
  computeModelMix,
  evidenceBadgeTone,
  evidenceHint,
  evidenceLabel,
  formatCollectedAt,
  formatUsdc,
  parseUsdcInput,
  replayParentTaskId,
  resolveRowEvidence,
  summarizePaymentRef,
  verifyUrlFor,
};

export interface BookPayment {
  ref: string;
  rail: string;
  amount: string | null;
}

export interface BookRoute {
  model?: string;
  hub?: string;
}

export type BookEvidence =
  | 'collected'
  | 'RECORDED_BY_SETTLE'
  | 'ARRIVAL_UNVERIFIED'
  | 'inflow_claimed'
  | 'UNVERIFIED'
  | 'policy_blocked';

export interface BookReplayEvent {
  at?: string;
  settlement_status?: 'idempotent_replay';
  replay_of?: string;
}

export interface BookInflowClaim {
  bucket: string;
  allocation: string;
  as_of: string;
  signature: { alg: string; value: string };
}

export interface BookInflowCorrection {
  bucket: string;
  allocation: string;
  reason: string;
  as_of: string;
  signature: { alg: string; value: string };
}

export interface BookEntry {
  task_id: string;
  evidence?: BookEvidence;
  payment: BookPayment;
  route?: BookRoute;
  collected_at: string | null;
  parent_ref?: string;
  intent_id?: string;
  attempt_index?: number;
  event?: 'policy_blocked';
  policy_code?: string;
  reason?: string;
  collected?: boolean;
  payer_wallet?: string | null;
  replay_count?: number;
  replay_events?: BookReplayEvent[];
  idempotent_replay?: boolean;
  replay_of?: string | null;
  bucket?: string;
  inflow_claim?: BookInflowClaim;
  inflow_corrections?: BookInflowCorrection[];
  recorded_by?: 'settle';
  arrival_status?: string;
}

export interface IntentGroup {
  intent_id: string;
  attempts: Array<{
    task_id: string;
    attempt_index: number | null;
    collected: boolean;
    event: string | null;
    amount: string | null;
    policy_code: string | null;
  }>;
  collected_count: number;
  blocked_count: number;
}

export interface BookTotals {
  count: number;
  usdc_sum: string;
  by_rail: Record<string, { count: number; amount: string }>;
}

export interface AgentBookResponse {
  agent_id: number;
  limit: number;
  entries: BookEntry[];
  totals: BookTotals;
  intents?: Record<string, IntentGroup>;
  window: string;
  cap: string | null;
  spent: string;
  remaining: string | null;
  allowance?: {
    agent_id: number;
    remaining: string | null;
    as_of: string;
    signature: { alg: string; value: string };
  };
  private_spend?: {
    enabled: boolean;
    mode: string;
    trust: string;
    note: string;
  };
}

export type BookFetchError = 'unauth' | 'forbidden' | 'network' | 'parse';

export interface FetchBookParams {
  agentId: number;
  session: string;
  limit?: number;
  budget?: string | null;
}

export type FetchBookResult =
  | { ok: true; data: AgentBookResponse }
  | { ok: false; error: BookFetchError; status?: number };

export type { BurnRate, ModelMixItem };

export interface BookPolicy {
  agent_id?: number;
  daily_cap?: { limit: string; reset_at: string };
  hourly_cap?: { limit: string; reset_at: string };
  model_allowlist?: string[];
  kill_switch?: boolean;
  require_payment_ref?: boolean;
  tier2_above?: { threshold: string };
  created_at?: string;
  updated_at?: string;
}

export interface BookPolicyResponse {
  agent_id: number;
  policy: BookPolicy | null;
}

export type PolicyType =
  | 'daily_cap'
  | 'hourly_cap'
  | 'model_allowlist'
  | 'kill_switch'
  | 'require_payment_ref'
  | 'tier2_above';

/** GET /v1/agents/:agent_id/book/policy */
export async function fetchBookPolicy(
  apiV1: string,
  params: { agentId: number; session: string },
): Promise<{ ok: true; data: BookPolicyResponse } | { ok: false; error: BookFetchError; status?: number }> {
  const url = `${apiV1.replace(/\/$/, '')}/agents/${params.agentId}/book/policy`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'X-XFuel-Session': params.session },
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  if (res.status === 401) return { ok: false, error: 'unauth', status: 401 };
  if (res.status === 403) return { ok: false, error: 'forbidden', status: 403 };
  if (!res.ok) return { ok: false, error: 'network', status: res.status };
  try {
    const data = (await res.json()) as BookPolicyResponse;
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'parse', status: res.status };
  }
}

/** POST /v1/agents/:agent_id/book/policy */
export async function setBookPolicy(
  apiV1: string,
  params: { agentId: number; session: string; policyType: PolicyType; value: unknown },
): Promise<{ ok: true; data: BookPolicyResponse } | { ok: false; error: BookFetchError; status?: number; message?: string }> {
  const url = `${apiV1.replace(/\/$/, '')}/agents/${params.agentId}/book/policy`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XFuel-Session': params.session,
      },
      body: JSON.stringify({ session: params.session, policy_type: params.policyType, value: params.value }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  if (res.status === 401) return { ok: false, error: 'unauth', status: 401 };
  if (res.status === 403) return { ok: false, error: 'forbidden', status: 403 };
  if (!res.ok) {
    try {
      const err = await res.json() as { message?: string };
      return { ok: false, error: 'network', status: res.status, message: err.message };
    } catch {
      return { ok: false, error: 'network', status: res.status };
    }
  }
  try {
    const data = (await res.json()) as BookPolicyResponse;
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'parse', status: res.status };
  }
}

/** GET /v1/agents/:agent_id/book/export */
export async function fetchBookExport(
  apiV1: string,
  params: { agentId: number; session: string; format?: 'csv' | 'json' | 'html'; limit?: number },
): Promise<{ ok: true; blob: Blob; filename?: string } | { ok: false; error: BookFetchError; status?: number }> {
  const fmt = params.format || 'csv';
  const qs = new URLSearchParams({ format: fmt });
  if (params.limit != null) qs.set('limit', String(params.limit));
  const url = `${apiV1.replace(/\/$/, '')}/agents/${params.agentId}/book/export?${qs}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'X-XFuel-Session': params.session },
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  if (res.status === 401) return { ok: false, error: 'unauth', status: 401 };
  if (res.status === 403) return { ok: false, error: 'forbidden', status: 403 };
  if (!res.ok) return { ok: false, error: 'network', status: res.status };
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { ok: true, blob, filename: match?.[1] };
}

/** POST /v1/agents/:agent_id/book — with possession session. */
export async function fetchAgentBook(
  apiV1: string,
  params: FetchBookParams,
): Promise<FetchBookResult> {
  const url = `${apiV1.replace(/\/$/, '')}/agents/${params.agentId}/book`;
  const body: Record<string, unknown> = { session: params.session };
  if (params.limit != null) body.limit = params.limit;
  if (Object.prototype.hasOwnProperty.call(params, 'budget')) {
    body.budget = params.budget;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XFuel-Session': params.session,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 401) return { ok: false, error: 'unauth', status: 401 };
  if (res.status === 403) return { ok: false, error: 'forbidden', status: 403 };
  if (!res.ok) return { ok: false, error: 'network', status: res.status };

  try {
    const data = (await res.json()) as AgentBookResponse;
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'parse', status: res.status };
  }
}

/** Default verify URL host for helpers that need it. */
export function defaultApiHost(): string {
  return getApiHost();
}

export interface BookEscrowRecord {
  escrow_id: string;
  agent_id: number;
  task_id: string;
  amount: string;
  status: 'open' | 'released' | 'clawed_back' | 'expired';
  hold: { kind: string; payment_ref?: string; rail?: string; note?: string };
  required: { output_hash?: string; proof_tier?: string };
  expires_at: string;
  verify_url?: string | null;
  ledger_escrow?: boolean;
  dispute_id?: string | null;
  refund_instruction?: object | null;
  verification?: object | null;
  opened_at?: string;
  closed_at?: string | null;
  close_reason?: string | null;
}

export interface EscrowActionParams {
  action: 'open' | 'release' | 'clawback' | 'status';
  task_id?: string;
  escrow_id?: string;
  amount?: string;
  expires_at?: string;
  required?: { output_hash?: string; proof_tier?: 'settlement' | 'inference' };
  claim_type?: 'output_missing' | 'wrong_model' | 'double_charge';
  evidence?: Record<string, unknown>;
}

export type EscrowActionResult =
  | {
      ok: true;
      escrow?: BookEscrowRecord;
      checks?: object;
      dispute?: object;
      disclaimer?: string;
    }
  | {
      ok: false;
      error: BookFetchError | 'escrow';
      message?: string;
      status?: number;
      escrow?: BookEscrowRecord;
      disclaimer?: string;
    };

/** POST /v1/agents/:agent_id/book/escrow with possession session. */
export async function bookEscrowAction(
  apiV1: string,
  auth: { agentId: number; session: string },
  params: EscrowActionParams,
): Promise<EscrowActionResult> {
  const url = `${apiV1.replace(/\/$/, '')}/agents/${auth.agentId}/book/escrow`;
  const body: Record<string, unknown> = {
    session: auth.session,
    action: params.action,
  };
  if (params.task_id) body.task_id = params.task_id;
  if (params.escrow_id) body.escrow_id = params.escrow_id;
  if (params.amount) body.amount = params.amount;
  if (params.expires_at) body.expires_at = params.expires_at;
  if (params.required) body.required = params.required;
  if (params.claim_type) body.claim_type = params.claim_type;
  if (params.evidence) body.evidence = params.evidence;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XFuel-Session': auth.session,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    if (!res.ok) return { ok: false, error: 'network', status: res.status };
  }

  if (res.status === 401) return { ok: false, error: 'unauth', status: 401 };
  if (res.status === 403) return { ok: false, error: 'forbidden', status: 403 };
  if (!res.ok) {
    return {
      ok: false,
      error: 'escrow',
      message: typeof data.message === 'string' ? data.message : 'Escrow request failed',
      status: res.status,
      escrow: data.escrow as BookEscrowRecord | undefined,
      disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : undefined,
    };
  }

  return {
    ok: true,
    escrow: data.escrow as BookEscrowRecord | undefined,
    checks: data.checks as object | undefined,
    dispute: data.dispute as object | undefined,
    disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : undefined,
  };
}

export interface BookInflowParams {
  bucket?: string;
  allocation: string;
  task_id?: string;
  hub?: string;
  model?: string;
  intent_id?: string;
  attempt_index?: number;
}

export interface BookInflowCorrectParams {
  task_id: string;
  bucket?: string;
  allocation?: string;
  reason: string;
}

/** POST /v1/agents/:agent_id/book/inflow — signed bucket/allocation claim. */
export async function claimBookInflow(
  apiV1: string,
  auth: { agentId: number; session: string },
  params: BookInflowParams,
): Promise<
  | { ok: true; data: { agent_id: number; task_id: string; bucket: string; allocation: string } }
  | { ok: false; error: BookFetchError | 'inflow'; message?: string; status?: number }
> {
  const url = `${apiV1.replace(/\/$/, '')}/agents/${auth.agentId}/book/inflow`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XFuel-Session': auth.session,
      },
      body: JSON.stringify({
        session: auth.session,
        bucket: params.bucket || 'patron',
        allocation: params.allocation,
        task_id: params.task_id,
        hub: params.hub,
        model: params.model,
        intent_id: params.intent_id,
        attempt_index: params.attempt_index,
      }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    if (!res.ok) return { ok: false, error: 'network', status: res.status };
  }

  if (res.status === 401) return { ok: false, error: 'unauth', status: 401 };
  if (res.status === 403) return { ok: false, error: 'forbidden', status: 403 };
  if (!res.ok) {
    return {
      ok: false,
      error: 'inflow',
      message: typeof data.message === 'string' ? data.message : 'Inflow claim failed',
      status: res.status,
    };
  }

  return {
    ok: true,
    data: {
      agent_id: Number(data.agent_id),
      task_id: String(data.task_id),
      bucket: String(data.bucket),
      allocation: String(data.allocation),
    },
  };
}

/** POST /v1/agents/:agent_id/book/inflow/correct — append-only correction. */
export async function correctBookInflow(
  apiV1: string,
  auth: { agentId: number; session: string },
  params: BookInflowCorrectParams,
): Promise<
  | { ok: true; data: { agent_id: number; task_id: string; allocation: string } }
  | { ok: false; error: BookFetchError | 'inflow'; message?: string; status?: number }
> {
  const url = `${apiV1.replace(/\/$/, '')}/agents/${auth.agentId}/book/inflow/correct`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XFuel-Session': auth.session,
      },
      body: JSON.stringify({
        session: auth.session,
        task_id: params.task_id,
        bucket: params.bucket,
        allocation: params.allocation,
        reason: params.reason,
      }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    if (!res.ok) return { ok: false, error: 'network', status: res.status };
  }

  if (res.status === 401) return { ok: false, error: 'unauth', status: 401 };
  if (res.status === 403) return { ok: false, error: 'forbidden', status: 403 };
  if (!res.ok) {
    return {
      ok: false,
      error: 'inflow',
      message: typeof data.message === 'string' ? data.message : 'Inflow correction failed',
      status: res.status,
    };
  }

  return {
    ok: true,
    data: {
      agent_id: Number(data.agent_id),
      task_id: String(data.task_id),
      allocation: String(data.allocation),
    },
  };
}
