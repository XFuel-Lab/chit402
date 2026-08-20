import { jest } from '@jest/globals';
import axios from 'axios';
import {
  XFuelClient,
  XFuelApiError,
  MessageType,
  ChainId,
  createMockPayer,
  createSignerPayer,
  selectAccept,
  verifyReceiptSignature,
  type TaskRequestResponse,
  type TaskStatusResponse,
  type ProofResponse,
  type A2AMessageResponse,
  type HealthResponse,
  type X402Challenge,
} from '../index.js';

// ── Mock axios ────────────────────────────────────────────────────────────────
jest.mock('axios');

const mockPost = jest.fn() as any;
const mockGet = jest.fn() as any;
let responseRejected: ((err: unknown) => Promise<unknown>) | undefined;
const mockCreate: jest.Mock = jest.fn(() => ({
  post: mockPost,
  get: mockGet,
  interceptors: {
    response: {
      use: jest.fn((_ok: unknown, rej: (err: unknown) => Promise<unknown>) => {
        responseRejected = rej;
      }),
    },
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
      model: 'usdc-base-splits-v2',
      note: 'Token-light: fee lands at one Splits v2 address on Base; buckets fan out off the hot path.',
      totalBps: 10000,
      buckets: [
        { key: 'treasury', label: 'Treasury / Ops', bps: 4000, pct: 40, address: null },
        { key: 'buyback', label: 'XF Buyback-Burn (Base, post-TGE)', bps: 3500, pct: 35, address: null },
        { key: 'stakers', label: 'veXF Stakers (optional USDC yield)', bps: 2500, pct: 25, address: null },
      ],
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
    revenue_split: {
      model: 'usdc-base-splits-v2',
      note: 'Token-light: fee lands at one Splits v2 address on Base; buckets fan out off the hot path.',
      totalBps: 10000,
      buckets: [
        { key: 'treasury', label: 'Treasury / Ops', bps: 4000, pct: 40, address: null },
        { key: 'buyback', label: 'XF Buyback-Burn (Base, post-TGE)', bps: 3500, pct: 35, address: null },
        { key: 'stakers', label: 'veXF Stakers (optional USDC yield)', bps: 2500, pct: 25, address: null },
      ],
    },
  },
  chains: ['base', 'theta', 'bittensor', 'akash'],
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

    it('uses default baseURL (hosted public beta) + public demo key when none provided', () => {
      new XFuelClient();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.xfuel.app',
          headers: expect.objectContaining({ 'X-API-Key': 'xfuel-demo' }),
        }),
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
        // defaults to Base + USDC (money + proof home — ADR 0002) when omitted
        chain_id: ChainId.BASE,
        payment: { rail: 'usdc' },
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

  describe('quoteTask', () => {
    it('POSTs /task-quote with the request shape the gateway actually prices', async () => {
      mockPost.mockResolvedValueOnce({
        data: { recommended: 'usdc', default_rail: 'usdc', rails: { usdc: { amount: '103400' } } },
      });
      const client = makeClient();
      const messages = [{ role: 'user' as const, content: 'hi' }];
      const tools = [{ type: 'function' as const, function: { name: 'search', parameters: { type: 'object' } } }];

      await client.quoteTask({
        model_id: 'akash/zai-org/GLM-5.2',
        amount: '10000',
        messages,
        max_tokens: 500,
        tools,
        proof_tier: 'settlement',
      });

      expect(mockPost).toHaveBeenCalledWith('/task-quote', {
        model_id: 'akash/zai-org/GLM-5.2',
        amount: '10000',
        messages,
        max_tokens: 500,
        tools,
        proof_tier: 'settlement',
      });
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

      expect(result.fee.revenue_split.model).toBe('usdc-base-splits-v2');
      expect(result.fee.revenue_split.buckets.map((b) => b.key)).toEqual(['treasury', 'buyback', 'stakers']);
      expect(result.fee.revenue_split.buckets.reduce((s, b) => s + b.bps, 0)).toBe(10000);
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

  // ── listModels ──────────────────────────────────────────────────────────

  describe('listModels', () => {
    it('GETs /v1/models and returns the OpenAI-shaped model list', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          object: 'list',
          data: [
            { id: 'llama-3-70b', object: 'model', created: 1_700_000_000, owned_by: 'xfuel' },
            { id: 'xfuel-auto', object: 'model', created: 1_700_000_000, owned_by: 'xfuel' },
          ],
        },
      });
      const client = makeClient();

      const result = await client.listModels();

      expect(mockGet).toHaveBeenCalledWith('/v1/models');
      expect(result.object).toBe('list');
      expect(result.data.map((m) => m.id)).toContain('llama-3-70b');
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

  // ── waitForSettlement (alias) ─────────────────────────────────────────────

  describe('waitForSettlement', () => {
    it('is an alias for waitForCompletion and resolves on terminal status', async () => {
      const pendingStatus: TaskStatusResponse = { ...mockStatusCompleted, status: 'pending', proof_outcome: 'pending' };
      mockGet
        .mockResolvedValueOnce({ data: pendingStatus })
        .mockResolvedValueOnce({ data: mockStatusCompleted });

      const client = makeClient();
      const result = await client.waitForSettlement(TASK_ID, { intervalMs: 0 });

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('completed');
    });
  });

  // ── USDC/x402 payment handshake ────────────────────────────────────────────

  describe('x402 payers', () => {
    const challenge: X402Challenge = {
      x402Version: 1,
      error: 'payment_required',
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          asset: 'USDC',
          maxAmountRequired: '50000',
          resource: '/x402/task/x402-req1',
          payTo: '0xTreasury',
          extra: { taskId: 'x402-req1', nonce: 'nonce-abc', expiresAt: null },
        },
      ],
    };

    it('selectAccept picks the exact-scheme accept', () => {
      expect(selectAccept(challenge).network).toBe('base');
    });

    it('createMockPayer returns a decodable X-PAYMENT header bound to the nonce', async () => {
      const payer = createMockPayer({ from: '0xAgent' });
      const { header, nonce } = await payer(challenge);
      expect(nonce).toBe('nonce-abc');
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      expect(decoded).toMatchObject({
        asset: 'USDC',
        network: 'base',
        amount: '50000',
        payTo: '0xTreasury',
        nonce: 'nonce-abc',
        from: '0xAgent',
        mock: true,
      });
    });

    it('createSignerPayer envelopes the caller-signed authorization', async () => {
      const signAuthorization = jest.fn(async () => ({ sig: '0xdeadbeef', v: 27 }));
      const payer = createSignerPayer(signAuthorization as any);
      const { header } = await payer(challenge);
      expect(signAuthorization).toHaveBeenCalledTimes(1);
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      expect(decoded.authorization).toEqual({ sig: '0xdeadbeef', v: 27 });
      expect(decoded.nonce).toBe('nonce-abc');
      expect(decoded.resource).toBe('/x402/task/x402-req1');
    });

    it('createSignerPayer echoes bazaar extensions from the 402', async () => {
      const withBazaar: X402Challenge = {
        ...challenge,
        resource: { url: 'https://api.xfuel.app/task-request' },
        extensions: { bazaar: { info: { input: { type: 'http', method: 'POST', bodyType: 'json', body: {} } } } },
        accepts: [{
          ...challenge.accepts[0],
          amount: '50000',
          network: 'eip155:8453',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        }],
      };
      const payer = createSignerPayer(async () => ({ sig: '0x1' }));
      const { header } = await payer(withBazaar);
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      expect(decoded.resource).toBe('https://api.xfuel.app/task-request');
      expect(decoded.extensions.bazaar.info.input.bodyType).toBe('json');
      expect(decoded.amount).toBe('50000');
    });

    it('createSignerPayer rejects a non-function argument', () => {
      expect(() => createSignerPayer(undefined as any)).toThrow();
    });
  });

  describe('submitTaskWithPayment', () => {
    const taskParams = {
      message_type: MessageType.INFERENCE_REQUEST,
      chain_id: ChainId.THETA,
      amount: '50000',
      sender: '0xSender',
      model_id: 'llama3',
      payment: { rail: 'usdc' as const },
    };
    const challengeBody: X402Challenge = {
      x402Version: 1,
      error: 'payment_required',
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          asset: 'USDC',
          maxAmountRequired: '50000',
          resource: '/x402/task/x402-req1',
          payTo: '0xTreasury',
          extra: { taskId: 'x402-req1', nonce: 'nonce-abc' },
        },
      ],
    };

    it('runs the 402 -> pay -> retry loop and returns the settled task', async () => {
      mockPost
        .mockResolvedValueOnce({ status: 402, data: challengeBody })
        .mockResolvedValueOnce({
          status: 202,
          data: { ...mockTaskResponse, payment_rail: 'usdc', payment_ref: 'base:0xtxref' },
        });

      const client = makeClient();
      const result = await client.submitTaskWithPayment(taskParams, createMockPayer());

      expect(mockPost).toHaveBeenCalledTimes(2);
      // Second call carries the X-PAYMENT + X-PAYMENT-NONCE headers.
      const secondCall = mockPost.mock.calls[1];
      expect(secondCall[0]).toBe('/task-request');
      expect(secondCall[2].headers['X-PAYMENT']).toBeDefined();
      expect(secondCall[2].headers['X-PAYMENT-NONCE']).toBe('nonce-abc');
      expect(result.payment_rail).toBe('usdc');
      expect(result.payment_ref).toBe('base:0xtxref');
    });

    it('returns immediately (no payer call) when the server settles without a 402', async () => {
      mockPost.mockResolvedValueOnce({ status: 202, data: mockTaskResponse });
      const payer = jest.fn();
      const client = makeClient();

      const result = await client.submitTaskWithPayment(taskParams, payer as any);

      expect(payer).not.toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(result.task_id).toBe(TASK_ID);
    });

    it('throws when the payment is re-challenged after retry', async () => {
      mockPost
        .mockResolvedValueOnce({ status: 402, data: challengeBody })
        .mockResolvedValueOnce({ status: 402, data: challengeBody });

      const client = makeClient();
      await expect(
        client.submitTaskWithPayment(taskParams, createMockPayer()),
      ).rejects.toThrow(XFuelApiError);
    });

    it('submitInference auto-runs the handshake when a payer is supplied', async () => {
      mockPost
        .mockResolvedValueOnce({ status: 402, data: challengeBody })
        .mockResolvedValueOnce({ status: 202, data: { ...mockTaskResponse, payment_rail: 'usdc' } });

      const client = makeClient();
      const result = await client.submitInference('llama3', '0xSender', '50000', {
        chain_id: ChainId.THETA,
        payment: { rail: 'usdc' },
        payer: createMockPayer(),
      });

      expect(mockPost).toHaveBeenCalledTimes(2);
      // `payer` must not leak into the request body.
      expect(mockPost.mock.calls[0][1].payer).toBeUndefined();
      expect(result.payment_rail).toBe('usdc');
    });
  });

  // ── XFuelApiError ─────────────────────────────────────────────────────────

  describe('chatCompletions', () => {
    it('POSTs /v1/chat/completions', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          id: 'chatcmpl-1',
          model: 'theta/glm_5_2',
          choices: [{ message: { role: 'assistant', content: 'Hello' } }],
          xfuel: { task_id: 'openai-1', verify_url: 'https://api-testnet.xfuel.app/receipt/openai-1' },
        },
      });
      const client = makeClient();
      const result = await client.chatCompletions({
        model: 'xfuel/auto',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(mockPost).toHaveBeenCalledWith('/v1/chat/completions', {
        model: 'xfuel/auto',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(result.xfuel?.task_id).toBe('openai-1');
    });
  });

  describe('XFuelApiError', () => {
    it('attaches the 402 challenge body so submitTask can complete the handshake', async () => {
      const client = makeClient();
      expect(responseRejected).toBeDefined();
      const challenge = {
        x402Version: 1,
        error: 'payment_required',
        accepts: [{ scheme: 'exact', network: 'base', asset: 'USDC', maxAmountRequired: '10000' }],
      };
      const err = await (responseRejected as (e: unknown) => Promise<unknown>)({
        message: 'Request failed with status code 402',
        config: {},
        response: { status: 402, data: challenge },
      }).catch((e: unknown) => e) as XFuelApiError;
      expect(err).toBeInstanceOf(XFuelApiError);
      expect(err.code).toBe('payment_required');
      expect(err.challenge?.accepts?.[0].maxAmountRequired).toBe('10000');
    });

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

  describe('verifyReceiptSignature', () => {
    it('is exported from the main package (no ethers import)', () => {
      expect(verifyReceiptSignature({ task_id: 'x' }, 'secret').checked).toBe(false);
    });
  });
});
