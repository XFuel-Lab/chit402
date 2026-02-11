import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration object for the Theta-Persistence ZK Bridge service
 */
const config = {
  // Theta RPC Configuration
  theta: {
    rpcUrls: process.env.THETA_RPC_URLS?.split(',').map(url => url.trim()) || [
      'https://eth-rpc-api.thetatoken.org/rpc',
      'https://theta-eth-rpc.thetatoken.org/rpc',
      'https://theta-bridge-rpc.thetatoken.org/rpc'
    ],
    timeout: parseInt(process.env.RPC_TIMEOUT_MS) || 30000,
    requiredConfirmations: parseInt(process.env.REQUIRED_CONFIRMATIONS) || 3,
    blockPollInterval: parseInt(process.env.BLOCK_POLL_INTERVAL_MS) || 5000
  },

  // Contract Configuration
  contracts: {
    vaultFactoryAddress: process.env.VAULT_FACTORY_ADDRESS,
    subVaultAbiPath: process.env.SUBVAULT_ABI_PATH || join(__dirname, '../abis/SubVault.json'),
    vaultFactoryAbiPath: process.env.VAULT_FACTORY_ABI_PATH || join(__dirname, '../abis/VaultFactory.json')
  },

  // Redis Configuration
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0
  },

  // Relayer Configuration
  relayer: {
    privateKey: process.env.RELAYER_PRIVATE_KEY,
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

  // SP1 zkVM Configuration (Production - Phase B+)
  sp1: {
    proverUrl: process.env.SP1_PROVER_URL || 'http://54.174.193.127:8080',
    timeout: parseInt(process.env.SP1_PROVER_TIMEOUT) || 120000, // 120s
    retries: parseInt(process.env.SP1_PROVER_RETRIES) || 3,
    fallbackToMock: process.env.SP1_PROVER_FALLBACK === 'true',
    // Phase B batching (11.6x speedup, 90% cost reduction)
    batchingEnabled: process.env.SP1_BATCHING_ENABLED !== 'false',
    batchSize: parseInt(process.env.SP1_BATCH_SIZE) || 10,
    batchTimeout: parseInt(process.env.SP1_BATCH_TIMEOUT_MS) || 10000,
    minBatchSize: parseInt(process.env.SP1_MIN_BATCH_SIZE) || 5
  },

  // Persistence Configuration (Phase C Update)
  persistence: {
    rpcUrl: process.env.PERSISTENCE_RPC_URL || 'https://rpc.core.persistence.one:443',
    chainId: process.env.PERSISTENCE_CHAIN_ID || 'core-1',
    wsUrl: process.env.PERSISTENCE_WS_URL || 'wss://rpc.core.persistence.one/websocket',
    pollInterval: parseInt(process.env.PERSISTENCE_POLL_INTERVAL_MS) || 10000,
    
    // Phase C: Governance whitelisting status
    whitelistApproved: process.env.PERSISTENCE_WHITELIST_APPROVED === 'true',
    
    // Contract addresses (deployed in Phase C)
    zkVerifierContract: process.env.PERSISTENCE_ZK_VERIFIER_ADDRESS,
    minterContract: process.env.PERSISTENCE_MINTER_ADDRESS,
    
    // Backend relayer wallet (for signing Persistence transactions)
    mnemonic: process.env.PERSISTENCE_RELAYER_MNEMONIC,
    
    // Reverse-burn loop configuration
    burnEventTopic: process.env.PERSISTENCE_BURN_EVENT_TOPIC || 'burn_ibcTFUEL',
    
    // Gas configuration
    gasPrice: process.env.PERSISTENCE_GAS_PRICE || '0.025uxprt',
    gasAdjustment: parseFloat(process.env.PERSISTENCE_GAS_ADJUSTMENT) || 1.8
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
    enabled: process.env.AI_LISTENER_ENABLED === 'true',

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

  // Yield Configuration (Reverse-burn)
  yield: {
    // 30% of ibcUSDC yields unwrapped to TFUEL and routed to RevenueSplitter
    unwrapPercentage: parseInt(process.env.YIELD_UNWRAP_PERCENTAGE) || 30,
    // 70% reinvested for LP growth
    reinvestPercentage: parseInt(process.env.YIELD_REINVEST_PERCENTAGE) || 70,
    // RevenueSplitter contract address
    revenueSplitterAddress: process.env.REVENUE_SPLITTER_ADDRESS,
    // Swap configuration for ibcUSDC -> TFUEL
    swapRouterAddress: process.env.SWAP_ROUTER_ADDRESS,
    // Minimum yield amount to process (avoid dust)
    minYieldAmount: process.env.MIN_YIELD_AMOUNT || '1000000' // 1 USDC (6 decimals)
  },

  // Service Configuration
  service: {
    port: parseInt(process.env.PORT) || 3001,
    logLevel: process.env.LOG_LEVEL || 'info',
    nodeEnv: process.env.NODE_ENV || 'development'
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

  if (!config.contracts.vaultFactoryAddress) {
    errors.push('VAULT_FACTORY_ADDRESS is required');
  }

  if (!config.relayer.privateKey) {
    errors.push('RELAYER_PRIVATE_KEY is required');
  }

  if (config.theta.rpcUrls.length === 0) {
    errors.push('At least one THETA_RPC_URL is required');
  }

  // Phase C: Validate Persistence configuration if whitelisting is approved
  if (config.persistence.whitelistApproved) {
    if (!config.persistence.zkVerifierContract) {
      errors.push('PERSISTENCE_ZK_VERIFIER_ADDRESS is required when whitelisting is approved');
    }
    if (!config.persistence.minterContract) {
      errors.push('PERSISTENCE_MINTER_ADDRESS is required when whitelisting is approved');
    }
    if (!config.persistence.mnemonic) {
      errors.push('PERSISTENCE_RELAYER_MNEMONIC is required when whitelisting is approved');
    }
  }

  // Validate yield configuration if reverse-burn is enabled
  if (config.yield.revenueSplitterAddress) {
    if (!config.yield.swapRouterAddress) {
      errors.push('SWAP_ROUTER_ADDRESS is required when REVENUE_SPLITTER_ADDRESS is set');
    }
    if (config.yield.unwrapPercentage + config.yield.reinvestPercentage !== 100) {
      errors.push('YIELD_UNWRAP_PERCENTAGE + YIELD_REINVEST_PERCENTAGE must equal 100');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

export default config;

