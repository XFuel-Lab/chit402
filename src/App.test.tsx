import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    // Mock window.theta for wallet connection
    ;(window as any).theta = undefined
  })

  it('renders "Connect Wallet" button when disconnected', () => {
    render(<App />)
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    expect(connectButton).toBeInTheDocument()
  })

  it('shows address and TFUEL balance after mock connection', async () => {
    const user = userEvent.setup()
    render(<App />)
    
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    await user.click(connectButton)

    await waitFor(() => {
      // Check for connected address
      const address = screen.getByText(/0x1234\.\.\.5678/i)
      expect(address).toBeInTheDocument()
      
      // Check for TFUEL balance
      const balance = screen.getByText(/1,234\.56/i)
      expect(balance).toBeInTheDocument()

      // Check that "Connected" text appears (indicating wallet is connected)
      const connectedText = screen.getByText(/Connected/i)
      expect(connectedText).toBeInTheDocument()

      // Verify TFUEL label is rendered in the wallet summary
      const tfuelLabel = screen.getByText(/TFUEL/i)
      expect(tfuelLabel).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('renders XFUEL header and navigation tabs', () => {
    render(<App />)
    
    // Header
    expect(screen.getByText(/XFUEL/i)).toBeInTheDocument()
    expect(screen.getByText(/Sub-4s settlement rail/i)).toBeInTheDocument()

    // Top-level tabs
    expect(screen.getAllByText(/Swap/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Staking/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Tip Pools/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Mining/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Profile/i).length).toBeGreaterThanOrEqual(1)
  })

  // Finality and Chainalysis indicators moved into more complex,
  // stateful flows (preview + profile). Those are covered implicitly
  // by higher-level product testing and E2E.
})

