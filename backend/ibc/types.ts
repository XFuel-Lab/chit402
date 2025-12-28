/**
 * Type definitions for IBC routing system
 */

export type TransactionStatus = 
  | 'pending'       // Initial state, waiting for confirmations
  | 'confirmed'     // Theta tx confirmed, ready for IBC transfer
  | 'ibc_transfer'  // IBC transfer in progress
  | 'ibc_complete'  // IBC transfer complete, tokens on Persistence
  | 'swapping'      // Swapping ibc/TFUEL → XPRT on Dexter
  | 'swap_complete' // Swap complete, have XPRT
  | 'staking'       // Staking XPRT → stkXPRT
  | 'complete'      // stkXPRT sent to user
  | 'failed'        // Transaction failed at some step
  | 'manual'        // Manual intervention required

export interface DepositTransaction {
  // Transaction identifiers
  id: string                      // Internal UUID
  thetaTxHash: string             // Theta transaction hash
  ibcTxHash?: string              // IBC transfer tx hash
  swapTxHash?: string             // Dexter swap tx hash
  stakeTxHash?: string            // pStake staking tx hash
  
  // User information
  userAddress: string             // User's Theta address (from tx)
  recipientAddress: string        // User's Persistence address (from memo or profile)
  
  // Transaction details
  tfuelAmount: string             // Amount of TFUEL deposited (in wei)
  xprtAmount?: string             // Amount of XPRT received (in uxprt)
  stkXprtAmount?: string          // Amount of stkXPRT minted (in uxprt)
  
  // Status tracking
  status: TransactionStatus
  statusMessage: string
  errorMessage?: string
  
  // Timestamps
  createdAt: number               // When deposit was detected
  confirmedAt?: number            // When Theta tx was confirmed
  ibcCompletedAt?: number         // When IBC transfer completed
  swapCompletedAt?: number        // When swap completed
  stakeCompletedAt?: number       // When staking completed
  completedAt?: number            // When entire flow completed
  
  // Retry tracking
  retryCount: number
  lastRetryAt?: number
  
  // Metadata
  blockNumber: number             // Theta block number
  confirmations: number           // Number of confirmations
  memo?: string                   // User-provided memo (may contain recipient address)
}

export interface IbcTransferResult {
  success: boolean
  txHash?: string
  sequence?: number
  error?: string
}

export interface SwapResult {
  success: boolean
  txHash?: string
  amountOut?: string
  error?: string
}

export interface StakeResult {
  success: boolean
  txHash?: string
  stkXprtAmount?: string
  error?: string
}

export interface RouteExecutionResult {
  success: boolean
  transaction: DepositTransaction
  error?: string
}

/**
 * Database schema for transaction tracking
 * Using a simple JSON file for now, can be upgraded to PostgreSQL/MongoDB
 */
export interface TransactionDatabase {
  transactions: Record<string, DepositTransaction>
  lastProcessedBlock: number
  lastUpdated: number
}

/**
 * Listener event for new deposits
 */
export interface DepositEvent {
  txHash: string
  from: string
  to: string
  value: string
  blockNumber: number
  timestamp: number
}

/**
 * Manual trigger request
 */
export interface ManualTriggerRequest {
  thetaTxHash: string
  recipientAddress: string  // Persistence address to send stkXPRT to
  force?: boolean           // Force reprocessing even if already processed
}

/**
 * Status query response
 */
export interface StatusResponse {
  transaction?: DepositTransaction
  found: boolean
  message: string
}

