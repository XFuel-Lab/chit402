/**
 * Unit tests for Cosmos LST Staking Pro integration
 */

import {
  isKeplrInstalled,
  connectKeplrForStride,
  connectKeplrForPersistence,
  ensureKeplrSetup,
  stakeLSTOnStride,
} from '../cosmosLSTStakingPro'

// Mock Keplr
const mockKeplr = {
  enable: jest.fn(),
  experimentalSuggestChain: jest.fn(),
  getOfflineSigner: jest.fn(),
}

// Mock @cosmjs/stargate
jest.mock('@cosmjs/stargate', () => ({
  SigningStargateClient: {
    connectWithSigner: jest.fn(),
  },
  GasPrice: {
    fromString: jest.fn(() => ({ amount: '0.001', denom: 'ustrd' })),
  },
  calculateFee: jest.fn(() => ({
    amount: [{ amount: '5000', denom: 'ustrd' }],
    gas: '200000',
  })),
}))

describe('Cosmos LST Staking Pro', () => {
  beforeEach(() => {
    // Reset window.keplr
    ;(window as any).keplr = mockKeplr
    
    // Reset mocks
    jest.clearAllMocks()
  })

  describe('isKeplrInstalled', () => {
    it('should return true when Keplr is installed', () => {
      ;(window as any).keplr = mockKeplr
      expect(isKeplrInstalled()).toBe(true)
    })

    it('should return false when Keplr is not installed', () => {
      ;(window as any).keplr = undefined
      expect(isKeplrInstalled()).toBe(false)
    })
  })

  describe('connectKeplrForStride', () => {
    it('should suggest chain and enable Stride', async () => {
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'stride1abc123def456' },
        ]),
      })

      const address = await connectKeplrForStride()

      expect(address).toBe('stride1abc123def456')
      expect(mockKeplr.experimentalSuggestChain).toHaveBeenCalled()
      expect(mockKeplr.enable).toHaveBeenCalledWith('stride-1')
    })

    it('should throw error if Keplr not installed', async () => {
      ;(window as any).keplr = undefined

      await expect(connectKeplrForStride()).rejects.toThrow('not installed')
    })

    it('should reject 0x addresses', async () => {
      ;(window as any).keplr = mockKeplr
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: '0x1234567890123456789012345678901234567890' },
        ]),
      })

      await expect(connectKeplrForStride()).rejects.toThrow()
    })

    it('should handle user rejection', async () => {
      ;(window as any).keplr = mockKeplr
      mockKeplr.experimentalSuggestChain.mockRejectedValue({
        message: 'User rejected the request',
      })

      await expect(connectKeplrForStride()).rejects.toThrow()
    })
  })

  describe('connectKeplrForPersistence', () => {
    it('should connect to Persistence chain for stkXPRT', async () => {
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'persistence1xyz789' },
        ]),
      })

      const address = await connectKeplrForPersistence()

      expect(address).toBe('persistence1xyz789')
      expect(mockKeplr.enable).toHaveBeenCalledWith('core-1')
    })
  })

  describe('ensureKeplrSetup', () => {
    it('should verify Keplr is ready for staking', async () => {
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'stride1test123' },
        ]),
      })

      const result = await ensureKeplrSetup('stkTIA')

      expect(result.ready).toBe(true)
      expect(result.address).toBe('stride1test123')
      expect(result.error).toBeUndefined()
    })

    it('should return error if Keplr not installed', async () => {
      ;(window as any).keplr = undefined

      const result = await ensureKeplrSetup('stkTIA')

      expect(result.ready).toBe(false)
      expect(result.error).toContain('not installed')
    })

    it('should return error for unsupported LST', async () => {
      const result = await ensureKeplrSetup('INVALID_LST')

      expect(result.ready).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('stakeLSTOnStride', () => {
    it('should successfully stake LST tokens', async () => {
      ;(window as any).keplr = mockKeplr
      // Mock Keplr connection
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'stride1staker123' },
        ]),
      })

      // Mock Stargate client
      const { SigningStargateClient } = require('@cosmjs/stargate')
      SigningStargateClient.connectWithSigner.mockResolvedValue({
        signAndBroadcast: jest.fn().mockResolvedValue({
          code: 0,
          transactionHash: '0xABCDEF123456',
        }),
      })

      const result = await stakeLSTOnStride('stkTIA', 100)

      expect(result.success).toBe(true)
      expect(result.txHash).toBe('0xABCDEF123456')
    })

    it('should handle transaction failure', async () => {
      ;(window as any).keplr = mockKeplr
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'stride1staker123' },
        ]),
      })

      const { SigningStargateClient } = require('@cosmjs/stargate')
      SigningStargateClient.connectWithSigner.mockResolvedValue({
        signAndBroadcast: jest.fn().mockResolvedValue({
          code: 1,
          rawLog: 'Insufficient balance',
        }),
      })

      const result = await stakeLSTOnStride('stkTIA', 100)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Insufficient balance')
    })

    it('should handle user rejection of transaction', async () => {
      ;(window as any).keplr = mockKeplr
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'stride1staker123' },
        ]),
      })

      const { SigningStargateClient } = require('@cosmjs/stargate')
      SigningStargateClient.connectWithSigner.mockResolvedValue({
        signAndBroadcast: jest.fn().mockRejectedValue({
          message: 'Transaction rejected by user',
        }),
      })

      const result = await stakeLSTOnStride('stkTIA', 100)

      expect(result.success).toBe(false)
      expect(result.error).toContain('rejected')
    })

    it('should reject staking with 0x address', async () => {
      ;(window as any).keplr = mockKeplr
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: '0x1234567890123456789012345678901234567890' },
        ]),
      })

      const result = await stakeLSTOnStride('stkTIA', 100)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid')
    })
  })

  describe('Chain Configuration', () => {
    it('should handle stkXPRT on Persistence chain', async () => {
      mockKeplr.experimentalSuggestChain.mockResolvedValue(undefined)
      mockKeplr.enable.mockResolvedValue(undefined)
      mockKeplr.getOfflineSigner.mockReturnValue({
        getAccounts: jest.fn().mockResolvedValue([
          { address: 'persistence1test' },
        ]),
      })

      const { SigningStargateClient } = require('@cosmjs/stargate')
      SigningStargateClient.connectWithSigner.mockResolvedValue({
        signAndBroadcast: jest.fn().mockResolvedValue({
          code: 0,
          transactionHash: '0xXPRT123',
        }),
      })

      const result = await stakeLSTOnStride('stkXPRT', 50)

      expect(result.success).toBe(true)
      expect(mockKeplr.enable).toHaveBeenCalledWith('core-1') // Persistence chain ID
    })
  })
})

