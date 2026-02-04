/**
 * Theta Blockchain Listener
 * 
 * Monitors the Theta blockchain for incoming TFUEL deposits to the
 * designated receive address, then triggers the IBC routing flow.
 */

import { ethers } from 'ethers'
import { IBC_CONFIG } from './config.js'
import { DepositTransaction, DepositEvent, TransactionStatus } from './types.js'
import { saveTransaction, loadDatabase, updateTransaction } from './database.js'
import { executeRoute } from './router.js'

// Theta RPC provider
let provider: ethers.JsonRpcProvider | null = null

/**
 * Initialize the Theta blockchain listener
 */
export async function initializeListener(): Promise<void> {
  console.log('🔍 [Listener] Initializing Theta blockchain listener...')
  console.log(`📍 [Listener] Monitoring address: ${IBC_CONFIG.theta.depositAddress}`)
  
  if (!IBC_CONFIG.theta.depositAddress) {
    throw new Error('THETA_DEPOSIT_ADDRESS not configured')
  }

  // Create provider
  provider = new ethers.JsonRpcProvider(IBC_CONFIG.theta.rpcUrl)
  
  // Verify connection
  const network = await provider.getNetwork()
  console.log(`✅ [Listener] Connected to Theta network (chainId: ${network.chainId})`)

  // Get current block
  const currentBlock = await provider.getBlockNumber()
  console.log(`📦 [Listener] Current block: ${currentBlock}`)

  // Load last processed block from database
  const db = await loadDatabase()
  const startBlock = db.lastProcessedBlock || currentBlock

  console.log(`🚀 [Listener] Starting from block ${startBlock}`)
  console.log(`⏱️  [Listener] Polling interval: ${IBC_CONFIG.service.pollingIntervalMs}ms`)
}

/**
 * Start polling for new deposits
 */
export async function startListener(): Promise<void> {
  if (!provider) {
    throw new Error('Listener not initialized. Call initializeListener() first.')
  }

  console.log('▶️  [Listener] Starting polling loop...')

  while (true) {
    try {
      await pollForDeposits()
    } catch (error) {
      console.error('❌ [Listener] Error in polling loop:', error)
      // Continue polling even if there's an error
    }

    // Wait before next poll
    await sleep(IBC_CONFIG.service.pollingIntervalMs)
  }
}

/**
 * Poll for new deposits since last processed block
 */
async function pollForDeposits(): Promise<void> {
  if (!provider) return

  const db = await loadDatabase()
  const currentBlock = await provider.getBlockNumber()
  const fromBlock = db.lastProcessedBlock + 1
  const toBlock = currentBlock

  if (fromBlock > toBlock) {
    // No new blocks
    return
  }

  console.log(`🔎 [Listener] Scanning blocks ${fromBlock} → ${toBlock}`)

  // Query logs for transfers to our deposit address
  // Theta uses standard Ethereum transfer events
  const logs = await provider.getLogs({
    address: null, // Any address (TFUEL transfers are native, not ERC20)
    fromBlock,
    toBlock,
    topics: [
      ethers.id('Transfer(address,address,uint256)'), // If using wrapped TFUEL
    ],
  })

  // Also check for native TFUEL transfers by inspecting transactions
  const deposits = await scanBlocksForDeposits(fromBlock, toBlock)

  console.log(`📥 [Listener] Found ${deposits.length} deposit(s)`)

  for (const deposit of deposits) {
    await handleDeposit(deposit)
  }

  // Update last processed block
  db.lastProcessedBlock = toBlock
  db.lastUpdated = Date.now()
  await saveTransaction(db)
}

/**
 * Scan blocks for native TFUEL transfers to deposit address
 */
async function scanBlocksForDeposits(fromBlock: number, toBlock: number): Promise<DepositEvent[]> {
  if (!provider) return []

  const deposits: DepositEvent[] = []
  const depositAddress = IBC_CONFIG.theta.depositAddress.toLowerCase()

  for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
    const block = await provider.getBlock(blockNum, true)
    if (!block || !block.prefetchedTransactions) continue

    for (const tx of block.prefetchedTransactions) {
      // Check if transaction sends TFUEL to our deposit address
      if (
        tx.to &&
        tx.to.toLowerCase() === depositAddress &&
        tx.value > 0n
      ) {
        console.log(`💰 [Listener] Deposit detected: ${tx.hash} (${ethers.formatEther(tx.value)} TFUEL)`)

        deposits.push({
          txHash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value.toString(),
          blockNumber: blockNum,
          timestamp: block.timestamp,
        })
      }
    }
  }

  return deposits
}

/**
 * Handle a new deposit
 */
async function handleDeposit(deposit: DepositEvent): Promise<void> {
  console.log(`🔄 [Listener] Processing deposit: ${deposit.txHash}`)

  // Check if we've already processed this transaction
  const db = await loadDatabase()
  if (db.transactions[deposit.txHash]) {
    console.log(`⏭️  [Listener] Transaction already processed: ${deposit.txHash}`)
    return
  }

  // Extract recipient address from transaction memo/input data
  let recipientAddress = ''
  try {
    const tx = await provider!.getTransaction(deposit.txHash)
    if (tx && tx.data && tx.data !== '0x') {
      // Try to decode recipient address from data field
      recipientAddress = decodeRecipientAddress(tx.data)
    }
  } catch (error) {
    console.warn(`⚠️  [Listener] Could not extract recipient address from tx ${deposit.txHash}`)
  }

  // If no recipient address found, mark for manual processing
  if (!recipientAddress) {
    console.warn(`⚠️  [Listener] No recipient address found, marking for manual processing`)
  }

  // Wait for required confirmations
  if (!provider) return
  const currentBlock = await provider.getBlockNumber()
  const confirmations = currentBlock - deposit.blockNumber + 1

  const status: TransactionStatus = confirmations >= IBC_CONFIG.service.confirmationsRequired
    ? 'confirmed'
    : 'pending'

  // Create transaction record
  const transaction: DepositTransaction = {
    id: generateId(),
    thetaTxHash: deposit.txHash,
    userAddress: deposit.from,
    recipientAddress: recipientAddress || '', // Will need manual input if empty
    tfuelAmount: deposit.value,
    status: recipientAddress ? status : 'manual',
    statusMessage: recipientAddress 
      ? `Waiting for ${IBC_CONFIG.service.confirmationsRequired} confirmations (${confirmations}/${IBC_CONFIG.service.confirmationsRequired})`
      : 'Manual recipient address required',
    createdAt: deposit.timestamp * 1000,
    confirmedAt: status === 'confirmed' ? Date.now() : undefined,
    blockNumber: deposit.blockNumber,
    confirmations,
    retryCount: 0,
  }

  // Save to database
  await saveTransaction(transaction)

  // If confirmed and has recipient, start routing
  if (transaction.status === 'confirmed') {
    console.log(`✅ [Listener] Transaction confirmed, starting IBC routing...`)
    executeRoute(transaction).catch((error) => {
      console.error(`❌ [Listener] Error executing route:`, error)
    })
  } else if (transaction.status === 'manual') {
    console.log(`⏸️  [Listener] Transaction requires manual recipient address`)
  } else {
    console.log(`⏳ [Listener] Transaction pending confirmations`)
  }
}

/**
 * Decode recipient address from transaction data
 * Expected format: 0x + hex-encoded persistence address
 */
function decodeRecipientAddress(data: string): string {
  try {
    // Remove 0x prefix
    const hex = data.startsWith('0x') ? data.slice(2) : data

    // Try to decode as UTF-8 string
    const decoded = Buffer.from(hex, 'hex').toString('utf8')

    // Check if it's a valid Persistence address (persistence1...)
    if (decoded.startsWith('persistence1') && decoded.length === 45) {
      return decoded
    }

    return ''
  } catch {
    return ''
  }
}

/**
 * Generate a unique ID for the transaction
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Stop the listener (for graceful shutdown)
 */
export async function stopListener(): Promise<void> {
  console.log('🛑 [Listener] Stopping...')
  provider = null
}

