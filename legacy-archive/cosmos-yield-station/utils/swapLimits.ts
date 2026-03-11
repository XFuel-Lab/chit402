/**
 * Mainnet Beta Testing - Swap Limit Enforcement
 * 
 * Enforces safety limits for mainnet testing:
 * - 1,000 TFUEL maximum per swap
 * - 5,000 TFUEL total per user
 */

export const SWAP_LIMITS = {
  MAX_SWAP_AMOUNT: 1000, // TFUEL
  TOTAL_USER_LIMIT: 5000, // TFUEL
}

// Local storage key for tracking user swaps
const STORAGE_KEY = 'xfuel_user_swap_total'

/**
 * Get the total amount the current user has swapped
 * @param userAddress The user's wallet address
 * @returns Total swapped amount in TFUEL
 */
export function getUserSwapTotal(userAddress: string): number {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return 0
    
    const swapData = JSON.parse(data) as Record<string, number>
    return swapData[userAddress.toLowerCase()] || 0
  } catch (error) {
    console.error('Error reading swap total:', error)
    return 0
  }
}

/**
 * Update the user's total swapped amount
 * @param userAddress The user's wallet address
 * @param amount Amount to add to the total
 */
export function updateUserSwapTotal(userAddress: string, amount: number): void {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    const swapData = data ? (JSON.parse(data) as Record<string, number>) : {}
    
    const key = userAddress.toLowerCase()
    swapData[key] = (swapData[key] || 0) + amount
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(swapData))
  } catch (error) {
    console.error('Error updating swap total:', error)
  }
}

/**
 * Check if a swap amount is within limits
 * @param userAddress The user's wallet address
 * @param swapAmount The amount to swap in TFUEL
 * @returns Object with validation result and error message if invalid
 */
export function validateSwapLimits(
  userAddress: string,
  swapAmount: number
): { valid: boolean; error?: string; remaining?: number } {
  // Check per-swap limit
  if (swapAmount > SWAP_LIMITS.MAX_SWAP_AMOUNT) {
    return {
      valid: false,
      error: `Swap amount exceeds maximum of ${SWAP_LIMITS.MAX_SWAP_AMOUNT} TFUEL per transaction`,
    }
  }

  // Check total user limit
  const currentTotal = getUserSwapTotal(userAddress)
  const newTotal = currentTotal + swapAmount

  if (newTotal > SWAP_LIMITS.TOTAL_USER_LIMIT) {
    const remaining = SWAP_LIMITS.TOTAL_USER_LIMIT - currentTotal
    return {
      valid: false,
      error: `Total limit exceeded. You have ${remaining.toFixed(2)} TFUEL remaining (${SWAP_LIMITS.TOTAL_USER_LIMIT} TFUEL total limit)`,
      remaining,
    }
  }

  return {
    valid: true,
    remaining: SWAP_LIMITS.TOTAL_USER_LIMIT - newTotal,
  }
}

/**
 * Get user's remaining swap allowance
 * @param userAddress The user's wallet address
 * @returns Remaining TFUEL that can be swapped
 */
export function getRemainingSwapAllowance(userAddress: string): number {
  const currentTotal = getUserSwapTotal(userAddress)
  return Math.max(0, SWAP_LIMITS.TOTAL_USER_LIMIT - currentTotal)
}

/**
 * Reset user's swap total (admin function - for testing/exceptions)
 * @param userAddress The user's wallet address
 */
export function resetUserSwapTotal(userAddress: string): void {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return
    
    const swapData = JSON.parse(data) as Record<string, number>
    delete swapData[userAddress.toLowerCase()]
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(swapData))
  } catch (error) {
    console.error('Error resetting swap total:', error)
  }
}

