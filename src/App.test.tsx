import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ethers } from 'ethers'
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

describe('Allowance timing and state issues', () => {
  beforeEach(() => {
    // Reset mocks
    ;(window as any).theta = undefined
    ;(window as any).ethereum = undefined
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('handles rapid status transitions without race conditions', async () => {
    const user = userEvent.setup({ delay: null })
    
    // Mock provider that resolves immediately
    ;(window as any).theta = {
      request: jest.fn().mockResolvedValue(['0x1234567890123456789012345678901234567890']),
    }

    const mockProvider = {
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1000')),
      getSigner: jest.fn().mockReturnValue({
        signMessage: jest.fn().mockResolvedValue('0xsignature'),
      }),
    }

    jest.spyOn(ethers.providers, 'Web3Provider').mockReturnValue(mockProvider as any)

    render(<App />)
    
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    
    // Trigger multiple rapid clicks - all should be handled gracefully
    const click1 = user.click(connectButton)
    const click2 = user.click(connectButton)
    const click3 = user.click(connectButton)

    await Promise.all([click1, click2, click3])

    // Verify wallet connection succeeds despite rapid clicks
    await waitFor(() => {
      expect(screen.getByText(/Connected/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('prevents swap status from changing during pending operations', async () => {
    const user = userEvent.setup({ delay: null })
    
    // Mock wallet connection
    ;(window as any).theta = {
      request: jest.fn().mockResolvedValue(['0x1234567890123456789012345678901234567890']),
    }

    const mockProvider = {
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1000')),
      getSigner: jest.fn().mockReturnValue({
        signMessage: jest.fn().mockResolvedValue('0xsignature'),
      }),
    }

    jest.spyOn(ethers.providers, 'Web3Provider').mockReturnValue(mockProvider as any)

    render(<App />)
    
    // Connect wallet
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    await user.click(connectButton)

    await waitFor(() => {
      expect(screen.getByText(/Connected/i)).toBeInTheDocument()
    })

    // Select percentage
    const percentageButton = screen.getByText(/Select %/i).closest('button')
    if (percentageButton) {
      await user.click(percentageButton)
      await waitFor(() => {
        const fiftyPercent = screen.getByText('50%')
        expect(fiftyPercent).toBeInTheDocument()
      })
      await user.click(screen.getByText('50%'))
    }

    // Mock router contract
    const mockRouterContract = {
      swapAndStake: jest.fn().mockImplementation(() => {
        // Return a promise that resolves slowly to test state locking
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ hash: '0x123', wait: jest.fn().mockResolvedValue({}) })
          }, 500)
        })
      }),
    }

    jest.spyOn(ethers, 'Contract').mockReturnValue(mockRouterContract as any)

    // Try to click swap button multiple times rapidly
    const swapButton = screen.getByRole('button', { name: /Swap & Stake/i })
    
    // First click should work
    await user.click(swapButton)

    // Verify button is disabled during operation
    await waitFor(() => {
      expect(swapButton).toBeDisabled()
    })

    // Try clicking again - should be prevented by disabled state
    await user.click(swapButton)
    
    // Verify swapAndStake was only called once
    jest.advanceTimersByTime(600)
    await waitFor(() => {
      expect(mockRouterContract.swapAndStake).toHaveBeenCalledTimes(1)
    })
  })

  it('handles state updates in correct order during async operations', async () => {
    const user = userEvent.setup({ delay: null })
    
    ;(window as any).theta = {
      request: jest.fn().mockResolvedValue(['0x1234567890123456789012345678901234567890']),
    }

    const mockProvider = {
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1000')),
      getSigner: jest.fn().mockReturnValue({
        signMessage: jest.fn().mockResolvedValue('0xsignature'),
      }),
    }

    jest.spyOn(ethers.providers, 'Web3Provider').mockReturnValue(mockProvider as any)

    render(<App />)
    
    // Connect wallet
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    await user.click(connectButton)

    await waitFor(() => {
      expect(screen.getByText(/Connected/i)).toBeInTheDocument()
    })

    // Select percentage and initiate swap
    const percentageButton = screen.getByText(/Select %/i).closest('button')
    if (percentageButton) {
      await user.click(percentageButton)
      await waitFor(() => screen.getByText('50%'))
      await user.click(screen.getByText('50%'))
    }

    // Mock swap to track state transitions
    let swapPromiseResolve: (value: any) => void
    const swapPromise = new Promise((resolve) => {
      swapPromiseResolve = resolve
    })

    const mockRouterContract = {
      swapAndStake: jest.fn().mockReturnValue(swapPromise),
    }

    jest.spyOn(ethers, 'Contract').mockReturnValue(mockRouterContract as any)

    const swapButton = screen.getByRole('button', { name: /Swap & Stake/i })
    await user.click(swapButton)

    // Verify initial state shows swapping
    await waitFor(() => {
      // Check for swapping status (may appear in multiple places)
      const swappingElements = screen.queryAllByText(/Swapping/i)
      expect(swappingElements.length).toBeGreaterThan(0)
    }, { timeout: 1000 })

    // Resolve swap
    swapPromiseResolve!({
      hash: '0xtxhash',
      wait: jest.fn().mockResolvedValue({}),
    })

    await jest.advanceTimersByTimeAsync(100)

    // Verify state progresses to success
    await waitFor(() => {
      expect(screen.getByText(/Staked into/i)).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('prevents concurrent swap operations from interfering with each other', async () => {
    const user = userEvent.setup({ delay: null })
    
    ;(window as any).theta = {
      request: jest.fn().mockResolvedValue(['0x1234567890123456789012345678901234567890']),
    }

    const mockProvider = {
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1000')),
      getSigner: jest.fn().mockReturnValue({
        signMessage: jest.fn().mockResolvedValue('0xsignature'),
      }),
    }

    jest.spyOn(ethers.providers, 'Web3Provider').mockReturnValue(mockProvider as any)

    render(<App />)
    
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    await user.click(connectButton)

    await waitFor(() => {
      expect(screen.getByText(/Connected/i)).toBeInTheDocument()
    })

    // Select percentage
    const percentageButton = screen.getByText(/Select %/i).closest('button')
    if (percentageButton) {
      await user.click(percentageButton)
      await waitFor(() => screen.getByText('25%'))
      await user.click(screen.getByText('25%'))
    }

    const swapCallCounts: number[] = []
    
    const mockRouterContract = {
      swapAndStake: jest.fn().mockImplementation(() => {
        swapCallCounts.push(swapCallCounts.length + 1)
        // Simulate async operation
        return Promise.resolve({
          hash: '0xtxhash',
          wait: jest.fn().mockResolvedValue({}),
        })
      }),
    }

    jest.spyOn(ethers, 'Contract').mockReturnValue(mockRouterContract as any)

    const swapButton = screen.getByRole('button', { name: /Swap & Stake/i })
    
    // Attempt concurrent swaps
    const click1 = user.click(swapButton)
    await jest.advanceTimersByTimeAsync(10) // Small delay
    const click2 = user.click(swapButton) // Should be prevented
    await jest.advanceTimersByTimeAsync(10)
    const click3 = user.click(swapButton) // Should be prevented

    await Promise.all([click1, click2, click3])
    await jest.advanceTimersByTimeAsync(100)

    // Only one swap should have been executed
    await waitFor(() => {
      expect(mockRouterContract.swapAndStake).toHaveBeenCalledTimes(1)
    })
  })

  it('handles state reset correctly after operation completes', async () => {
    const user = userEvent.setup({ delay: null })
    
    ;(window as any).theta = {
      request: jest.fn().mockResolvedValue(['0x1234567890123456789012345678901234567890']),
    }

    const mockProvider = {
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1000')),
      getSigner: jest.fn().mockReturnValue({
        signMessage: jest.fn().mockResolvedValue('0xsignature'),
      }),
    }

    jest.spyOn(ethers.providers, 'Web3Provider').mockReturnValue(mockProvider as any)

    render(<App />)
    
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    await user.click(connectButton)

    await waitFor(() => {
      expect(screen.getByText(/Connected/i)).toBeInTheDocument()
    })

    // Select percentage
    const percentageButton = screen.getByText(/Select %/i).closest('button')
    if (percentageButton) {
      await user.click(percentageButton)
      await waitFor(() => screen.getByText('50%'))
      await user.click(screen.getByText('50%'))
    }

    const mockRouterContract = {
      swapAndStake: jest.fn().mockResolvedValue({
        hash: '0xtxhash',
        wait: jest.fn().mockResolvedValue({}),
      }),
    }

    jest.spyOn(ethers, 'Contract').mockReturnValue(mockRouterContract as any)

    const swapButton = screen.getByRole('button', { name: /Swap & Stake/i })
    await user.click(swapButton)

    // Wait for success state
    await waitFor(() => {
      expect(screen.getByText(/success|Staked into/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Advance time past the auto-reset timeout (8000ms) incrementally
    await jest.advanceTimersByTimeAsync(8500)
    
    // Use waitFor to allow React state updates to complete
    await waitFor(() => {
      // Check that status message has been cleared (state reset)
      const statusMessages = screen.queryAllByText(/Swapping|success|error/i)
      // Status should be cleared after reset, but button text might still show "Swap complete"
      // So we verify that the main status message div is not showing success/error
      const mainStatusDiv = screen.queryByText(/✅ Staked into/i)
      expect(mainStatusDiv).not.toBeInTheDocument()
    }, { timeout: 1000 })
  }, 10000)

  it('maintains consistent state when balance refreshes during swap operation', async () => {
    const user = userEvent.setup({ delay: null })
    
    ;(window as any).theta = {
      request: jest.fn().mockResolvedValue(['0x1234567890123456789012345678901234567890']),
    }

    let balanceCallCount = 0
    const mockProvider = {
      getBalance: jest.fn().mockImplementation(() => {
        balanceCallCount++
        // Simulate balance decreasing as swap happens
        const balances = [
          ethers.utils.parseEther('1000'), // Initial
          ethers.utils.parseEther('500'),  // After swap
        ]
        return Promise.resolve(balances[Math.min(balanceCallCount - 1, balances.length - 1)])
      }),
      getSigner: jest.fn().mockReturnValue({
        signMessage: jest.fn().mockResolvedValue('0xsignature'),
      }),
    }

    jest.spyOn(ethers.providers, 'Web3Provider').mockReturnValue(mockProvider as any)

    render(<App />)
    
    const connectButton = screen.getByRole('button', { name: /connect theta wallet/i })
    await user.click(connectButton)

    await waitFor(() => {
      expect(screen.getByText(/Connected/i)).toBeInTheDocument()
    })

    // Select percentage
    const percentageButton = screen.getByText(/Select %/i).closest('button')
    if (percentageButton) {
      await user.click(percentageButton)
      await waitFor(() => screen.getByText('50%'))
      await user.click(screen.getByText('50%'))
    }

    const mockRouterContract = {
      swapAndStake: jest.fn().mockImplementation(() => {
        // Simulate balance refresh happening during swap
        setTimeout(() => {
          mockProvider.getBalance()
        }, 100)
        return Promise.resolve({
          hash: '0xtxhash',
          wait: jest.fn().mockResolvedValue({}),
        })
      }),
    }

    jest.spyOn(ethers, 'Contract').mockReturnValue(mockRouterContract as any)

    const swapButton = screen.getByRole('button', { name: /Swap & Stake/i })
    await user.click(swapButton)

    // Verify swap completes successfully despite balance refresh
    await waitFor(() => {
      expect(screen.getByText(/success|Staked into/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})

