const { ethers } = require('hardhat')

/**
 * Verify upgrade and set limits
 */

async function main() {
  console.log('Verifying RevenueSplitter upgrade...')
  console.log('')

  const REVENUE_SPLITTER = '0x03973A67449557b14228541Df339Ae041567628B'
  const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER)

  console.log('Testing new functions...')
  
  // Check if new functions exist
  try {
    const maxSwap = await proxy.maxSwapAmount()
    console.log('✅ maxSwapAmount:', ethers.formatEther(maxSwap), 'TFUEL')
  } catch (e) {
    console.log('❌ maxSwapAmount not found - upgrade may have failed')
    console.log('   Error:', e.message)
  }

  try {
    const totalLimit = await proxy.totalUserLimit()
    console.log('✅ totalUserLimit:', ethers.formatEther(totalLimit), 'TFUEL')
  } catch (e) {
    console.log('❌ totalUserLimit not found')
  }

  try {
    const paused = await proxy.paused()
    console.log('✅ paused:', paused)
  } catch (e) {
    console.log('❌ paused not found')
  }

  console.log('')
  console.log('If limits show 0, run set-limits.cjs to configure them')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    process.exit(1)
  })

