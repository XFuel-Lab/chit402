// Mock WalletConnect to avoid ESM issues - must be before imports
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

import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    // Mock window.theta for wallet connection
    ;(window as any).theta = undefined
  })

  it('renders manual deposit flow UI', () => {
    render(<App />)
    // Manual deposit flow - no wallet connect buttons
    const depositElement = screen.getByText(/Manual Send Flow/i)
    expect(depositElement).toBeInTheDocument()
  })

  // Wallet connect tests removed - manual deposit flow only
  it.skip('shows address and TFUEL balance after mock connection', async () => {
    // Test skipped - wallet connect removed
  })
})
