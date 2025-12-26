const { ethers } = require('hardhat')

/**
 * Check existing RevenueSplitter contract
 */

async function main() {
  console.log('🔍 Checking existing RevenueSplitter contract...')
  console.log('')

  const REVENUE_SPLITTER = '0x03973A67449557b14228541Df339Ae041567628B'

  // Connect to existing contract
  const contract = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER)

  console.log('📋 Contract:', REVENUE_SPLITTER)
  console.log('')

  // Try to read existing values
  try {
    const revenueToken = await contract.revenueToken()
    console.log('✅ revenueToken:', revenueToken)
  } catch (e) {
    console.log('❌ Could not read revenueToken')
  }

  try {
    const veXF = await contract.veXFContract()
    console.log('✅ veXFContract:', veXF)
  } catch (e) {
    console.log('❌ Could not read veXF')
  }

  try {
    const treasury = await contract.treasury()
    console.log('✅ treasury:', treasury)
  } catch (e) {
    console.log('❌ Could not read treasury')
  }

  try {
    const owner = await contract.owner()
    console.log('✅ owner:', owner)
  } catch (e) {
    console.log('❌ Could not read owner')
  }

  console.log('')
  console.log('🧪 Checking for beta limit functions...')
  
  try {
    const maxSwap = await contract.maxSwapAmount()
    console.log('✅ maxSwapAmount already exists:', ethers.formatEther(maxSwap), 'TFUEL')
  } catch (e) {
    console.log('❌ maxSwapAmount does not exist (need to upgrade)')
  }

  try {
    const totalLimit = await contract.totalUserLimit()
    console.log('✅ totalUserLimit already exists:', ethers.formatEther(totalLimit), 'TFUEL')
  } catch (e) {
    console.log('❌ totalUserLimit does not exist (need to upgrade)')
  }

  try {
    const paused = await contract.paused()
    console.log('✅ paused already exists:', paused)
  } catch (e) {
    console.log('❌ paused does not exist (need to upgrade)')
  }

  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

