import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'

// Polyfill TextEncoder/TextDecoder for jsdom (required by WalletConnect)
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder as any

// Mock Vite's import.meta.env for Jest
// Set up global mock that components can access
globalThis.__import_meta_env__ = {
  VITE_MULTISIG_ADDRESS: process.env.VITE_MULTISIG_ADDRESS || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
  VITE_USDC_ADDRESS_MAINNET: process.env.VITE_USDC_ADDRESS_MAINNET || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
  VITE_CONTRIBUTION_WEBHOOK_URL: process.env.VITE_CONTRIBUTION_WEBHOOK_URL || 'https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/',
}

// Also set up import.meta for direct access
if (typeof globalThis.import === 'undefined') {
  Object.defineProperty(globalThis, 'import', {
    value: {
      meta: {
        env: globalThis.__import_meta_env__,
      },
    },
    writable: true,
    configurable: true,
  })
}

// Mock @walletconnect/ethereum-provider to avoid ESM issues
jest.mock('@walletconnect/ethereum-provider', () => {
  class MockEthereumProvider {
    connected = false
    accounts = []
    chainId = 1
    uri = ''
    
    async connect() {
      this.connected = true
      return { chainId: this.chainId }
    }
    
    async disconnect() {
      this.connected = false
    }
    
    async request({ method }: { method: string }) {
      if (method === 'eth_requestAccounts') return this.accounts
      if (method === 'eth_accounts') return this.accounts
      if (method === 'eth_chainId') return `0x${this.chainId.toString(16)}`
      return null
    }
    
    on() {}
    off() {}
    removeAllListeners() {}
  }
  
  return {
    EthereumProvider: {
      init: async () => new MockEthereumProvider(),
    },
  }
})

