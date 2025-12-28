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
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    // Mock window.theta for wallet connection
    ;(window as any).theta = undefined
  })

  it('renders app header and navigation', () => {
    render(<App />)
    // Check for app elements that appear on default swap tab
    expect(screen.getByText(/XFUEL/i)).toBeInTheDocument()
    expect(screen.getByText(/Sub-4s settlement rail/i)).toBeInTheDocument()
  })

  it('renders manual deposit flow UI on profile tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    
    // Click on Profile tab to see manual deposit flow
    const profileTab = screen.getByText('Profile')
    await user.click(profileTab)
    
    // Now check for manual deposit flow text
    const depositElement = screen.getByText(/Manual Send Flow/i)
    expect(depositElement).toBeInTheDocument()
  })

  // Wallet connect tests removed - manual deposit flow only
  it.skip('shows address and TFUEL balance after mock connection', async () => {
    // Test skipped - wallet connect removed
  })
})
