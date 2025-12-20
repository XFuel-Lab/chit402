import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock ethers before any imports
const mockContract = jest.fn()

// We'll set up the provider mock in the describe block
// Initialize with a default mock to avoid undefined issues
let mockProviderInstance: any = {
  getBalance: jest.fn(),
  getSigner: jest.fn(),
  getNetwork: jest.fn(),
}

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers')
  // Create a constructor function that returns the mock provider
  // Use a function that accesses mockProviderInstance at call time, not definition time
  const BrowserProviderMock = function(this: any, provider: any) {
    // Access mockProviderInstance at call time to get the current value
    return (global as any).__mockProviderInstance__ || mockProviderInstance
  } as any
  
  // Create a new object with all properties from actual, but exclude BrowserProvider
  const { BrowserProvider: _, Contract: __, ...rest } = actual as any
  
  return {
    ...rest,
    // Override BrowserProvider completely - don't let the real one leak through
    BrowserProvider: BrowserProviderMock,
    Contract: mockContract,
    // Use real utility functions from ethers
    parseEther: actual.parseEther,
    parseUnits: actual.parseUnits,
    formatEther: actual.formatEther,
    formatUnits: actual.formatUnits,
  }
})

// Mock thetaConfig module to avoid import.meta.env issues
jest.mock('../../config/thetaConfig', () => ({
  THETA_TESTNET: {
    chainId: 365,
    chainIdHex: '0x16d',
    name: 'Theta Testnet',
    rpcUrl: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    explorerUrl: 'https://testnet-explorer.thetatoken.org',
    currencySymbol: 'TFUEL',
    faucetUrl: 'https://faucet.testnet.theta.org/request',
  },
  THETA_MAINNET: {
    chainId: 361,
    chainIdHex: '0x169',
    name: 'Theta Mainnet',
    rpcUrl: 'https://eth-rpc-api.thetatoken.org/rpc',
    explorerUrl: 'https://explorer.thetatoken.org',
    currencySymbol: 'TFUEL',
  },
  ROUTER_ADDRESS: '',
  TIP_POOL_ADDRESS: '',
  ROUTER_ABI: [],
  TIP_POOL_ABI: [],
  ERC20_ABI: [],
}))

import { ethers } from 'ethers'
import { THETA_MAINNET } from '../../config/thetaConfig'
import EarlyBelieversModal from '../EarlyBelieversModal'

// Mock fetch for TFUEL price
global.fetch = jest.fn()

describe('EarlyBelieversModal', () => {
  const mockOnClose = jest.fn()
  const mockOnConnectWallet = jest.fn()

  // Create the mock provider instance that will be returned by BrowserProvider
  mockProviderInstance = {
    getBalance: jest.fn(),
    getSigner: jest.fn(),
    getNetwork: jest.fn(),
    getTransactionReceipt: jest.fn(),
  }
  
  // Store in global so the mock constructor can access it
  ;(global as any).__mockProviderInstance__ = mockProviderInstance

  const mockSigner = {
    sendTransaction: jest.fn(),
    signMessage: jest.fn(),
  }

  const mockUsdcContract = {
    balanceOf: jest.fn(),
    decimals: jest.fn(),
    allowance: jest.fn(),
    approve: jest.fn(),
    transfer: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    
    // Update global reference to current mock instance
    ;(global as any).__mockProviderInstance__ = mockProviderInstance
    
    // Default mock setup
    ;(window as any).theta = {
      request: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
    }
    ;(window as any).ethereum = (window as any).theta

    // Reset mocks
    mockContract.mockClear()
    mockContract.mockReturnValue(mockUsdcContract)

    // Reset provider mocks
    mockProviderInstance.getNetwork.mockClear()
    mockProviderInstance.getBalance.mockClear()
    mockProviderInstance.getSigner.mockClear()
    mockProviderInstance.getTransactionReceipt.mockClear()
    
    // Setup default provider responses
    mockProviderInstance.getNetwork.mockResolvedValue({ chainId: BigInt(THETA_MAINNET.chainId) })
    // Return a proper BigInt-like object for balance
    const balanceValue = BigInt('1000000000000000000000') // 1000 TFUEL
    mockProviderInstance.getBalance.mockResolvedValue(balanceValue)
    mockProviderInstance.getSigner.mockResolvedValue(mockSigner)

    // Reset contract mocks
    mockUsdcContract.balanceOf.mockClear()
    mockUsdcContract.decimals.mockClear()
    mockUsdcContract.allowance.mockClear()
    mockUsdcContract.approve.mockClear()
    mockUsdcContract.transfer.mockClear()
    
    mockUsdcContract.balanceOf.mockResolvedValue(BigInt('1000000000')) // 1000 USDC (6 decimals)
    mockUsdcContract.decimals.mockResolvedValue(6)
    mockUsdcContract.allowance.mockResolvedValue(BigInt('0'))

    // Reset signer mocks
    mockSigner.sendTransaction.mockClear()
    mockSigner.signMessage.mockClear()

    // Mock fetch for TFUEL price
    ;(global.fetch as jest.Mock).mockClear()
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ 'theta-fuel': { usd: 0.05 } }),
    })

    // Mock console.log for webhook logging
    jest.spyOn(console, 'log').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Modal Visibility', () => {
    it('should not render when visible is false', () => {
      render(
        <EarlyBelieversModal
          visible={false}
          onClose={mockOnClose}
          walletAddress={null}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )
      expect(screen.queryByText('Early Believers Round — Mainnet Live')).not.toBeInTheDocument()
    })

    it('should render when visible is true', async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={null}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )
      // Wait for async operations to complete
      await waitFor(() => {
        expect(screen.getByText('Early Believers Round — Mainnet Live')).toBeInTheDocument()
      }, { timeout: 2000 })
    })
  })

  describe('Wallet Connection', () => {
    it('should show connect button when wallet not connected', async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={null}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )
      // Wait for async operations to complete
      await waitFor(() => {
        expect(screen.getByText('Connect Theta Wallet')).toBeInTheDocument()
      }, { timeout: 2000 })
    })

    it('should call onConnectWallet when connect button clicked', async () => {
      const user = userEvent.setup()
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={null}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for async operations to complete
      await waitFor(() => {
        expect(screen.getByText('Connect Theta Wallet')).toBeInTheDocument()
      }, { timeout: 2000 })

      const connectButton = screen.getByText('Connect Theta Wallet')
      await user.click(connectButton)
      expect(mockOnConnectWallet).toHaveBeenCalled()
    })

    it('should show connected wallet info when wallet is connected', async () => {
      const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
      
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for network check and balance fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
        expect(screen.getByText(walletAddress.slice(0, 6))).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should check network and show error on wrong network', async () => {
      mockProviderInstance.getNetwork.mockResolvedValue({ chainId: BigInt(365) }) // Testnet

      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/Please switch to Theta Mainnet/i)).toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('Amount Input and Tier Calculation', () => {
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

    beforeEach(async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )
      // Wait for initial network check and balance fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should accept amount input', async () => {
      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1000')
      expect(input).toHaveValue(1000)
    })

    it('should show Standard tier for amounts < $50k', async () => {
      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '10000')

      await waitFor(() => {
        expect(screen.getByText('Standard')).toBeInTheDocument()
      })
    })

    it('should show +10% bonus tier for $50k-$99k', async () => {
      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '60000')

      await waitFor(() => {
        expect(screen.getByText('+10% bonus rXF')).toBeInTheDocument()
        expect(screen.getByText('Bonus (10%)')).toBeInTheDocument()
      })
    })

    it('should show +25% bonus tier for $100k+', async () => {
      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '150000')

      await waitFor(() => {
        expect(screen.getByText('+25% bonus rXF')).toBeInTheDocument()
        expect(screen.getByText('Bonus (25%)')).toBeInTheDocument()
      })
    })

    it('should toggle between USDC and TFUEL', async () => {
      const usdcButton = screen.getByText('USDC').closest('button')
      const tfuelButton = screen.getByText('TFUEL').closest('button')

      expect(usdcButton).toHaveClass('border-cyan-400/80')
      
      await userEvent.click(tfuelButton!)
      await waitFor(() => {
        expect(tfuelButton).toHaveClass('border-cyan-400/80')
      })
    })
  })

  describe('Payment Transaction', () => {
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

    beforeEach(() => {
      mockSigner.sendTransaction.mockResolvedValue({
        hash: '0x1234567890abcdef',
        wait: jest.fn().mockResolvedValue({ status: 1 }),
      })
    })

    it('should send TFUEL transaction successfully', async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for initial network check and balance fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      // Switch to TFUEL
      const tfuelButton = screen.getByText('TFUEL').closest('button')
      await userEvent.click(tfuelButton!)

      // Enter amount
      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1')

      // Click contribute
      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      await waitFor(() => {
        expect(mockSigner.sendTransaction).toHaveBeenCalled()
      })
    })

    it('should handle insufficient balance error', async () => {
      mockProviderInstance.getBalance.mockResolvedValue(BigInt('100000000000000000')) // 0.1 TFUEL
      mockSigner.sendTransaction.mockRejectedValue(new Error('insufficient funds'))

      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for initial network check and balance fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      const tfuelButton = screen.getByText('TFUEL').closest('button')
      await userEvent.click(tfuelButton!)

      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1')

      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      await waitFor(() => {
        expect(screen.getByText(/Insufficient balance/i)).toBeInTheDocument()
      })
    })

    it('should handle transaction rejection', async () => {
      mockSigner.sendTransaction.mockRejectedValue(new Error('user rejected'))

      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for initial network check and balance fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      const tfuelButton = screen.getByText('TFUEL').closest('button')
      await userEvent.click(tfuelButton!)

      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1')

      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      await waitFor(() => {
        expect(screen.getByText(/rejected/i)).toBeInTheDocument()
      })
    })
  })

  describe('Webhook Logging', () => {
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

    beforeEach(() => {
      process.env.VITE_CONTRIBUTION_WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/'
      mockSigner.sendTransaction.mockResolvedValue({
        hash: '0x1234567890abcdef',
        wait: jest.fn().mockResolvedValue({ status: 1 }),
      })
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    })

    it('should log to console on successful contribution', async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for initial network check and balance fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      const tfuelButton = screen.getByText('TFUEL').closest('button')
      await userEvent.click(tfuelButton!)

      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1')

      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      await waitFor(() => {
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Early Believer Contribution'),
          expect.any(Object)
        )
      })
    })

    it('should POST to webhook if URL is configured', async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for initial network check and balance fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      const tfuelButton = screen.getByText('TFUEL').closest('button')
      await userEvent.click(tfuelButton!)

      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1')

      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          'https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        )
      })
    })
  })

  describe('Network Switching', () => {
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

    it('should show switch network button on wrong network', async () => {
      mockProviderInstance.getNetwork.mockResolvedValue({ chainId: BigInt(365) }) // Testnet

      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/Switch to Theta Mainnet/i)).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('should call wallet_switchEthereumChain when switch button clicked', async () => {
      const user = userEvent.setup()
      mockProviderInstance.getNetwork.mockResolvedValue({ chainId: BigInt(365) }) // Testnet
      ;(window as any).theta.request.mockResolvedValue(null)

      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/Switch to Theta Mainnet/i)).toBeInTheDocument()
      }, { timeout: 3000 })

      const switchButton = screen.getByText(/Switch to Theta Mainnet/i)
      await user.click(switchButton)

      await waitFor(() => {
        expect((window as any).theta.request).toHaveBeenCalledWith({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x169' }],
        })
      })
    })
  })

  describe('RPC Error Handling', () => {
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

    it('should handle RPC receipt error and still show success', async () => {
      const mockTx = {
        hash: '0x1234567890abcdef',
        wait: jest.fn().mockRejectedValue({
          code: -32603,
          message: 'Internal JSON-RPC error',
        }),
      }
      mockSigner.sendTransaction.mockResolvedValue(mockTx)
      
      // Mock getTransactionReceipt to eventually succeed
      mockProviderInstance.getTransactionReceipt = jest.fn()
        .mockResolvedValueOnce(null) // First attempt fails
        .mockResolvedValueOnce({ status: 1 }) // Second attempt succeeds

      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      const tfuelButton = screen.getByText('TFUEL').closest('button')
      await userEvent.click(tfuelButton!)

      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1')

      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      // Should eventually show success even if receipt fetch initially fails
      await waitFor(() => {
        expect(screen.getByText(/Contribution received/i)).toBeInTheDocument()
      }, { timeout: 10000 })
    })

    it('should show success with hash even if receipt fetch completely fails', async () => {
      const mockTx = {
        hash: '0xabcdef1234567890',
        wait: jest.fn().mockRejectedValue({
          code: -32603,
          message: 'could not coalesce error',
        }),
      }
      mockSigner.sendTransaction.mockResolvedValue(mockTx)
      
      // Mock getTransactionReceipt to always fail
      mockProviderInstance.getTransactionReceipt = jest.fn()
        .mockRejectedValue({ code: -32603, message: 'Internal JSON-RPC error' })

      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      const tfuelButton = screen.getByText('TFUEL').closest('button')
      await userEvent.click(tfuelButton!)

      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '1')

      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      // Should show success message with transaction hash
      await waitFor(() => {
        expect(screen.getByText(/Transaction submitted successfully/i)).toBeInTheDocument()
        expect(screen.getByText(/0xabcdef/i)).toBeInTheDocument()
      }, { timeout: 15000 })
    })
  })

  describe('USDC Payment Flow', () => {
    const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

    beforeEach(() => {
      // Set up USDC address
      process.env.VITE_USDC_ADDRESS_MAINNET = '0x1234567890123456789012345678901234567890'
      
      mockUsdcContract.allowance.mockResolvedValue(BigInt('0')) // Needs approval
      mockUsdcContract.approve.mockResolvedValue({
        hash: '0xapprove123',
        wait: jest.fn().mockResolvedValue({ status: 1 }),
      })
      mockUsdcContract.transfer.mockResolvedValue({
        hash: '0xtransfer123',
        wait: jest.fn().mockResolvedValue({ status: 1 }),
      })
    })

    it('should handle USDC approval before transfer', async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress={walletAddress}
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Connected Wallet')).toBeInTheDocument()
      }, { timeout: 3000 })

      const input = screen.getByPlaceholderText('0.00')
      await userEvent.type(input, '100')

      const contributeButton = screen.getByText('Contribute Now')
      await userEvent.click(contributeButton)

      await waitFor(() => {
        expect(mockUsdcContract.approve).toHaveBeenCalled()
      }, { timeout: 5000 })

      await waitFor(() => {
        expect(mockUsdcContract.transfer).toHaveBeenCalled()
      }, { timeout: 10000 })
    })
  })

  describe('Disclaimer', () => {
    it('should display disclaimer footer', async () => {
      render(
        <EarlyBelieversModal
          visible={true}
          onClose={mockOnClose}
          walletAddress="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
          onConnectWallet={mockOnConnectWallet}
          isMainnet={true}
        />
      )

      // Wait for async operations to complete
      await waitFor(() => {
        expect(screen.getByText(/This is a contribution to support protocol development/i)).toBeInTheDocument()
        expect(screen.getByText(/rXF provides governance and utility within XFUEL/i)).toBeInTheDocument()
        expect(screen.getByText(/No promise of profit/i)).toBeInTheDocument()
      }, { timeout: 2000 })
    })
  })
})

