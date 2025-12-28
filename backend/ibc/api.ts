/**
 * IBC Routing API Endpoints
 * 
 * REST API for querying transaction status and manual triggering
 */

import express from 'express'
import {
  getTransaction,
  getAllTransactions,
  getTransactionsByUser,
  getRecentTransactions,
  getStats,
} from './database.js'
import { executeRoute, retryTransaction } from './router.js'
import { ManualTriggerRequest, StatusResponse } from './types.js'

const router = express.Router()

/**
 * GET /api/ibc/status/:txHash
 * 
 * Get transaction status by Theta transaction hash
 */
router.get('/status/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params
    const transaction = await getTransaction(txHash)

    if (!transaction) {
      const response: StatusResponse = {
        found: false,
        message: 'Transaction not found',
      }
      return res.status(404).json(response)
    }

    const response: StatusResponse = {
      found: true,
      transaction,
      message: 'Transaction found',
    }

    res.json(response)
  } catch (error) {
    console.error('❌ [API] Error fetching transaction status:', error)
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * GET /api/ibc/transactions/user/:address
 * 
 * Get all transactions for a user address
 */
router.get('/transactions/user/:address', async (req, res) => {
  try {
    const { address } = req.params
    const transactions = await getTransactionsByUser(address)

    res.json({
      success: true,
      count: transactions.length,
      transactions,
    })
  } catch (error) {
    console.error('❌ [API] Error fetching user transactions:', error)
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * GET /api/ibc/transactions/recent
 * 
 * Get recent transactions (last 100 by default)
 */
router.get('/transactions/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100
    const transactions = await getRecentTransactions(limit)

    res.json({
      success: true,
      count: transactions.length,
      transactions,
    })
  } catch (error) {
    console.error('❌ [API] Error fetching recent transactions:', error)
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * GET /api/ibc/stats
 * 
 * Get database statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStats()
    res.json({
      success: true,
      stats,
    })
  } catch (error) {
    console.error('❌ [API] Error fetching stats:', error)
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * POST /api/ibc/trigger
 * 
 * Manually trigger IBC routing for a transaction
 * Required for transactions without recipient address in memo
 */
router.post('/trigger', async (req, res) => {
  try {
    const request: ManualTriggerRequest = req.body

    if (!request.thetaTxHash || !request.recipientAddress) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'thetaTxHash and recipientAddress are required',
      })
    }

    // Validate recipient address format
    if (!request.recipientAddress.startsWith('persistence1')) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'Invalid recipient address (must start with persistence1)',
      })
    }

    // Get transaction
    let transaction = await getTransaction(request.thetaTxHash)

    if (!transaction) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Transaction not found',
      })
    }

    // Check if already processed (unless force flag is set)
    if (transaction.status === 'complete' && !request.force) {
      return res.status(400).json({
        error: 'Already processed',
        message: 'Transaction already completed. Use force=true to reprocess.',
        transaction,
      })
    }

    // Update recipient address
    transaction.recipientAddress = request.recipientAddress

    // Execute routing
    console.log(`🔧 [API] Manual trigger for ${request.thetaTxHash}`)
    const result = await executeRoute(transaction)

    if (result.success) {
      res.json({
        success: true,
        message: 'Transaction processed successfully',
        transaction: result.transaction,
      })
    } else {
      res.status(500).json({
        success: false,
        message: 'Transaction processing failed',
        error: result.error,
        transaction: result.transaction,
      })
    }
  } catch (error) {
    console.error('❌ [API] Error processing manual trigger:', error)
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * POST /api/ibc/retry/:txHash
 * 
 * Retry a failed transaction
 */
router.post('/retry/:txHash', async (req, res) => {
  try {
    const { txHash } = req.params
    const transaction = await getTransaction(txHash)

    if (!transaction) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Transaction not found',
      })
    }

    if (transaction.status === 'complete') {
      return res.status(400).json({
        error: 'Already completed',
        message: 'Transaction already completed',
      })
    }

    console.log(`🔄 [API] Retry requested for ${txHash}`)
    const result = await retryTransaction(transaction)

    if (result.success) {
      res.json({
        success: true,
        message: 'Transaction retry successful',
        transaction: result.transaction,
      })
    } else {
      res.status(500).json({
        success: false,
        message: 'Transaction retry failed',
        error: result.error,
        transaction: result.transaction,
      })
    }
  } catch (error) {
    console.error('❌ [API] Error retrying transaction:', error)
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * GET /api/ibc/health
 * 
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const stats = await getStats()
    res.json({
      status: 'ok',
      service: 'IBC Routing',
      version: '1.0.0',
      timestamp: Date.now(),
      stats,
    })
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router

