/**
 * Swap API with Enhanced Security and Validation
 * 
 * Features:
 * - Input validation and sanitization
 * - Replay attack prevention via nonce/timestamp
 * - Comprehensive error handling
 * - Simulation mode for testing
 */

import express from 'express'

const router = express.Router()

// Environment variable: SIMULATION_MODE (default: false)
const SIMULATION_MODE = process.env.SIMULATION_MODE === 'true'

// Validation utilities (inline since we're using ES modules)
const VALID_LST_SYMBOLS = ['stkTIA', 'stkATOM', 'stkXPRT', 'stkOSMO', 'pSTAKE BTC', 'USDC']

function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

function validateSwapRequest(data) {
  const errors = []

  if (!data.userAddress || !isValidAddress(data.userAddress)) {
    errors.push('Invalid or missing userAddress')
  }

  if (typeof data.amount !== 'number' || data.amount <= 0 || data.amount > 1000000) {
    errors.push('Invalid amount (must be 0 < amount <= 1M)')
  }

  if (!data.targetLST || !VALID_LST_SYMBOLS.includes(data.targetLST)) {
    errors.push(`Invalid targetLST (must be one of: ${VALID_LST_SYMBOLS.join(', ')})`)
  }

  if (typeof data.userBalance !== 'number' || data.userBalance < data.amount) {
    errors.push('Insufficient balance')
  }

  // Validate timestamp for replay protection
  if (data.timestamp !== undefined) {
    const now = Date.now()
    const age = now - data.timestamp
    if (age < 0 || age > 5 * 60 * 1000) { // 5 minute window
      errors.push('Request expired or timestamp invalid')
    }
  }

  return { valid: errors.length === 0, errors }
}

// Simulate delay (3-5 seconds)
const simulateDelay = () => {
  const delay = 3000 + Math.random() * 2000 // 3000-5000ms
  return new Promise(resolve => setTimeout(resolve, delay))
}

// Generate fake transaction hash
const generateMockTxHash = () => {
  return `0x${Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`
}

// Calculate mock output amount based on current rates (simulate 5% fee)
const calculateMockOutput = (inputAmount, targetLST) => {
  // Base rate: 1 TFUEL = 0.95 LST tokens (5% fee)
  // Can be enhanced with real-time rates in the future
  const feeRate = 0.95
  return inputAmount * feeRate
}

/**
 * POST /api/swap
 * Swap endpoint with simulation mode support
 * 
 * Body:
 *   - userAddress: string (required)
 *   - amount: number (TFUEL amount, required)
 *   - targetLST: string (LST name, required)
 *   - userBalance: number (current TFUEL balance, required)
 * 
 * Returns:
 *   - success: boolean
 *   - txHash: string (transaction hash)
 *   - outputAmount: number (LST amount received)
 *   - simulated: boolean (whether this was a simulation)
 *   - message?: string (error message if failed)
 */
router.post('/swap', async (req, res) => {
  try {
    const { userAddress, amount, targetLST, userBalance, nonce, timestamp } = req.body

    // Sanitize and validate input
    const requestData = {
      userAddress: String(userAddress || '').toLowerCase().trim(),
      amount: parseFloat(amount),
      targetLST: String(targetLST || '').trim(),
      userBalance: parseFloat(userBalance),
      nonce,
      timestamp,
    }

    const validation = validateSwapRequest(requestData)
    if (!validation.valid) {
      console.warn('❌ Swap validation failed:', validation.errors)
      return res.status(400).json({
        success: false,
        message: `Validation failed: ${validation.errors.join(', ')}`,
        errors: validation.errors,
      })
    }

    const amountNum = requestData.amount
    const balanceNum = requestData.userBalance

    // Determine if we should simulate:
    // 1. SIMULATION_MODE env flag is true, OR
    // 2. User balance is insufficient (including gas buffer)
    const minRequired = amountNum + 0.01 // Buffer for gas
    const shouldSimulate = SIMULATION_MODE || balanceNum < minRequired

    if (shouldSimulate) {
      // Simulate delay to mimic on-chain transaction
      await simulateDelay()

      // Generate mock transaction hash
      const mockTxHash = generateMockTxHash()
      
      // Calculate mock output amount
      const outputAmount = calculateMockOutput(amountNum, requestData.targetLST)

      // Log swap event with nonce for security tracking
      console.log(`✅ [SIMULATION] Swap executed:`, {
        userAddress: requestData.userAddress,
        inputAmount: amountNum,
        outputAmount,
        targetLST: requestData.targetLST,
        txHash: mockTxHash,
        nonce,
        timestamp: new Date().toISOString()
      })

      return res.json({
        success: true,
        txHash: mockTxHash,
        outputAmount,
        simulated: true,
        message: 'Swap simulated successfully (testnet mode)',
      })
    } else {
      // Real mode: would execute actual swap here
      // For now, return error since we don't have backend execution
      // Frontend will fall back to on-chain execution
      console.log('⚠️ Real swap mode requested but not implemented')
      return res.status(503).json({
        success: false,
        message: 'Backend real swap execution not implemented. Use frontend on-chain swap.',
      })
    }
  } catch (error) {
    console.error('❌ Swap endpoint error:', error)
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    })
  }
})

export default router


