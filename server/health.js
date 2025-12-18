import express from 'express'
import swapRouter from './api/swap.js'

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(express.json())

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    project: 'XFUEL',
    chain: 'Theta',
    version: '1.0.0',
    timestamp: Date.now(),
    simulationMode: process.env.SIMULATION_MODE === 'true',
  })
})

// API routes
app.use('/api', swapRouter)

// Start server
app.listen(PORT, () => {
  console.log(`XFUEL API server running on http://localhost:${PORT}`)
  console.log(`Health endpoint: http://localhost:${PORT}/health`)
  console.log(`Swap endpoint: http://localhost:${PORT}/api/swap`)
  console.log(`Simulation mode: ${process.env.SIMULATION_MODE === 'true' ? 'ENABLED' : 'DISABLED'}`)
})

