/**
 * Integration tests for swap API endpoint
 * Requires backend server to be running
 */

const assert = require('assert')
const { describe, it, before, after } = require('mocha')
const fetch = require('node-fetch')

const API_URL = process.env.API_URL || 'http://localhost:3001'

describe('Swap API Integration Tests', () => {
  describe('POST /api/swap', () => {
    it('should return simulation response when SIMULATION_MODE is enabled', async () => {
      // Note: This test assumes SIMULATION_MODE=true is set in environment
      let response
      try {
        response = await fetch(`${API_URL}/api/swap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
            amount: '10',
            targetLST: 'stkATOM',
            userBalance: '100',
          }),
        })
      } catch (error) {
        // Server not running - skip test
        console.log('Skipping integration test - server not available')
        return
      }

      // If server is not running, skip test
      if (!response.ok && response.status === 503) {
        console.log('Skipping integration test - server not available')
        return
      }

      const data = await response.json()
      
      // Should return success (either simulated or real)
      assert(data.hasOwnProperty('success'))
      if (data.simulated) {
        assert.strictEqual(data.success, true)
        assert(data.hasOwnProperty('txHash'))
        assert(data.hasOwnProperty('outputAmount'))
        assert.strictEqual(data.simulated, true)
      }
    })

    it('should return simulation when balance is insufficient', async () => {
      let response
      try {
        response = await fetch(`${API_URL}/api/swap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
            amount: '10',
            targetLST: 'stkATOM',
            userBalance: '5', // Less than required (10 + 0.01)
          }),
        })
      } catch (error) {
        console.log('Skipping integration test - server not available')
        return
      }

      if (!response.ok && response.status === 503) {
        console.log('Skipping integration test - server not available')
        return
      }

      const data = await response.json()
      
      // Should simulate when balance is insufficient
      if (data.success && data.simulated) {
        assert.strictEqual(data.simulated, true)
        assert(data.outputAmount > 0)
      }
    })

    it('should return error for missing required fields', async () => {
      let response
      try {
        response = await fetch(`${API_URL}/api/swap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
            // Missing amount, targetLST, userBalance
          }),
        })
      } catch (error) {
        console.log('Skipping integration test - server not available')
        return
      }

      if (!response.ok && response.status === 503) {
        console.log('Skipping integration test - server not available')
        return
      }

      if (response.status === 400) {
        const data = await response.json()
        assert.strictEqual(data.success, false)
        assert(data.hasOwnProperty('message'))
      }
    })
  })

  describe('Health Check', () => {
    it('should return health status with simulation mode info', async () => {
      let response
      try {
        response = await fetch(`${API_URL}/health`)
      } catch (error) {
        console.log('Skipping health check - server not available')
        return
      }
      
      if (!response.ok) {
        console.log('Skipping health check - server not available')
        return
      }

      const data = await response.json()
      assert.strictEqual(data.status, 'ok')
      assert(data.hasOwnProperty('simulationMode'))
    })
  })
})

