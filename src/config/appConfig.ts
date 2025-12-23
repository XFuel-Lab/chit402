// App configuration including mock mode toggle
export const APP_CONFIG = {
  // Mock mode: when true, uses mock router instead of real contract
  // Set to false to use real contracts on Theta testnet
  MOCK_MODE: import.meta.env.VITE_MOCK_MODE === 'true' || !import.meta.env.VITE_ROUTER_ADDRESS,
  
  // Auto-detect mock mode based on router address
  get USE_MOCK_MODE() {
    // If no router address is set, use mock mode
    if (!import.meta.env.VITE_ROUTER_ADDRESS) {
      return true
    }
    // Otherwise use the explicit setting
    return this.MOCK_MODE
  },

  // Backend API URL (defaults to localhost:3001 in dev)
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  
  // Network configuration (mainnet or testnet)
  NETWORK: import.meta.env.VITE_NETWORK || 'mainnet',
}

// Mock router address (for testing without deployed contracts)
export const MOCK_ROUTER_ADDRESS = '0x0000000000000000000000000000000000000001'

