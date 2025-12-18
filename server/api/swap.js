import express from 'express'

const router = express.Router()

// Environment variable: SIMULATION_MODE (default: false)
const SIMULATION_MODE = process.env.SIMULATION_MODE === 'true'

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
    const { userAddress, amount, targetLST, userBalance } = req.body

    // Validation
    if (!userAddress || !amount || !targetLST || userBalance === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userAddress, amount, targetLST, userBalance'
      })
    }

    const amountNum = parseFloat(amount)
    const balanceNum = parseFloat(userBalance)

    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      })
    }

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
      const outputAmount = calculateMockOutput(amountNum, targetLST)

      // Emit mock settlement event (for dashboard updates)
      // In a real implementation, this would emit to an event bus or websocket
      console.log(`[SIMULATION] Mock swap event:`, {
        userAddress,
        inputAmount: amountNum,
        outputAmount,
        targetLST,
        txHash: mockTxHash,
        timestamp: new Date().toISOString()
      })

      return res.json({
        success: true,
        txHash: mockTxHash,
        outputAmount,
        simulated: true,
        message: 'Swap simulated successfully'
      })
    } else {
      // Real mode: would execute actual swap here
      // For now, return error since we don't have backend execution
      // Frontend will fall back to on-chain execution
      return res.status(503).json({
        success: false,
        message: 'Backend real swap execution not implemented. Use frontend on-chain swap.'
      })
    }
  } catch (error) {
    console.error('Swap endpoint error:', error)
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    })
  }
})

export default router

