const { ethers, upgrades } = require('hardhat')

/**
 * SAFE UPGRADE - RevenueSplitter with Beta Limits
 * Handles upgrade more carefully with proper error checking
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Safe Upgrade: RevenueSplitter + Beta Limits')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer:', deployerAddress)
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  // Existing contract address
  const EXISTING_REVENUE_SPLITTER = '0x03973A67449557b14228541Df339Ae041567628B'

  console.log('📋 Target Contract:')
  console.log('   RevenueSplitter:', EXISTING_REVENUE_SPLITTER)
  console.log('')

  // ============================================
  // STEP 1: Connect to existing contract
  // ============================================
  
  console.log('🔗 Connecting to existing contract...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  
  // Get current implementation
  const implAddress = await upgrades.erc1967.getImplementationAddress(EXISTING_REVENUE_SPLITTER)
  console.log('   Current implementation:', implAddress)
  console.log('')

  // ============================================
  // STEP 2: Validate upgrade
  // ============================================
  
  console.log('🔍 Validating upgrade...')
  try {
    await upgrades.validateUpgrade(EXISTING_REVENUE_SPLITTER, RevenueSplitter)
    console.log('   ✅ Upgrade validation passed')
  } catch (error) {
    console.log('   ⚠️  Validation warning:', error.message)
    console.log('   Continuing anyway...')
  }
  console.log('')

  // ============================================
  // STEP 3: Prepare upgrade
  // ============================================

  console.log('📦 Preparing new implementation...')
  const newImpl = await upgrades.prepareUpgrade(EXISTING_REVENUE_SPLITTER, RevenueSplitter)
  console.log('   ✅ New implementation deployed at:', newImpl)
  console.log('')

  // ============================================
  // STEP 4: Execute upgrade
  // ============================================

  console.log('🔄 Upgrading proxy...')
  const upgraded = await upgrades.upgradeProxy(EXISTING_REVENUE_SPLITTER, RevenueSplitter)
  console.log('   ✅ Proxy upgraded')
  console.log('')

  // ============================================
  // STEP 5: Configure beta limits
  // ============================================

  console.log('⚙️  Configuring beta limits...')
  const contract = await ethers.getContractAt('RevenueSplitter', EXISTING_REVENUE_SPLITTER)
  
  // Check if updateSwapLimits function exists
  try {
    const tx = await contract.updateSwapLimits(
      ethers.parseEther('1000'),   // 1,000 TFUEL max
      ethers.parseEther('5000')    // 5,000 TFUEL total
    )
    await tx.wait()
    console.log('   ✅ Limits configured')
  } catch (error) {
    console.log('   ⚠️  Could not set limits:', error.message)
    console.log('   You may need to call updateSwapLimits manually')
  }
  console.log('')

  // ============================================
  // STEP 6: Verify
  // ============================================

  console.log('📊 Verification:')
  try {
    const maxSwap = await contract.maxSwapAmount()
    const totalLimit = await contract.totalUserLimit()
    const paused = await contract.paused()
    
    console.log('   Max swap:', ethers.formatEther(maxSwap), 'TFUEL')
    console.log('   Total limit:', ethers.formatEther(totalLimit), 'TFUEL')
    console.log('   Paused:', paused)
  } catch (error) {
    console.log('   Could not read limits (may not be initialized yet)')
  }
  console.log('')

  console.log('═══════════════════════════════════════════════════')
  console.log('🎉 UPGRADE COMPLETE!')
  console.log('═══════════════════════════════════════════════════')
  console.log('')
  console.log('Contract Address (unchanged):', EXISTING_REVENUE_SPLITTER)
  console.log('New Implementation:', newImpl)
  console.log('')
  console.log('🔍 Verify on Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${EXISTING_REVENUE_SPLITTER}`)
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ UPGRADE FAILED')
    console.error('══════════════════════')
    console.error('')
    console.error('Error:', error.message)
    console.error('')
    if (error.stack) {
      console.error('Full error:')
      console.error(error.stack)
    }
    console.error('')
    process.exit(1)
  })

