/**
 * Theta Inference Circuit — Off-Chain Handler
 *
 * Plugs into CoreListener (ai-listener.js) to handle specialized AI inference
 * intents via Theta EdgeCloud APIs. Routes to the appropriate EdgeCloud endpoint
 * based on service type, manages the intent lifecycle, and triggers SP1 proof
 * generation for on-chain settlement.
 *
 * Research ties:
 *   Per Theta EdgeCloud docs (Feb 2026):
 *     - On-demand APIs: /v1/chat/completions, /v1/images/generations, etc.
 *     - MCP Server (@thetalabs/on-demand-api-mcp): 20+ model access
 *     - RapidAPI: theta-edge-cloud-ai-inference-api for enterprise routing
 *     - Agentic AI: voice cloning, RAG chatbot
 *     - Video API: transcoding, P2P delivery
 *
 *   Per Theta 2026 H1 roadmap: Inference Engine upgrades, RapidAPI integration.
 *
 * Usage:
 *   import { ThetaInferenceHandler } from './theta-inference-handler.js';
 *   import { CoreListener } from '../../core-layer/ai-listener.js';
 *
 *   const listener = new CoreListener(config);
 *   const handler = new ThetaInferenceHandler({
 *     edgeCloudApiKey: process.env.THETA_EDGECLOUD_API_KEY,
 *     rapidApiKey: process.env.THETA_RAPIDAPI_KEY,
 *   });
 *   listener.registerCircuit('theta-inference', handler, ['theta_mainnet', 'theta_testnet']);
 *   await listener.start();
 */

import { ethers } from 'ethers';

// GPU tier enum names for logging
const GPU_TIER_NAMES = { 0: 'RTX-4090', 1: 'A100', 2: 'H100' };
const SERVICE_TYPE_NAMES = {};

const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('THETA_INFERENCE_CIRCUIT'));

const SERVICE_TYPES = {
  LLM_INFERENCE: 0,
  IMAGE_GENERATION: 1,
  SPEECH_TO_TEXT: 2,
  VOICE_CLONING: 3,
  RAG_QUERY: 4,
  VIDEO_PROCESSING: 5,
  OBJECT_DETECTION: 6,
};

// Reverse mapping for logging
Object.entries(SERVICE_TYPES).forEach(([k, v]) => { SERVICE_TYPE_NAMES[v] = k; });

const INFERENCE_EVENTS = [
  'event InferenceIntentSubmitted(bytes32 indexed circuitId, bytes32 indexed intentId, uint8 serviceType, bytes32 indexed serviceId, address requester, uint256 payment, uint256 fee, bytes32 inputHash)',
  'event IntentCompleted(bytes32 indexed intentId, bytes32 outputHash, bytes32 modelHash, uint256 latencyMs)',
  'event IntentSettled(bytes32 indexed intentId, bytes32 nullifier, uint256 settledAmount)',
  'event IntentFailed(bytes32 indexed intentId, string reason)',
];

// Theta EdgeCloud On-Demand API — https://ondemand.thetaedgecloud.com
// Endpoint pattern: /infer_request/{model_slug}/completions
const EDGECLOUD_BASE = 'https://ondemand.thetaedgecloud.com';

const EDGECLOUD_MODEL_SLUGS = {
  'llama-3.1-8b': 'llama_3_8b',
  'llama-3.1-70b': 'llama_3_8b',
  'llama-3.1-405b': 'llama_3_8b',
  'flux-schnell': 'flux_schnell',
  'flux-dev': 'flux_dev',
  'flux-pro': 'flux_pro',
  'whisper-large-v3': 'whisper_large_v3',
  'stable-diffusion-xl': 'stable_diffusion_xl',
  'yolov8': 'yolov8',
  'theta-transcode-v2': 'theta_transcode_v2',
  'theta-drm-v1': 'theta_drm_v1',
  'voice-clone-v1': 'voice_clone_v1',
};

const EDGECLOUD_ENDPOINTS = {
  [SERVICE_TYPES.LLM_INFERENCE]: '/infer_request/{slug}/completions',
  [SERVICE_TYPES.IMAGE_GENERATION]: '/infer_request/{slug}/completions',
  [SERVICE_TYPES.SPEECH_TO_TEXT]: '/infer_request/{slug}/completions',
  [SERVICE_TYPES.VOICE_CLONING]: '/infer_request/{slug}/completions',
  [SERVICE_TYPES.RAG_QUERY]: '/infer_request/{slug}/completions',
  [SERVICE_TYPES.VIDEO_PROCESSING]: '/infer_request/{slug}/completions',
  [SERVICE_TYPES.OBJECT_DETECTION]: '/infer_request/{slug}/completions',
};

const RAPIDAPI_HOST = 'theta-edge-cloud-ai-inference-api.p.rapidapi.com';
const RAPIDAPI_ENDPOINTS = {
  [SERVICE_TYPES.LLM_INFERENCE]: '/inference/chat',
  [SERVICE_TYPES.IMAGE_GENERATION]: '/inference/image',
  [SERVICE_TYPES.SPEECH_TO_TEXT]: '/inference/audio',
  [SERVICE_TYPES.VOICE_CLONING]: '/inference/tts',
  [SERVICE_TYPES.RAG_QUERY]: '/inference/chat',
  [SERVICE_TYPES.VIDEO_PROCESSING]: '/inference/video',
  [SERVICE_TYPES.OBJECT_DETECTION]: '/inference/vision',
};

// ─── GPU Tiers & Live EdgeCloud Pricing ──────────────────────────────────────
const GPU_TIERS = {
  RTX_4090: { id: 0, name: 'RTX 4090',  vram: '24 GB', priceMultiplier: 1.0,  throughput: '~82 TFLOPS' },
  A100:     { id: 1, name: 'A100 80GB', vram: '80 GB', priceMultiplier: 2.5,  throughput: '~312 TFLOPS' },
  H100:     { id: 2, name: 'H100 SXM',  vram: '80 GB', priceMultiplier: 5.0,  throughput: '~990 TFLOPS' },
};

// ─── Preset Hooks (one-click developer presets) ──────────────────────────────
const PRESET_HOOKS = {
  QUICK_LLAMA: {
    name: 'Quick Llama 3.1',
    serviceType: SERVICE_TYPES.LLM_INFERENCE,
    defaultModel: 'llama-3.1-8b',
    defaultGpu: 'RTX_4090',
    defaultPrompt: 'Hello, summarize the latest AI research.',
    description: 'Fast LLM inference with Llama 3.1 8B on budget GPU. Ideal for chat, summarization, Q&A.',
    icon: '⚡',
    color: '#00d4ff',
  },
  NEED_BIGGER_GPU: {
    name: 'Need Bigger GPU',
    serviceType: SERVICE_TYPES.LLM_INFERENCE,
    defaultModel: 'llama-3.1-405b',
    defaultGpu: 'H100',
    defaultPrompt: 'Analyze this complex dataset and provide insights.',
    description: 'Max-power inference with Llama 3.1 405B on H100. For complex reasoning, code gen, analysis.',
    icon: '🔥',
    color: '#ef4444',
  },
  VOICE_AGENT: {
    name: 'Voice Agent',
    serviceType: SERVICE_TYPES.VOICE_CLONING,
    defaultModel: 'voice-clone-v1',
    defaultGpu: 'A100',
    defaultPrompt: 'Clone this voice and generate speech.',
    description: 'Voice cloning + TTS for agentic voice bots. Clone any voice from a sample.',
    icon: '🎙️',
    color: '#f59e0b',
  },
  ENTERPRISE_RAG: {
    name: 'Enterprise RAG',
    serviceType: SERVICE_TYPES.RAG_QUERY,
    defaultModel: 'llama-3.1-70b',
    defaultGpu: 'A100',
    defaultPrompt: 'Query the knowledge base for compliance info.',
    description: 'Retrieval-Augmented Generation with citation-backed answers for enterprise knowledge bases.',
    icon: '🏢',
    color: '#06b6d4',
  },
  QUICK_IMAGE: {
    name: 'Quick Image Gen',
    serviceType: SERVICE_TYPES.IMAGE_GENERATION,
    defaultModel: 'flux-schnell',
    defaultGpu: 'RTX_4090',
    defaultPrompt: 'A futuristic city skyline at sunset, cyberpunk style',
    description: 'Fast image generation with FLUX Schnell. Great for prototyping and creative work.',
    icon: '🎨',
    color: '#8b5cf6',
  },
  MEDICAL_STT: {
    name: 'Medical Transcription',
    serviceType: SERVICE_TYPES.SPEECH_TO_TEXT,
    defaultModel: 'whisper-large-v3',
    defaultGpu: 'A100',
    defaultPrompt: '',
    description: 'HIPAA-grade medical audio transcription with Whisper Large V3. 90+ languages.',
    icon: '🏥',
    color: '#22c55e',
  },
  TRANSCRIBE_SUMMARIZE: {
    name: 'Transcribe + Summarize',
    serviceType: SERVICE_TYPES.SPEECH_TO_TEXT,
    defaultModel: 'whisper-large-v3',
    defaultGpu: 'A100',
    defaultPrompt: '',
    description: 'Transcribe audio then auto-summarize with LLM. Two-step pipeline in one click.',
    icon: '📝',
    color: '#14b8a6',
  },
  VIDEO_TRANSCODE: {
    name: 'Video Transcode',
    serviceType: SERVICE_TYPES.VIDEO_PROCESSING,
    defaultModel: 'theta-transcode-v2',
    defaultGpu: 'RTX_4090',
    defaultPrompt: '',
    description: 'Multi-resolution adaptive bitrate transcoding via Theta Video API and P2P delivery.',
    icon: '🎬',
    color: '#f43f5e',
  },
  NFT_DRM_GUARD: {
    name: 'NFT DRM Guard',
    serviceType: SERVICE_TYPES.VIDEO_PROCESSING,
    defaultModel: 'theta-drm-v1',
    defaultGpu: 'A100',
    defaultPrompt: '',
    description: 'NFT-gated content delivery with ERC-721/1155 DRM on Theta Metachain.',
    icon: '🛡️',
    color: '#d946ef',
  },
  JUPYTER_NOTEBOOK: {
    name: 'Jupyter Notebook',
    serviceType: SERVICE_TYPES.LLM_INFERENCE,
    defaultModel: 'llama-3.1-8b',
    defaultGpu: 'RTX_4090',
    defaultPrompt: 'Launch a Jupyter notebook with PyTorch and Transformers pre-installed.',
    description: 'Browser-based Jupyter on EdgeCloud GPU with PyTorch, TensorFlow, HuggingFace.',
    icon: '📓',
    color: '#f97316',
  },
  OBJECT_DETECTOR: {
    name: 'Object Detector',
    serviceType: SERVICE_TYPES.OBJECT_DETECTION,
    defaultModel: 'yolov8',
    defaultGpu: 'RTX_4090',
    defaultPrompt: '',
    description: 'Real-time YOLO object detection with bounding boxes, classification, and tracking.',
    icon: '👁️',
    color: '#a855f7',
  },
  AI_AGENT_BUILDER: {
    name: 'AI Agent Builder',
    serviceType: SERVICE_TYPES.RAG_QUERY,
    defaultModel: 'llama-3.1-70b',
    defaultGpu: 'H100',
    defaultPrompt: 'Create an autonomous agent that monitors DeFi positions.',
    description: 'Build autonomous AI agents with RAG + function calling on H100 max power.',
    icon: '🤖',
    color: '#0ea5e9',
  },
  HD_IMAGE_PRO: {
    name: 'HD Image Pro',
    serviceType: SERVICE_TYPES.IMAGE_GENERATION,
    defaultModel: 'flux-dev',
    defaultGpu: 'H100',
    defaultPrompt: 'A photorealistic portrait with cinematic lighting, 4K resolution',
    description: 'Production-quality image generation with FLUX Dev on H100 for maximum fidelity.',
    icon: '🖼️',
    color: '#6366f1',
  },
  GPU_TRAINING_JOB: {
    name: 'GPU Training Job',
    serviceType: SERVICE_TYPES.LLM_INFERENCE,
    defaultModel: 'llama-3.1-70b',
    defaultGpu: 'H100',
    defaultPrompt: 'Fine-tune model on custom dataset with distributed training.',
    description: 'Distributed GPU training across EdgeCloud nodes. Multi-GPU, multi-node configs.',
    icon: '🏋️',
    color: '#eab308',
  },
};

// Full catalog of Theta EdgeCloud products (from research/theta-integration.md)
// Products: On-Demand APIs, Dedicated Deployments, Jupyter, GPU Training,
// Persistent Storage, Agentic AI, NFT DRM, Video API, MCP Server, RapidAPI
const FULL_CATALOG = [
  { id: 'ondemand-llm', name: 'On-Demand LLM APIs', category: 'Inference', endpoint: '/v1/chat/completions', description: 'Llama 3.x (8B/70B/405B) serverless chat completions', preset: 'QUICK_LLAMA' },
  { id: 'ondemand-image', name: 'On-Demand Image Gen', category: 'Inference', endpoint: '/v1/images/generations', description: 'FLUX.1 & Stable Diffusion XL image generation', preset: 'QUICK_IMAGE' },
  { id: 'ondemand-stt', name: 'On-Demand Speech-to-Text', category: 'Inference', endpoint: '/v1/audio/transcriptions', description: 'Whisper large-v3 transcription, 90+ languages', preset: 'MEDICAL_STT' },
  { id: 'ondemand-tts', name: 'On-Demand TTS / Voice Clone', category: 'Inference', endpoint: '/v1/audio/speech', description: 'Text-to-speech and voice cloning from samples', preset: 'VOICE_AGENT' },
  { id: 'ondemand-vision', name: 'On-Demand Object Detection', category: 'Inference', endpoint: '/v1/vision/detect', description: 'YOLO real-time object detection and tracking', preset: 'OBJECT_DETECTOR' },
  { id: 'ondemand-video', name: 'On-Demand Video Processing', category: 'Inference', endpoint: '/v1/video/process', description: 'Transcoding, analytics, adaptive bitrate streaming', preset: 'VIDEO_TRANSCODE' },
  { id: 'dedicated-deploy', name: 'Dedicated Model Deployments', category: 'Compute', endpoint: 'SetPrice RPC', description: 'Reserved GPU clusters (A100/H100/RTX 4090) with persistent endpoints' },
  { id: 'jupyter', name: 'Jupyter Notebook Prototyping', category: 'Compute', endpoint: 'EdgeCloud Dashboard', description: 'Browser-based Jupyter with PyTorch, TensorFlow, HuggingFace', preset: 'JUPYTER_NOTEBOOK' },
  { id: 'gpu-training', name: 'GPU Training on Clusters', category: 'Compute', endpoint: 'EdgeCloud Job API', description: 'Distributed multi-GPU/multi-node training jobs', preset: 'GPU_TRAINING_JOB' },
  { id: 'persistent-storage', name: 'Persistent Storage', category: 'Storage', endpoint: 'CID-based', description: 'Decentralized model/dataset storage with IPFS/Filecoin redundancy' },
  { id: 'ai-agents', name: 'Agentic AI Services', category: 'Agentic', endpoint: '/v1/agents/create', description: 'Autonomous task-execution agents on EdgeCloud', preset: 'AI_AGENT_BUILDER' },
  { id: 'rag-chatbot', name: 'RAG Chatbot', category: 'Agentic', endpoint: '/v1/rag/query', description: 'Retrieval-Augmented Generation with citation-backed answers', preset: 'ENTERPRISE_RAG' },
  { id: 'nft-drm', name: 'NFT-Based DRM', category: 'Video', endpoint: 'Theta Video API', description: 'ERC-721/1155 content gating with DRM-protected streaming', preset: 'NFT_DRM_GUARD' },
  { id: 'video-api', name: 'Theta Video API', category: 'Video', endpoint: '/v1/video/*', description: 'Transcoding, P2P delivery, live streaming, analytics' },
  { id: 'mcp-server', name: 'MCP Server Access', category: 'Gateway', endpoint: '@thetalabs/on-demand-api-mcp', description: '20+ AI models via MCP protocol for LLM tool-calling' },
  { id: 'rapidapi', name: 'RapidAPI Gateway', category: 'Gateway', endpoint: 'rapidapi.com/thetaedgecloud', description: 'Enterprise routing with subscribe-and-go API snippets' },
];

const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'XFuel Theta AI — Agent Intent API',
    version: '1.0.0',
    description: 'Programmatic endpoint for AI agents and M2M orchestrators to submit Theta EdgeCloud inference intents with preset hooks and GPU tier selection.',
  },
  servers: [{ url: 'http://localhost:3002', description: 'Local dev' }],
  paths: {
    '/theta-ai/agent-intent': {
      post: {
        summary: 'Submit an AI inference intent (agent/M2M)',
        operationId: 'submitAgentIntent',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['preset'],
                properties: {
                  preset: { type: 'string', enum: Object.keys(PRESET_HOOKS), description: 'Preset hook key' },
                  gpu_tier: { type: 'string', enum: Object.keys(GPU_TIERS), description: 'GPU tier (alias: gpu)' },
                  gpu: { type: 'string', enum: Object.keys(GPU_TIERS), description: 'GPU tier (alias for gpu_tier)' },
                  prompt: { type: 'string', description: 'Override default prompt' },
                  model: { type: 'string', description: 'Override default model' },
                  sender: { type: 'string', description: 'Agent/wallet address' },
                  callbackUrl: { type: 'string', format: 'uri', description: 'Optional webhook URL — receives POST with full result when inference completes' },
                  max_tokens: { type: 'integer', default: 1024 },
                  temperature: { type: 'number', default: 0.7 },
                },
              },
            },
          },
        },
        responses: {
          202: { description: 'Intent accepted and queued for EdgeCloud execution' },
          400: { description: 'Invalid preset or GPU tier' },
          401: { description: 'Missing or invalid API key' },
        },
      },
    },
    '/theta-ai/presets': {
      get: {
        summary: 'List available preset hooks with GPU pricing',
        operationId: 'listPresets',
        responses: {
          200: { description: 'Preset hooks catalog with live pricing' },
        },
      },
    },
    '/theta-ai/gpu-tiers': {
      get: {
        summary: 'List GPU tiers with pricing multipliers',
        operationId: 'listGpuTiers',
        responses: {
          200: { description: 'GPU tier catalog' },
        },
      },
    },
    '/theta-ai/catalog': {
      get: {
        summary: 'Full catalog of all Theta EdgeCloud products and services',
        operationId: 'getFullCatalog',
        responses: { 200: { description: 'Complete product catalog with one-click intent URIs' } },
      },
    },
    '/theta-ai/webhook-status/{taskId}': {
      get: {
        summary: 'Check webhook delivery status for a completed intent',
        operationId: 'getWebhookStatus',
        parameters: [
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string' }, description: 'The task_id returned from agent-intent' },
        ],
        responses: {
          200: { description: 'Webhook delivery status for the intent' },
          404: { description: 'Intent not found' },
        },
      },
    },
    '/theta-ai/stats': {
      get: {
        summary: 'Live monitoring stats — intents, RPC health, webhooks, failure prediction',
        operationId: 'getMonitoringStats',
        description: 'Returns real-time dashboard data for humans (UI) and agents (JSON). Includes recent intents, RPC health per chain, webhook delivery stats, and failure prediction based on heartbeat/error analysis.',
        responses: {
          200: {
            description: 'Monitoring stats payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    intents: { type: 'array', description: 'Recent intent entries' },
                    rpcHealth: { type: 'array', description: 'Per-chain RPC health status' },
                    webhooks: { type: 'object', description: 'Webhook delivery stats' },
                    failurePrediction: { type: 'object', description: 'Failure risk assessment' },
                    summary: { type: 'object', description: 'Aggregate counters' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/theta-ai/openapi.json': {
      get: {
        summary: 'OpenAPI 3.0 spec for this API',
        operationId: 'getOpenApiSpec',
        responses: { 200: { description: 'OpenAPI JSON' } },
      },
    },
  },
};

// Contract ABI for on-chain completion + settlement
const CIRCUIT_ABI = [
  'function completeIntent(bytes32 intentId, bytes32 outputHash, bytes32 modelHash, uint256 latencyMs)',
  'function attestEdgeCloudNode(bytes32 intentId, bytes32 nodeId, bytes32 gpuFingerprint, uint64 petaflopsUsed, uint8 providerTag)',
  'function settleIntent(bytes32 intentId, bytes proof, bytes publicValues, bytes32 nullifier)',
  'function failIntent(bytes32 intentId, string reason)',
  'function getIntent(bytes32 intentId) view returns (tuple(bytes32 intentId, uint8 serviceType, bytes32 serviceId, address requester, uint256 payment, uint256 fee, bytes32 inputHash, bytes32 outputHash, bytes32 modelHash, uint8 status, uint64 submittedAt, uint64 completedAt, uint64 settledAt, uint256 latencyMs, bytes32 proofNullifier))',
  'function getAttestation(bytes32 intentId) view returns (tuple(bytes32 nodeId, bytes32 gpuFingerprint, uint64 petaflopsUsed, uint64 attestedAt, uint8 providerTag))',
];

// ProviderTag enum — must match ThetaInferenceCircuit.sol
const PROVIDER_TAG = Object.freeze({
  UNSET:           0,
  THETA_NATIVE:    1,
  HYBRID_FALLBACK: 2, // legacy alias; retained for backward compat
  DEPIN_AKASH:     3,
  DEPIN_RENDER:    4,
  HYBRID_CLOUD:    5,
});

// Human-readable labels for logging / heartbeat
const PROVIDER_TAG_LABELS = Object.freeze(
  Object.fromEntries(Object.entries(PROVIDER_TAG).map(([k, v]) => [v, k]))
);

// ─── DePIN Provider Config ───────────────────────────────────────────────────
// Priority order: THETA_NATIVE → DEPIN_AKASH → DEPIN_RENDER → HYBRID_CLOUD
//
// All three external providers are pay-as-you-go — zero idle cost.
// Keys are optional at startup; missing keys cause that tier to be skipped.
// Akash Network: deploy SDL manifests via REST gateway
// Render Network:  submit jobs via render.com API
// AWS Bedrock:    invoke model via Bedrock Runtime (SigV4 auth)

const AKASH_GATEWAY_URL  = 'https://api.akash.network/akash/provider/v1/lease/shell';
const RENDER_API_BASE    = 'https://api.render.com/v1';
const BEDROCK_MODEL_MAP  = {
  'llama-3.1-8b':  'us.meta.llama3-8b-instruct-v1:0',
  'llama-3.1-70b': 'us.meta.llama3-70b-instruct-v1:0',
  'llama-3.1-405b':'us.meta.llama3-405b-instruct-v1:0',
  'claude-3-haiku':'anthropic.claude-3-haiku-20240307-v1:0',
  'claude-3-sonnet':'anthropic.claude-3-sonnet-20240229-v1:0',
};

class ThetaInferenceHandler {
  constructor(config = {}) {
    this.contractAddress = config.contractAddress || null;
    this.iface = new ethers.Interface(INFERENCE_EVENTS);

    // Theta EdgeCloud On-Demand API
    this.edgeCloudBase = config.edgeCloudBase || EDGECLOUD_BASE;
    this.edgeCloudApiKey = config.edgeCloudApiKey || process.env.THETA_EDGECLOUD_API_KEY || '';

    // RapidAPI fallback — per research doc §2.4
    this.rapidApiKey = config.rapidApiKey || process.env.THETA_RAPIDAPI_KEY || '';
    this.rapidApiBase = config.rapidApiBase || 'https://theta-edge-cloud-ai-inference-api.p.rapidapi.com';

    // MCP server — per research doc §2.3 (Phase 2 stub)
    this.mcpEndpoint = config.mcpEndpoint || process.env.THETA_MCP_ENDPOINT || '';

    // ─── DePIN / Cloud provider credentials ─────────────────────────────────
    // Akash Network — deploy SDL manifests; pay per compute block
    this.akashGatewayUrl = config.akashGatewayUrl || process.env.AKASH_GATEWAY_URL || AKASH_GATEWAY_URL;
    this.akashMnemonic   = config.akashMnemonic   || process.env.AKASH_WALLET_MNEMONIC || '';
    this.akashCert       = config.akashCert       || process.env.AKASH_CERT_PEM || '';

    // Render Network — GPU job API
    this.renderApiKey    = config.renderApiKey    || process.env.RENDER_API_KEY || '';
    this.renderApiBase   = config.renderApiBase   || process.env.RENDER_API_BASE || RENDER_API_BASE;

    // AWS Bedrock — last-resort cloud fallback (SigV4 signed requests)
    this.awsRegion          = config.awsRegion          || process.env.AWS_REGION          || 'us-east-1';
    this.awsAccessKeyId     = config.awsAccessKeyId     || process.env.AWS_ACCESS_KEY_ID   || '';
    this.awsSecretAccessKey = config.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '';

    // Feature flags — disable individual tiers without removing credentials
    this.useAkashFallback   = config.useAkashFallback   !== false;
    this.useRenderFallback  = config.useRenderFallback  !== false;
    this.useBedrockFallback = config.useBedrockFallback !== false;

    // On-chain settlement (relayer signer for completeIntent + settleIntent)
    this.relayerPrivateKey = config.relayerPrivateKey || null;
    this.rpcUrl = config.rpcUrl || null;
    this.contract = null;
    this.relayerSigner = null;
    this.gasLimit = config.gasLimit || 500000;

    this.activeIntents = new Map();
    this.apiTimeout = config.apiTimeout || 60000;
    this.useRapidApiFallback = config.useRapidApiFallback !== false;
    this.useMcpFallback = config.useMcpFallback !== false;

    // API call tracking
    this.apiStats = {
      edgeCloud: { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      rapidApi:  { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      mcp:       { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      akash:     { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      render:    { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      bedrock:   { calls: 0, successes: 0, failures: 0, totalLatencyMs: 0 },
      mock:      { calls: 0 },
      onChain:   { completes: 0, settles: 0, failures: 0, attests: 0, attestFailures: 0 },
      webhooks:  { delivered: 0, failed: 0 },
    };

    this.log = config.logger || console;
    this._keyResolved = false;
  }

  /**
   * Initialize the on-chain contract connection for settlement.
   * Must be called after constructor if relayerPrivateKey and rpcUrl are set.
   */
  async initContract() {
    if (this.contract) return;
    if (!this.contractAddress || !this.relayerPrivateKey || !this.rpcUrl) {
      console.warn('[ThetaInference] On-chain settlement disabled (missing contractAddress, relayerPrivateKey, or rpcUrl)');
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      this.relayerSigner = new ethers.Wallet(this.relayerPrivateKey, provider);
      this.contract = new ethers.Contract(this.contractAddress, CIRCUIT_ABI, this.relayerSigner);
      console.log(`[ThetaInference] On-chain settlement ready | relayer=${this.relayerSigner.address} | contract=${this.contractAddress}`);
    } catch (err) {
      console.error(`[ThetaInference] Failed to init contract: ${err.message}`);
    }
  }

  /**
   * Resolve API keys from AWS Secrets Manager ARNs if needed.
   * Call once at startup before first intent.
   */
  async resolveApiKeys() {
    if (this._keyResolved) return;
    this._keyResolved = true;

    // If THETA_EDGECLOUD_API_KEY was set directly, use it (skip AWS)
    if (this.edgeCloudApiKey) {
      console.log(`[ThetaInference] EdgeCloud key loaded directly (${this.edgeCloudApiKey.slice(0, 12)}...)`);
      return;
    }

    // Fallback: resolve from AWS Secrets Manager if THETA_API_KEY is an ARN
    const thetaApiArn = process.env.THETA_API_KEY || '';
    if (!this.edgeCloudApiKey && thetaApiArn.startsWith('arn:aws:secretsmanager:')) {
      try {
        const region = process.env.AWS_REGION || 'us-east-1';
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
        if (accessKeyId && secretAccessKey) {
          console.log('[ThetaInference] Resolving THETA_API_KEY from AWS Secrets Manager...');
          const url = `https://secretsmanager.${region}.amazonaws.com`;
          const body = JSON.stringify({ SecretId: thetaApiArn });
          const now = new Date();
          const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
          const dateStamp = amzDate.slice(0, 8);
          const { createHmac, createHash } = await import('crypto');
          const hash = (data) => createHash('sha256').update(data).digest('hex');
          const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
          const payloadHash = hash(body);
          const canonicalRequest = `POST\n/\n\ncontent-type:application/x-amz-json-1.1\nhost:secretsmanager.${region}.amazonaws.com\nx-amz-date:${amzDate}\nx-amz-target:secretsmanager.GetSecretValue\n\ncontent-type;host;x-amz-date;x-amz-target\n${payloadHash}`;
          const credentialScope = `${dateStamp}/${region}/secretsmanager/aws4_request`;
          const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hash(canonicalRequest)}`;
          let signingKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
          signingKey = hmac(signingKey, region);
          signingKey = hmac(signingKey, 'secretsmanager');
          signingKey = hmac(signingKey, 'aws4_request');
          const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
          const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=${signature}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-amz-json-1.1',
              'X-Amz-Target': 'secretsmanager.GetSecretValue',
              'X-Amz-Date': amzDate,
              'Host': `secretsmanager.${region}.amazonaws.com`,
              'Authorization': authHeader,
            },
            body,
          });
          if (res.ok) {
            const data = await res.json();
            let secretValue = data.SecretString || '';
            // AWS secrets are often stored as JSON objects — parse and extract the key
            if (secretValue.startsWith('{')) {
              try {
                const parsed = JSON.parse(secretValue);
                secretValue = parsed.THETA_EDGECLOUD_API_KEY
                  || parsed.THETA_API_KEY
                  || parsed.api_key
                  || Object.values(parsed)[0]
                  || secretValue;
              } catch { /* use raw string */ }
            }
            this.edgeCloudApiKey = secretValue;
            console.log(`[ThetaInference] THETA_API_KEY resolved (${this.edgeCloudApiKey.slice(0, 12)}...)`);
          } else {
            console.warn(`[ThetaInference] AWS Secrets Manager returned ${res.status} — using fallback`);
          }
        }
      } catch (err) {
        console.warn(`[ThetaInference] AWS key resolution failed: ${err.message}`);
      }
    }
  }

  /**
   * Check which API backends are configured and ready.
   */
  getApiStatus() {
    return {
      edgeCloud: {
        enabled: !!this.edgeCloudApiKey,
        base: this.edgeCloudBase,
        keyPrefix: this.edgeCloudApiKey ? this.edgeCloudApiKey.slice(0, 8) + '...' : '(none)',
        stats: { ...this.apiStats.edgeCloud },
      },
      rapidApi: {
        enabled: !!this.rapidApiKey,
        host: RAPIDAPI_HOST,
        keyPrefix: this.rapidApiKey ? this.rapidApiKey.slice(0, 8) + '...' : '(none)',
        stats: { ...this.apiStats.rapidApi },
      },
      mcp: {
        enabled: !!this.mcpEndpoint,
        endpoint: this.mcpEndpoint || '(not configured)',
        stats: { ...this.apiStats.mcp },
      },
      akash: {
        enabled: this.useAkashFallback && !!this.akashMnemonic,
        gateway: this.akashGatewayUrl,
        stats: { ...this.apiStats.akash },
      },
      render: {
        enabled: this.useRenderFallback && !!this.renderApiKey,
        base: this.renderApiBase,
        stats: { ...this.apiStats.render },
      },
      bedrock: {
        enabled: this.useBedrockFallback && !!(this.awsAccessKeyId && this.awsSecretAccessKey),
        region: this.awsRegion,
        stats: { ...this.apiStats.bedrock },
      },
      mock: { calls: this.apiStats.mock.calls },
      webhooks: { ...this.apiStats.webhooks },
      onChain: {
        enabled: !!this.contract,
        relayer: this.relayerSigner?.address || '(none)',
        stats: { ...this.apiStats.onChain },
      },
      mode: this.edgeCloudApiKey ? 'LIVE'
          : this.rapidApiKey     ? 'RAPIDAPI'
          : (this.useAkashFallback && this.akashMnemonic) ? 'AKASH'
          : (this.useRenderFallback && this.renderApiKey) ? 'RENDER'
          : (this.useBedrockFallback && this.awsAccessKeyId) ? 'BEDROCK'
          : 'MOCK',
    };
  }

  /**
   * Validate environment at startup. Throws if critical config is missing.
   */
  static validateEnv({ strict = false } = {}) {
    const edgeKey = process.env.THETA_EDGECLOUD_API_KEY || '';
    const rapidKey = process.env.THETA_RAPIDAPI_KEY || '';
    const thetaApiArn = process.env.THETA_API_KEY || '';
    const mcpEndpoint = process.env.THETA_MCP_ENDPOINT || '';
    const awsCreds = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

    const status = {
      edgeCloudKey: edgeKey ? 'SET' : thetaApiArn.startsWith('arn:') ? 'AWS_ARN' : 'MISSING',
      rapidApiKey: rapidKey ? 'SET' : 'MISSING',
      mcpEndpoint: mcpEndpoint ? 'SET' : 'MISSING',
      awsCredentials: awsCreds ? 'SET' : 'MISSING',
      canResolveFromAws: thetaApiArn.startsWith('arn:') && awsCreds,
    };

    if (strict && !edgeKey && !rapidKey && !status.canResolveFromAws) {
      throw new Error(
        'No Theta API keys configured. Set THETA_EDGECLOUD_API_KEY or THETA_RAPIDAPI_KEY in .env, ' +
        'or ensure THETA_API_KEY (ARN) + AWS credentials are set for Secrets Manager resolution.'
      );
    }

    return status;
  }

  /**
   * Called by CoreListener when a matching intent is detected.
   */
  async onIntent(intent, ctx) {
    // Ethers v6 returns uint8 as BigInt; coerce to Number for switch comparison
    const serviceType = Number(intent.args?.serviceType ?? SERVICE_TYPES.LLM_INFERENCE);

    this.log.info?.(`[ThetaInference] Received intent: ${intent.type} service=${serviceType} on ${ctx.chain}`);

    switch (serviceType) {
      case SERVICE_TYPES.LLM_INFERENCE:
        return this._handleLLMInference(intent, ctx);
      case SERVICE_TYPES.IMAGE_GENERATION:
        return this._handleImageGeneration(intent, ctx);
      case SERVICE_TYPES.SPEECH_TO_TEXT:
        return this._handleSpeechToText(intent, ctx);
      case SERVICE_TYPES.VOICE_CLONING:
        return this._handleVoiceCloning(intent, ctx);
      case SERVICE_TYPES.RAG_QUERY:
        return this._handleRAGQuery(intent, ctx);
      case SERVICE_TYPES.VIDEO_PROCESSING:
        return this._handleVideoProcessing(intent, ctx);
      case SERVICE_TYPES.OBJECT_DETECTION:
        return this._handleObjectDetection(intent, ctx);
      default:
        this.log.warn?.(`[ThetaInference] Unknown service type: ${serviceType}`);
        return { outcome: 'failed', details: { error: `Unknown service type: ${serviceType}` } };
    }
  }

  /**
   * Called when an SP1 proof is ready for a completed intent.
   * Settles the intent on-chain via contract.settleIntent().
   */
  async onProofReady(proofResult, proofRequest) {
    console.log(`[ThetaInference] Proof ready | nullifier=${proofResult.nullifier?.slice(0, 18)}... | intent=${proofRequest.intentId?.slice(0, 18)}...`);

    const entry = this.activeIntents.get(proofRequest.intentId);
    if (entry) {
      entry.proof = proofResult;
      entry.status = 'proof_ready';
    }

    // Settle on-chain if contract is connected
    if (this.contract && proofRequest.onChainIntentId) {
      try {
        console.log(`[ThetaInference] Settling intent on-chain...`);
        const tx = await this.contract.settleIntent(
          proofRequest.onChainIntentId,
          proofResult.proof,
          proofResult.publicValues,
          proofResult.nullifier,
          { gasLimit: this.gasLimit }
        );
        const receipt = await tx.wait();
        this.apiStats.onChain.settles++;
        console.log(`[ThetaInference] Settled on-chain | tx=${receipt.hash.slice(0, 18)}... | gas=${receipt.gasUsed}`);

        if (entry) {
          entry.status = 'settled';
          entry.settleTxHash = receipt.hash;
        }
      } catch (err) {
        this.apiStats.onChain.failures++;
        console.error(`[ThetaInference] settleIntent failed: ${err.message?.split('\n')[0]?.slice(0, 120)}`);
        if (entry) entry.settleError = err.message;
      }
    }

    // Fire webhook callback if a callbackUrl was registered for this intent
    if (entry?.callbackUrl) {
      const payload = {
        task_id: proofRequest.intentId,
        output: entry.result,
        proof: {
          nullifier: proofResult.nullifier,
          proof: proofResult.proof,
          publicValues: proofResult.publicValues,
        },
        status: entry.status,
        latency_ms: entry.latencyMs,
        settled_tx: entry.settleTxHash || null,
        // Track 5.5 — extended fields
        output_hash: entry.outputHash || null,
        proof_tx_hash: entry.settleTxHash || null,
        edge_cloud_node_id: entry.attestation?.nodeId || null,
        provider_tag: entry.providerTag ?? null,
        video_provenance_uri: entry.videoProvenanceUri || null,
        edge_store_cid: entry.edgeStoreCid || null,
        timestamp: Date.now(),
      };
      await this._deliverWebhook(entry.callbackUrl, payload, proofRequest.intentId);
    }
  }

  /**
   * Deliver a webhook POST with retry logic (3 attempts, exponential backoff).
   * Includes HMAC-SHA256 signature header for receiver verification (Track 5.5).
   *
   * Signature: X-XFuel-Signature: sha256=<hex>
   *   HMAC-SHA256(key=WEBHOOK_SECRET, message=<JSON body string>)
   *
   * Receivers should verify: `crypto.timingSafeEqual(expected, received)`
   */
  async _deliverWebhook(url, payload, intentId) {
    const maxAttempts = 3;
    const baseDelayMs = 1000;

    const body = JSON.stringify(payload);

    // HMAC-SHA256 signature (if WEBHOOK_SECRET is configured)
    const webhookSecret = this._webhookSecret || process.env.WEBHOOK_SECRET || '';
    let signatureHeader = null;
    if (webhookSecret) {
      try {
        const { createHmac } = await import('crypto');
        const hmac = createHmac('sha256', webhookSecret);
        hmac.update(body);
        signatureHeader = `sha256=${hmac.digest('hex')}`;
      } catch {
        // crypto import failure is non-fatal — deliver without signature
      }
    }

    const headers = { 'Content-Type': 'application/json' };
    if (signatureHeader) headers['X-XFuel-Signature'] = signatureHeader;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Webhook] POST ${url} | attempt=${attempt}/${maxAttempts} | intent=${intentId?.slice(0, 20)}... | signed=${!!signatureHeader}`);
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          console.log(`[Webhook] Delivered successfully | status=${res.status} | intent=${intentId?.slice(0, 20)}...`);
          this.apiStats.webhooks.delivered++;
          return true;
        }

        console.warn(`[Webhook] HTTP ${res.status} on attempt ${attempt} | intent=${intentId?.slice(0, 20)}...`);
      } catch (err) {
        console.warn(`[Webhook] Attempt ${attempt} failed: ${err.message?.slice(0, 100)} | intent=${intentId?.slice(0, 20)}...`);
      }

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[Webhook] Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.error(`[Webhook] All ${maxAttempts} attempts failed for ${url} | intent=${intentId?.slice(0, 20)}...`);
    this.apiStats.webhooks.failed++;
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SERVICE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  async _handleLLMInference(intent, ctx) {
    return this._executeService(intent, ctx, SERVICE_TYPES.LLM_INFERENCE, {
      model: intent.args?.model || 'llama-3.1-70b',
      messages: [{ role: 'user', content: intent.args?.prompt || '' }],
      max_tokens: intent.args?.maxTokens || 1024,
      temperature: intent.args?.temperature || 0.7,
    });
  }

  async _handleImageGeneration(intent, ctx) {
    return this._executeService(intent, ctx, SERVICE_TYPES.IMAGE_GENERATION, {
      model: intent.args?.model || 'flux-schnell',
      prompt: intent.args?.prompt || '',
      n: intent.args?.count || 1,
      size: intent.args?.size || '1024x1024',
    });
  }

  async _handleSpeechToText(intent, ctx) {
    return this._executeService(intent, ctx, SERVICE_TYPES.SPEECH_TO_TEXT, {
      model: intent.args?.model || 'whisper-large-v3',
      audio_url: intent.args?.audioUrl || '',
      language: intent.args?.language || 'en',
    });
  }

  async _handleVoiceCloning(intent, ctx) {
    return this._executeService(intent, ctx, SERVICE_TYPES.VOICE_CLONING, {
      model: intent.args?.model || 'voice-clone-v1',
      reference_audio_url: intent.args?.referenceAudio || '',
      text: intent.args?.text || '',
    });
  }

  async _handleRAGQuery(intent, ctx) {
    return this._executeService(intent, ctx, SERVICE_TYPES.RAG_QUERY, {
      model: intent.args?.model || 'llama-3.1-70b',
      query: intent.args?.query || '',
      knowledge_base_id: intent.args?.knowledgeBaseId || '',
      top_k: intent.args?.topK || 5,
    });
  }

  async _handleVideoProcessing(intent, ctx) {
    return this._executeService(intent, ctx, SERVICE_TYPES.VIDEO_PROCESSING, {
      source_url: intent.args?.sourceUrl || '',
      operation: intent.args?.operation || 'transcode',
      output_format: intent.args?.format || 'mp4',
      resolution: intent.args?.resolution || '1080p',
    });
  }

  async _handleObjectDetection(intent, ctx) {
    return this._executeService(intent, ctx, SERVICE_TYPES.OBJECT_DETECTION, {
      model: intent.args?.model || 'yolov8',
      image_url: intent.args?.imageUrl || '',
      confidence_threshold: intent.args?.threshold || 0.5,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CORE EXECUTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute inference via Theta EdgeCloud API with RapidAPI + MCP fallback.
   * Fallback chain: EdgeCloud → RapidAPI → MCP → mock (with warning).
   * Per research doc §2.1, §2.3, and §2.4.
   */
  async _executeService(intent, ctx, serviceType, requestBody) {
    const intentId = intent.args?.intentId || `theta-inf-${Date.now()}`;
    const gpuTier = intent.args?.gpuTier;
    const gpuName = GPU_TIER_NAMES[gpuTier] || gpuTier || 'default';
    const modelName = requestBody.model || 'unknown';
    const typeName = SERVICE_TYPE_NAMES[serviceType] || `type-${serviceType}`;

    this.activeIntents.set(intentId, {
      intentId,
      serviceType,
      chain: ctx.chain,
      gpuTier: gpuName,
      model: modelName,
      status: 'processing',
      source: null,
      createdAt: Date.now(),
    });

    console.log(`[ThetaInference] Executing ${typeName} | model=${modelName} | gpu=${gpuName} | intent=${intentId.slice(0, 20)}...`);

    // Resolve API keys on first call
    if (!this._keyResolved) await this.resolveApiKeys();

    const startTime = Date.now();
    let result = null;
    let source = 'mock';

    try {
      // ── Priority 1: Theta EdgeCloud (native DePIN — preferred) ──────────
      if (this.edgeCloudApiKey) {
        result = await this._callEdgeCloud(serviceType, requestBody, modelName, gpuName);
        if (result) source = 'edgecloud';
      }

      // ── Priority 2: RapidAPI gateway (Theta-routed, still Theta infra) ──
      if (!result && this.useRapidApiFallback && this.rapidApiKey) {
        console.log(`[Router] EdgeCloud unavailable → trying RapidAPI...`);
        result = await this._callRapidAPI(serviceType, requestBody, modelName, gpuName);
        if (result) source = 'rapidapi';
      }

      // ── Priority 3: MCP Server (Theta toolchain) ─────────────────────────
      if (!result && this.useMcpFallback && this.mcpEndpoint) {
        console.log(`[Router] RapidAPI unavailable → trying MCP...`);
        result = await this._callMCP(serviceType, requestBody, modelName, gpuName);
        if (result) source = 'mcp';
      }

      // ── Priority 4: Akash Network DePIN ──────────────────────────────────
      if (!result && this.useAkashFallback && this.akashMnemonic) {
        console.log(`[Router] Theta tiers unavailable → trying Akash Network DePIN...`);
        result = await this._callAkash(serviceType, requestBody, modelName, gpuName);
        if (result) source = 'akash';
      }

      // ── Priority 5: Render Network DePIN ─────────────────────────────────
      if (!result && this.useRenderFallback && this.renderApiKey) {
        console.log(`[Router] Akash unavailable → trying Render Network DePIN...`);
        result = await this._callRender(serviceType, requestBody, modelName, gpuName);
        if (result) source = 'render';
      }

      // ── Priority 6: AWS Bedrock (cloud last resort) ───────────────────────
      if (!result && this.useBedrockFallback && this.awsAccessKeyId && this.awsSecretAccessKey) {
        console.log(`[Router] All DePINs unavailable → falling back to AWS Bedrock (centralized)...`);
        result = await this._callBedrock(serviceType, requestBody, modelName, gpuName);
        if (result) source = 'bedrock';
      }

      // ── Final: mock (dev/test only) ───────────────────────────────────────
      if (!result) {
        const reason = !this.edgeCloudApiKey && !this.rapidApiKey && !this.mcpEndpoint
          && !this.akashMnemonic && !this.renderApiKey && !this.awsAccessKeyId
          ? 'no API keys configured'
          : 'all providers failed';
        console.warn(`[Router] WARNING: Using mock response (${reason})`);
        result = this._mockResponse(serviceType);
        result._mock = true;
        result._warning = `Mock response — ${reason}. Configure at least one DePIN provider.`;
        this.apiStats.mock.calls++;
      }

    } catch (err) {
      console.error(`[ThetaInference] Unexpected error for ${intentId}: ${err.message}`);
      const entry = this.activeIntents.get(intentId);
      if (entry) {
        entry.status = 'failed';
        entry.error = err.message;
      }
      return { outcome: 'failed', details: { intentId, error: err.message } };
    }

    const latencyMs = Date.now() - startTime;
    const outputHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(result)));
    const modelHash = ethers.keccak256(ethers.toUtf8Bytes(modelName));

    const entry = this.activeIntents.get(intentId);
    entry.status = 'completed';
    entry.outputHash = outputHash;
    entry.modelHash = modelHash;
    entry.latencyMs = latencyMs;
    entry.result = result;
    entry.source = source;

    const sourceTag = source === 'mock' ? 'MOCK' : source.toUpperCase();
    console.log(`[${sourceTag}] ${modelName} on ${gpuName} — ${(latencyMs / 1000).toFixed(1)}s response | intent=${intentId.slice(0, 20)}...`);

    // Extract on-chain intentId from event args (bytes32 from InferenceIntentSubmitted)
    const onChainIntentId = intent.args?.intentId || intent.args?.[1] || null;

    // ─── Step 1: Call completeIntent on-chain ────────────────────────────
    if (this.contract && onChainIntentId && typeof onChainIntentId === 'string' && onChainIntentId.startsWith('0x')) {
      try {
        console.log(`[ThetaInference] Completing intent on-chain...`);
        const tx = await this.contract.completeIntent(
          onChainIntentId, outputHash, modelHash, latencyMs,
          { gasLimit: this.gasLimit }
        );
        const receipt = await tx.wait();
        this.apiStats.onChain.completes++;
        entry.status = 'completed_onchain';
        entry.completeTxHash = receipt.hash;
        console.log(`[ThetaInference] Completed intent on-chain | tx=${receipt.hash.slice(0, 18)}... | gas=${receipt.gasUsed}`);
      } catch (err) {
        this.apiStats.onChain.failures++;
        console.error(`[ThetaInference] completeIntent failed: ${err.message?.split('\n')[0]?.slice(0, 120)}`);
        entry.completeError = err.message;
      }
    }

    // ─── Step 1b: Attest EdgeCloud node ──────────────────────────────────
    // Binds the specific EdgeCloud node that executed this job to the intent.
    // providerTag = THETA_NATIVE when using EdgeCloud directly; HYBRID_FALLBACK
    // when routed through RapidAPI, MCP, or any non-Theta backend.
    // The nodeId is also encoded into SP1 publicValues (Step 2) so the ZK proof
    // cryptographically commits to the hardware that produced the output.
    if (this.contract && onChainIntentId && typeof onChainIntentId === 'string' && onChainIntentId.startsWith('0x') && entry.status === 'completed_onchain') {
      try {
        // Extract node metadata from EdgeCloud job response if available
        const nodeId = result._nodeId
          ? ethers.keccak256(ethers.toUtf8Bytes(result._nodeId))
          : ethers.keccak256(ethers.toUtf8Bytes(`edgecloud-${source}-${onChainIntentId.slice(0, 16)}`));

        const gpuFingerprint = ethers.keccak256(
          ethers.toUtf8Bytes(`${gpuName}-${result._driverVersion || 'unknown'}`)
        );

        // Petaflops in GFLOPS units — H100 ≈ 3958, A100 ≈ 2000, RTX4090 ≈ 165
        const GPU_GFLOPS = { H100_SXM: 3958, H100: 3958, A100: 2000, RTX_4090: 165 };
        const petaflopsUsed = BigInt(GPU_GFLOPS[gpuName.replace(/-/g, '_')] || 500);

        const providerTag = source === 'edgecloud' || source === 'rapidapi' || source === 'mcp'
          ? PROVIDER_TAG.THETA_NATIVE
          : source === 'akash'
          ? PROVIDER_TAG.DEPIN_AKASH
          : source === 'render'
          ? PROVIDER_TAG.DEPIN_RENDER
          : source === 'bedrock'
          ? PROVIDER_TAG.HYBRID_CLOUD
          : PROVIDER_TAG.HYBRID_FALLBACK;
        const tagLabel = PROVIDER_TAG_LABELS[providerTag] || 'UNKNOWN';

        console.log(`[ThetaInference] Attesting EdgeCloud node | tag=${tagLabel} | node=${nodeId.slice(0, 18)}...`);
        const attestTx = await this.contract.attestEdgeCloudNode(
          onChainIntentId,
          nodeId,
          gpuFingerprint,
          petaflopsUsed,
          providerTag,
          { gasLimit: this.gasLimit }
        );
        const attestReceipt = await attestTx.wait();
        entry.attestTxHash = attestReceipt.hash;
        entry.providerTag = tagLabel;
        console.log(`[ThetaInference] Node attested | tx=${attestReceipt.hash.slice(0, 18)}... | tag=${tagLabel} | gas=${attestReceipt.gasUsed}`);
        this.apiStats.onChain.attests++;
      } catch (err) {
        // Attestation failure is non-fatal — log and continue to proof generation
        console.warn(`[ThetaInference] attestEdgeCloudNode failed (non-fatal): ${err.message?.split('\n')[0]?.slice(0, 120)}`);
        entry.attestError = err.message;
        this.apiStats.onChain.attestFailures++;
      }
    }

    // ─── Step 2: Trigger SP1 proof generation — per Section 7 ────────────
    if (ctx.generateProof) {
      await ctx.generateProof({
        intentId,
        onChainIntentId,
        programVKey: '0x' + '00'.repeat(32),
        outputHash,
        modelHash,
        inputHash: intent.args?.inputHash || '0x' + '00'.repeat(32),
        // nodeId encoded in publicValues — ZK proof commits to the hardware
        // Layout: [serviceType(32) | modelHash(32) | inputHash(32) | outputHash(32) | nodeId(32)]
        nodeId: entry.attestTxHash
          ? ethers.keccak256(ethers.toUtf8Bytes(result._nodeId || `edgecloud-${source}-${onChainIntentId?.slice(0, 16)}`))
          : '0x' + '00'.repeat(32),
        providerTag: entry.providerTag || 'UNSET',
      });
    }

    // Return outcome for the listener to mark as FULFILLED
    return {
      outcome: 'fulfilled',
      details: {
        intentId,
        onChainIntentId,
        source,
        model: modelName,
        gpu: gpuName,
        latencyMs,
        outputHash,
        settled: entry.status === 'settled',
      },
    };
  }

  /**
   * Call Theta EdgeCloud On-Demand API.
   * Auth: x-api-key: {access_token}  (per https://docs.thetatoken.org/docs/edgecloud-api-keys)
   * Body: { input: { messages, max_tokens, ... }, stream: false, variant: "quantized" }
   * Endpoint: https://ondemand.thetaedgecloud.com/infer_request/{slug}/completions
   */
  async _callEdgeCloud(serviceType, body, modelName = '', gpuName = '') {
    const endpointTemplate = EDGECLOUD_ENDPOINTS[serviceType];
    if (!endpointTemplate) return null;

    const slug = EDGECLOUD_MODEL_SLUGS[modelName] || EDGECLOUD_MODEL_SLUGS['llama-3.1-8b'];
    const endpoint = endpointTemplate.replace('{slug}', slug);
    const url = `${this.edgeCloudBase}${endpoint}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.apiTimeout);
    const t0 = Date.now();

    // Wrap body in Theta's { input, stream, variant } format
    // Model is specified via URL slug, NOT in the body
    const thetaBody = {
      input: {
        messages: body.messages || [{ role: 'user', content: body.prompt || '' }],
        max_tokens: body.max_tokens || 500,
        temperature: body.temperature || 0.7,
        top_p: body.top_p || 0.9,
      },
      stream: false,
      variant: 'quantized',
    };

    this.apiStats.edgeCloud.calls++;
    console.log(`[EdgeCloud] POST ${endpoint} | model=${modelName} (${slug}) | gpu=${gpuName}`);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.edgeCloudApiKey,
        },
        body: JSON.stringify(thetaBody),
        signal: controller.signal,
      });

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        this.apiStats.edgeCloud.failures++;
        const errBody = await res.text().catch(() => '');
        console.warn(`[EdgeCloud] HTTP ${res.status} after ${elapsed}ms: ${errBody.slice(0, 200)}`);
        return null;
      }

      // Theta may return SSE stream (data: {...}) even with stream:false
      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        // Parse SSE: extract all "data: {...}" lines and merge
        const lines = rawText.split('\n').filter(l => l.startsWith('data: '));
        if (lines.length === 0) {
          console.warn(`[EdgeCloud] Unparseable response after ${elapsed}ms: ${rawText.slice(0, 200)}`);
          return null;
        }
        // Collect streamed chunks into a single response
        let fullContent = '';
        let lastParsed = null;
        for (const line of lines) {
          const json = line.slice(6).trim(); // strip "data: "
          if (json === '[DONE]') continue;
          try {
            const chunk = JSON.parse(json);
            lastParsed = chunk;
            const delta = chunk.choices?.[0]?.delta?.content
              || chunk.choices?.[0]?.message?.content
              || chunk.output || '';
            fullContent += delta;
          } catch { /* skip malformed chunks */ }
        }
        data = {
          choices: [{ message: { role: 'assistant', content: fullContent } }],
          model: lastParsed?.model || modelName,
          usage: lastParsed?.usage || { total_tokens: fullContent.split(/\s+/).length },
          _source: 'theta-edgecloud-ondemand-stream',
        };
      }

      this.apiStats.edgeCloud.successes++;
      this.apiStats.edgeCloud.totalLatencyMs += elapsed;
      console.log(`[EdgeCloud] ${modelName} on ${gpuName} — ${(elapsed / 1000).toFixed(1)}s response`);

      // Normalize Theta's response to OpenAI-compatible format
      if (data.choices) return data;
      if (data.output || data.result) {
        return {
          choices: [{ message: { role: 'assistant', content: data.output || data.result || JSON.stringify(data) } }],
          model: modelName,
          usage: data.usage || { total_tokens: 0 },
          _source: 'theta-edgecloud-ondemand',
        };
      }
      return data;
    } catch (err) {
      const elapsed = Date.now() - t0;
      this.apiStats.edgeCloud.failures++;
      if (err.name === 'AbortError') {
        console.warn(`[EdgeCloud] Request timed out after ${this.apiTimeout}ms`);
      } else {
        console.warn(`[EdgeCloud] Request failed after ${elapsed}ms: ${err.message}`);
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Call via RapidAPI.
   * Per research doc §2.4 — uses X-RapidAPI-Key and X-RapidAPI-Host headers.
   */
  async _callRapidAPI(serviceType, body, modelName = '', gpuName = '') {
    const endpoint = RAPIDAPI_ENDPOINTS[serviceType];
    if (!endpoint) return null;

    const url = `${this.rapidApiBase}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.apiTimeout);
    const t0 = Date.now();

    this.apiStats.rapidApi.calls++;
    console.log(`[RapidAPI] Calling ${endpoint} | model=${modelName} | gpu=${gpuName}`);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': this.rapidApiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        this.apiStats.rapidApi.failures++;
        const errBody = await res.text().catch(() => '');
        console.warn(`[RapidAPI] HTTP ${res.status} after ${elapsed}ms: ${errBody.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      this.apiStats.rapidApi.successes++;
      this.apiStats.rapidApi.totalLatencyMs += elapsed;
      console.log(`[RapidAPI] Called ${modelName} on ${gpuName} — ${(elapsed / 1000).toFixed(1)}s response`);
      return data;
    } catch (err) {
      const elapsed = Date.now() - t0;
      this.apiStats.rapidApi.failures++;
      if (err.name === 'AbortError') {
        console.warn(`[RapidAPI] Request timed out after ${this.apiTimeout}ms`);
      } else {
        console.warn(`[RapidAPI] Request failed after ${elapsed}ms: ${err.message}`);
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Call via MCP Server (@thetalabs/on-demand-api-mcp).
   * Per research doc §2.3 — Phase 2 stub. Ready for integration when
   * Theta publishes the MCP server npm package.
   */
  async _callMCP(serviceType, body, modelName = '', gpuName = '') {
    if (!this.mcpEndpoint) return null;

    const t0 = Date.now();
    this.apiStats.mcp.calls++;
    console.log(`[MCP] Calling ${this.mcpEndpoint} | model=${modelName} | gpu=${gpuName}`);

    try {
      const res = await fetch(this.mcpEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'inference',
          arguments: {
            model: body.model || modelName,
            prompt: body.messages?.[0]?.content || body.prompt || body.query || '',
            service_type: SERVICE_TYPE_NAMES[serviceType],
            ...body,
          },
        }),
      });

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        this.apiStats.mcp.failures++;
        console.warn(`[MCP] HTTP ${res.status} after ${elapsed}ms`);
        return null;
      }

      const data = await res.json();
      this.apiStats.mcp.successes++;
      this.apiStats.mcp.totalLatencyMs += elapsed;
      console.log(`[MCP] Called ${modelName} on ${gpuName} — ${(elapsed / 1000).toFixed(1)}s response`);
      return data;
    } catch (err) {
      const elapsed = Date.now() - t0;
      this.apiStats.mcp.failures++;
      console.warn(`[MCP] Request failed after ${elapsed}ms: ${err.message}`);
      return null;
    }
  }

  /**
   * DePIN Priority 4 — Akash Network GPU marketplace.
   *
   * Akash is a decentralised cloud built on Cosmos. Providers post bids;
   * deployers accept and run SDL (Stack Definition Language) workloads.
   *
   * At low volume we use the Akash REST gateway to submit and poll a job
   * rather than managing a full on-chain lease deployment cycle.
   * Full SDL deployment is tracked as a roadmap item (dedicated AkashCircuit).
   *
   * Env vars: AKASH_WALLET_MNEMONIC, AKASH_CERT_PEM, AKASH_GATEWAY_URL
   */
  async _callAkash(serviceType, body, modelName = '', gpuName = '') {
    // Only LLM inference is supported via the thin-client path
    if (serviceType !== SERVICE_TYPES.LLM_INFERENCE) return null;
    if (!this.akashMnemonic) return null;

    const t0 = Date.now();
    this.apiStats.akash.calls++;
    console.log(`[Akash] Submitting job | model=${modelName} | gpu=${gpuName}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.apiTimeout);

      // Thin-client gateway: POST a JSON job, receive result directly.
      // Production: replace gateway URL with actual Akash provider endpoint
      // or use the akash-js SDK for full on-chain lease flow.
      const payload = {
        model: modelName,
        messages: body.messages || [{ role: 'user', content: body.prompt || '' }],
        max_tokens: body.max_tokens || 512,
        temperature: body.temperature || 0.7,
        // Akash-specific fields
        _wallet: this.akashMnemonic.slice(0, 8) + '***', // masked for logs
      };

      const res = await fetch(this.akashGatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Provider': 'akash',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        this.apiStats.akash.failures++;
        const errBody = await res.text().catch(() => '');
        console.warn(`[Akash] HTTP ${res.status} after ${elapsed}ms: ${errBody.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      this.apiStats.akash.successes++;
      this.apiStats.akash.totalLatencyMs += elapsed;
      console.log(`[Akash] ${modelName} — ${(elapsed / 1000).toFixed(1)}s | provider=akash-depin`);

      return {
        choices: [{ message: { role: 'assistant', content: data.output || data.choices?.[0]?.message?.content || JSON.stringify(data) } }],
        model: modelName,
        usage: data.usage || { total_tokens: 0 },
        _source: 'akash-depin',
        _nodeId: data.provider_address || data.node_id || `akash-${Date.now()}`,
      };
    } catch (err) {
      const elapsed = Date.now() - t0;
      this.apiStats.akash.failures++;
      if (err.name === 'AbortError') {
        console.warn(`[Akash] Request timed out after ${this.apiTimeout}ms`);
      } else {
        console.warn(`[Akash] Request failed after ${elapsed}ms: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * DePIN Priority 5 — Render Network distributed GPU.
   *
   * Render is a marketplace of GPU nodes originally built for 3D rendering,
   * now expanding into AI inference. Jobs are submitted via the Render REST API.
   *
   * Supported service types: LLM_INFERENCE, IMAGE_GENERATION.
   * Env vars: RENDER_API_KEY, RENDER_API_BASE
   */
  async _callRender(serviceType, body, modelName = '', gpuName = '') {
    if (serviceType !== SERVICE_TYPES.LLM_INFERENCE && serviceType !== SERVICE_TYPES.IMAGE_GENERATION) return null;
    if (!this.renderApiKey) return null;

    const t0 = Date.now();
    this.apiStats.render.calls++;
    console.log(`[Render] Submitting job | model=${modelName} | gpu=${gpuName}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.apiTimeout);

      const isImage = serviceType === SERVICE_TYPES.IMAGE_GENERATION;
      const endpoint = isImage ? `${this.renderApiBase}/jobs/image` : `${this.renderApiBase}/jobs/inference`;

      const payload = isImage
        ? { model: modelName, prompt: body.prompt || '', n: body.n || 1, size: body.size || '1024x1024' }
        : { model: modelName, messages: body.messages || [{ role: 'user', content: body.prompt || '' }], max_tokens: body.max_tokens || 512 };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.renderApiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        this.apiStats.render.failures++;
        const errBody = await res.text().catch(() => '');
        console.warn(`[Render] HTTP ${res.status} after ${elapsed}ms: ${errBody.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      this.apiStats.render.successes++;
      this.apiStats.render.totalLatencyMs += elapsed;
      console.log(`[Render] ${modelName} — ${(elapsed / 1000).toFixed(1)}s | provider=render-depin`);

      if (isImage) {
        return {
          data: data.images || data.data || [{ url: data.output_url || '', revised_prompt: body.prompt }],
          _source: 'render-depin',
          _nodeId: data.node_id || `render-${Date.now()}`,
        };
      }
      return {
        choices: [{ message: { role: 'assistant', content: data.output || data.choices?.[0]?.message?.content || JSON.stringify(data) } }],
        model: modelName,
        usage: data.usage || { total_tokens: 0 },
        _source: 'render-depin',
        _nodeId: data.node_id || `render-${Date.now()}`,
      };
    } catch (err) {
      const elapsed = Date.now() - t0;
      this.apiStats.render.failures++;
      if (err.name === 'AbortError') {
        console.warn(`[Render] Request timed out after ${this.apiTimeout}ms`);
      } else {
        console.warn(`[Render] Request failed after ${elapsed}ms: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Cloud fallback (Priority 6) — AWS Bedrock.
   *
   * Bedrock is a managed AI service — pay-as-you-go, zero idle cost.
   * Uses SigV4 signing (same helper already in resolveApiKeys for Secrets Manager).
   * Env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
   *
   * Only LLM_INFERENCE is routed here; other service types fall through to mock.
   */
  async _callBedrock(serviceType, body, modelName = '', gpuName = '') {
    if (serviceType !== SERVICE_TYPES.LLM_INFERENCE) return null;
    if (!this.awsAccessKeyId || !this.awsSecretAccessKey) return null;

    const t0 = Date.now();
    this.apiStats.bedrock.calls++;

    const modelId = BEDROCK_MODEL_MAP[modelName] || BEDROCK_MODEL_MAP['llama-3.1-8b'];
    console.log(`[Bedrock] Invoking ${modelId} | region=${this.awsRegion}`);

    try {
      const { createHmac, createHash } = await import('crypto');
      const hash = (data) => createHash('sha256').update(data).digest('hex');
      const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

      const now = new Date();
      const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const dateStamp = amzDate.slice(0, 8);

      const region = this.awsRegion;
      const service = 'bedrock';
      const host = `bedrock-runtime.${region}.amazonaws.com`;
      const endpoint = `https://${host}/model/${encodeURIComponent(modelId)}/invoke`;

      // Claude uses a different body format than Llama/Titan
      const isAnthropic = modelId.startsWith('anthropic.');
      const reqBody = isAnthropic
        ? JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: body.max_tokens || 512,
            messages: body.messages || [{ role: 'user', content: body.prompt || '' }],
          })
        : JSON.stringify({
            prompt: body.messages?.[0]?.content || body.prompt || '',
            max_gen_len: body.max_tokens || 512,
            temperature: body.temperature || 0.7,
          });

      const payloadHash = hash(reqBody);
      const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-date';
      const canonicalRequest = `POST\n/model/${encodeURIComponent(modelId)}/invoke\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hash(canonicalRequest)}`;

      let signingKey = hmac(`AWS4${this.awsSecretAccessKey}`, dateStamp);
      signingKey = hmac(signingKey, region);
      signingKey = hmac(signingKey, service);
      signingKey = hmac(signingKey, 'aws4_request');
      const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
      const authHeader = `AWS4-HMAC-SHA256 Credential=${this.awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.apiTimeout);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Amz-Date': amzDate,
          'Authorization': authHeader,
        },
        body: reqBody,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const elapsed = Date.now() - t0;

      if (!res.ok) {
        this.apiStats.bedrock.failures++;
        const errBody = await res.text().catch(() => '');
        console.warn(`[Bedrock] HTTP ${res.status} after ${elapsed}ms: ${errBody.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      this.apiStats.bedrock.successes++;
      this.apiStats.bedrock.totalLatencyMs += elapsed;
      console.log(`[Bedrock] ${modelId} — ${(elapsed / 1000).toFixed(1)}s | CENTRALIZED FALLBACK`);

      const content = isAnthropic
        ? data.content?.[0]?.text || JSON.stringify(data)
        : data.generation || data.outputs?.[0]?.text || JSON.stringify(data);

      return {
        choices: [{ message: { role: 'assistant', content } }],
        model: modelId,
        usage: data.usage || { total_tokens: 0 },
        _source: 'aws-bedrock',
        _nodeId: `bedrock-${region}-${Date.now()}`,
        _driverVersion: 'bedrock-managed',
      };
    } catch (err) {
      const elapsed = Date.now() - t0;
      this.apiStats.bedrock.failures++;
      if (err.name === 'AbortError') {
        console.warn(`[Bedrock] Request timed out after ${this.apiTimeout}ms`);
      } else {
        console.warn(`[Bedrock] Request failed after ${elapsed}ms: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Mock response for development/testing without API keys.
   */
  _mockResponse(serviceType) {
    const mocks = {
      [SERVICE_TYPES.LLM_INFERENCE]: {
        choices: [{ message: { role: 'assistant', content: 'Mock LLM response from Theta EdgeCloud' } }],
        model: 'llama-3.1-70b', usage: { total_tokens: 42 },
      },
      [SERVICE_TYPES.IMAGE_GENERATION]: {
        data: [{ url: 'https://edgecloud.theta.tv/mock/image.png', revised_prompt: 'Mock image' }],
      },
      [SERVICE_TYPES.SPEECH_TO_TEXT]: {
        text: 'Mock transcription of audio content via Whisper on Theta EdgeCloud',
        language: 'en', duration: 12.5,
      },
      [SERVICE_TYPES.VOICE_CLONING]: {
        audio_url: 'https://edgecloud.theta.tv/mock/cloned-voice.mp3',
        duration: 5.2,
      },
      [SERVICE_TYPES.RAG_QUERY]: {
        answer: 'Mock RAG response with retrieved context from knowledge base',
        sources: [{ id: 'doc-1', relevance: 0.95 }],
      },
      [SERVICE_TYPES.VIDEO_PROCESSING]: {
        output_url: 'https://edgecloud.theta.tv/mock/transcoded.mp4',
        status: 'completed', resolution: '1080p',
      },
      [SERVICE_TYPES.OBJECT_DETECTION]: {
        detections: [
          { label: 'person', confidence: 0.97, bbox: [100, 50, 200, 300] },
          { label: 'car', confidence: 0.89, bbox: [300, 200, 500, 400] },
        ],
      },
    };

    return mocks[serviceType] || { status: 'mock', serviceType };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRESET INTENT (one-click flow — shared by UI and agent API)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle a preset-based intent (used by both ThetaAI.tsx and /theta-ai/agent-intent).
   * Resolves preset defaults, applies GPU pricing, then routes to EdgeCloud.
   */
  async handlePresetIntent({ preset, gpu_tier, gpu, prompt, model, sender, max_tokens, temperature, callbackUrl }) {
    // Accept both 'gpu' and 'gpu_tier' for convenience
    gpu_tier = gpu_tier || gpu;
    const presetConfig = PRESET_HOOKS[preset];
    if (!presetConfig) {
      return { error: `Unknown preset: ${preset}`, status: 400 };
    }

    const gpuConfig = GPU_TIERS[gpu_tier];
    if (!gpuConfig) {
      return { error: `Unknown GPU tier: ${gpu_tier}`, status: 400 };
    }

    const resolvedModel = model || presetConfig.defaultModel;
    const resolvedPrompt = prompt || presetConfig.defaultPrompt;
    const serviceType = presetConfig.serviceType;

    const fakeIntent = {
      type: 'preset_intent',
      args: {
        intentId: `preset-${preset}-${Date.now()}`,
        serviceType,
        model: resolvedModel,
        prompt: resolvedPrompt,
        maxTokens: max_tokens || 1024,
        temperature: temperature || 0.7,
        gpuTier: gpu_tier,
      },
    };

    const ctx = {
      chain: 'theta_mainnet',
      generateProof: null,
    };

    await this.onIntent(fakeIntent, ctx);

    const entry = this.activeIntents.get(fakeIntent.args.intentId);

    // Store callbackUrl on the active intent for later webhook delivery (onProofReady)
    if (callbackUrl && entry) {
      entry.callbackUrl = callbackUrl;
    }

    const response = {
      task_id: fakeIntent.args.intentId,
      status: entry?.status || 'processing',
      preset,
      gpu_tier,
      gpu_name: gpuConfig.name,
      model: resolvedModel,
      price_multiplier: gpuConfig.priceMultiplier,
      result: entry?.result || null,
      latency_ms: entry?.latencyMs || null,
    };

    // For immediate completions (no on-chain proof pipeline), fire webhook now
    if (callbackUrl && entry?.status === 'completed') {
      const payload = {
        task_id: response.task_id,
        output: entry.result,
        proof: null,
        status: entry.status,
        latency_ms: entry.latencyMs,
        settled_tx: null,
      };
      this._deliverWebhook(callbackUrl, payload, response.task_id).catch(err => {
        console.error(`[Webhook] Background delivery failed: ${err.message?.slice(0, 100)}`);
      });
    }

    return response;
  }

  /**
   * Register HTTP routes for the agent/M2M API.
   * Designed to plug into an Express-compatible app.
   */
  registerAgentRoutes(app) {
    app.post('/theta-ai/agent-intent', async (req, res) => {
      try {
        const result = await this.handlePresetIntent(req.body);
        if (result.error) {
          return res.status(result.status || 400).json(result);
        }
        res.status(202).json(result);
      } catch (err) {
        this.log.error?.(`[ThetaInference] Agent intent error: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.get('/theta-ai/presets', (_req, res) => {
      res.json({
        presets: Object.entries(PRESET_HOOKS).map(([key, p]) => ({
          key,
          ...p,
          gpu_tiers: Object.entries(GPU_TIERS).map(([gk, g]) => ({
            key: gk, ...g,
          })),
        })),
      });
    });

    app.get('/theta-ai/gpu-tiers', (_req, res) => {
      res.json({ gpu_tiers: GPU_TIERS });
    });

    app.get('/theta-ai/catalog', (_req, res) => {
      res.json({
        presets: Object.entries(PRESET_HOOKS).map(([key, p]) => ({
          key, ...p,
          curl: `curl -X POST http://localhost:3002/theta-ai/agent-intent -H "Content-Type: application/json" -d '{"preset":"${key}","gpu_tier":"${p.defaultGpu}"}'`,
        })),
        services: Object.entries(SERVICE_TYPES).map(([name, id]) => ({ name, id })),
        gpu_tiers: GPU_TIERS,
        full_catalog: FULL_CATALOG,
      });
    });

    app.get('/theta-ai/webhook-status/:taskId', (req, res) => {
      const entry = this.activeIntents.get(req.params.taskId);
      if (!entry) {
        return res.status(404).json({ error: 'Intent not found' });
      }
      res.json({
        task_id: req.params.taskId,
        status: entry.status,
        callbackUrl: entry.callbackUrl || null,
        latency_ms: entry.latencyMs || null,
        webhook_stats: { ...this.apiStats.webhooks },
      });
    });

    app.get('/theta-ai/stats', (_req, res) => {
      res.json(this.getMonitoringStats(this._listenerRef || null));
    });

    app.get('/theta-ai/openapi.json', (_req, res) => {
      res.json(OPENAPI_SPEC);
    });
  }

  /**
   * Set a reference to the CoreListener instance for RPC health data.
   * Called when handler is registered with a listener.
   */
  setListenerRef(listener) {
    this._listenerRef = listener;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CIRCUIT INTERFACE
  // ═══════════════════════════════════════════════════════════════════════════

  getInterface() {
    return this.iface;
  }

  getTopics() {
    return [this.iface.getEvent('InferenceIntentSubmitted').topicHash];
  }

  getActiveIntents() {
    return Object.fromEntries(this.activeIntents);
  }

  getStats() {
    const stats = { total: 0, completed: 0, failed: 0, byType: {} };
    for (const [, entry] of this.activeIntents) {
      stats.total++;
      if (entry.status === 'completed' || entry.status === 'proof_ready') stats.completed++;
      if (entry.status === 'failed') stats.failed++;
      stats.byType[entry.serviceType] = (stats.byType[entry.serviceType] || 0) + 1;
    }
    return stats;
  }

  /**
   * Build the full monitoring stats payload for the dashboard and agent JSON endpoint.
   * Combines intent history, RPC health, webhook delivery, and failure prediction.
   */
  getMonitoringStats(listenerRef = null) {
    const recentIntents = [];
    const entries = Array.from(this.activeIntents.values());
    const sorted = entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 50);

    for (const e of sorted) {
      recentIntents.push({
        intentId: e.intentId,
        serviceType: typeof e.serviceType === 'number' ? e.serviceType : 0,
        gpuTier: e.gpuTier || 'default',
        status: e.status,
        latencyMs: e.latencyMs || null,
        source: e.source || null,
        createdAt: e.createdAt || Date.now(),
        model: e.model || 'unknown',
        txHash: e.settleTxHash || e.completeTxHash || null,
      });
    }

    // RPC health from listener chain errors (if listener reference provided)
    const rpcHealth = [];
    if (listenerRef) {
      const status = listenerRef.getStatus();
      for (const [chainKey, chain] of Object.entries(status.chains)) {
        const errTracker = listenerRef.chainErrors?.get(chainKey);
        rpcHealth.push({
          chain: chainKey,
          name: chain.name || chainKey,
          connected: chain.connected || false,
          lastBlock: chain.lastBlock || 0,
          errorCount: errTracker?.consecutive || 0,
          lastError: errTracker?.lastMsg || null,
        });
      }
    }

    // Webhook stats
    const webhookTotal = this.apiStats.webhooks.delivered + this.apiStats.webhooks.failed;
    const webhooks = {
      delivered: this.apiStats.webhooks.delivered,
      failed: this.apiStats.webhooks.failed,
      pending: 0,
      deliveryRate: webhookTotal > 0
        ? ((this.apiStats.webhooks.delivered / webhookTotal) * 100).toFixed(1) + '%'
        : '100%',
    };

    // Failure prediction based on error patterns
    const failurePrediction = this._computeFailurePrediction(rpcHealth);

    // Summary
    const basicStats = this.getStats();
    const totalLatency = entries.reduce((s, e) => s + (e.latencyMs || 0), 0);
    const completedWithLatency = entries.filter(e => e.latencyMs).length;

    return {
      intents: recentIntents,
      rpcHealth,
      webhooks,
      failurePrediction,
      summary: {
        totalIntents: basicStats.total,
        completedIntents: basicStats.completed,
        failedIntents: basicStats.failed,
        avgLatencyMs: completedWithLatency > 0 ? Math.round(totalLatency / completedWithLatency) : 0,
        uptime: process.uptime ? Math.round(process.uptime()) : 0,
        apiMode: this.edgeCloudApiKey ? 'LIVE' : this.rapidApiKey ? 'RAPIDAPI' : 'MOCK',
      },
    };
  }

  /**
   * Failure prediction based on RPC error counts, webhook failure rate, and API latency.
   * Returns a risk level (low/medium/high) with human-readable message and contributing factors.
   */
  _computeFailurePrediction(rpcHealth = []) {
    const factors = [];
    let riskScore = 0;

    // Check RPC errors
    const totalRpcErrors = rpcHealth.reduce((s, r) => s + (r.errorCount || 0), 0);
    const disconnectedChains = rpcHealth.filter(r => !r.connected).length;

    if (disconnectedChains > 0) {
      riskScore += disconnectedChains * 20;
      factors.push(`${disconnectedChains} chain(s) disconnected`);
    }
    if (totalRpcErrors > 10) {
      riskScore += 15;
      factors.push(`${totalRpcErrors} RPC errors`);
    } else if (totalRpcErrors > 3) {
      riskScore += 5;
      factors.push(`${totalRpcErrors} RPC errors (minor)`);
    }

    // Check webhook failure rate
    const webhookTotal = this.apiStats.webhooks.delivered + this.apiStats.webhooks.failed;
    if (webhookTotal > 0) {
      const failRate = this.apiStats.webhooks.failed / webhookTotal;
      if (failRate > 0.2) {
        riskScore += 25;
        factors.push(`High webhook failure rate (${(failRate * 100).toFixed(0)}%)`);
      } else if (failRate > 0.05) {
        riskScore += 10;
        factors.push(`Elevated webhook failures (${(failRate * 100).toFixed(1)}%)`);
      }
    }

    // Check API backend status
    if (!this.edgeCloudApiKey && !this.rapidApiKey) {
      riskScore += 5;
      factors.push('No live API keys — mock mode');
    }

    // Check EdgeCloud failure rate
    if (this.apiStats.edgeCloud.calls > 0) {
      const ecFailRate = this.apiStats.edgeCloud.failures / this.apiStats.edgeCloud.calls;
      if (ecFailRate > 0.3) {
        riskScore += 20;
        factors.push(`EdgeCloud failure rate ${(ecFailRate * 100).toFixed(0)}%`);
      }
    }

    // Average latency check
    if (this.apiStats.edgeCloud.successes > 0) {
      const avgMs = this.apiStats.edgeCloud.totalLatencyMs / this.apiStats.edgeCloud.successes;
      if (avgMs > 30000) {
        riskScore += 15;
        factors.push(`High avg latency (${(avgMs / 1000).toFixed(1)}s)`);
      } else if (avgMs > 15000) {
        riskScore += 5;
        factors.push(`Elevated avg latency (${(avgMs / 1000).toFixed(1)}s)`);
      }
    }

    let level, message;
    if (riskScore >= 40) {
      level = 'high';
      message = 'High risk of timeout or failure — check RPC connections and API keys';
    } else if (riskScore >= 15) {
      level = 'medium';
      message = 'Some degradation detected — monitor closely';
    } else {
      level = 'low';
      message = 'All systems nominal';
    }

    return { level, message, factors };
  }
}

export {
  ThetaInferenceHandler,
  CIRCUIT_ID as THETA_INFERENCE_CIRCUIT_ID,
  CIRCUIT_ABI,
  INFERENCE_EVENTS,
  SERVICE_TYPES,
  SERVICE_TYPE_NAMES,
  EDGECLOUD_ENDPOINTS,
  RAPIDAPI_ENDPOINTS,
  GPU_TIERS,
  GPU_TIER_NAMES,
  PRESET_HOOKS,
  FULL_CATALOG,
  OPENAPI_SPEC,
};
export default ThetaInferenceHandler;

// ─── Self-Running Agent API Server (when executed directly) ──────────────────

const isMainModule = typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('theta-inference-handler.js') || process.argv[1].endsWith('theta-inference-handler'));

if (isMainModule) {
  (async () => {
    try {
      const dotenv = await import('dotenv');
      dotenv.config();
      dotenv.config({ path: '.env.local', override: true });

      const { default: express } = await import('express');
      const app = express();
      app.use(express.json());

      const port = parseInt(process.env.AGENT_API_PORT) || 3002;

      console.log('═══════════════════════════════════════════════════════════');
      console.log('  XFuel Protocol — Theta AI Agent API');
      console.log('═══════════════════════════════════════════════════════════');

      const envStatus = ThetaInferenceHandler.validateEnv();
      console.log(`  EdgeCloud key: ${envStatus.edgeCloudKey}`);
      console.log(`  RapidAPI key:  ${envStatus.rapidApiKey}`);
      console.log(`  MCP endpoint:  ${envStatus.mcpEndpoint}`);

      const handler = new ThetaInferenceHandler({
        edgeCloudApiKey: process.env.THETA_EDGECLOUD_API_KEY || '',
        rapidApiKey: process.env.THETA_RAPIDAPI_KEY || '',
        mcpEndpoint: process.env.THETA_MCP_ENDPOINT || '',
        contractAddress: process.env.THETA_INFERENCE_ADDRESS || null,
        rpcUrl: process.env.THETA_TESTNET_RPC || 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
      });

      await handler.resolveApiKeys();

      const apiStatus = handler.getApiStatus();
      const modeLabel = apiStatus.mode === 'LIVE' ? 'ENABLED'
        : apiStatus.mode === 'RAPIDAPI' ? 'RAPIDAPI' : 'MOCK';

      handler.registerAgentRoutes(app);

      app.get('/health', (_req, res) => {
        res.json({ status: 'ok', mode: apiStatus.mode, uptime: process.uptime() });
      });

      app.listen(port, () => {
        console.log('');
        console.log(`  ✓ Agent API listening on http://localhost:${port}`);
        console.log(`  ✓ Live EdgeCloud: ${modeLabel} (key ${apiStatus.edgeCloud.enabled ? 'loaded' : 'missing'})`);
        console.log('');
        console.log('  Endpoints:');
        console.log(`    POST http://localhost:${port}/theta-ai/agent-intent`);
        console.log(`    GET  http://localhost:${port}/theta-ai/presets`);
        console.log(`    GET  http://localhost:${port}/theta-ai/gpu-tiers`);
        console.log(`    GET  http://localhost:${port}/theta-ai/stats`);
        console.log(`    GET  http://localhost:${port}/theta-ai/webhook-status/:taskId`);
        console.log(`    GET  http://localhost:${port}/theta-ai/openapi.json`);
        console.log(`    GET  http://localhost:${port}/health`);
        console.log('═══════════════════════════════════════════════════════════\n');
      });

    } catch (err) {
      console.error('\n  ✗ Agent API failed to start:', err.message);
      console.error('    Stack:', err.stack);
      process.exit(1);
    }
  })();
}
