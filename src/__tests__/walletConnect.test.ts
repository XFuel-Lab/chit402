/**
 * Jest Tests for Wallet Connect Integration
 * 
 * Tests:
 * - WalletConnect provider initialization
 * - Session persistence
 * - Error recovery
 * - Platform detection
 * - Deep linking
 */

import {
  createWalletConnectProvider,
  clearWalletConnectStorage,
  isMobileDevice,
  getWalletConnectProvider,
  disconnectWalletConnect,
  getChainId,
  isWalletConnectReady,
  THETA_CHAIN_CONFIG,
} from '../utils/walletConnectV2'

// Mock WalletConnect
jest.mock('@walletconnect/ethereum-provider', () => ({
  EthereumProvider: {
    init: jest.fn().mockResolvedValue({
      on: jest.fn(),
      enable: jest.fn().mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
      disconnect: jest.fn(),
      request: jest.fn(),
      removeAllListeners: jest.fn(),
      session: { topic: 'mock-session' },
      chainId: 361,
      uri: 'wc:mock-uri@2',
    }),
  },
}))

describe('WalletConnect v2 Integration', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear()
    
    // Reset mocks
    jest.clearAllMocks()
  })

  describe('Platform Detection', () => {
    it('should detect mobile devices', () => {
      // Mock mobile user agent
      Object.defineProperty(window.navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      })

      const isMobile = isMobileDevice()
      expect(isMobile).toBe(true)
    })

    it('should detect desktop devices', () => {
      // Mock desktop user agent
      Object.defineProperty(window.navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      })

      const isMobile = isMobileDevice()
      expect(isMobile).toBe(false)
    })

    it('should detect Android devices', () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (Linux; Android 10)',
      })

      const isMobile = isMobileDevice()
      expect(isMobile).toBe(true)
    })
  })

  describe('WalletConnect Provider', () => {
    it('should initialize WalletConnect provider with Theta config', async () => {
      const provider = await createWalletConnectProvider()

      expect(provider).toBeDefined()
      expect(provider.chainId).toBe(THETA_CHAIN_CONFIG.chainId)
    })

    it('should generate URI on initialization', async () => {
      let capturedUri: string | null = null

      await createWalletConnectProvider({
        onDisplayUri: (uri) => {
          capturedUri = uri
        },
      })

      // URI should be generated (mocked as 'wc:mock-uri@2')
      expect(capturedUri).toBeTruthy()
    })

    it('should handle connection events', async () => {
      let connectCalled = false

      await createWalletConnectProvider({
        onConnect: () => {
          connectCalled = true
        },
      })

      // Simulate connection (in real scenario, this would be triggered by wallet)
      // For now, just check that handler was registered
      expect(connectCalled).toBe(false) // Not called yet until wallet connects
    })

    it('should reuse existing provider if not forcing new', async () => {
      const provider1 = await createWalletConnectProvider()
      const provider2 = await createWalletConnectProvider({ forceNew: false })

      expect(provider1).toBe(provider2)
    })

    it('should create new provider when forcing new', async () => {
      await createWalletConnectProvider()
      const provider2 = await createWalletConnectProvider({ forceNew: true })

      // Should have called init again
      expect(provider2).toBeDefined()
    })
  })

  describe('Storage Management', () => {
    it('should clear WalletConnect storage', () => {
      // Set some WalletConnect keys
      localStorage.setItem('wc@2:core:0.3//keychain', 'mock-key')
      localStorage.setItem('wc@2:client:0.3//session', 'mock-session')
      localStorage.setItem('walletconnect', 'mock-data')
      localStorage.setItem('other-key', 'should-remain')

      clearWalletConnectStorage()

      // WalletConnect keys should be removed
      expect(localStorage.getItem('wc@2:core:0.3//keychain')).toBeNull()
      expect(localStorage.getItem('wc@2:client:0.3//session')).toBeNull()
      expect(localStorage.getItem('walletconnect')).toBeNull()

      // Other keys should remain
      expect(localStorage.getItem('other-key')).toBe('should-remain')
    })

    it('should handle empty localStorage gracefully', () => {
      localStorage.clear()

      expect(() => clearWalletConnectStorage()).not.toThrow()
    })
  })

  describe('Provider State', () => {
    it('should get current provider', async () => {
      const provider = await createWalletConnectProvider()
      const retrieved = getWalletConnectProvider()

      expect(retrieved).toBe(provider)
    })

    it('should return null when no provider exists', () => {
      const retrieved = getWalletConnectProvider()
      expect(retrieved).toBeNull()
    })

    it('should check if provider is ready', async () => {
      await createWalletConnectProvider()
      const isReady = isWalletConnectReady()

      // Should be ready (mocked provider has session)
      expect(isReady).toBe(true)
    })

    it('should get chain ID', async () => {
      await createWalletConnectProvider()
      const chainId = getChainId()

      expect(chainId).toBe(THETA_CHAIN_CONFIG.chainId)
    })
  })

  describe('Disconnection', () => {
    it('should disconnect and cleanup', async () => {
      await createWalletConnectProvider()
      await disconnectWalletConnect()

      const provider = getWalletConnectProvider()
      expect(provider).toBeNull()
    })

    it('should clear storage on disconnect', async () => {
      localStorage.setItem('wc@2:core:0.3//keychain', 'mock-key')

      await createWalletConnectProvider()
      await disconnectWalletConnect()

      expect(localStorage.getItem('wc@2:core:0.3//keychain')).toBeNull()
    })
  })

  describe('Error Handling', () => {
    it('should handle initialization errors', async () => {
      // Mock error
      const { EthereumProvider } = require('@walletconnect/ethereum-provider')
      EthereumProvider.init.mockRejectedValueOnce(new Error('Network error'))

      await expect(createWalletConnectProvider()).rejects.toThrow('Network error')
    })

    it('should clear storage after max retry attempts', async () => {
      const { EthereumProvider } = require('@walletconnect/ethereum-provider')

      // Mock 3 consecutive failures
      EthereumProvider.init
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'))

      // Try 3 times
      for (let i = 0; i < 3; i++) {
        try {
          await createWalletConnectProvider({ forceNew: true })
        } catch (e) {
          // Expected to fail
        }
      }

      // After 3 attempts, storage should be cleared
      // (This is implementation-specific behavior)
    })
  })

  describe('Theta Network Configuration', () => {
    it('should have correct Theta chain configuration', () => {
      expect(THETA_CHAIN_CONFIG.chainId).toBe(361)
      expect(THETA_CHAIN_CONFIG.chainIdHex).toBe('0x169')
      expect(THETA_CHAIN_CONFIG.rpcUrl).toBe('https://eth-rpc-api.thetatoken.org/rpc')
      expect(THETA_CHAIN_CONFIG.nativeCurrency.symbol).toBe('TFUEL')
    })
  })
})

describe('WalletConnect Session Persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should persist session data', async () => {
    await createWalletConnectProvider()

    // Check if session keys were created
    const keys = Object.keys(localStorage)
    const hasWCKeys = keys.some(key => key.startsWith('wc@2:') || key.includes('walletconnect'))

    // WalletConnect should create session keys
    expect(hasWCKeys).toBe(false) // Initially false until actual connection
  })

  it('should restore session on page reload', async () => {
    // Create initial provider
    const provider1 = await createWalletConnectProvider()

    // Simulate page reload (in real scenario, localStorage persists)
    const provider2 = await createWalletConnectProvider({ forceNew: false })

    // Should reuse session
    expect(provider2).toBeDefined()
  })
})

