// App configuration
export const APP_CONFIG = {
  // Backend API URL (defaults to localhost:3001 in dev)
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  
  // Network configuration (mainnet or testnet)
  NETWORK: import.meta.env.VITE_NETWORK || 'mainnet',
  
  // Force real mode in production - no mock/simulation
  USE_REAL_MODE: true,
}

// Mock router address (deprecated - only for legacy tests)
export const MOCK_ROUTER_ADDRESS = '0x0000000000000000000000000000000000000001'

