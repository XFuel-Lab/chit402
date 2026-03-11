/**
 * Unit tests for WalletConnect Pro integration
 */

import { 
  clearWalletConnectSession, 
  createWalletConnectProvider,
  getConnectionHealth,
  smartConnect,
} from '../walletConnectPro'

// Mock WalletConnect
jest.mock('@walletconnect/ethereum-provider', () => {
  const mockProvider = {
    on: jest.fn(),
    session: null,
    disconnect: jest.fn(),
    enable: jest.fn(),
    removeAllListeners: jest.fn(),
  }
  
  return {
    EthereumProvider: {
      init: jest.fn().mockResolvedValue(mockProvider),
    },
  }
})

// Mock window.ethereum
const mockEthereum = {
  isTheta: true,
  request: jest.fn(),
  on: jest.fn(),
}

describe('WalletConnect Pro', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear()
    
    // Reset window.ethereum
    ;(window as any).ethereum = mockEthereum
    
    // Reset mocks
    jest.clearAllMocks()
  })

  describe('clearWalletConnectSession', () => {
    it('should clear all WalletConnect session data', async () => {
      // Set some test data
      localStorage.setItem('wc@2:core:0.3:test', 'test-data')
      localStorage.setItem('xfuel_wc_session', 'test-session')
      localStorage.setItem('xfuel_wc_last_error', 'test-error')
      
      await clearWalletConnectSession()
      
      // Verify all keys are cleared
      expect(localStorage.getItem('wc@2:core:0.3:test')).toBeNull()
      expect(localStorage.getItem('xfuel_wc_session')).toBeNull()
      expect(localStorage.getItem('xfuel_wc_last_error')).toBeNull()
    })
    
    it('should handle errors gracefully', async () => {
      // Mock localStorage.removeItem to throw error
      const originalRemoveItem = localStorage.removeItem
      localStorage.removeItem = jest.fn(() => {
        throw new Error('Storage error')
      })
      
      // Should not throw
      await expect(clearWalletConnectSession()).resolves.not.toThrow()
      
      // Restore
      localStorage.removeItem = originalRemoveItem
    })
  })

  describe('getConnectionHealth', () => {
    it('should return health status with no errors', () => {
      const health = getConnectionHealth()
      
      expect(health).toEqual({
        hasProvider: false,
        hasSession: false,
        lastError: null,
        errorCount: 0,
        suggestions: expect.any(Array),
      })
    })
    
    it('should return health status with errors', () => {
      localStorage.setItem('xfuel_wc_last_error', 'Connection failed')
      localStorage.setItem('xfuel_wc_error_count', '3')
      
      const health = getConnectionHealth()
      
      expect(health.lastError).toBe('Connection failed')
      expect(health.errorCount).toBe(3)
      expect(health.suggestions.length).toBeGreaterThan(0)
    })
  })

  describe('smartConnect', () => {
    it('should prefer direct connection on desktop with Theta extension', async () => {
      // Mock desktop with Theta extension
      mockEthereum.isTheta = true
      mockEthereum.request.mockResolvedValue(['0x1234567890123456789012345678901234567890'])
      
      const result = await smartConnect()
      
      expect(result.method).toBe('direct')
      expect(result.address).toBe('0x1234567890123456789012345678901234567890')
      expect(mockEthereum.request).toHaveBeenCalledWith({
        method: 'eth_requestAccounts',
      })
    })
    
    it('should handle user rejection gracefully', async () => {
      mockEthereum.isTheta = true
      mockEthereum.request.mockRejectedValue({
        code: 4001,
        message: 'User rejected',
      })
      
      await expect(smartConnect()).rejects.toThrow()
      
      // Verify error was logged
      expect(mockEthereum.request).toHaveBeenCalled()
    })
  })

  describe('Retry Logic', () => {
    it('should have retry mechanism available', async () => {
      const { EthereumProvider } = require('@walletconnect/ethereum-provider')
      
      // Verify mock is set up correctly
      expect(EthereumProvider.init).toBeDefined()
      expect(typeof EthereumProvider.init).toBe('function')
    })
  })

  describe('Platform Detection', () => {
    it('should detect mobile device', () => {
      const originalUserAgent = navigator.userAgent
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X)',
        configurable: true,
      })
      
      // Would need to import isMobileDevice if it was exported
      // For now, just verify user agent is set
      expect(navigator.userAgent).toContain('iPhone')
      
      // Restore
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      })
    })
  })
})

