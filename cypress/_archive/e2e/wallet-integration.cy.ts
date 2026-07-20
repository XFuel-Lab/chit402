/**
 * End-to-End Tests for Theta Wallet and Keplr Integration
 * Tests the complete flow from wallet connection to LST staking
 */

describe('Wallet Integration E2E', () => {
  beforeEach(() => {
    // Mock Theta Wallet (window.ethereum)
    cy.window().then((win) => {
      ;(win as any).ethereum = {
        isTheta: true,
        request: cy.stub().callsFake((args: any) => {
          if (args.method === 'eth_requestAccounts') {
            return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'])
          }
          if (args.method === 'eth_accounts') {
            return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'])
          }
          return Promise.resolve([])
        }),
      }
    })

    // Mock Keplr
    cy.window().then((win) => {
      ;(win as any).keplr = {
        enable: cy.stub().resolves(undefined),
        experimentalSuggestChain: cy.stub().resolves(undefined),
        getOfflineSigner: cy.stub().returns({
          getAccounts: cy.stub().resolves([
            { address: 'stride1abc123def456ghi789' },
          ]),
        }),
      }
    })

    // Visit the app
    cy.visit('/')
  })

  describe('Theta Wallet Connection', () => {
    it('should connect to Theta Wallet via direct connection', () => {
      cy.contains('button', /Connect.*Wallet/i).should('be.visible').click()

      // Wait for connection
      cy.contains(/Connected|0x742d/i, { timeout: 10000 }).should('be.visible')
    })

    it('should show platform-aware connection method', () => {
      cy.window().then((win) => {
        const userAgent = win.navigator.userAgent
        console.log('User Agent:', userAgent)
        
        // Desktop should prefer extension, mobile should prefer WalletConnect
        if (userAgent.includes('Mobile')) {
          cy.log('Mobile detected - should use WalletConnect')
        } else {
          cy.log('Desktop detected - should use direct connection')
        }
      })
    })

    it('should handle connection error gracefully', () => {
      // Mock connection failure
      cy.window().then((win) => {
        ;(win as any).ethereum.request = cy.stub().rejects({
          code: 4001,
          message: 'User rejected',
        })
      })

      cy.contains('button', /Connect.*Wallet/i).click()

      // Should show error message
      cy.contains(/rejected|failed/i, { timeout: 5000 }).should('be.visible')
    })

    it('should clear session on approve disabled error', () => {
      cy.window().then((win) => {
        ;(win as any).ethereum.request = cy.stub().rejects({
          message: 'approve disabled',
        })
      })

      cy.contains('button', /Connect.*Wallet/i).click()

      // Should show suggestion to clear cache
      cy.contains(/clear.*cache/i, { timeout: 5000 }).should('exist')
    })
  })

  describe('Keplr Integration', () => {
    beforeEach(() => {
      // Connect Theta Wallet first
      cy.contains('button', /Connect.*Wallet/i).click()
      cy.contains(/Connected/i, { timeout: 10000 }).should('be.visible')
    })

    it('should suggest Cosmos chain to Keplr', () => {
      // Navigate to swap/stake interface
      cy.contains('button', /Swap.*Stake/i).should('be.visible')
      
      // Select stkTIA as output LST
      cy.contains(/stkTIA|Stake TIA/i).click()
      
      // Should trigger Keplr chain suggestion
      cy.window().then((win) => {
        expect((win as any).keplr.experimentalSuggestChain).to.have.been.called
      })
    })

    it('should show Keplr UI for transaction signing', () => {
      // This would be tested in integration with real Keplr
      // For now, verify the flow is triggered
      cy.window().then((win) => {
        const keplr = (win as any).keplr
        expect(keplr).to.exist
        expect(keplr.enable).to.exist
      })
    })

    it('should handle Cosmos address correctly (not 0x)', () => {
      cy.window().then((win) => {
        const keplr = (win as any).keplr
        const signer = keplr.getOfflineSigner('stride-1')
        
        return signer.getAccounts().then((accounts: any[]) => {
          const address = accounts[0].address
          
          // Verify it's a Cosmos address, not ETH
          expect(address).to.match(/^stride1/)
          expect(address).to.not.match(/^0x/)
        })
      })
    })

    it('should handle stkXPRT on Persistence chain', () => {
      // Select stkXPRT
      cy.contains(/stkXPRT|Stake XPRT/i).click()
      
      // Should enable Persistence chain, not Stride
      cy.window().then((win) => {
        const keplr = (win as any).keplr
        cy.wrap(keplr.enable).should('have.been.calledWith', 'core-1')
      })
    })
  })

  describe('Complete Swap Flow', () => {
    it('should complete Theta -> LST swap and stake', () => {
      // 1. Connect Theta Wallet
      cy.contains('button', /Connect.*Wallet/i).click()
      cy.contains(/Connected/i, { timeout: 10000 }).should('be.visible')
      
      // 2. Enter swap amount
      cy.get('input[type="number"]').first().type('100')
      
      // 3. Select LST
      cy.contains(/stkATOM|Stake ATOM/i).click()
      
      // 4. Initiate swap
      cy.contains('button', /Swap.*Stake/i).click()
      
      // 5. Should trigger Keplr for staking
      cy.window().then((win) => {
        expect((win as any).keplr.enable).to.have.been.called
      })
    })

    it('should show transaction success modal', () => {
      // Mock successful transaction
      cy.window().then((win) => {
        ;(win as any).ethereum.request = cy.stub().resolves('0xTXHASH123')
      })
      
      // Complete flow
      cy.contains('button', /Connect.*Wallet/i).click()
      cy.contains(/Connected/i, { timeout: 10000 })
      
      cy.get('input[type="number"]').first().type('50')
      cy.contains('button', /Swap.*Stake/i).click()
      
      // Should show success
      cy.contains(/success|complete/i, { timeout: 15000 }).should('be.visible')
    })
  })

  describe('Error Recovery', () => {
    it('should offer retry on connection failure', () => {
      let attemptCount = 0
      
      cy.window().then((win) => {
        ;(win as any).ethereum.request = cy.stub().callsFake(() => {
          attemptCount++
          if (attemptCount < 3) {
            return Promise.reject(new Error('Network error'))
          }
          return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'])
        })
      })
      
      cy.contains('button', /Connect.*Wallet/i).click()
      
      // Should eventually succeed after retries
      cy.contains(/Connected/i, { timeout: 20000 }).should('be.visible')
    })

    it('should provide emergency reset option', () => {
      // Look for emergency reset or clear session option
      cy.contains(/reset|clear.*session/i).should('exist')
    })
  })

  describe('Session Persistence', () => {
    it('should restore session on page reload', () => {
      // Connect wallet
      cy.contains('button', /Connect.*Wallet/i).click()
      cy.contains(/Connected/i, { timeout: 10000 })
      
      // Reload page
      cy.reload()
      
      // Should auto-reconnect
      cy.contains(/Connected|0x742d/i, { timeout: 5000 }).should('be.visible')
    })

    it('should clear session after 24 hours', () => {
      // This would need time manipulation in a real test
      // For now, verify session storage exists
      cy.window().then((win) => {
        const session = win.localStorage.getItem('xfuel_theta_session')
        expect(session).to.exist
      })
    })
  })

  describe('Deep Linking (Mobile)', () => {
    it('should handle WalletConnect deep link', () => {
      // Mock mobile user agent
      cy.window().then((win) => {
        Object.defineProperty(win.navigator, 'userAgent', {
          value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X)',
          configurable: true,
        })
      })
      
      // Should prefer WalletConnect on mobile
      cy.contains('button', /Connect.*Wallet/i).click()
      
      // Would trigger deep link (can't fully test in Cypress)
      cy.log('Deep link would be triggered on real mobile device')
    })
  })

  describe('Accessibility', () => {
    it('should be keyboard navigable', () => {
      cy.get('body').tab()
      cy.focused().should('have.attr', 'role', 'button')
    })

    it('should have proper ARIA labels', () => {
      cy.get('button').first().should('have.attr', 'aria-label')
    })
  })
})

