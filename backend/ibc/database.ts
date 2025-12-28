/**
 * Transaction Database
 * 
 * Simple JSON file-based database for transaction tracking
 * Can be upgraded to PostgreSQL/MongoDB for production
 */

import fs from 'fs/promises'
import path from 'path'
import { DepositTransaction, TransactionDatabase } from './types.js'

const DB_FILE = process.env.DB_FILE || 'backend/ibc/transactions.json'

// In-memory cache
let dbCache: TransactionDatabase | null = null

/**
 * Load database from file
 */
export async function loadDatabase(): Promise<TransactionDatabase> {
  if (dbCache) {
    return dbCache
  }

  try {
    const data = await fs.readFile(DB_FILE, 'utf-8')
    dbCache = JSON.parse(data)
    return dbCache!
  } catch (error) {
    // Database doesn't exist yet, create new one
    console.log('📝 [DB] Creating new database...')
    dbCache = {
      transactions: {},
      lastProcessedBlock: 0,
      lastUpdated: Date.now(),
    }
    await saveDatabase(dbCache)
    return dbCache
  }
}

/**
 * Save database to file
 */
async function saveDatabase(db: TransactionDatabase): Promise<void> {
  try {
    // Ensure directory exists
    const dir = path.dirname(DB_FILE)
    await fs.mkdir(dir, { recursive: true })

    // Write to file
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf-8')
    dbCache = db
  } catch (error) {
    console.error('❌ [DB] Error saving database:', error)
    throw error
  }
}

/**
 * Save or update a transaction
 */
export async function saveTransaction(
  transaction: DepositTransaction | TransactionDatabase
): Promise<void> {
  const db = await loadDatabase()

  // Check if it's a full database update or just a transaction
  if ('transactions' in transaction && 'lastProcessedBlock' in transaction) {
    // Full database update
    await saveDatabase(transaction as TransactionDatabase)
  } else {
    // Single transaction update
    const tx = transaction as DepositTransaction
    db.transactions[tx.thetaTxHash] = tx
    db.lastUpdated = Date.now()
    await saveDatabase(db)
  }
}

/**
 * Update an existing transaction
 */
export async function updateTransaction(
  transaction: DepositTransaction
): Promise<void> {
  await saveTransaction(transaction)
}

/**
 * Get transaction by Theta transaction hash
 */
export async function getTransaction(
  thetaTxHash: string
): Promise<DepositTransaction | null> {
  const db = await loadDatabase()
  return db.transactions[thetaTxHash] || null
}

/**
 * Get all transactions
 */
export async function getAllTransactions(): Promise<DepositTransaction[]> {
  const db = await loadDatabase()
  return Object.values(db.transactions)
}

/**
 * Get transactions by status
 */
export async function getTransactionsByStatus(
  status: string
): Promise<DepositTransaction[]> {
  const db = await loadDatabase()
  return Object.values(db.transactions).filter((tx) => tx.status === status)
}

/**
 * Get transactions by user address
 */
export async function getTransactionsByUser(
  userAddress: string
): Promise<DepositTransaction[]> {
  const db = await loadDatabase()
  const normalized = userAddress.toLowerCase()
  return Object.values(db.transactions).filter(
    (tx) => tx.userAddress.toLowerCase() === normalized
  )
}

/**
 * Get recent transactions (last N)
 */
export async function getRecentTransactions(limit = 100): Promise<DepositTransaction[]> {
  const db = await loadDatabase()
  const transactions = Object.values(db.transactions)
  
  // Sort by creation time (newest first)
  transactions.sort((a, b) => b.createdAt - a.createdAt)
  
  return transactions.slice(0, limit)
}

/**
 * Delete a transaction
 */
export async function deleteTransaction(thetaTxHash: string): Promise<void> {
  const db = await loadDatabase()
  delete db.transactions[thetaTxHash]
  db.lastUpdated = Date.now()
  await saveDatabase(db)
}

/**
 * Get database statistics
 */
export async function getStats(): Promise<{
  totalTransactions: number
  byStatus: Record<string, number>
  totalVolume: string
  lastUpdated: number
}> {
  const db = await loadDatabase()
  const transactions = Object.values(db.transactions)

  const byStatus: Record<string, number> = {}
  let totalVolume = BigInt(0)

  for (const tx of transactions) {
    byStatus[tx.status] = (byStatus[tx.status] || 0) + 1
    totalVolume += BigInt(tx.tfuelAmount)
  }

  return {
    totalTransactions: transactions.length,
    byStatus,
    totalVolume: totalVolume.toString(),
    lastUpdated: db.lastUpdated,
  }
}

/**
 * Clear all transactions (for testing only)
 */
export async function clearDatabase(): Promise<void> {
  console.warn('⚠️  [DB] Clearing all transactions!')
  dbCache = {
    transactions: {},
    lastProcessedBlock: 0,
    lastUpdated: Date.now(),
  }
  await saveDatabase(dbCache)
}

