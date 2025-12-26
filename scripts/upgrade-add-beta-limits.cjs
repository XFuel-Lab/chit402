const { ethers, upgrades } = require('hardhat')

/**
 * UPGRADE EXISTING REVENUESPLITTER WITH BETA LIMITS
 * 
 * This upgrades your existing RevenueSplitter contract (0x03973A67449557b14228541Df339Ae041567628B)
 * to add beta testing safety limits.
 * 
 * LIMITS ARE REMOVABLE after beta:
 * - Call updateSwapLimits() with very high values (e.g., 100M TFUEL)
 * - Or call setPaused(false) if paused
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Upgrade RevenueSplitter with Beta Limits')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer:', deployerAddress)
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  if (parseFloat(ethers.formatEther(balance)) < 50) {
    throw new Error('Insufficient balance. Need 100+ TFUEL')
  }

  // ============================================
  // EXISTING CONTRACT ADDRESSES (From deployments)
  // ============================================
  const EXISTING_REVENUE_SPLITTER = '0x03973A67449557b14228541Df339Ae041567628B'

  console.log('📋 Existing Contracts:')
  console.log('   RevenueSplitter:', EXISTING_REVENUE_SPLITTER)
  console.log('')

  // ============================================
  // UPGRADE REVENUESPLITTER
  // ============================================

  console.log('📦 Upgrading RevenueSplitter to add beta limits...')
  console.log('   This preserves all existing state and data.')
  console.log('')

  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  
  // Upgrade existing proxy
  const revenueSplitter = await upgrades.upgradeProxy(
    EXISTING_REVENUE_SPLITTER,
    RevenueSplitter
  )
  
  await revenueSplitter.waitForDeployment()
  console.log('✅ Upgrade transaction sent')
  console.log('   Waiting for confirmation...')
  console.log('')

  // Get the upgraded contract instance
  const upgradedContract = await ethers.getContractAt(
    'RevenueSplitter',
    EXISTING_REVENUE_SPLITTER
  )

  // ============================================
  // INITIALIZE BETA LIMITS
  // ============================================

  console.log('⚙️  Setting beta testing limits...')
  console.log('   Max per swap: 1,000 TFUEL')
  console.log('   Total per user: 5,000 TFUEL')
  console.log('')

  // Set beta limits using updateSwapLimits (works for both new and existing)
  const tx1 = await upgradedContract.updateSwapLimits(
    ethers.parseEther('1000'),   // 1,000 TFUEL max per swap
    ethers.parseEther('5000')    // 5,000 TFUEL total per user
  )
  await tx1.wait()
  console.log('✅ Beta limits configured')
  console.log('')

  // Verify limits are set
  const maxSwap = await upgradedContract.maxSwapAmount()
  const totalLimit = await upgradedContract.totalUserLimit()
  const isPaused = await upgradedContract.paused()

  console.log('📊 Current Configuration:')
  console.log('   Max swap amount:', ethers.formatEther(maxSwap), 'TFUEL')
  console.log('   Total user limit:', ethers.formatEther(totalLimit), 'TFUEL')
  console.log('   Paused:', isPaused)
  console.log('')

  // ============================================
  // SUCCESS SUMMARY
  // ============================================

  console.log('═══════════════════════════════════════════════════')
  console.log('🎉 UPGRADE COMPLETE!')
  console.log('═══════════════════════════════════════════════════')
  console.log('')
  console.log('✅ RevenueSplitter upgraded with beta limits')
  console.log('✅ Contract address unchanged:', EXISTING_REVENUE_SPLITTER)
  console.log('✅ All existing state preserved')
  console.log('')
  console.log('⚠️  BETA LIMITS ACTIVE:')
  console.log('   • Max swap: 1,000 TFUEL per transaction')
  console.log('   • Total limit: 5,000 TFUEL per user')
  console.log('   • Emergency pause: Available')
  console.log('')
  console.log('🔓 REMOVING LIMITS AFTER BETA:')
  console.log('   To remove limits after beta testing, run:')
  console.log('')
  console.log('   const contract = await ethers.getContractAt(')
  console.log('     "RevenueSplitter",')
  console.log(`     "${EXISTING_REVENUE_SPLITTER}"`)
  console.log('   )')
  console.log('')
  console.log('   // Set very high limits (effectively unlimited)')
  console.log('   await contract.updateSwapLimits(')
  console.log('     ethers.parseEther("100000000"),  // 100M TFUEL max')
  console.log('     ethers.parseEther("1000000000")  // 1B TFUEL total')
  console.log('   )')
  console.log('')
  console.log('   // Or use actual max values:')
  console.log('   await contract.updateSwapLimits(')
  console.log('     ethers.MaxUint256,  // Max uint256')
  console.log('     ethers.MaxUint256')
  console.log('   )')
  console.log('')
  console.log('📝 NOTE: The 5% rXF for early believers is separate.')
  console.log('   That is part of tokenomics (15% rXF mint slice),')
  console.log('   not a limit - it stays in Phase 2 distribution.')
  console.log('')
  console.log('🔍 Verify on Theta Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${EXISTING_REVENUE_SPLITTER}`)
  console.log('')
  console.log('═══════════════════════════════════════════════════')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('═══════════════════════════════════════════════════')
    console.error('❌ UPGRADE FAILED')
    console.error('═══════════════════════════════════════════════════')
    console.error('')
    console.error('Error:', error.message)
    console.error('')
    if (error.stack) {
      console.error('Stack:')
      console.error(error.stack)
    }
    console.error('')
    process.exit(1)
  })

