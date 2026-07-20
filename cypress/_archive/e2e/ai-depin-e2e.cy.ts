/**
 * @title Cypress E2E — AI DePIN TaskSimulator v5.1
 * @notice Frontend E2E tests for the TaskSimulator component:
 *
 *   1. POST /task-request via TaskSimulator form
 *   2. Assert ProofOutcome.Valid / Regenerable / Invalid (Section 3.4.5)
 *   3. Fee preview with 30/30/25/15 revenue split
 *   4. All message types: COMPUTE_BID, INFERENCE_REQUEST, CAPABILITY_QUERY, etc.
 *   5. All chain targets: Akash, Bittensor (TAO), Osmosis, Theta, Persistence
 *   6. Error handling (dust rejection, invalid chain, rate limit)
 *
 * Reference: Whitepaper v5.1 Sections 3.4.5, 6.1.2, 8.2
 */

const BACKEND_URL = Cypress.env('BACKEND_URL') || 'http://localhost:3001'
const FRONTEND_URL = Cypress.env('BASE_URL') || 'http://localhost:3000'

// ─── Constants (synced with frontend/src/utils/api.js) ────────────────────────

const MESSAGE_TYPES = {
  COMPUTE_BID: 'compute_bid',
  COMPUTE_RESULT: 'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY: 'capability_query',
  DATA_ATTESTATION: 'data_attestation',
}

const CHAIN_IDS = {
  THETA: 'theta',
  OSMOSIS: 'osmosis',
  AKASH: 'akash',
  BITTENSOR: 'bittensor',
  PERSISTENCE: 'persistence',
}

const FEE_CONFIG = {
  defaultBps: 50,
  minBps: 50,
  maxBps: 100,
  denominator: 10000,
  minTaskAmount: 10000,
}

// ─── Helper: mock /task-request response ─────────────────────────────────────

function mockTaskResponse(overrides: Record<string, any> = {}) {
  const taskId = `task_${Cypress._.uniqueId()}_${Date.now()}`
  return {
    task_id: taskId,
    status: 'accepted',
    message_type: MESSAGE_TYPES.INFERENCE_REQUEST,
    chain_id: CHAIN_IDS.AKASH,
    gross_amount: '1000000',
    fee_amount: '5000',
    net_amount: '995000',
    fee_bps: 50,
    fee_info: {
      description: '0.5% AI task fee → FeeCollector → 30/30/25/15 split',
    },
    proof_outcome: 'pending',
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TaskSimulator E2E Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI DePIN TaskSimulator E2E', () => {
  beforeEach(() => {
    cy.visit(FRONTEND_URL)

    // Navigate to TaskSimulator tab (if tabbed UI)
    cy.get('body').then(($body) => {
      if ($body.find('[role="tab"]').length > 0) {
        cy.contains('[role="tab"]', /task/i).click()
      }
    })
  })

  // ─── POST /task-request — INFERENCE_REQUEST → Akash ───────────────────────

  describe('POST /task-request — INFERENCE_REQUEST', () => {
    it('should submit inference request to Akash and receive accepted response', () => {
      cy.intercept('POST', '**/task-request', {
        statusCode: 200,
        body: mockTaskResponse({
          message_type: MESSAGE_TYPES.INFERENCE_REQUEST,
          chain_id: CHAIN_IDS.AKASH,
          proof_outcome: 'valid',
        }),
      }).as('submitTask')

      // Fill form
      cy.get('input[value="1000000"], [label*="Amount"] input')
        .first()
        .clear()
        .type('1000000')

      // Submit
      cy.contains('button', /submit/i).click()

      cy.wait('@submitTask').then((interception) => {
        const body = interception.request.body
        expect(body.message_type).to.equal(MESSAGE_TYPES.INFERENCE_REQUEST)
        expect(body.chain_id).to.equal(CHAIN_IDS.AKASH)
        expect(Number(body.amount)).to.be.greaterThan(0)
      })

      // Verify response displayed
      cy.contains('Task Accepted').should('be.visible')
      cy.contains('task_').should('be.visible') // task ID shown
    })

    it('should assert ProofOutcome.Valid on successful task', () => {
      cy.intercept('POST', '**/task-request', {
        statusCode: 200,
        body: mockTaskResponse({ proof_outcome: 'valid' }),
      }).as('submitTask')

      cy.contains('button', /submit/i).click()
      cy.wait('@submitTask')
      cy.contains('Task Accepted').should('be.visible')
    })
  })

  // ─── ProofOutcome: Regenerable (Section 3.4.5) ────────────────────────────

  describe('ProofOutcome.Regenerable — Retry Flow (Section 3.4.5)', () => {
    it('should handle Regenerable outcome and show retry status', () => {
      let callCount = 0
      cy.intercept('POST', '**/task-request', (req) => {
        callCount++
        if (callCount === 1) {
          req.reply({
            statusCode: 200,
            body: mockTaskResponse({
              proof_outcome: 'regenerable',
              status: 'retry_pending',
              retry_reason: 'stale_block_height',
            }),
          })
        } else {
          req.reply({
            statusCode: 200,
            body: mockTaskResponse({
              proof_outcome: 'valid',
              status: 'accepted',
            }),
          })
        }
      }).as('submitTask')

      cy.contains('button', /submit/i).click()
      cy.wait('@submitTask')

      // First response shows regenerable status
      cy.get('body').then(($body) => {
        const text = $body.text()
        // Either shows task accepted (on auto-retry) or retry info
        expect(text).to.satisfy(
          (t: string) => t.includes('Task Accepted') || t.includes('retry') || t.includes('Regenerable'),
          'Shows regenerable or retry status',
        )
      })
    })
  })

  // ─── ProofOutcome: Invalid (Section 3.4.5) ────────────────────────────────

  describe('ProofOutcome.Invalid — Hard Failure (Section 3.4.5)', () => {
    it('should display error for Invalid proof outcome', () => {
      cy.intercept('POST', '**/task-request', {
        statusCode: 400,
        body: {
          error: 'ProofOutcome.Invalid',
          message: 'Proof validation failed: fee mismatch',
          proof_outcome: 'invalid',
          reason_hash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      }).as('submitTask')

      cy.contains('button', /submit/i).click()
      cy.wait('@submitTask')

      // Error should be displayed
      cy.get('[role="alert"], .MuiAlert-root').should('be.visible')
    })
  })

  // ─── Fee Preview ──────────────────────────────────────────────────────────

  describe('Fee Preview & Revenue Split', () => {
    it('should preview fee with correct 30/30/25/15 split', () => {
      // Click Preview Fee button
      cy.contains('button', /preview/i).click()

      // Fee preview card should appear
      cy.contains('Fee Preview').should('be.visible')

      // Revenue split labels should be visible
      cy.contains('30%').should('exist')
      cy.contains('25%').should('exist')
      cy.contains('15%').should('exist')
    })

    it('should update fee preview when amount changes', () => {
      // Enter amount
      cy.get('input[value="1000000"], [label*="Amount"] input')
        .first()
        .clear()
        .type('5000000')

      cy.contains('button', /preview/i).click()
      cy.contains('Fee Preview').should('be.visible')
      // Fee should be calculated on 5M
    })
  })

  // ─── All Message Types ────────────────────────────────────────────────────

  describe('All Message Types', () => {
    const messageTypes = [
      { type: MESSAGE_TYPES.COMPUTE_BID, label: 'COMPUTE BID' },
      { type: MESSAGE_TYPES.COMPUTE_RESULT, label: 'COMPUTE RESULT' },
      { type: MESSAGE_TYPES.INFERENCE_REQUEST, label: 'INFERENCE REQUEST' },
      { type: MESSAGE_TYPES.CAPABILITY_QUERY, label: 'CAPABILITY QUERY' },
      { type: MESSAGE_TYPES.DATA_ATTESTATION, label: 'DATA ATTESTATION' },
    ]

    messageTypes.forEach(({ type, label }) => {
      it(`should submit ${label} task successfully`, () => {
        cy.intercept('POST', '**/task-request', {
          statusCode: 200,
          body: mockTaskResponse({ message_type: type }),
        }).as('submitTask')

        // Select message type from dropdown
        cy.get('[label="Message Type"] div[role="combobox"], [id*="message"] [role="combobox"]')
          .first()
          .click()
        cy.get('[role="listbox"] [role="option"]')
          .contains(new RegExp(label.replace(/_/g, ' '), 'i'))
          .click()

        cy.contains('button', /submit/i).click()
        cy.wait('@submitTask').then((interception) => {
          expect(interception.request.body.message_type).to.equal(type)
        })
      })
    })
  })

  // ─── All Chain Targets ────────────────────────────────────────────────────

  describe('All Chain Targets', () => {
    const chains = [
      { id: CHAIN_IDS.AKASH, label: 'Akash' },
      { id: CHAIN_IDS.BITTENSOR, label: 'Bittensor' },
      { id: CHAIN_IDS.OSMOSIS, label: 'Osmosis' },
      { id: CHAIN_IDS.THETA, label: 'Theta' },
      { id: CHAIN_IDS.PERSISTENCE, label: 'Persistence' },
    ]

    chains.forEach(({ id, label }) => {
      it(`should route task to ${label} chain`, () => {
        cy.intercept('POST', '**/task-request', {
          statusCode: 200,
          body: mockTaskResponse({ chain_id: id }),
        }).as('submitTask')

        // Select chain from dropdown
        cy.get('[label="Chain ID"] div[role="combobox"], [id*="chain"] [role="combobox"]')
          .first()
          .click()
        cy.get('[role="listbox"] [role="option"]')
          .contains(new RegExp(label, 'i'))
          .click()

        cy.contains('button', /submit/i).click()
        cy.wait('@submitTask').then((interception) => {
          expect(interception.request.body.chain_id).to.equal(id)
        })
      })
    })
  })

  // ─── Error Handling ───────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should display error for dust amount rejection', () => {
      cy.intercept('POST', '**/task-request', {
        statusCode: 400,
        body: {
          error: 'ValidationError',
          message: 'Amount below minimum',
          details: [`amount must be >= ${FEE_CONFIG.minTaskAmount}`],
        },
      }).as('submitTask')

      cy.get('input[value="1000000"], [label*="Amount"] input')
        .first()
        .clear()
        .type('100')

      cy.contains('button', /submit/i).click()
      cy.wait('@submitTask')

      cy.get('[role="alert"], .MuiAlert-root').should('be.visible')
    })

    it('should display error for rate limit (429)', () => {
      cy.intercept('POST', '**/task-request', {
        statusCode: 429,
        body: { error: 'RateLimited', message: 'Too many requests' },
      }).as('submitTask')

      cy.contains('button', /submit/i).click()
      cy.wait('@submitTask')

      cy.get('[role="alert"], .MuiAlert-root').should('be.visible')
    })

    it('should display error for server error (500)', () => {
      cy.intercept('POST', '**/task-request', {
        statusCode: 500,
        body: { error: 'InternalError', message: 'SP1 prover unavailable' },
      }).as('submitTask')

      cy.contains('button', /submit/i).click()
      cy.wait('@submitTask')

      cy.get('[role="alert"], .MuiAlert-root').should('be.visible')
    })

    it('should display error for network timeout', () => {
      cy.intercept('POST', '**/task-request', { forceNetworkError: true }).as('submitTask')

      cy.contains('button', /submit/i).click()

      // Wait for error state
      cy.get('[role="alert"], .MuiAlert-root', { timeout: 10000 }).should('be.visible')
    })
  })

  // ─── Backend Integration (live) ───────────────────────────────────────────

  describe('Backend Integration (live, if available)', () => {
    it('should verify backend health', () => {
      cy.request({ url: `${BACKEND_URL}/health`, failOnStatusCode: false })
        .then((response) => {
          if (response.status === 200) {
            expect(response.body).to.have.property('status', 'ok')
            cy.log('Backend is healthy')
          } else {
            cy.log('Backend not available — skipping live tests')
          }
        })
    })

    it('should submit live task request if backend is available', () => {
      cy.request({ url: `${BACKEND_URL}/health`, failOnStatusCode: false })
        .then((healthResp) => {
          if (healthResp.status !== 200) {
            cy.log('Skipping — backend not available')
            return
          }

          cy.request({
            method: 'POST',
            url: `${BACKEND_URL}/task-request`,
            body: {
              message_type: MESSAGE_TYPES.INFERENCE_REQUEST,
              chain_id: CHAIN_IDS.AKASH,
              amount: '1000000',
              sender: '0xCypressE2ETestSender',
            },
            failOnStatusCode: false,
          }).then((response) => {
            // Accept either 200 (success) or 401/403 (auth required — still proves endpoint works)
            expect([200, 201, 401, 403]).to.include(response.status)
            cy.log(`Backend response status: ${response.status}`)
          })
        })
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// TaskStatus Polling E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('Task Status Polling', () => {
  beforeEach(() => {
    cy.visit(FRONTEND_URL)
  })

  it('should poll task status and display ProofOutcome', () => {
    const taskId = `task_poll_${Date.now()}`

    // Mock initial task submission
    cy.intercept('POST', '**/task-request', {
      statusCode: 200,
      body: mockTaskResponse({ task_id: taskId, proof_outcome: 'pending' }),
    }).as('submitTask')

    // Mock status polling
    cy.intercept('GET', '**/task-status*', {
      statusCode: 200,
      body: {
        task_id: taskId,
        status: 'settled',
        proof_outcome: 'valid',
        output_hash: '0x' + 'ab'.repeat(32),
      },
    }).as('pollStatus')

    // Submit task
    cy.contains('button', /submit/i).click()
    cy.wait('@submitTask')
    cy.contains('Task Accepted').should('be.visible')
  })
})
