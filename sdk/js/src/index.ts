import axios, {
  AxiosInstance,
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';

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
  THETA: 'theta',
  OSMOSIS: 'osmosis',
  AKASH: 'akash',
  BITTENSOR: 'bittensor',
  PERSISTENCE: 'persistence',
} as const;

export type ChainId = (typeof ChainId)[keyof typeof ChainId];

// ─── Request Types ──────────────────────────────────────────────────────────

export interface TaskRequestParams {
  message_type: MessageType;
  chain_id: ChainId;
  amount: string;
  sender: string;
  fee_bps?: number;
  model_id?: string;
  input_hash?: string;
  output_hash?: string;
  theta_recipient?: string;
  max_gpu_hours?: string;
  subnet_id?: number;
  ibc_channel?: string;
  memo?: string;
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
  fee_info: {
    description: string;
    collector: string;
  };
  _links: {
    status: string;
    proof: string;
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
  result: unknown | null;
  sp1_proof: {
    has_proof: boolean;
    nullifier: string | null;
    proving_time_ms: number | null;
    error: string | null;
  } | null;
  created_at: number;
  updated_at: number;
}

export interface ProofResponse {
  task_id: string;
  status: string;
  proof_outcome: 'valid' | 'regenerable';
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
    revenue_split: {
      bbb_buyback_burn: string;
      lp_provision: string;
      vexf_stakers: string;
      treasury: string;
    };
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

export interface HealthResponse {
  status: string;
  server: string;
  version: string;
  timestamp: string;
  uptime_s: number;
  a2a_messages_total: number;
  ai_listener: unknown | null;
  fee_config: {
    default_bps: number;
    min_bps: number;
    max_bps: number;
    min_task_amount: string;
    a2a_relay_bps: number;
    revenue_split: string;
  };
  chains: string[];
  message_types: string[];
}

// ─── Error Types ────────────────────────────────────────────────────────────

export class XFuelApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'XFuelApiError';
  }
}

// ─── Client Options ─────────────────────────────────────────────────────────

export interface XFuelClientOptions {
  baseUrl?: string;
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

  constructor(options: XFuelClientOptions = {}) {
    const {
      baseUrl = 'http://localhost:3002',
      apiKey,
      maxRetries = 3,
      retryBaseMs = 1000,
      timeoutMs = 30_000,
    } = options;

    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;

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
      | { error?: string; message?: string; details?: string[] }
      | undefined;

    return new XFuelApiError(
      data?.message ?? error.message,
      error.response?.status ?? 0,
      data?.error ?? 'network_error',
      data?.details,
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

  // ── Convenience: inference shorthand ───────────────────────────────────

  async submitInference(
    modelId: string,
    sender: string,
    amount: string,
    opts: {
      chain_id?: ChainId;
      input_hash?: string;
      fee_bps?: number;
      theta_recipient?: string;
      max_gpu_hours?: string;
      subnet_id?: number;
      memo?: string;
    } = {},
  ): Promise<TaskRequestResponse> {
    return this.submitTask({
      message_type: MessageType.INFERENCE_REQUEST,
      chain_id: opts.chain_id ?? ChainId.AKASH,
      amount,
      sender,
      model_id: modelId,
      ...opts,
    });
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
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Default export ─────────────────────────────────────────────────────────

export default XFuelClient;
