import { jest } from '@jest/globals';
import axios from 'axios';
import {
  XFuelClient,
  XFuelApiError,
  MessageType,
  ChainId,
  type TaskRequestResponse,
  type TaskStatusResponse,
  type ProofResponse,
  type A2AMessageResponse,
  type HealthResponse,
} from '../index.js';

// ── Mock axios ────────────────────────────────────────────────────────────────
jest.mock('axios');

const mockPost = jest.fn() as any;
const mockGet = jest.fn() as any;
const mockCreate: jest.Mock = jest.fn(() => ({
  post: mockPost,
  get: mockGet,
  interceptors: {
    response: { use: jest.fn() },
  },
}));
(axios as unknown as { create: jest.Mock }).create = mockCreate;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_ID = 'task_abc123';
const MESSAGE_ID = 'msg_xyz789';

const mockTaskResponse: TaskRequestResponse = {
  task_id: TASK_ID,
  status: 'pending',
  message_type: MessageType.INFERENCE_REQUEST,
  chain_id: ChainId.THETA,
  gross_amount: '1000000000000000000',
  fee_amount: '30000000000000000',
  net_amount: '970000000000000000',
  fee_bps: 300,
  fee_info: { description: '3% protocol fee', collector: '0xABC' },
  _links: {
    status: `/task-status?task_id=${TASK_ID}`,
    proof: `/prove-result?task_id=${TASK_ID}`,
  },
};

const mockStatusCompleted: TaskStatusResponse = {
  task_id: TASK_ID,
  status: 'completed',
  proof_outcome: 'valid',
  message_type: MessageType.INFERENCE_REQUEST,
  chain_id: ChainId.THETA,
  gross_amount: '1000000000000000000',
  fee_amount: '30000000000000000',
  net_amount: '970000000000000000',
  fee_bps: 300,
  result: { output: 'Hello from AI' },
  sp1_proof: {
    has_proof: true,
    nullifier: '0xdeadbeef',
    proving_time_ms: 8997,
    error: null,
  },
  created_at: 1741000000,
  updated_at: 1741000010,
};

const mockProofResponse: ProofResponse = {
  task_id: TASK_ID,
  status: 'completed',
  proof_outcome: 'valid',
  sp1_proof: {
    proof: '0xaabbcc',
    publicInputs: '0x112233',
    nullifier: '0xdeadbeef',
    provingTimeMs: 8997,
  },
  fee: {
    gross_amount: '1000000000000000000',
    fee_amount: '30000000000000000',
    net_amount: '970000000000000000',
    fee_bps: 300,
    fee_collector: '0xABC',
    revenue_split: {
      bbb_buyback_burn: '30%',
      lp_provision: '30%',
      vexf_stakers: '25%',
      treasury: '15%',
    },
  },
  result: { output: 'Hello from AI' },
  meta: {
    source_chain: ChainId.THETA,
    source_tx: '0xTX',
    block_height: 12345678,
    completed_at: 1741000010,
  },
};

const mockA2AResponse: A2AMessageResponse = {
  message_id: MESSAGE_ID,
  status: 'pending',
  message_type: MessageType.COMPUTE_BID,
  sender_chain: ChainId.THETA,
  recipient_chain: ChainId.BITTENSOR,
  payload_hash: '0xpayload',
  escrow_amount: '500000000000000000',
  relay_fee: '15000000000000000',
  relay_fee_info: '3% relay fee',
  nonce: 42,
  ttl: 3600,
  timestamp: 1741000000,
  _links: { status: `/task-status?message_id=${MESSAGE_ID}` },
};

const mockHealthResponse: HealthResponse = {
  status: 'ok',
  server: 'xfuel-bridge',
  version: '2.4.0',
  timestamp: new Date().toISOString(),
  uptime_s: 3600,
  a2a_messages_total: 100,
  ai_listener: null,
  fee_config: {
    default_bps: 300,
    min_bps: 10,
    max_bps: 1000,
    min_task_amount: '100000000000000000',
    a2a_relay_bps: 300,
    revenue_split: '30/30/25/15',
  },
  chains: ['theta', 'bittensor', 'akash'],
  message_types: ['inference_request', 'compute_bid', 'a2a_message'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient(): XFuelClient {
  return new XFuelClient({ baseUrl: 'http://localhost:3002' });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('XFuelClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates axios instance with correct baseURL', () => {
      new XFuelClient({ baseUrl: 'https://api.xfuel.app' });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://api.xfuel.app' }),
      );
    });

    it('injects X-API-Key header when apiKey is provided', () => {
      new XFuelClient({ apiKey: 'test-key-123' });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-API-Key': 'test-key-123' }),
        }),
      );
    });

    it('uses default baseURL when none provided', () => {
      new XFuelClient();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'http://localhost:3002' }),
      );
    });
  });

  // ── submitTask ────────────────────────────────────────────────────────────

  describe('submitTask', () => {
    it('POSTs to /task-request and returns response', async () => {
      mockPost.mockResolvedValueOnce({ data: mockTaskResponse });
      const client = makeClient();

      const result = await client.submitTask({
        message_type: MessageType.INFERENCE_REQUEST,
        chain_id: ChainId.THETA,
        amount: '1000000000000000000',
        sender: '0xSender',
        model_id: 'llama3',
      });

      expect(mockPost).toHaveBeenCalledWith('/task-request', expect.objectContaining({
        message_type: MessageType.INFERENCE_REQUEST,
        chain_id: ChainId.THETA,
        model_id: 'llama3',
      }));
      expect(result.task_id).toBe(TASK_ID);
      expect(result.status).toBe('pending');
    });

    it('returns fee breakdown in response', async () => {
      mockPost.mockResolvedValueOnce({ data: mockTaskResponse });
      const client = makeClient();
      const result = await client.submitTask({
        message_type: MessageType.INFERENCE_REQUEST,
        chain_id: ChainId.THETA,
        amount: '1000000000000000000',
        sender: '0xSender',
      });

      expect(result.fee_bps).toBe(300);
      expect(result.fee_amount).toBe('30000000000000000');
    });
  });

  // ── submitInference ───────────────────────────────────────────────────────

  describe('submitInference', () => {
    it('calls submitTask with INFERENCE_REQUEST message type', async () => {
      mockPost.mockResolvedValueOnce({ data: mockTaskResponse });
      const client = makeClient();

      await client.submitInference('llama3', '0xSender', '1000000000000000000');

      expect(mockPost).toHaveBeenCalledWith('/task-request', expect.objectContaining({
        message_type: MessageType.INFERENCE_REQUEST,
        model_id: 'llama3',
        sender: '0xSender',
        amount: '1000000000000000000',
      }));
    });

    it('passes optional fields through', async () => {
      mockPost.mockResolvedValueOnce({ data: mockTaskResponse });
      const client = makeClient();

      await client.submitInference('llama3', '0xSender', '1e18', {
        chain_id: ChainId.BITTENSOR,
        subnet_id: 18,
        memo: 'test-memo',
      });

      expect(mockPost).toHaveBeenCalledWith('/task-request', expect.objectContaining({
        chain_id: ChainId.BITTENSOR,
        subnet_id: 18,
        memo: 'test-memo',
      }));
    });
  });

  // ── getTaskStatus ─────────────────────────────────────────────────────────

  describe('getTaskStatus', () => {
    it('GETs /task-status with task_id param', async () => {
      mockGet.mockResolvedValueOnce({ data: mockStatusCompleted });
      const client = makeClient();

      const result = await client.getTaskStatus(TASK_ID);

      expect(mockGet).toHaveBeenCalledWith('/task-status', {
        params: { task_id: TASK_ID },
      });
      expect(result.status).toBe('completed');
      expect(result.proof_outcome).toBe('valid');
    });
  });

  // ── getProof ──────────────────────────────────────────────────────────────

  describe('getProof', () => {
    it('GETs /prove-result with task_id param', async () => {
      mockGet.mockResolvedValueOnce({ data: mockProofResponse });
      const client = makeClient();

      const result = await client.getProof(TASK_ID);

      expect(mockGet).toHaveBeenCalledWith('/prove-result', {
        params: { task_id: TASK_ID },
      });
      expect(result.sp1_proof?.nullifier).toBe('0xdeadbeef');
      expect(result.sp1_proof?.provingTimeMs).toBe(8997);
    });

    it('returns full fee breakdown in proof response', async () => {
      mockGet.mockResolvedValueOnce({ data: mockProofResponse });
      const client = makeClient();
      const result = await client.getProof(TASK_ID);

      expect(result.fee.revenue_split.bbb_buyback_burn).toBe('30%');
      expect(result.fee.revenue_split.vexf_stakers).toBe('25%');
    });
  });

  // ── sendA2AMessage ────────────────────────────────────────────────────────

  describe('sendA2AMessage', () => {
    it('POSTs to /a2a-message and returns message_id', async () => {
      mockPost.mockResolvedValueOnce({ data: mockA2AResponse });
      const client = makeClient();

      const result = await client.sendA2AMessage({
        message_type: MessageType.COMPUTE_BID,
        sender_chain: ChainId.THETA,
        recipient_chain: ChainId.BITTENSOR,
        payload_hash: '0xpayload',
        ttl: 3600,
        sender_address: '0xSender',
        sender_identity: 'agent-001',
      });

      expect(mockPost).toHaveBeenCalledWith('/a2a-message', expect.objectContaining({
        sender_chain: ChainId.THETA,
        recipient_chain: ChainId.BITTENSOR,
      }));
      expect(result.message_id).toBe(MESSAGE_ID);
      expect(result.status).toBe('pending');
    });
  });

  // ── getHealth ─────────────────────────────────────────────────────────────

  describe('getHealth', () => {
    it('GETs /health and returns status', async () => {
      mockGet.mockResolvedValueOnce({ data: mockHealthResponse });
      const client = makeClient();

      const result = await client.getHealth();

      expect(mockGet).toHaveBeenCalledWith('/health');
      expect(result.status).toBe('ok');
      expect(result.version).toBe('2.4.0');
    });
  });

  // ── waitForCompletion ─────────────────────────────────────────────────────

  describe('waitForCompletion', () => {
    it('polls until terminal status is reached', async () => {
      const pendingStatus: TaskStatusResponse = { ...mockStatusCompleted, status: 'pending', proof_outcome: 'pending' };
      mockGet
        .mockResolvedValueOnce({ data: pendingStatus })
        .mockResolvedValueOnce({ data: pendingStatus })
        .mockResolvedValueOnce({ data: mockStatusCompleted });

      const client = makeClient();
      const result = await client.waitForCompletion(TASK_ID, { intervalMs: 0 });

      expect(mockGet).toHaveBeenCalledTimes(3);
      expect(result.status).toBe('completed');
    });

    it('throws XFuelApiError after maxRetries', async () => {
      const pendingStatus: TaskStatusResponse = { ...mockStatusCompleted, status: 'pending', proof_outcome: 'pending' };
      mockGet.mockResolvedValue({ data: pendingStatus });

      const client = makeClient();
      await expect(
        client.waitForCompletion(TASK_ID, { maxRetries: 2, intervalMs: 0 }),
      ).rejects.toThrow(XFuelApiError);
    });

    it('invokes onPoll callback on each poll', async () => {
      const pendingStatus: TaskStatusResponse = { ...mockStatusCompleted, status: 'pending', proof_outcome: 'pending' };
      mockGet
        .mockResolvedValueOnce({ data: pendingStatus })
        .mockResolvedValueOnce({ data: mockStatusCompleted });

      const onPoll = jest.fn();
      const client = makeClient();
      await client.waitForCompletion(TASK_ID, { intervalMs: 0, onPoll });

      expect(onPoll).toHaveBeenCalledTimes(2);
      expect(onPoll).toHaveBeenNthCalledWith(1, pendingStatus, 1);
      expect(onPoll).toHaveBeenNthCalledWith(2, mockStatusCompleted, 2);
    });
  });

  // ── XFuelApiError ─────────────────────────────────────────────────────────

  describe('XFuelApiError', () => {
    it('has correct name and properties', () => {
      const err = new XFuelApiError('rate limited', 429, 'rate_limit', ['try again']);
      expect(err.name).toBe('XFuelApiError');
      expect(err.status).toBe(429);
      expect(err.code).toBe('rate_limit');
      expect(err.details).toEqual(['try again']);
      expect(err.message).toBe('rate limited');
    });

    it('is instanceof Error', () => {
      const err = new XFuelApiError('test', 500, 'internal_error');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
