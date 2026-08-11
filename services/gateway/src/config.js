import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for XFuel gateway (agent routing, x402/USDC on Base, proofs, receipts).
 * EdgeCloud / Theta RPC remain available as optional provider ops — not settlement home (ADR 0002).
 */
// ── Theta RPC failover list ────────────────────────────────────────────────
// Order = failover priority (MultiRpcProvider uses index 0 as primary). If a
// ZAN Node Service endpoint is configured it becomes primary, with the explicit
// THETA_RPC_URLS list (or the public defaults) retained as fallback so ZAN is
// never a single point of failure. Deduped; empties stripped.
const PUBLIC_THETA_RPCS = [
  'https://eth-rpc-api.thetatoken.org/rpc',          // mainnet 361
  'https://eth-rpc-api-testnet.thetatoken.org/rpc',  // testnet 365
];
const explicitThetaRpcs = process.env.THETA_RPC_URLS
  ? process.env.THETA_RPC_URLS.split(',').map((u) => u.trim()).filter(Boolean)
  : null;
const zanThetaRpc = (process.env.ZAN_THETA_RPC_URL || '').trim();
const thetaRpcUrls = [
  ...(zanThetaRpc ? [zanThetaRpc] : []),
  ...(explicitThetaRpcs || PUBLIC_THETA_RPCS),
].filter((url, i, arr) => url && arr.indexOf(url) === i);

const config = {
  // Theta RPC Configuration — ZAN primary (if set) + public fallback; see thetaRpcUrls above
  theta: {
    rpcUrls: thetaRpcUrls,
    timeout: parseInt(process.env.RPC_TIMEOUT_MS) || 30000,
    requiredConfirmations: parseInt(process.env.REQUIRED_CONFIRMATIONS) || 3,
    blockPollInterval: parseInt(process.env.BLOCK_POLL_INTERVAL_MS) || 5000
  },

  // Contract Configuration
  contracts: {
    /** Phase 1 Fair Exchange: A2ACircuit address for settleBidFairExchange (optional). */
    a2aCircuitAddress: process.env.A2A_CIRCUIT_ADDRESS || null,
  },

  // x402 / USDC payment rail (ADR 0001 / 0002). Default rail is USDC on Base.
  // Optional TFUEL fallback only if X402_FALLBACK_TFUEL=true. Payer is agent-side.
  // See docs/X402_ADAPTER.md.
  x402: {
    enabled: process.env.X402_ENABLED === 'true',
    // Server default rail when a request omits payment.rail.
    defaultRail: (process.env.X402_DEFAULT_RAIL || 'usdc').toLowerCase() === 'tfuel' ? 'tfuel' : 'usdc',
    // If usdc is requested but the facilitator is unavailable: fall back to TFUEL
    // (true) or return 503 (false).
    fallbackToTfuel: process.env.X402_FALLBACK_TFUEL === 'true',
    // Facilitator protocol: 'x402' (standard public Base facilitator) or 'zan'.
    facilitatorProvider: (process.env.X402_FACILITATOR_PROVIDER || 'x402').toLowerCase() === 'zan' ? 'zan' : 'x402',
    // Standard x402 facilitator URL (used when facilitatorProvider='x402'); null →
    // network-aware default (base-sepolia → x402.org; base → CDP mainnet URL).
    facilitatorUrl: process.env.X402_FACILITATOR_URL || null,
    gatewayUrl: process.env.ZAN_X402_GATEWAY_URL || null,   // ZAN facilitator (verify + settle)
    // ZAN key OR static bearer for non-CDP facilitators. CDP mainnet uses
    // CDP_API_KEY_ID + CDP_API_KEY_SECRET (see cdp-jwt.js) — do not put those here.
    apiKey: process.env.X402_FACILITATOR_API_KEY || process.env.ZAN_X402_API_KEY || null,
    payTo: process.env.X402_PAY_TO || null,                 // Base USDC treasury / Safe
    network: process.env.X402_NETWORK || 'base-sepolia',    // base-sepolia | base
    asset: process.env.X402_ASSET || 'USDC',
    challengeTtlMs: parseInt(process.env.X402_CHALLENGE_TTL_MS, 10) || 120000,
    // Phase 2: bind the x402 payment_ref into the SP1 proof so it attests BOTH
    // computation AND payment. Flag-gated (default off). When on, the backend
    // computes a deterministic payment commitment and threads it to the prover;
    // full in-proof attestation activates once the SP1 guest commits the v2 layout
    // (new programVKey). See docs/X402_ADAPTER.md §"Phase 2 proof binding".
    proofBinding: process.env.X402_PROOF_BINDING === 'true',
    // USDC pricing (smallest unit, 6dp). Default per task + optional per-model JSON map.
    usdcPriceDefault: process.env.X402_USDC_PRICE_DEFAULT || '10000', // $0.01
    usdcPrices: (() => {
      if (!process.env.X402_USDC_PRICES) return {};
      try { return JSON.parse(process.env.X402_USDC_PRICES); } catch { return {}; }
    })(),
  },

  // Verifiable receipts. When a signing secret is set, public receipts carry a
  // Tier-1 HMAC signature over the payment-bound tuple (PBR) so a third party can
  // detect tampering. Off by default → receipt JSON is unchanged. Dedicated secret
  // (NOT reused from WEBHOOK_SECRET) so enabling webhooks never implies signing.
  receipts: {
    signingSecret: process.env.RECEIPT_SIGNING_SECRET || null,
  },

  // Private Spend v0 — vendor-blind routing mode. Buyer pays XFuel; providers see
  // gateway-pooled credentials only. See docs/PRIVATE_SPEND_THESIS.md.
  privateSpend: {
    enabled: process.env.PRIVATE_SPEND_ENABLED === 'true',
    // When true (default if Private Spend on), omit prompt/input bodies from long-lived logs.
    minimizeLogs: process.env.PRIVATE_SPEND_MINIMIZE_LOGS !== 'false',
  },

  // Provider Float Manager v0 (ADR 0005) — prepaid COGS; buyer rail stays USDC.
  // See docs/PROVIDER_FLOAT_TREASURY.md. No hot-path FX.
  providerFloats: {
    json: process.env.PROVIDER_FLOATS_JSON || null,
    cogsBps: parseInt(process.env.PROVIDER_COGS_BPS, 10) || 7000,
    defaultProvider: process.env.PROVIDER_FLOAT_DEFAULT || 'theta-edgecloud',
    enforce: process.env.PROVIDER_FLOAT_ENFORCE === 'true',
    publicBalances: process.env.PROVIDER_FLOAT_PUBLIC_BALANCES === 'true',
  },

  // Verified Inference tier engine (Phase 4). Disabled by default → receipts behave as before
  // (proof.tier = settlement/signed, no verified_inference block). When enabled, the gateway
  // prices trust to value-at-risk and stamps the selected tier + honest attestation/spot-check
  // summaries on the receipt. See docs/VERIFIED_INFERENCE_TIERS.md.
  verifiedInference: {
    enabled: process.env.VERIFIED_INFERENCE_ENABLED === 'true',
    tier2Min: process.env.VI_TIER2_MIN_USDC || '10000',      // ≥ this → settlement floor
    tier3Min: process.env.VI_TIER3_MIN_USDC || '1000000',    // ≥ this → inference floor
    defaultMechanism: process.env.VI_DEFAULT_MECHANISM || 'tee',
    available: {
      settlement: process.env.VI_SETTLEMENT_AVAILABLE !== 'false',
      tee: process.env.VI_TEE_ENABLED === 'true',
      'zk-spotcheck': process.env.VI_SPOTCHECK_ENABLED === 'true',
      'zk-full': process.env.VI_ZKFULL_ENABLED === 'true',
    },
    tee: {
      allowedVendors: (process.env.VI_TEE_VENDORS || 'dev').split(',').map((s) => s.trim()).filter(Boolean),
      allowedSigners: (process.env.VI_TEE_SIGNERS || '').split(',').map((s) => s.trim()).filter(Boolean),
      allowedMeasurements: (process.env.VI_TEE_MEASUREMENTS || '').split(',').map((s) => s.trim()).filter(Boolean),
      requireModelRootMatch: process.env.VI_TEE_REQUIRE_MODEL_ROOT === 'true',
    },
    spotcheck: {
      rateBps: parseInt(process.env.VI_SPOTCHECK_RATE_BPS, 10) || 0,
      seed: process.env.VI_SPOTCHECK_SEED || null,
    },
    stakingAddress: process.env.PROVIDER_STAKING_ADDRESS || null,
  },

  // ERC-8004 (Trustless Agents) Validation Registry adapter (Phase 3). XFuel acts as a
  // validator: an XFuel receipt → a validationResponse verdict. Default is non-custodial —
  // POST /erc8004/validate returns a ready-to-submit record + calldata; set autoSubmit=true
  // (with a submitter key + adapter) to have the gateway push the verdict on-chain itself.
  erc8004: {
    registryAddress: process.env.ERC8004_VALIDATION_REGISTRY || null,   // the ERC-8004 registry
    adapterAddress: process.env.XFUEL_VALIDATION_ADAPTER || null,       // contracts/core/XFuelValidationAdapter.sol
    // The address agents name as `validatorAddress` in their request (usually the adapter).
    validatorAddress:
      process.env.XFUEL_VALIDATOR_ADDRESS || process.env.XFUEL_VALIDATION_ADAPTER || null,
    autoSubmit: process.env.ERC8004_AUTO_SUBMIT === 'true',
    submitterKey: process.env.ERC8004_SUBMITTER_KEY || null,            // only used when autoSubmit
    rpcUrl: process.env.ERC8004_RPC_URL || process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || null,
  },

  // On-chain settlement proof home (ADR 0002) — Base Sepolia / Base.
  // Deploy: npx hardhat run deploy/base-verifier.cjs --network base-sepolia
  settlement: {
    chainId: parseInt(process.env.VERIFIER_CHAIN_ID || process.env.SETTLEMENT_CHAIN_ID || '84532', 10),
    rpcUrl: process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || null,
    zkVerifierAddress: process.env.ZK_VERIFIER_ADDRESS || process.env.VERIFIER_ADDRESS || null,
  },

  // USDC revenue split (ADR 0001 — token-light). Protocol fees land at ONE address on
  // Base — a Splits v2 Split — which fans USDC out to the buckets OFF the hot path.
  // Per-bucket addresses/bps live in env (see revenue-split.js); XF buyback-burn is a
  // downstream treasury op, not a per-task rake. splitAddress falls back to X402_PAY_TO
  // so a single treasury address works until the Split is deployed.
  revenue: {
    // Deployed Splits v2 Split address on Base (fees land here). Falls back to payTo.
    splitAddress: process.env.REVENUE_SPLIT_ADDRESS || process.env.X402_PAY_TO || null,
    network: process.env.REVENUE_NETWORK || process.env.X402_NETWORK || 'base',
    // Distributor incentive (uint16) baked into the Split at deploy (0 = none).
    distributionIncentive: parseInt(process.env.REVENUE_DISTRIBUTION_INCENTIVE, 10) || 0,
  },

  // Redis Configuration
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0
  },

  // Relayer Configuration (optional for zkGPT-only / dev; refunds and Fair Exchange submit need it)
  relayer: {
    privateKey: (() => {
      const v = process.env.RELAYER_PRIVATE_KEY;
      if (!v || typeof v !== 'string') return null;
      if (/YOUR_|_HERE|your_key|placeholder|0x\.\.\./i.test(v.trim())) return null;
      return v.trim();
    })(),
    gasLimit: parseInt(process.env.RELAYER_GAS_LIMIT) || 100000,
    maxFeePerGas: BigInt(process.env.RELAYER_MAX_FEE_PER_GAS || '100000000000')
  },

  // Expiry Configuration
  expiry: {
    minutes: parseInt(process.env.EXPIRY_MINUTES) || 30,
    get milliseconds() {
      return this.minutes * 60 * 1000;
    }
  },

  // ZK Proof Configuration
  // NOTE: Legacy Groth16 circuit paths (Phase 0) - kept for historical reference
  // Production uses SP1 zkVM prover (see sp1-program/ directory and SP1 config below)
  zk: {
    circuitWasm: process.env.ZK_CIRCUIT_WASM || join(__dirname, '../circuits/circuit.wasm'),
    circuitZkey: process.env.ZK_CIRCUIT_ZKEY || join(__dirname, '../circuits/circuit_final.zkey'),
    verificationKey: process.env.ZK_VERIFICATION_KEY || join(__dirname, '../circuits/verification_key.json')
  },

  // SP1 zkVM Configuration
  // Primary: Theta EdgeCloud (CUDA GPU, paid in TFUEL)
  // Fallback: Succinct Network (optional, set SP1_FALLBACK_URL)
  sp1: {
    proverUrl: process.env.SP1_PROVER_URL || null,
    fallbackUrl: process.env.SP1_FALLBACK_URL || null,
    timeout: parseInt(process.env.SP1_PROVER_TIMEOUT) || 120000,
    retries: parseInt(process.env.SP1_PROVER_RETRIES) || 3,
    fallbackToMock: process.env.SP1_PROVER_FALLBACK_MOCK === 'true',
    batchingEnabled: process.env.SP1_BATCHING_ENABLED !== 'false',
    batchSize: parseInt(process.env.SP1_BATCH_SIZE) || 10,
    batchTimeout: parseInt(process.env.SP1_BATCH_TIMEOUT_MS) || 10000,
    minBatchSize: parseInt(process.env.SP1_MIN_BATCH_SIZE) || 5
  },

  // Osmosis Configuration (Phase D/E: Primary settlement + AI routing)
  osmosis: {
    rpcUrl: process.env.OSMOSIS_RPC_URL || 'https://rpc.osmosis.zone:443',
    chainId: process.env.OSMOSIS_CHAIN_ID || 'osmosis-1',
    wsUrl: process.env.OSMOSIS_WS_URL || 'wss://rpc.osmosis.zone/websocket',
    pollInterval: parseInt(process.env.OSMOSIS_POLL_INTERVAL_MS) || 10000,

    // ibcTFUEL token on Osmosis (CW20 or native IBC denom)
    ibcTFUELDenom: process.env.OSMOSIS_IBC_TFUEL_DENOM || 'ibc/TFUEL',
    ibcTFUELContract: process.env.OSMOSIS_IBC_TFUEL_CONTRACT,

    // Pool contract for ibcTFUEL pairs (Osmosis DEX)
    poolContract: process.env.OSMOSIS_POOL_CONTRACT,

    // FeeCollector on Osmosis (receives 0.5% AI task fees)
    feeCollectorContract: process.env.OSMOSIS_FEE_COLLECTOR_CONTRACT,

    // Relayer wallet for signing Osmosis transactions
    relayerMnemonic: process.env.OSMOSIS_RELAYER_MNEMONIC,

    // Gas configuration
    gasPrice: process.env.OSMOSIS_GAS_PRICE || '0.025uosmo',
    gasAdjustment: parseFloat(process.env.OSMOSIS_GAS_ADJUSTMENT) || 1.5,
  },

  // Akash Configuration (Phase E: AI DePIN compute marketplace)
  akash: {
    rpcUrl: process.env.AKASH_RPC_URL || 'https://akash-rpc.polkachu.com:443',
    chainId: process.env.AKASH_CHAIN_ID || 'akashnet-2',
    wsUrl: process.env.AKASH_WS_URL || 'wss://akash-rpc.polkachu.com/websocket',
    pollInterval: parseInt(process.env.AKASH_POLL_INTERVAL_MS) || 15000,

    // Relay address for receiving AI task IBC transfers
    relayAddress: process.env.AKASH_RELAY_ADDRESS,

    // Gas configuration
    gasPrice: process.env.AKASH_GAS_PRICE || '0.025uakt',
  },

  // AI Listener Configuration (Phase E: AI DePIN Bridge)
  aiListener: {
    // Cosmos (Osmosis/Akash) inbound intent listeners. Off by default: the
    // settlement home is Base (ADR 0002) and these sockets only watch for IBC
    // intents, which no current product surface depends on. The task registry
    // and timeout watcher run regardless of this flag.
    cosmosListeners: process.env.COSMOS_LISTENERS_ENABLED === 'true',

    // Theta Edge Cloud URL for inference routing
    thetaEdgeUrl: process.env.THETA_EDGE_URL,

    // Timeouts
    routingTimeout: parseInt(process.env.AI_ROUTING_TIMEOUT_MS) || 30000,
    inferenceTimeout: parseInt(process.env.AI_INFERENCE_TIMEOUT_MS) || 60000,
    taskTimeoutMs: parseInt(process.env.AI_TASK_TIMEOUT_MS) || 300000, // 5 min

    // Polling interval (backup to WebSocket)
    pollInterval: parseInt(process.env.AI_POLL_INTERVAL_MS) || 15000,

    // Fee configuration (basis points)
    feeBps: parseInt(process.env.AI_TASK_FEE_BPS) || 50, // 0.5% = 50 bps
  },

  // Service Configuration
  service: {
    port: parseInt(process.env.PORT) || 3001,
    logLevel: process.env.LOG_LEVEL || 'info',
    nodeEnv: process.env.NODE_ENV || 'development',
    // Canonical public base URL for building absolute, shareable links (the
    // `verify_url` / receipt link). Set this when the server sits behind a proxy
    // or CDN (e.g. https://api-testnet.xfuel.app) so links aren't derived from the
    // internal host. When unset, links are derived from the request host.
    publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
  },

  // Task/receipt persistence. Tasks (and thus the public `verify_url` receipt) are
  // held in memory for the task lifetime; without persistence a shared verify_url
  // 404s after a restart or once a settled task is GC'd. This write-through file
  // store keeps a durable, public-safe snapshot so receipts survive both.
  // Single-node/file by design (matches the Phase-1 single-process model); swap the
  // dir for a shared volume, or a Redis/Postgres store, when scaling horizontally.
  taskStore: {
    // Disable to run purely in-memory (e.g. ephemeral CI) with TASK_STORE_PERSIST=false.
    persist: process.env.TASK_STORE_PERSIST !== 'false',
    // Durable snapshot directory (gitignored). Defaults next to the package.
    dir: process.env.TASK_STORE_DIR || join(__dirname, '..', '.data', 'tasks'),
    // How often to flush in-place task mutations (status/proof) to disk.
    autoFlushMs: parseInt(process.env.TASK_STORE_FLUSH_MS, 10) || 10000,
    // Retain a settled receipt this long before pruning (default 30 days).
    retentionMs: parseInt(process.env.TASK_STORE_RETENTION_MS, 10) || 30 * 24 * 3600 * 1000,
  },

  // Retry Configuration
  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
    delayMs: parseInt(process.env.RETRY_DELAY_MS) || 5000
  }
};

/**
 * Validates required configuration values
 * @throws {Error} if required config is missing
 */
export function validateConfig() {
  const errors = [];

  // RELAYER_PRIVATE_KEY optional: needed for refunds, Fair Exchange submit; omit or use placeholder for zkGPT-only dev
  if (!config.relayer.privateKey) {
    // No error; relayer-dependent features will be disabled
  }

  if (config.theta.rpcUrls.length === 0) {
    errors.push('At least one THETA_RPC_URL is required');
  }

  // SP1_PROVER_URL is optional: bridge can run with zkGPT-only (Phase 1 E2E); SP1 proof paths skip or return 503 if unset

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

export default config;

