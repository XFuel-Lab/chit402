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
  zk: {
    circuitWasm: process.env.ZK_CIRCUIT_WASM || join(__dirname, '../circuits/circuit.wasm'),
    circuitZkey: process.env.ZK_CIRCUIT_ZKEY || join(__dirname, '../circuits/circuit_final.zkey'),
    verificationKey: process.env.ZK_VERIFICATION_KEY || join(__dirname, '../circuits/verification_key.json')
  },

  // Persistence Configuration (Phase 3)
  persistence: {
    rpcUrl: process.env.PERSISTENCE_RPC_URL || 'https://rpc.persistence.one',
    minterContract: process.env.PERSISTENCE_MINTER_CONTRACT,
    // Reverse-burn loop configuration
    burnEventTopic: process.env.PERSISTENCE_BURN_EVENT_TOPIC || 'burn_ibcTFUEL',
    chainId: process.env.PERSISTENCE_CHAIN_ID || 'core-1',
    wsUrl: process.env.PERSISTENCE_WS_URL || 'wss://rpc.persistence.one/websocket',
    pollInterval: parseInt(process.env.PERSISTENCE_POLL_INTERVAL_MS) || 10000
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

