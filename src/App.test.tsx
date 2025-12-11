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
      
      // Verify TFUEL appears in the wallet section by checking the parent container
      const walletSection = connectedText.closest('.bg-gray-800\\/50')
      expect(walletSection).toBeInTheDocument()
      expect(walletSection).toHaveTextContent('TFUEL')
    }, { timeout: 3000 })
  })

  it('renders three preset buttons with correct text', () => {
    render(<App />)
    
    const preset1 = screen.getByRole('button', { name: /25% → stkXPRT/i })
    const preset2 = screen.getByRole('button', { name: /50% → stkATOM/i })
    const preset3 = screen.getByRole('button', { name: /100% → pSTAKE BTC/i })
    
    expect(preset1).toBeInTheDocument()
    expect(preset2).toBeInTheDocument()
    expect(preset3).toBeInTheDocument()
  })

  it('displays live finality indicator', () => {
    render(<App />)
    
    const finalityLabel = screen.getByText(/Live finality:/i)
    const finalityValue = screen.getByText(/2\.8 s/i)
    
    expect(finalityLabel).toBeInTheDocument()
    expect(finalityValue).toBeInTheDocument()
  })

  it('displays Chainalysis indicator', () => {
    render(<App />)
    
    const chainalysisLabel = screen.getByText(/Chainalysis:/i)
    const chainalysisValue = screen.getByText(/100\/100 safe/i)
    
    expect(chainalysisLabel).toBeInTheDocument()
    expect(chainalysisValue).toBeInTheDocument()
  })
})

