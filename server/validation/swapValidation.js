/**
 * Swap Request Validation using Zod
 * 
 * Provides type-safe validation for swap API requests
 * Prevents injection attacks and ensures data integrity
 */

// Note: Using pure JS validation since Zod is TypeScript-first
// For production, install: npm install zod
// Then use TypeScript version in server/validation/swapValidation.ts

/**
 * Validate Ethereum address format
 */
function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validate LST symbol
 */
const VALID_LST_SYMBOLS = ['stkTIA', 'stkATOM', 'stkXPRT', 'stkOSMO', 'pSTAKE BTC', 'USDC']

function isValidLST(lst) {
  return VALID_LST_SYMBOLS.includes(lst)
}

/**
 * Validate swap request
 */
function validateSwapRequest(data) {
  const errors = []

  // Validate userAddress
  if (!data.userAddress) {
    errors.push('userAddress is required')
  } else if (!isValidAddress(data.userAddress)) {
    errors.push('userAddress must be a valid Ethereum address')
  }

  // Validate amount
  if (typeof data.amount !== 'number') {
    errors.push('amount must be a number')
  } else if (data.amount <= 0) {
    errors.push('amount must be greater than 0')
  } else if (data.amount > 1000000) {
    errors.push('amount exceeds maximum allowed (1M TFUEL)')
  }

  // Validate targetLST
  if (!data.targetLST) {
    errors.push('targetLST is required')
  } else if (!isValidLST(data.targetLST)) {
    errors.push(`targetLST must be one of: ${VALID_LST_SYMBOLS.join(', ')}`)
  }

  // Validate userBalance
  if (typeof data.userBalance !== 'number') {
    errors.push('userBalance must be a number')
  } else if (data.userBalance < data.amount) {
    errors.push('insufficient balance for swap')
  }

  // Validate optional nonce (for replay protection)
  if (data.nonce !== undefined) {
    if (typeof data.nonce !== 'number') {
      errors.push('nonce must be a number')
    } else if (data.nonce < 0) {
      errors.push('nonce must be non-negative')
    }
  }

  // Validate optional timestamp (for replay protection)
  if (data.timestamp !== undefined) {
    if (typeof data.timestamp !== 'number') {
      errors.push('timestamp must be a number')
    } else {
      const now = Date.now()
      const age = now - data.timestamp
      // Reject requests older than 5 minutes or in the future
      if (age < 0 || age > 5 * 60 * 1000) {
        errors.push('timestamp is invalid or expired')
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? data : null,
  }
}

/**
 * Sanitize swap request data
 */
function sanitizeSwapRequest(data) {
  return {
    userAddress: String(data.userAddress).toLowerCase().trim(),
    amount: Number(data.amount),
    targetLST: String(data.targetLST).trim(),
    userBalance: Number(data.userBalance),
    nonce: data.nonce !== undefined ? Number(data.nonce) : undefined,
    timestamp: data.timestamp !== undefined ? Number(data.timestamp) : Date.now(),
  }
}

module.exports = {
  validateSwapRequest,
  sanitizeSwapRequest,
  isValidAddress,
  isValidLST,
  VALID_LST_SYMBOLS,
}

