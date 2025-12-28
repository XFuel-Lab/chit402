/**
 * IBC Channel-190 Configuration for TFUEL → Persistence Cross-Chain Routing
 * 
 * This module configures the IBC infrastructure for routing TFUEL from Theta
 * to Persistence chain, then swapping to XPRT and staking to stkXPRT.
 */

export const IBC_CONFIG = {
  // Theta Network Configuration
  theta: {
    chainId: 361,
    rpcUrl: process.env.THETA_RPC_URL || 'https://eth-rpc-api.thetatoken.org/rpc',
    depositAddress: process.env.THETA_DEPOSIT_ADDRESS || '',
    explorerUrl: 'https://explorer.thetatoken.org',
  },

  // Persistence Chain Configuration
  persistence: {
    chainId: 'core-1',
    rpcUrl: process.env.PERSISTENCE_RPC_URL || 'https://rpc.core.persistence.one',
    restUrl: process.env.PERSISTENCE_REST_URL || 'https://rest.core.persistence.one',
    explorerUrl: 'https://www.mintscan.io/persistence',
    
    // IBC Channel from Theta → Persistence
    ibcChannel: 'channel-190',
    
    // Dexter DEX contract address on Persistence
    dexterRouterAddress: process.env.DEXTER_ROUTER_ADDRESS || 'persistence1...', // TODO: Add real address
    
    // pStake Finance stkXPRT staking contract
    pstakeStakingAddress: process.env.PSTAKE_STAKING_ADDRESS || 'persistence1...', // TODO: Add real address
  },

  // IBC Transfer Configuration
  ibc: {
    // Timeout for IBC transfers (10 minutes)
    timeoutHeight: BigInt(0), // Use timestamp-based timeout instead
    timeoutTimestamp: BigInt(600_000_000_000), // 10 minutes in nanoseconds
    
    // TFUEL IBC denomination on Persistence chain
    // Format: ibc/[hash of transfer/channel-190/tfuel]
    tfuelIbcDenom: process.env.TFUEL_IBC_DENOM || 'ibc/...',
    
    // Gas settings for IBC transfers
    gasPrice: '0.025uxprt',
    gasLimit: 300_000,
  },

  // Dexter DEX Configuration
  dexter: {
    // TFUEL/XPRT pool address
    tfuelXprtPoolAddress: process.env.DEXTER_TFUEL_XPRT_POOL || '',
    
    // Slippage tolerance (1% = 0.01)
    slippageTolerance: 0.01,
    
    // Minimum output (calculated from slippage)
    minOutputRatio: 0.99,
  },

  // pStake Staking Configuration
  pstake: {
    // Fee for liquid staking (typically 0.1-0.3%)
    stakingFee: 0.003,
    
    // Minimum staking amount (1 XPRT)
    minStakingAmount: 1_000_000, // 1 XPRT in uxprt
  },

  // Backend Service Configuration
  service: {
    // Polling interval for checking new deposits (5 seconds)
    pollingIntervalMs: 5_000,
    
    // Number of confirmations required before processing
    confirmationsRequired: 3,
    
    // Maximum retries for failed operations
    maxRetries: 3,
    
    // Retry delay (exponential backoff base in ms)
    retryDelayMs: 5_000,
    
    // Transaction timeout (30 minutes)
    txTimeoutMs: 30 * 60 * 1000,
  },
}

// IBC Transfer Port (standard)
export const IBC_TRANSFER_PORT = 'transfer'

// Expected IBC packet acknowledgement
export const IBC_ACK_SUCCESS = 'AQ==' // Base64 for {result: '1'}
export const IBC_ACK_ERROR_PREFIX = 'error'

/**
 * Generate IBC denom trace hash
 * Format: ibc/[hash of "transfer/channel-190/tfuel"]
 */
export function getIbcDenomTrace(port: string, channel: string, baseDenom: string): string {
  const path = `${port}/${channel}/${baseDenom}`
  // In production, this should use SHA-256 hash
  // For now, return the configured value
  return IBC_CONFIG.ibc.tfuelIbcDenom
}

/**
 * Environment validation
 */
export function validateIbcConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!IBC_CONFIG.theta.depositAddress) {
    errors.push('THETA_DEPOSIT_ADDRESS not configured')
  }

  if (!IBC_CONFIG.persistence.dexterRouterAddress.startsWith('persistence1')) {
    errors.push('Invalid DEXTER_ROUTER_ADDRESS (must start with persistence1)')
  }

  if (!IBC_CONFIG.persistence.pstakeStakingAddress.startsWith('persistence1')) {
    errors.push('Invalid PSTAKE_STAKING_ADDRESS (must start with persistence1)')
  }

  if (!IBC_CONFIG.ibc.tfuelIbcDenom.startsWith('ibc/')) {
    errors.push('Invalid TFUEL_IBC_DENOM (must start with ibc/)')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

