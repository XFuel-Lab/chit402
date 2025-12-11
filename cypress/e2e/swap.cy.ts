describe('XFUEL Swap E2E Test', () => {
  beforeEach(() => {
    // Mock window.ethereum (Theta Wallet)
    cy.window().then((win) => {
      (win as any).ethereum = {
        request: cy.stub().resolves(['0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb']),
        isMetaMask: false,
      }
    })

    // Visit the app
    cy.visit('/')
  })

  it('should complete a swap flow', () => {
    // Step 1: Connect wallet
    cy.contains('button', 'Connect Theta Wallet').should('be.visible').click()

    // Wait for wallet connection
    cy.contains('Connected', { timeout: 5000 }).should('be.visible')
    cy.contains('0x1234...5678').should('be.visible')
    cy.contains('1,234.56').should('be.visible')
    cy.contains('TFUEL').should('be.visible')

    // Step 2: Enter 10 TFUEL
    cy.get('input[type="text"]').first().clear().type('10')
    cy.get('input[type="text"]').first().should('have.value', '10')

    // Step 3: Click "100% → pSTAKE BTC" button
    cy.contains('button', '100% → pSTAKE BTC').should('be.visible').click()

    // Verify the input field is updated (should be 100% of balance)
    cy.get('input[type="text"]').first().should('have.value', '1234.56')

    // Step 4: Approve TFUEL
    cy.contains('button', 'Approve TFUEL').should('be.visible').click()

    // Wait for approval status message
    cy.contains('Approval successful', { timeout: 3000 }).should('be.visible')

    // Step 5: Click Swap button
    cy.contains('button', 'Swap').should('be.visible').click()

    // Step 6: Assert success message appears
    cy.contains('Swap successful', { timeout: 5000 }).should('be.visible')
  })
})

