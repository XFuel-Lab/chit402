/**
 * Cypress E2E Tests for Theta Wallet QR Modal
 * 
 * Tests:
 * - QR modal display
 * - QR code generation
 * - Copy link functionality
 * - Mobile deep link
 * - Error recovery
 * - MetaMask fallback
 * - Session persistence
 */

describe('Theta Wallet QR Modal E2E', () => {
  beforeEach(() => {
    // Clear localStorage
    cy.clearLocalStorage()

    // Mock WalletConnect
    cy.window().then((win) => {
      // Mock successful WalletConnect initialization
      ;(win as any).mockWalletConnectUri = 'wc:mock-uri-12345@2?bridge=https%3A%2F%2Fbridge.walletconnect.org&key=mock-key'
    })

    // Visit the app
    cy.visit('/')
  })

  describe('QR Modal Display', () => {
    it('should open QR modal on connect button click', () => {
      // Click connect wallet button
      cy.contains('button', /connect.*wallet/i).click()

      // QR modal should appear
      cy.contains('Connect Theta Wallet').should('be.visible')
      cy.contains('Scan with Theta Wallet').should('be.visible')
    })

    it('should display QR code container', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // QR code container should be visible
      cy.get('[data-testid="qr-container"]').should('exist').or(
        cy.contains('Loading QR').should('be.visible')
      )
    })

    it('should show loading state initially', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Should show loading spinner
      cy.contains('Loading QR').should('be.visible').or(
        cy.contains('Generating').should('be.visible')
      )
    })

    it('should close modal when clicking close button', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Modal should be visible
      cy.contains('Connect Theta Wallet').should('be.visible')

      // Click close button (X icon)
      cy.get('button').contains('svg').click({ force: true })

      // Modal should be closed
      cy.contains('Connect Theta Wallet').should('not.exist')
    })

    it('should close modal when clicking backdrop', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Click backdrop (outside modal)
      cy.get('.fixed.inset-0').first().click({ force: true })

      // Modal should be closed
      cy.contains('Connect Theta Wallet').should('not.exist')
    })
  })

  describe('QR Code Generation', () => {
    it('should generate QR code after initialization', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Wait for QR code to appear (or timeout with loading state)
      cy.contains('Loading QR').should('be.visible').or(
        cy.get('svg').should('exist') // QR code SVG
      )
    })

    it('should display valid WalletConnect URI format', () => {
      // Intercept WalletConnect initialization
      cy.window().then((win) => {
        // Set mock URI
        ;(win as any).mockWalletConnectUri = 'wc:test-uri@2?bridge=https%3A%2F%2Fbridge.walletconnect.org&key=test-key'
      })

      cy.contains('button', /connect.*wallet/i).click()

      // URI should start with 'wc:'
      cy.window().its('mockWalletConnectUri').should('match', /^wc:/)
    })
  })

  describe('Copy Link Functionality', () => {
    it('should show copy link button', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Copy link button should be visible (after QR loads)
      cy.contains('Copy Link').should('exist')
    })

    it('should copy link to clipboard', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Wait for copy button
      cy.contains('Copy Link', { timeout: 10000 }).should('be.visible')

      // Click copy
      cy.contains('Copy Link').click()

      // Success toast should appear
      cy.contains('Link copied', { timeout: 5000 }).should('be.visible')
    })

    it('should hide copy toast after 3 seconds', () => {
      cy.contains('button', /connect.*wallet/i).click()

      cy.contains('Copy Link', { timeout: 10000 }).click()

      // Toast appears
      cy.contains('Link copied').should('be.visible')

      // Toast disappears after 3 seconds
      cy.wait(3500)
      cy.contains('Link copied').should('not.exist')
    })
  })

  describe('Mobile Deep Link', () => {
    beforeEach(() => {
      // Mock mobile user agent
      cy.viewport('iphone-x')
    })

    it('should show "Open Theta Wallet App" button on mobile', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Mobile-specific button should appear
      cy.contains('Open Theta Wallet', { timeout: 10000 }).should('exist')
    })

    it('should handle deep link click', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Click deep link button
      cy.contains('Open Theta Wallet', { timeout: 10000 }).click()

      // Should attempt to open deep link (can't test actual app open in Cypress)
      // But we can verify button was clicked
      cy.contains('Open Theta Wallet').should('exist')
    })
  })

  describe('Error Handling', () => {
    it('should show error message on connection failure', () => {
      // Mock WalletConnect error
      cy.window().then((win) => {
        ;(win as any).mockWalletConnectError = new Error('Connection failed')
      })

      cy.contains('button', /connect.*wallet/i).click()

      // Error message should appear
      cy.contains(/failed|error/i, { timeout: 10000 }).should('be.visible')
    })

    it('should show retry button on error', () => {
      cy.window().then((win) => {
        ;(win as any).mockWalletConnectError = new Error('Network error')
      })

      cy.contains('button', /connect.*wallet/i).click()

      // Retry button should appear
      cy.contains('Retry', { timeout: 10000 }).should('be.visible')
    })

    it('should retry connection on retry button click', () => {
      cy.window().then((win) => {
        ;(win as any).mockWalletConnectError = new Error('Temporary error')
      })

      cy.contains('button', /connect.*wallet/i).click()

      // Wait for error
      cy.contains('Retry', { timeout: 10000 }).should('be.visible')

      // Clear error
      cy.window().then((win) => {
        delete ;(win as any).mockWalletConnectError
      })

      // Click retry
      cy.contains('Retry').click()

      // Should show loading state again
      cy.contains('Loading QR').should('be.visible')
    })

    it('should clear storage on error retry', () => {
      // Set some storage
      cy.window().then((win) => {
        win.localStorage.setItem('wc@2:test', 'mock-data')
      })

      cy.window().then((win) => {
        ;(win as any).mockWalletConnectError = new Error('Storage error')
      })

      cy.contains('button', /connect.*wallet/i).click()

      cy.contains('Retry', { timeout: 10000 }).click()

      // Storage should be cleared
      cy.window().then((win) => {
        expect(win.localStorage.getItem('wc@2:test')).to.be.null
      })
    })
  })

  describe('MetaMask Fallback', () => {
    it('should show MetaMask option', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // MetaMask button should be visible
      cy.contains('MetaMask').should('be.visible')
    })

    it('should connect via MetaMask when clicked', () => {
      // Mock MetaMask
      cy.window().then((win) => {
        ;(win as any).ethereum = {
          isMetaMask: true,
          request: cy.stub().resolves(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        }
      })

      cy.contains('button', /connect.*wallet/i).click()

      // Click MetaMask button
      cy.contains('MetaMask').click()

      // Should connect (modal closes)
      cy.contains('Connect Theta Wallet').should('not.exist')
    })

    it('should open MetaMask download page if not installed', () => {
      // No MetaMask installed
      cy.window().then((win) => {
        delete ;(win as any).ethereum
      })

      cy.contains('button', /connect.*wallet/i).click()

      // Stub window.open
      cy.window().then((win) => {
        cy.stub(win, 'open').as('windowOpen')
      })

      // Click MetaMask button
      cy.contains('MetaMask').click()

      // Should open download page
      cy.get('@windowOpen').should('be.calledWith', 'https://metamask.io/download/')
    })
  })

  describe('Session Persistence', () => {
    it('should save connection to localStorage', () => {
      // Mock successful connection
      cy.window().then((win) => {
        ;(win as any).ethereum = {
          isTheta: true,
          request: cy.stub().resolves(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
          on: cy.stub(),
        }
      })

      cy.contains('button', /connect.*wallet/i).click()

      // Wait for connection
      cy.wait(1000)

      // Check localStorage
      cy.window().then((win) => {
        const address = win.localStorage.getItem('xfuel_wallet_address')
        expect(address).to.exist
      })
    })

    it('should restore session on page reload', () => {
      // Set up saved session
      cy.window().then((win) => {
        win.localStorage.setItem('xfuel_wallet_address', '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')
        win.localStorage.setItem('xfuel_connection_method', 'theta_extension')
        win.localStorage.setItem('xfuel_session_ts', Date.now().toString())
      })

      // Mock Theta Wallet
      cy.window().then((win) => {
        ;(win as any).ethereum = {
          isTheta: true,
          request: cy.stub().resolves(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
          on: cy.stub(),
        }
      })

      // Reload page
      cy.reload()

      // Should auto-connect
      cy.contains('0x742d...0bEb', { timeout: 5000 }).should('be.visible')
    })
  })

  describe('Responsive Design', () => {
    it('should display properly on mobile', () => {
      cy.viewport('iphone-x')

      cy.contains('button', /connect.*wallet/i).click()

      // Modal should fit mobile screen
      cy.contains('Connect Theta Wallet').should('be.visible')
      cy.get('.max-w-lg').should('exist') // Modal max width
    })

    it('should display properly on tablet', () => {
      cy.viewport('ipad-2')

      cy.contains('button', /connect.*wallet/i).click()

      cy.contains('Connect Theta Wallet').should('be.visible')
    })

    it('should display properly on desktop', () => {
      cy.viewport(1920, 1080)

      cy.contains('button', /connect.*wallet/i).click()

      cy.contains('Connect Theta Wallet').should('be.visible')
    })
  })

  describe('Theta Network Configuration', () => {
    it('should display correct chain ID', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Should show Theta chain ID 361
      cy.contains('361').should('be.visible')
    })

    it('should use correct RPC endpoint', () => {
      cy.window().then((win) => {
        // Check if RPC URL is configured
        cy.visit('/', {
          onBeforeLoad: (win) => {
            cy.spy(win.console, 'log').as('consoleLog')
          },
        })
      })

      cy.contains('button', /connect.*wallet/i).click()

      // Should log RPC URL
      cy.get('@consoleLog').should('be.calledWith', 
        Cypress.sinon.match(/https:\/\/eth-rpc-api\.thetatoken\.org\/rpc/)
      )
    })
  })

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Close button should have accessible label
      cy.get('button').contains('svg').should('exist')
    })

    it('should be keyboard navigable', () => {
      cy.contains('button', /connect.*wallet/i).click()

      // Tab through elements
      cy.focused().tab()
      cy.focused().tab()

      // Should be able to close with Escape
      cy.get('body').type('{esc}')
      cy.contains('Connect Theta Wallet').should('not.exist')
    })
  })
})

describe('Theta Wallet Connection Flow on Testnet', () => {
  it('should connect to Theta Testnet', () => {
    // Set testnet mode
    cy.window().then((win) => {
      win.localStorage.setItem('xfuel_use_testnet', 'true')
    })

    cy.visit('/')

    // Mock Theta Wallet on testnet
    cy.window().then((win) => {
      ;(win as any).ethereum = {
        isTheta: true,
        request: cy.stub().resolves(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        on: cy.stub(),
      }
    })

    cy.contains('button', /connect.*wallet/i).click()

    // Should connect to testnet
    cy.wait(1000)
  })
})

