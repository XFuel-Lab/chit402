/**
 * IBC Routing Service - Main Entry Point
 * 
 * Starts the listener and API server
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { initializeListener, startListener, stopListener } from './listener.js'
import { initializeIbcClient } from './ibc-transfer.js'
import { initializeDexClient } from './dexter-dex.js'
import { initializeStakeClient } from './pstake-staking.js'
import { validateIbcConfig, IBC_CONFIG } from './config.js'
import ibcApiRouter from './api.js'

// Load environment variables
dotenv.config({ path: '.env.local' })
dotenv.config()

const app = express()
const PORT = process.env.IBC_PORT || 3002

// Middleware
app.use(cors())
app.use(express.json())

// Mount IBC API routes
app.use('/api/ibc', ibcApiRouter)

// Root health check
app.get('/', (req, res) => {
  res.json({
    service: 'XFUEL IBC Routing Service',
    version: '1.0.0',
    status: 'running',
    timestamp: Date.now(),
  })
})

/**
 * Initialize all services
 */
async function initializeServices(): Promise<void> {
  console.log('\n🚀 XFUEL IBC Routing Service')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Validate configuration
  console.log('🔍 Validating configuration...')
  const validation = validateIbcConfig()
  if (!validation.valid) {
    console.error('❌ Configuration validation failed:')
    validation.errors.forEach((error) => console.error(`   - ${error}`))
    process.exit(1)
  }
  console.log('✅ Configuration valid\n')

  // Check required environment variables
  const mnemonic = process.env.IBC_WALLET_MNEMONIC
  if (!mnemonic) {
    console.error('❌ IBC_WALLET_MNEMONIC not set in environment')
    console.error('   Please set IBC_WALLET_MNEMONIC in .env.local')
    process.exit(1)
  }

  try {
    // Initialize Theta listener
    console.log('🔍 Initializing Theta blockchain listener...')
    await initializeListener()
    console.log('✅ Listener initialized\n')

    // Initialize IBC client
    console.log('📡 Initializing IBC client...')
    await initializeIbcClient(mnemonic)
    console.log('✅ IBC client initialized\n')

    // Initialize DEX client
    console.log('💱 Initializing Dexter DEX client...')
    await initializeDexClient(mnemonic)
    console.log('✅ DEX client initialized\n')

    // Initialize Staking client
    console.log('🔒 Initializing pStake staking client...')
    await initializeStakeClient(mnemonic)
    console.log('✅ Staking client initialized\n')

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ All services initialized successfully')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  } catch (error) {
    console.error('❌ Service initialization failed:', error)
    process.exit(1)
  }
}

/**
 * Start the service
 */
async function start(): Promise<void> {
  try {
    // Initialize all services
    await initializeServices()

    // Start API server
    app.listen(PORT, () => {
      console.log(`🌐 API server listening on http://localhost:${PORT}`)
      console.log(`   Health: http://localhost:${PORT}/`)
      console.log(`   IBC API: http://localhost:${PORT}/api/ibc/*`)
      console.log('')
    })

    // Start blockchain listener (this runs indefinitely)
    console.log('🎧 Starting blockchain listener...\n')
    await startListener()
  } catch (error) {
    console.error('❌ Service startup failed:', error)
    process.exit(1)
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  console.log('\n🛑 Shutting down gracefully...')
  await stopListener()
  process.exit(0)
}

// Handle shutdown signals
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Start the service
start().catch((error) => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

