import express from 'express'

const app = express()
const PORT = process.env.PORT || 3001

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    project: 'XFUEL',
    chain: 'Theta',
    version: '1.0.0',
    timestamp: Date.now(),
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`XFUEL Health Check server running on http://localhost:${PORT}`)
  console.log(`Health endpoint: http://localhost:${PORT}/health`)
})

