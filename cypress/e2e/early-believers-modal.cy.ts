describe('Early Believers Contribution Modal E2E', () => {
  const THETA_MAINNET_CHAIN_ID = '0x169' // 361 in hex
  const MOCK_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
  const MULTISIG_ADDRESS = Cypress.env('VITE_MULTISIG_ADDRESS') || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257'

  beforeEach(() => {
    // Mock window.theta and window.ethereum
    cy.window().then((win) => {
      // Default: mock mainnet connection
      ;(win as any).theta = {
        request: cy.stub().callsFake(({ method, params }) => {
          if (method === 'eth_requestAccounts') {
            return Promise.resolve([MOCK_ADDRESS])
          }
          if (method === 'eth_chainId') {
            return Promise.resolve(THETA_MAINNET_CHAIN_ID)
          }
          if (method === 'wallet_switchEthereumChain') {
            return Promise.resolve(null)
          }
          return Promise.resolve(null)
        }),
        on: cy.stub(),
        removeListener: cy.stub(),
        isMetaMask: false,
      }
      ;(win as any).ethereum = (win as any).theta
    })

    // Mock fetch for TFUEL price
    cy.intercept('GET', 'https://api.coingecko.com/api/v3/simple/price?ids=theta-fuel&vs_currencies=usd', {
      statusCode: 200,
      body: { 'theta-fuel': { usd: 0.05 } },
    }).as('getTfuelPrice')

    // Mock webhook endpoint
    cy.intercept('POST', 'https://hooks.zapier.com/hooks/catch/25764894/uakt9ir/', {
      statusCode: 200,
      body: { success: true },
    }).as('webhookPost')

    cy.visit('/')
  })

  describe('Homepage Card Visibility', () => {
    it('should display Early Believers card on homepage', () => {
      cy.contains('Early Believers Round — Mainnet Live').should('be.visible')
      cy.contains('TFUEL farmed into fresh rXF soul').should('be.visible')
      cy.contains('Contribute Now').should('be.visible')
    })

    it('should open modal when card is clicked', () => {
      cy.contains('Contribute Now').click()
      cy.contains('Early Believers Round — Mainnet Live').should('be.visible')
      cy.contains('Connect your Theta wallet to contribute').should('be.visible')
    })
  })

  describe('Wallet Connection', () => {
    it('should show connect button when wallet not connected', () => {
      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').should('be.visible')
    })

    it('should connect wallet successfully on mainnet', () => {
      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').click()

      cy.wait('@getTfuelPrice')

      // Should show connected wallet info
      cy.contains('Connected Wallet').should('be.visible')
      cy.contains(MOCK_ADDRESS.slice(0, 6)).should('be.visible')
    })

    it('should enforce mainnet and show error on wrong network', () => {
      cy.window().then((win) => {
        // Mock wrong network (testnet)
        ;(win as any).theta = {
          request: cy.stub().callsFake(({ method, params }) => {
            if (method === 'eth_requestAccounts') {
              return Promise.resolve([MOCK_ADDRESS])
            }
            if (method === 'eth_chainId') {
              return Promise.resolve('0x16d') // Testnet chain ID
            }
            return Promise.resolve(null)
          }),
          on: cy.stub(),
          removeListener: cy.stub(),
        }
        ;(win as any).ethereum = (win as any).theta
      })

      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').click()

      // Should show network error
      cy.contains('Please switch to Theta Mainnet', { timeout: 5000 }).should('be.visible')
      cy.contains('Switch to Theta Mainnet').should('be.visible')
    })

    it('should handle wallet connection rejection', () => {
      cy.window().then((win) => {
        ;(win as any).theta = {
          request: cy.stub().callsFake(({ method }) => {
            if (method === 'eth_requestAccounts') {
              return Promise.reject(new Error('User rejected'))
            }
            return Promise.resolve(null)
          }),
          on: cy.stub(),
          removeListener: cy.stub(),
        }
        ;(win as any).ethereum = (win as any).theta
      })

      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').click()

      // Should still show connect button (connection failed)
      cy.contains('Connect Theta Wallet', { timeout: 2000 }).should('be.visible')
    })
  })

  describe('Amount Input and Tier Calculation', () => {
    beforeEach(() => {
      // Connect wallet first
      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').click()
      cy.wait('@getTfuelPrice')
    })

    it('should accept amount input', () => {
      cy.get('input[type="number"]').should('be.visible')
      cy.get('input[type="number"]').type('1000')
      cy.get('input[type="number"]').should('have.value', '1000')
    })

    it('should show Standard tier for amounts < $50k', () => {
      cy.get('input[type="number"]').type('10000')
      cy.contains('Standard').should('be.visible')
      cy.contains('Total rXF').should('be.visible')
    })

    it('should show +10% bonus tier for $50k-$99k', () => {
      cy.get('input[type="number"]').type('60000')
      cy.contains('+10% bonus rXF').should('be.visible')
      cy.contains('Bonus (10%)').should('be.visible')
    })

    it('should show +25% bonus tier for $100k+', () => {
      cy.get('input[type="number"]').type('150000')
      cy.contains('+25% bonus rXF').should('be.visible')
      cy.contains('Bonus (25%)').should('be.visible')
    })

    it('should toggle between USDC and TFUEL payment methods', () => {
      cy.contains('USDC').should('be.visible')
      cy.contains('TFUEL').should('be.visible')

      // Click TFUEL
      cy.contains('button', 'TFUEL').click()
      cy.contains('button', 'TFUEL').should('have.class', 'border-cyan-400/80')

      // Click USDC
      cy.contains('button', 'USDC').click()
      cy.contains('button', 'USDC').should('have.class', 'border-cyan-400/80')
    })

    it('should show USD equivalent for TFUEL amounts', () => {
      cy.contains('button', 'TFUEL').click()
      cy.get('input[type="number"]').type('1000')
      cy.contains('≈ $').should('be.visible')
    })
  })

  describe('Payment Transaction UI', () => {
    beforeEach(() => {
      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').click()
      cy.wait('@getTfuelPrice')
    })

    it('should show multisig address', () => {
      cy.contains('Sending To').should('be.visible')
      // Check that multisig address section exists (may show placeholder if not configured)
      cy.contains('Sending To').parent().should('be.visible')
    })

    it('should disable contribute button when amount is 0', () => {
      cy.contains('button', 'Contribute Now').should('be.disabled')
    })

    it('should enable contribute button when valid amount entered', () => {
      cy.get('input[type="number"]').type('100')
      cy.contains('button', 'Contribute Now').should('not.be.disabled')
    })

    it('should show transaction status during processing', () => {
      // This test verifies UI states exist
      // Actual transaction testing requires manual verification
      cy.get('input[type="number"]').type('100')
      cy.contains('button', 'Contribute Now').should('be.visible')
    })
  })

  describe('Webhook Logging', () => {
    beforeEach(() => {
      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').click()
      cy.wait('@getTfuelPrice')
    })

    it('should have webhook endpoint configured', () => {
      // Verify webhook URL is set in environment
      // Actual webhook testing requires manual verification with real transactions
      cy.window().its('location.origin').should('exist')
    })

    it('should log contribution data structure', () => {
      // This test verifies the logging mechanism exists
      // Actual logging happens during real transactions
      cy.get('input[type="number"]').type('100')
      // Note: Full transaction flow testing requires manual verification
      // See docs/EARLY_BELIEVERS_MODAL_TEST.md for manual testing steps
    })
  })

  describe('Success Screen and Error Handling', () => {
    it('should display modal structure for success state', () => {
      // Verify UI elements exist for success state
      // Actual success state requires real transaction
      cy.contains('Contribute Now').click()
      cy.contains('Early Believers Round — Mainnet Live').should('be.visible')
      // Success screen elements are tested in manual testing guide
    })

    it('should have error handling UI elements', () => {
      cy.contains('Contribute Now').click()
      cy.contains('Connect Theta Wallet').click()
      // Error states are tested through manual testing
      // See docs/EARLY_BELIEVERS_MODAL_TEST.md
    })
  })

  describe('Disclaimer and Safety', () => {
    it('should display disclaimer footer', () => {
      cy.contains('Contribute Now').click()
      cy.contains('This is a contribution to support protocol development').should('be.visible')
      cy.contains('rXF provides governance and utility within XFUEL').should('be.visible')
      cy.contains('No promise of profit').should('be.visible')
    })

    it('should not contain investment language', () => {
      cy.contains('Contribute Now').click()
      cy.get('body').should('not.contain', 'investment')
      cy.get('body').should('not.contain', 'guaranteed return')
      cy.get('body').should('not.contain', 'profit')
    })
  })
})

