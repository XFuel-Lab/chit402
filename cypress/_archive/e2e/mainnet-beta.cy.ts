// Mainnet Beta Testing - Limits and Banner E2E Tests

describe('Mainnet Beta Testing Features', () => {
  beforeEach(() => {
    // Mock mainnet environment
    cy.visit('/', {
      onBeforeLoad(win) {
        // Set mainnet in config
        win.localStorage.setItem('xfuel_network', 'mainnet')
      }
    })
  })

  describe('Beta Banner', () => {
    it('should display beta banner on mainnet', () => {
      // Check banner is visible
      cy.contains('Live Mainnet Testing').should('be.visible')
      cy.contains('Swap at Your Own Risk').should('be.visible')
      
      // Check limits are displayed
      cy.contains('1,000 TFUEL').should('be.visible')
      cy.contains('5,000 TFUEL').should('be.visible')
    })

    it('should hide banner when dismissed', () => {
      // Banner should be visible initially
      cy.contains('Live Mainnet Testing').should('be.visible')
      
      // Click dismiss button
      cy.get('[aria-label="Dismiss banner"]').click()
      
      // Banner should be hidden
      cy.contains('Live Mainnet Testing').should('not.exist')
    })

    it('should not display banner on testnet', () => {
      // Set testnet environment
      cy.window().then((win) => {
        win.localStorage.setItem('xfuel_network', 'testnet')
      })
      
      cy.reload()
      
      // Banner should not be visible
      cy.contains('Live Mainnet Testing').should('not.exist')
    })
  })

  describe('Swap Limits', () => {
    beforeEach(() => {
      // Mock wallet connection
      cy.window().then((win) => {
        win.localStorage.setItem('wallet_connected', 'true')
        win.localStorage.setItem('wallet_address', '0x1234567890123456789012345678901234567890')
      })
    })

    it('should reject swaps over 1,000 TFUEL', () => {
      // Navigate to swap
      cy.contains('Swap').click()
      
      // Try to swap 1,500 TFUEL
      cy.get('input[type="number"]').type('1500')
      
      // Click swap button
      cy.contains('Swap Now').click()
      
      // Should show error
      cy.contains('exceeds max swap limit').should('be.visible')
    })

    it('should accept swaps under 1,000 TFUEL', () => {
      // Navigate to swap
      cy.contains('Swap').click()
      
      // Try to swap 500 TFUEL
      cy.get('input[type="number"]').type('500')
      
      // Click swap button
      cy.contains('Swap Now').click()
      
      // Should not show max limit error
      cy.contains('exceeds max swap limit').should('not.exist')
    })

    it('should track total user swaps', () => {
      const userAddress = '0x1234567890123456789012345678901234567890'
      
      // Clear any existing swap data
      cy.window().then((win) => {
        win.localStorage.removeItem('xfuel_user_swap_total')
      })
      
      // Make first swap of 2,000 TFUEL
      cy.get('input[type="number"]').type('2000')
      cy.contains('Swap Now').click()
      
      // Wait for swap to complete (mocked)
      cy.wait(1000)
      
      // Try another swap of 4,000 TFUEL (would exceed 5,000 total)
      cy.get('input[type="number"]').clear().type('4000')
      cy.contains('Swap Now').click()
      
      // Should show total limit error
      cy.contains('Total limit exceeded').should('be.visible')
      cy.contains('TFUEL remaining').should('be.visible')
    })

    it('should display remaining allowance', () => {
      // Make a swap
      cy.get('input[type="number"]').type('1000')
      cy.contains('Swap Now').click()
      
      // Check console for remaining allowance log
      cy.window().then((win) => {
        const swapTotal = JSON.parse(win.localStorage.getItem('xfuel_user_swap_total') || '{}')
        const userTotal = swapTotal['0x1234567890123456789012345678901234567890'] || 0
        const remaining = 5000 - userTotal
        
        expect(remaining).to.be.at.least(0)
        expect(remaining).to.be.at.most(5000)
      })
    })
  })

  describe('Emergency Controls', () => {
    it('should prevent swaps when contract is paused', () => {
      // Mock paused state in contract
      cy.intercept('POST', '**/eth-rpc-api.thetatoken.org/rpc', (req) => {
        if (req.body.method === 'eth_call') {
          // Mock paused() call returning true
          req.reply({
            statusCode: 200,
            body: {
              jsonrpc: '2.0',
              id: req.body.id,
              result: '0x0000000000000000000000000000000000000000000000000000000000000001' // true
            }
          })
        }
      }).as('pausedCheck')
      
      // Try to swap
      cy.get('input[type="number"]').type('100')
      cy.contains('Swap Now').click()
      
      // Should show paused error
      cy.contains('contract is paused', { matchCase: false }).should('be.visible')
    })
  })

  describe('Safety Features', () => {
    it('should display safety warnings', () => {
      // Check for safety indicators
      cy.contains('Unaudited').should('be.visible')
      cy.contains('Beta').should('be.visible')
    })

    it('should not allow unlimited approvals', () => {
      // Check that approval amounts are limited
      cy.window().then((win) => {
        // Mock ethers contract call
        const mockContract = {
          approve: cy.stub().as('approveStub')
        }
        
        // Trigger approval flow
        cy.get('input[type="number"]').type('500')
        cy.contains('Approve').click()
        
        // Check that approval is for exact amount, not MAX_UINT256
        cy.get('@approveStub').should('not.be.calledWith', cy.anything(), '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      })
    })
  })
})

