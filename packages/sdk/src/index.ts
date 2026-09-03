import axios, {
  AxiosInstance,
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import {
  type X402Payer,
  type X402Challenge,
  selectAccept,
} from './x402.js';

export {
  type X402Accept,
  type X402Challenge,
  type X402ResourceInfo,
  type X402PaymentAuthorization,
  type X402Payer,
  selectAccept,
  acceptAmount,
  challengeResourceUrl,
  createMockPayer,
  createSignerPayer,
} from './x402.js';
export {
  canonicalReceiptPayload,
  verifyReceiptSignature,
  verifyReceiptEcdsa,
  verifyReceiptEcdsaWithJwks,
  type ReceiptSignatureCheck,
  type ReceiptEcdsaCheck,
  type Es256Jwk,
  type Jwks,
} from './receipt.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const MessageType = {
  COMPUTE_BID: 'compute_bid',
  COMPUTE_RESULT: 'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY: 'capability_query',
  DATA_ATTESTATION: 'data_attestation',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const ChainId = {
  BASE: 'base',
  THETA: 'theta', // legacy / EdgeCloud provider hint — not settlement home (ADR 0002)
  OSMOSIS: 'osmosis',
  AKASH: 'akash',
  BITTENSOR: 'bittensor',
  PERSISTENCE: 'persistence',
} as const;

export type ChainId = (typeof ChainId)[keyof typeof ChainId];

/**
 * Default endpoint the SDK talks to when no `baseUrl` is given: XFuel's hosted
 * public-beta API. `https://api-testnet.xfuel.app` is a permanent alias of the
 * same box. Point at your own deployment (or `http://localhost:3002`) for local.
 */
export const DEFAULT_BASE_URL = 'https://api.xfuel.app';

/**
 * Shared PUBLIC demo key used against {@link DEFAULT_BASE_URL} when no `apiKey`
 * is provided. It is heavily rate-limited per IP — bring your own key
 * (`X-API-Key`) for higher limits and production use.
 */
export const PUBLIC_DEMO_API_KEY = 'xfuel-demo';

// ─── Request Types ──────────────────────────────────────────────────────────

/**
 * Payment rail selector. USDC via x402 is the default/recommended rail; TFUEL on
 * Theta is the secondary rail. When `rail: 'usdc'`, settlement uses the x402
 * handshake (402 challenge → agent-side payer signs X-PAYMENT → verify+settle).
 * The payer is agent-side and pluggable — the SDK never holds keys.
 */
/**
 * x402 settlement networks. Prefer feeding `quote.rails.usdc.network` straight
 * into `payment.network` so a client follows whatever the gateway is settling on.
 */
export type X402Network = 'base' | 'base-sepolia' | 'solana';

export interface PaymentParams {
  rail: 'usdc' | 'tfuel';
  /** usdc rail: asset symbol (default USDC). */
  asset?: string;
  /** usdc rail: settlement network (default base; demo often base-sepolia). */
  network?: X402Network;
  /** Max amount in smallest unit (USDC 6dp; TFUEL wei). */
  maxAmount?: string;
}

/** A tool call the model asked for, in OpenAI's shape. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | string;
  content: string | null;
  /** Present on an assistant turn that called tools. */
  tool_calls?: ToolCall[];
  /** Required on a `role: 'tool'` turn — the id of the call being answered. */
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface TaskRequestParams {
  message_type: MessageType;
  chain_id: ChainId;
  amount: string;
  sender: string;
  fee_bps?: number;
  model_id?: string;
  /**
   * Raw prompt for live DePIN routing (M2M full router). Without this (or
   * `messages`), the gateway can only settle on an input_hash / mock path —
   * EdgeCloud will not be called.
   */
  input?: string;
  /**
   * Chat-shaped input alternative to `input` for full-router inference.
   *
   * `content` may be null on an assistant turn that carries `tool_calls`, and a
   * `role: 'tool'` turn carries the result — both are required to represent a
   * multi-turn agent loop.
   */
  messages?: ChatMessage[];
  /**
   * OpenAI tool definitions, forwarded to the hub unchanged. Tool calls come back
   * on `result.tool_calls`.
   *
   * Asking for tools also changes how `xfuel/auto` resolves: a tool-carrying
   * request is agent work and routes to a model that completes multi-turn loops.
   * Hubs that cannot serve tools reject the task with `tools_unsupported_on_hub`
   * rather than answering with prose.
   */
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /**
   * Output budget. This is metered into the x402 quote, so it is also what you
   * are charged for. Default 500.
   */
  max_tokens?: number;
  temperature?: number;
  input_hash?: string;
  output_hash?: string;
  theta_recipient?: string;
  max_gpu_hours?: string;
  subnet_id?: number;
  ibc_channel?: string;
  memo?: string;
  proof_system?: 'sp1' | 'zkgpt';
  /** Optional per-task webhook; receives a signed TaskSettled event on completion. */
  callback_url?: string;
  /** Optional HMAC secret for this task's callback (else server WEBHOOK_SECRET). */
  callback_secret?: string;
  /** Prior task in a multi-hop / A2A receipt chain. */
  parent_task_id?: string;
  /** Link this task to an A2A message id. */
  a2a_message_id?: string;
  /** Free-form swarm / partner session correlation. */
  correlation_id?: string;
  /** Payment rail (default USDC via x402; TFUEL secondary). Server-side handshake is flag-gated (Phase 1). */
  payment?: PaymentParams;
}

export interface A2AMessageParams {
  message_type: MessageType;
  sender_chain: ChainId;
  recipient_chain: ChainId;
  payload_hash: string;
  escrow_amount?: string;
  ttl: number;
  sender_address: string;
  sender_identity: string;
  recipient_address?: string;
  ibc_channel?: string;
  /** Prior inference task to link in the receipt chain. */
  parent_task_id?: string;
  correlation_id?: string;
}

// ─── Response Types ─────────────────────────────────────────────────────────

export interface TaskRequestResponse {
  task_id: string;
  status: string;
  message_type: string;
  chain_id: string;
  gross_amount: string;
  fee_amount: string;
  net_amount: string;
  fee_bps: number;
  /** Resolved payment rail: 'usdc' (x402) | 'tfuel'. */
  payment_rail?: 'usdc' | 'tfuel';
  /** x402 settlement reference (network:txRef) or null for TFUEL. */
  payment_ref?: string | null;
  /**
   * Canonical shareable proof link — the public `/receipt/:taskId` page (no auth).
   * Absolute when the server knows its public base URL. Falls back client-side via
   * {@link XFuelClient.receiptUrl} if an older server omits it.
   */
  verify_url?: string;
  fee_info: {
    description: string;
    collector: string;
  };
  _links: {
    status: string;
    proof: string;
    /** Public, no-auth receipt page (same value as {@link verify_url}). */
    receipt?: string;
  };
}

/**
 * Phase 2 (flag-gated) x402 payment binding: a deterministic commitment that binds
 * the settlement `payment_ref` to the task. `in_proof` is true once the SP1 guest
 * commits the v2 public-values layout (until then it's server-attested metadata).
 */
export interface PaymentBinding {
  version: number;
  rail: 'usdc';
  commitment: string;
  payment_ref_hash: string;
  amount: string;
  in_proof: boolean;
}

export interface TaskQuoteParams {
  model_id?: string;
  /** TFUEL task value in wei (echoed back in the tfuel rail). */
  amount?: string;
  /** Same fields as the request you intend to submit — `/task-quote` is a forecast, not the invoice. */
  messages?: ChatMessage[];
  max_tokens?: number;
  tools?: ToolDefinition[];
  proof_tier?: string;
}

export interface TaskQuoteResponse {
  recommended: string;
  default_rail: 'usdc' | 'tfuel';
  settlement_home?: string;
  rails: {
    usdc: {
      rail?: 'usdc';
      enabled?: boolean;
      asset: string;
      network: X402Network;
      decimals?: number;
      amount: string;
      pay_to: string | null;
      note?: string;
      pricing?: {
        basis?: string;
        floor_applied?: boolean;
        prompt_tokens?: number;
        provider_cogs?: string;
        platform_fee?: string;
        fee_bps?: number;
      };
    };
    tfuel: {
      rail?: 'tfuel';
      legacy?: boolean;
      amount: string | null;
      note?: string;
    };
  };
}

export interface TaskStatusResponse {
  task_id: string;
  status: string;
  proof_outcome: 'pending' | 'valid' | 'regenerable' | 'invalid';
  message_type: string;
  chain_id: string;
  gross_amount: string;
  fee_amount: string;
  net_amount: string;
  fee_bps: number;
  /** Resolved payment rail: 'usdc' (x402, default) | 'tfuel' (legacy secondary). */
  payment_rail?: 'usdc' | 'tfuel';
  /** x402 settlement reference (network:txRef), or null when unpaid / legacy TFUEL. */
  payment_ref?: string | null;
  /** Canonical shareable proof link — the public `/receipt/:taskId` page (no auth). */
  verify_url?: string;
  /** Phase 2 (flag-gated): x402 payment commitment bound into the proof, or null. */
  payment_binding?: PaymentBinding | null;
  result: TaskResult | null;
  /**
   * Why the task failed. A task no provider could serve fails rather than
   * returning a synthetic answer, so this is the field to branch on.
   */
  error?: TaskError | null;
  sp1_proof: {
    has_proof: boolean;
    nullifier: string | null;
    proving_time_ms: number | null;
    error: string | null;
  } | null;
  created_at: number;
  updated_at: number;
}

export interface TaskResult {
  content?: string;
  /** Present when the model called a tool — feed these back as the next turn. */
  tool_calls?: ToolCall[] | null;
  finish_reason?: string | null;
  /** Catalog id of the model that actually served, e.g. `akash/zai-org/GLM-5.2`. */
  model?: string;
  provider?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  [key: string]: unknown;
}

export interface TaskError {
  /**
   * `model_not_found` · `tools_unsupported_on_hub` · `no_provider_available`
   * are the ones worth handling; treat unknown codes as retryable.
   */
  code: string;
  message: string;
  hint?: string;
}

export interface ProofResponse {
  task_id: string;
  status: string;
  proof_outcome: 'pending' | 'valid' | 'regenerable' | 'invalid';
  /** Canonical shareable proof link — the public `/receipt/:taskId` page (no auth). */
  verify_url?: string;
  /** Phase 2 (flag-gated): x402 payment commitment bound into the proof, or null. */
  payment_binding?: PaymentBinding | null;
  sp1_proof: {
    proof: string;
    publicInputs: string;
    nullifier: string;
    provingTimeMs: number;
  } | null;
  fee: {
    gross_amount: string;
    fee_amount: string;
    net_amount: string;
    fee_bps: number;
    fee_collector: string;
    /** Token-light describeSplit() payload from the gateway (ADR 0001). */
    revenue_split: RevenueSplitDescription;
  };
  result: unknown | null;
  meta: {
    source_chain: string;
    source_tx: string;
    block_height: number;
    completed_at: number;
  };
}

export interface A2AMessageResponse {
  message_id: string;
  status: string;
  message_type: string;
  sender_chain: string;
  recipient_chain: string;
  payload_hash: string;
  escrow_amount: string;
  relay_fee: string;
  relay_fee_info: string;
  nonce: number;
  ttl: number;
  timestamp: number;
  _links: { status: string };
}

export interface A2AStatusResponse {
  message_id: string;
  status: string;
  proof_outcome: 'pending' | 'valid';
  message_type: string;
  sender_chain: string;
  recipient_chain: string;
  payload_hash: string;
  escrow_amount: string;
  relay_fee: string;
  nonce: number;
  ttl: number;
  timestamp: number;
  sp1_proof: unknown | null;
}

/** Phase 1 Fair Exchange: params for POST /a2a-settle-fair-exchange */
export interface A2ASettleFairExchangeParams {
  bid_id: string;
  result_hash: string;
  v: number;
  r: string;
  s: string;
}

/** Phase 1 Fair Exchange: response (submitted or calldata) */
export interface A2ASettleFairExchangeResponse {
  status: 'submitted' | 'calldata';
  tx_hash?: string;
  contract?: string;
  calldata?: string;
  bid_id: string;
  result_hash: string;
  confirmed?: boolean;
  message?: string;
  _links?: { status: string };
}

/** Token-light describeSplit() payload from the gateway (ADR 0001). */
export interface RevenueSplitDescription {
  model: string;
  note?: string;
  totalBps?: number;
  buckets: Array<{ key: string; label: string; bps: number; pct: number; address?: string | null }>;
}

export interface HealthResponse {
  status: string;
  server?: string;
  version?: string;
  timestamp?: string;
  uptime_s?: number;
  a2a_messages_total?: number;
  ai_listener?: unknown | null;
  free_tier?: {
    enforced?: boolean;
    daily_limit_usd?: string;
  };
  demo?: {
    rate_per_min?: number;
  };
  rolling_settlement?: {
    enabled?: boolean;
    unsettled_usd?: string;
  };
  proofs?: {
    signed_receipts?: string;
    settlement_proof?: string;
    prover_configured?: boolean;
    prover_reachable?: boolean | null;
    note?: string;
  };
  provider_floats?: unknown;
  fee_config?: {
    default_bps?: number;
    min_bps?: number;
    max_bps?: number;
    min_task_amount?: string;
    a2a_relay_bps?: number;
    revenue_split?: RevenueSplitDescription;
  };
  chains?: string[];
  message_types?: string[];
}

/** Public receipt JSON (`GET /receipt/:taskId?format=json`). */
export interface Receipt {
  schema?: string;
  task_id: string;
  status?: string;
  proof_outcome?: string;
  verify_url?: string;
  payment?: {
    rail?: string;
    ref?: string | null;
    gross_amount?: string;
    net_amount?: string;
    fee_amount?: string;
    collected?: boolean;
    collects_on?: string;
  };
  output?: { hash?: string | null; kind?: string };
  signature?: { alg?: string; value?: string; payload_version?: number };
  [key: string]: unknown;
}

/** Buyer-scoped `GET /stats/me`. Shared demo key = shared public identity. */
export interface BuyerStats {
  scope?: string;
  tasks?: { total?: number; settled?: number };
  private_spend?: { enabled?: boolean; trust?: string };
  north_star?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  object?: string;
  created?: number;
  model: string;
  choices: Array<{
    index?: number;
    message: ChatMessage;
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  xfuel?: Receipt;
}

/** One entry of the OpenAI-compatible `GET /v1/models` list. */
export interface ModelObject {
  id: string;
  object: 'model';
  created?: number;
  owned_by?: string;
}

/** Response of `GET /v1/models` (OpenAI-compatible model list). */
export interface ModelsResponse {
  object: 'list';
  data: ModelObject[];
}

// ─── Error Types ────────────────────────────────────────────────────────────

export class XFuelApiError extends Error {
  readonly challenge?: X402Challenge;
  readonly body?: unknown;

  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: string[],
    extras?: { challenge?: X402Challenge; body?: unknown },
  ) {
    super(message);
    this.name = 'XFuelApiError';
    this.challenge = extras?.challenge;
    this.body = extras?.body;
  }
}

// ─── Client Options ─────────────────────────────────────────────────────────

export interface XFuelClientOptions {
  /** API base URL. Defaults to {@link DEFAULT_BASE_URL} (hosted public beta). */
  baseUrl?: string;
  /** API key (sent as `X-API-Key`). Defaults to {@link PUBLIC_DEMO_API_KEY}. */
  apiKey?: string;
  /** Max automatic retries on 429 / 5xx (default: 3) */
  maxRetries?: number;
  /** Base delay in ms before first retry (default: 1000) */
  retryBaseMs?: number;
  /** Axios request timeout in ms (default: 30 000) */
  timeoutMs?: number;
}

export interface WaitOptions {
  /** Polling interval in ms (default: 5000) */
  intervalMs?: number;
  /** Max polling attempts before giving up (default: 60) */
  maxRetries?: number;
  /** Optional callback invoked after each poll */
  onPoll?: (status: TaskStatusResponse, attempt: number) => void;
}

// ─── Terminal statuses (task is settled once it reaches one of these) ────────

const TERMINAL_STATUSES = new Set([
  'completed',
  'fee_collected',
  'failed',
]);

// ─── Client ─────────────────────────────────────────────────────────────────

export class XFuelClient {
  private readonly http: AxiosInstance;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  /** Resolved API base URL (used to build client-side receipt/verify links). */
  readonly baseUrl: string;

  constructor(options: XFuelClientOptions = {}) {
    const {
      baseUrl = DEFAULT_BASE_URL,
      apiKey = PUBLIC_DEMO_API_KEY,
      maxRetries = 3,
      retryBaseMs = 1000,
      timeoutMs = 30_000,
    } = options;

    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this.baseUrl = baseUrl.replace(/\/$/, '');

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
    });

    this.http.interceptors.response.use(undefined, (err: AxiosError) =>
      this.handleResponseError(err),
    );
  }

  // ── Retry interceptor ──────────────────────────────────────────────────

  private async handleResponseError(error: AxiosError): Promise<unknown> {
    const config = error.config as InternalAxiosRequestConfig & {
      _retryCount?: number;
    };
    if (!config) return Promise.reject(error);

    const status = error.response?.status;
    const retryable = status === 429 || (status !== undefined && status >= 500);
    config._retryCount = config._retryCount ?? 0;

    if (retryable && config._retryCount < this.maxRetries) {
      config._retryCount += 1;

      let delayMs: number;
      if (status === 429) {
        const retryAfter = error.response?.headers?.['retry-after'];
        delayMs = retryAfter
          ? Number(retryAfter) * 1000
          : this.retryBaseMs * 2 ** (config._retryCount - 1);
      } else {
        delayMs = this.retryBaseMs * 2 ** (config._retryCount - 1);
      }

      await sleep(delayMs);
      return this.http.request(config);
    }

    return Promise.reject(this.normalizeError(error));
  }

  private normalizeError(error: AxiosError): XFuelApiError {
    const data = error.response?.data as
      | {
          error?: string;
          message?: string;
          details?: string[];
          accepts?: unknown;
          x402Version?: number;
        }
      | undefined;

    const details = Array.isArray(data?.details) ? data.details : undefined;
    const detailSuffix =
      details && details.length > 0 ? `: ${details.join('; ')}` : '';
    const message =
      (data?.message ?? data?.error ?? error.message) + detailSuffix;

    const challenge =
      data && Array.isArray(data.accepts) && data.accepts.length > 0
        ? (data as X402Challenge)
        : undefined;

    return new XFuelApiError(
      message,
      error.response?.status ?? 0,
      data?.error ?? 'network_error',
      details,
      { challenge, body: data },
    );
  }

  // ── POST /task-request ─────────────────────────────────────────────────

  async submitTask(params: TaskRequestParams): Promise<TaskRequestResponse> {
    const { data } = await this.http.post<TaskRequestResponse>(
      '/task-request',
      params,
    );
    return data;
  }

  // ── POST /task-request with USDC/x402 payment handshake ─────────────────

  /**
   * Submit a task and, if the server replies **402** (USDC/x402), complete the
   * payment handshake with `payer` and retry — returning the accepted task.
   *
   * If the server settles via the TFUEL fallback (x402 flag off, or x402 failure
   * with fallback enabled), it returns 202 directly and `payer` is never called.
   * The payer is agent-side and signs the payment; the SDK never holds keys.
   *
   * @param params  task request (typically `payment: { rail: 'usdc' }`)
   * @param payer   an X402Payer. `createMockPayer()` is local-mock only; hosted Coinbase x402 rejects it.
   * @see docs/payments-x402.md
   */
  async submitTaskWithPayment(
    params: TaskRequestParams,
    payer: X402Payer,
  ): Promise<TaskRequestResponse> {
    if (typeof payer !== 'function') {
      throw new XFuelApiError('submitTaskWithPayment requires a payer function', 0, 'bad_payer');
    }
    const acceptStatus = (s: number) => s === 402 || (s >= 200 && s < 300);

    // Step 1 — submit; accept a 402 challenge without throwing.
    const first = await this.http.post<TaskRequestResponse | X402Challenge>(
      '/task-request',
      params,
      { validateStatus: acceptStatus },
    );
    if (first.status !== 402) return first.data as TaskRequestResponse;

    // Step 2 — pay the challenge (agent-side) and retry with X-PAYMENT.
    const challenge = first.data as X402Challenge;
    const auth = await payer(challenge);
    const nonce = auth.nonce ?? selectAccept(challenge).extra?.nonce;
    const headers: Record<string, string> = { 'X-PAYMENT': auth.header };
    if (nonce) headers['X-PAYMENT-NONCE'] = nonce;

    const second = await this.http.post<TaskRequestResponse & { reason?: string; error?: string }>(
      '/task-request',
      params,
      { headers, validateStatus: acceptStatus },
    );
    if (second.status === 402) {
      const body = second.data as { reason?: string; error?: string; accepts?: unknown };
      // Failed verify/settle returns { error, reason }; a raw re-challenge has accepts[].
      const why = body?.reason
        || (Array.isArray(body?.accepts) ? 'rechallenge_without_reason' : undefined)
        || body?.error
        || 'unknown';
      throw new XFuelApiError(
        `x402 payment was rejected or re-challenged after retry (${why})`,
        402,
        'payment_rejected',
        [why],
      );
    }
    return second.data;
  }

  // ── POST /task-quote ───────────────────────────────────────────────────

  /** Preview per-rail pricing (USDC via x402 / TFUEL) without creating a task. */
  async quoteTask(params: TaskQuoteParams = {}): Promise<TaskQuoteResponse> {
    const { data } = await this.http.post<TaskQuoteResponse>(
      '/task-quote',
      {
        model_id: params.model_id,
        amount: params.amount,
        messages: params.messages,
        max_tokens: params.max_tokens,
        tools: params.tools,
        proof_tier: params.proof_tier,
      },
    );
    return data;
  }

  // ── Convenience: inference shorthand ───────────────────────────────────

  async submitInference(
    modelId: string,
    sender: string,
    amount: string,
    opts: {
      chain_id?: ChainId;
      /** Raw prompt — required for live EdgeCloud / DePIN routing. */
      input?: string;
      messages?: ChatMessage[];
      /** Tool definitions for an agent loop. See {@link TaskRequestParams.tools}. */
      tools?: ToolDefinition[];
      tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
      /** Output budget — metered into the quote, so also what you pay for. */
      max_tokens?: number;
      temperature?: number;
      input_hash?: string;
      fee_bps?: number;
      theta_recipient?: string;
      max_gpu_hours?: string;
      subnet_id?: number;
      memo?: string;
      proof_system?: 'sp1' | 'zkgpt';
      /** Raise assurance: `settlement` requests an on-chain SP1 proof (+$0.08). */
      proof_tier?: string;
      callback_url?: string;
      callback_secret?: string;
      parent_task_id?: string;
      a2a_message_id?: string;
      correlation_id?: string;
      payment?: PaymentParams;
      /** Agent-side x402 payer. When provided, the USDC 402 handshake is run automatically. */
      payer?: X402Payer;
    } = {},
  ): Promise<TaskRequestResponse> {
    const { payer, payment, ...taskOpts } = opts;
    const params: TaskRequestParams = {
      message_type: MessageType.INFERENCE_REQUEST,
      chain_id: opts.chain_id ?? ChainId.BASE,
      amount,
      sender,
      model_id: modelId,
      // Default rail = USDC/x402 (ADR 0002). Pass payment.rail: 'tfuel' only for legacy Theta flows.
      payment: payment ?? { rail: 'usdc' },
      ...taskOpts,
    };
    return payer ? this.submitTaskWithPayment(params, payer) : this.submitTask(params);
  }

  // ── Shareable receipt / verify link ─────────────────────────────────────

  /**
   * The public, no-auth receipt URL for a task — one shareable link that renders
   * the settlement, proof status, and (for USDC tasks) an independent payment-binding
   * check. Prefer the `verify_url` returned by the API; use this to construct the
   * same link client-side (e.g. before the server responds, or against an older
   * server that doesn't yet echo `verify_url`).
   */
  receiptUrl(taskId: string): string {
    return `${this.baseUrl}/receipt/${taskId}`;
  }

  /**
   * Fetch the public receipt JSON (`GET /receipt/:taskId?format=json`) — no auth.
   * Third parties can recompute payment binding from this payload without trusting
   * the HTML page. Prefer this over scraping the shareable UI.
   */
  async getReceipt(taskId: string): Promise<Receipt> {
    const { data } = await this.http.get<Receipt>(
      `/receipt/${encodeURIComponent(taskId)}`,
      { params: { format: 'json' } },
    );
    return data;
  }

  /**
   * Auditor selective-disclosure export (`GET /receipt/:id?format=auditor`).
   * Policy + totals + binding — no prompts or raw outputs.
   */
  async getAuditorExport(taskId: string): Promise<Record<string, unknown>> {
    const { data } = await this.http.get<Record<string, unknown>>(
      `/receipt/${encodeURIComponent(taskId)}`,
      { params: { format: 'auditor' } },
    );
    return data;
  }

  /**
   * Buyer-only usage stats (`GET /stats/me`) — requires the same API key used on tasks.
   * Returns Private Spend scope when enabled on the gateway.
   */
  async getMyStats(): Promise<BuyerStats> {
    const { data } = await this.http.get<BuyerStats>('/stats/me');
    return data;
  }

  // ── GET /task-status?task_id= ──────────────────────────────────────────

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const { data } = await this.http.get<TaskStatusResponse>('/task-status', {
      params: { task_id: taskId },
    });
    return data;
  }

  // ── GET /prove-result?task_id= ─────────────────────────────────────────

  async getProof(taskId: string): Promise<ProofResponse> {
    const { data } = await this.http.get<ProofResponse>('/prove-result', {
      params: { task_id: taskId },
    });
    return data;
  }

  // ── POST /a2a-message ──────────────────────────────────────────────────

  async sendA2AMessage(
    params: A2AMessageParams,
  ): Promise<A2AMessageResponse> {
    const { data } = await this.http.post<A2AMessageResponse>(
      '/a2a-message',
      params,
    );
    return data;
  }

  // ── GET /task-status?message_id= ───────────────────────────────────────

  async getA2AStatus(messageId: string): Promise<A2AStatusResponse> {
    const { data } = await this.http.get<A2AStatusResponse>('/task-status', {
      params: { message_id: messageId },
    });
    return data;
  }

  /**
   * Phase 1 Fair Exchange: settle an A2A bid via PAS signature.
   * Calls POST /a2a-settle-fair-exchange. If the server has a relayer configured,
   * returns with status 'submitted' and tx_hash; otherwise returns 'calldata' for
   * the client to submit to A2ACircuit.
   */
  async settleWithFairExchange(
    params: A2ASettleFairExchangeParams,
  ): Promise<A2ASettleFairExchangeResponse> {
    const { data } = await this.http.post<A2ASettleFairExchangeResponse>(
      '/a2a-settle-fair-exchange',
      params,
    );
    return data;
  }

  // ── GET /health ────────────────────────────────────────────────────────

  async getHealth(): Promise<HealthResponse> {
    const { data } = await this.http.get<HealthResponse>('/health');
    return data;
  }

  // ── GET /v1/models ─────────────────────────────────────────────────────

  /**
   * List the models routable through XFuel (OpenAI-compatible `GET /v1/models`).
   * Handy for discovery before {@link submitInference} — use a returned `id` as
   * the `model`.
   */
  async listModels(): Promise<ModelsResponse> {
    const { data } = await this.http.get<ModelsResponse>('/v1/models');
    return data;
  }

  /**
   * Free OpenAI-compatible submit (`POST /v1/chat/completions`). This is the
   * first-hour path: signed receipt, no wallet. Paid USDC is `submitInference`.
   */
  async chatCompletions(body: {
    model?: string;
    messages: ChatMessage[];
    max_tokens?: number;
    temperature?: number;
    tools?: ToolDefinition[];
    tool_choice?: TaskRequestParams['tool_choice'];
    proof_tier?: string;
  }): Promise<ChatCompletionResponse> {
    const { data } = await this.http.post<ChatCompletionResponse>(
      '/v1/chat/completions',
      body,
    );
    return data;
  }

  // ── Polling helper ─────────────────────────────────────────────────────

  async waitForCompletion(
    taskId: string,
    opts: WaitOptions = {},
  ): Promise<TaskStatusResponse> {
    const {
      intervalMs = 5000,
      maxRetries = 60,
      onPoll,
    } = opts;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const status = await this.getTaskStatus(taskId);

      if (onPoll) onPoll(status, attempt);

      if (TERMINAL_STATUSES.has(status.status)) {
        return status;
      }

      if (attempt < maxRetries) {
        await sleep(intervalMs);
      }
    }

    throw new XFuelApiError(
      `Task ${taskId} did not complete within ${maxRetries} polling attempts`,
      0,
      'polling_timeout',
    );
  }

  /**
   * Alias for {@link waitForCompletion}. Kept for parity with the docs/AGENTS.md
   * quick-start (`client.waitForSettlement(taskId)`); a task is "settled" once it
   * reaches a terminal status.
   */
  async waitForSettlement(
    taskId: string,
    opts: WaitOptions = {},
  ): Promise<TaskStatusResponse> {
    return this.waitForCompletion(taskId, opts);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Default export ─────────────────────────────────────────────────────────

export default XFuelClient;
