/**
 * Jest Tests for Unified Wallet Provider
 * 
 * Tests:
 * - Provider initialization
 * - Platform detection
 * - Connection methods
 * - Session restoration
 * - Balance fetching
 */

import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WalletProvider, useWallet, THETA_CHAIN_CONFIG } from '../providers/WalletProvider'
import { ethers } from 'ethers'

// Mock ethers
jest.mock('ethers', () => ({
  ethers: {
    BrowserProvider: jest.fn().mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue(ethers.parseEther('100')),
      getNetwork: jest.fn().mockResolvedValue({ chainId: BigInt(361) }),
      getSigner: jest.fn().mockReturnValue({
        getAddress: jest.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'),
      }),
    })),
    formatEther: jest.fn((value) => '100.00'),
    parseEther: jest.fn((value) => BigInt(value) * BigInt(10 ** 18)),
  },
}))

// Test component that uses wallet
const TestComponent = () => {
  const wallet = useWallet()

  return (
    <div>
      <div data-testid="address">{wallet.address || 'Not connected'}</div>
      <div data-testid="balance">{wallet.balance}</div>
      <div data-testid="is-connected">{wallet.isConnected ? 'Connected' : 'Disconnected'}</div>
      <div data-testid="is-mobile">{wallet.isMobileDevice ? 'Mobile' : 'Desktop'}</div>
      <button onClick={wallet.connect} data-testid="connect-btn">
        Connect
      </button>
      <button onClick={wallet.disconnect} data-testid="disconnect-btn">
        Disconnect
      </button>
      <button onClick={wallet.refreshBalance} data-testid="refresh-btn">
        Refresh
      </button>
    </div>
  )
}

describe('WalletProvider', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear()

    // Reset mocks
    jest.clearAllMocks()

    // Mock window.ethereum
    ;(window as any).ethereum = undefined
  })

  describe('Provider Setup', () => {
    it('should render children', () => {
      render(
        <WalletProvider>
          <div>Test Child</div>
        </WalletProvider>
      )

      expect(screen.getByText('Test Child')).toBeInTheDocument()
    })

    it('should throw error when useWallet is used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useWallet must be used within WalletProvider')

      consoleSpy.mockRestore()
    })
  })

  describe('Initial State', () => {
    it('should start disconnected', () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      expect(screen.getByTestId('address')).toHaveTextContent('Not connected')
      expect(screen.getByTestId('is-connected')).toHaveTextContent('Disconnected')
      expect(screen.getByTestId('balance')).toHaveTextContent('0.00')
    })

    it('should detect platform correctly', () => {
      // Mock mobile user agent
      Object.defineProperty(window.navigator, 'userAgent', {
        writable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      })

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('Mobile')
    })
  })

  describe('Connection - Theta Wallet Extension', () => {
    beforeEach(() => {
      // Mock Theta Wallet extension
      ;(window as any).ethereum = {
        isTheta: true,
        request: jest.fn().mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        on: jest.fn(),
        removeListener: jest.fn(),
      }
    })

    it('should connect via Theta Wallet extension', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      const connectBtn = screen.getByTestId('connect-btn')
      await user.click(connectBtn)

      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Connected')
      })

      expect(screen.getByTestId('address')).toHaveTextContent('0x742d...0bEb')
    })

    it('should fetch balance on connection', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      const connectBtn = screen.getByTestId('connect-btn')
      await user.click(connectBtn)

      await waitFor(() => {
        expect(screen.getByTestId('balance')).toHaveTextContent('100.00')
      })
    })

    it('should save session to localStorage', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      const connectBtn = screen.getByTestId('connect-btn')
      await user.click(connectBtn)

      await waitFor(() => {
        expect(localStorage.getItem('xfuel_wallet_address')).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')
        expect(localStorage.getItem('xfuel_connection_method')).toBe('theta_extension')
      })
    })
  })

  describe('Connection - MetaMask', () => {
    beforeEach(() => {
      // Mock MetaMask extension
      ;(window as any).ethereum = {
        isMetaMask: true,
        request: jest.fn().mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        on: jest.fn(),
        removeListener: jest.fn(),
      }
    })

    it('should connect via MetaMask', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      const connectBtn = screen.getByTestId('connect-btn')
      await user.click(connectBtn)

      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Connected')
      })
    })

    it('should save MetaMask connection method', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      const connectBtn = screen.getByTestId('connect-btn')
      await user.click(connectBtn)

      await waitFor(() => {
        expect(localStorage.getItem('xfuel_connection_method')).toBe('metamask')
      })
    })
  })

  describe('Disconnection', () => {
    beforeEach(() => {
      ;(window as any).ethereum = {
        isTheta: true,
        request: jest.fn().mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        on: jest.fn(),
        removeListener: jest.fn(),
      }
    })

    it('should disconnect wallet', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      // Connect first
      const connectBtn = screen.getByTestId('connect-btn')
      await user.click(connectBtn)

      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Connected')
      })

      // Disconnect
      const disconnectBtn = screen.getByTestId('disconnect-btn')
      await user.click(disconnectBtn)

      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Disconnected')
      })

      expect(screen.getByTestId('address')).toHaveTextContent('Not connected')
      expect(screen.getByTestId('balance')).toHaveTextContent('0.00')
    })

    it('should clear localStorage on disconnect', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      // Connect
      await user.click(screen.getByTestId('connect-btn'))

      await waitFor(() => {
        expect(localStorage.getItem('xfuel_wallet_address')).toBeTruthy()
      })

      // Disconnect
      await user.click(screen.getByTestId('disconnect-btn'))

      await waitFor(() => {
        expect(localStorage.getItem('xfuel_wallet_address')).toBeNull()
      })
    })
  })

  describe('Session Restoration', () => {
    beforeEach(() => {
      ;(window as any).ethereum = {
        isTheta: true,
        request: jest.fn().mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        on: jest.fn(),
        removeListener: jest.fn(),
      }
    })

    it('should restore session from localStorage', async () => {
      // Set up saved session
      localStorage.setItem('xfuel_wallet_address', '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')
      localStorage.setItem('xfuel_connection_method', 'theta_extension')
      localStorage.setItem('xfuel_session_ts', Date.now().toString())

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      // Should auto-connect
      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Connected')
      }, { timeout: 3000 })
    })

    it('should not restore expired session', async () => {
      // Set up expired session (> 24 hours ago)
      const expiredTime = Date.now() - (25 * 60 * 60 * 1000)
      localStorage.setItem('xfuel_wallet_address', '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')
      localStorage.setItem('xfuel_connection_method', 'theta_extension')
      localStorage.setItem('xfuel_session_ts', expiredTime.toString())

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      // Should remain disconnected
      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Disconnected')
      })

      // Session should be cleared
      expect(localStorage.getItem('xfuel_wallet_address')).toBeNull()
    })
  })

  describe('Balance Refresh', () => {
    beforeEach(() => {
      ;(window as any).ethereum = {
        isTheta: true,
        request: jest.fn().mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        on: jest.fn(),
        removeListener: jest.fn(),
      }
    })

    it('should refresh balance on demand', async () => {
      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      // Connect first
      await user.click(screen.getByTestId('connect-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Connected')
      })

      // Refresh balance
      await user.click(screen.getByTestId('refresh-btn'))

      // Balance should be updated (mocked to same value)
      await waitFor(() => {
        expect(screen.getByTestId('balance')).toHaveTextContent('100.00')
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle user rejection', async () => {
      ;(window as any).ethereum = {
        isTheta: true,
        request: jest.fn().mockRejectedValue({ code: 4001, message: 'User rejected' }),
        on: jest.fn(),
        removeListener: jest.fn(),
      }

      const user = userEvent.setup()

      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      )

      const connectBtn = screen.getByTestId('connect-btn')
      await user.click(connectBtn)

      await waitFor(() => {
        expect(screen.getByTestId('is-connected')).toHaveTextContent('Disconnected')
      })
    })
  })
})

