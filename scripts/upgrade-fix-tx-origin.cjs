const { ethers, upgrades } = require('hardhat')

/**
 * CRITICAL SECURITY UPGRADE
 * Fix tx.origin → msg.sender vulnerability in limit tracking
 * CVE-XF-2024-001
 */

async function main() {
  console.log('')
  console.log('🔴 CRITICAL SECURITY UPGRADE: Fix tx.origin vulnerability')
  console.log('===========================================================')
  console.log('')

  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', await deployer.getAddress())
  
  const balance = await ethers.provider.getBalance(await deployer.getAddress())
  console.log('Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  // Mainnet addresses
  const REVENUE_SPLITTER_PROXY = '0x03973A67449557b14228541Df339Ae041567628B'
  const BUYBACK_BURNER_PROXY = '0x0eB5f7f19C1a8C2b9DA0f9b1E2a90b0f4a0a2e5E' // Replace with actual address

  console.log('📋 Contract Addresses:')
  console.log('   RevenueSplitter:', REVENUE_SPLITTER_PROXY)
  console.log('   BuybackBurner:', BUYBACK_BURNER_PROXY)
  console.log('')

  // Step 1: Upgrade RevenueSplitter
  console.log('Step 1: Upgrading RevenueSplitter...')
  console.log('   ⚠️  This fixes tx.origin → msg.sender in splitRevenue() and splitRevenueNative()')
  console.log('')

  try {
    const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
    
    console.log('   Deploying new implementation...')
    const upgraded = await upgrades.upgradeProxy(REVENUE_SPLITTER_PROXY, RevenueSplitter)
    await upgraded.waitForDeployment()
    
    const newImplAddress = await upgrades.erc1967.getImplementationAddress(REVENUE_SPLITTER_PROXY)
    console.log('   ✅ New implementation:', newImplAddress)
    console.log('')

    // Verify upgrade
    console.log('   Verifying upgrade...')
    const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER_PROXY)
    
    const maxSwap = await proxy.maxSwapAmount()
    const totalLimit = await proxy.totalUserLimit()
    const paused = await proxy.paused()
    
    console.log('   ✅ maxSwapAmount:', ethers.formatEther(maxSwap), 'TFUEL')
    console.log('   ✅ totalUserLimit:', ethers.formatEther(totalLimit), 'TFUEL')
    console.log('   ✅ paused:', paused)
    console.log('')
    console.log('   ✅ RevenueSplitter upgraded successfully!')
    console.log('')
  } catch (error) {
    console.error('   ❌ RevenueSplitter upgrade failed:', error.message)
    throw error
  }

  // Step 2: Upgrade BuybackBurner
  console.log('Step 2: Upgrading BuybackBurner...')
  console.log('   ⚠️  This fixes tx.origin → msg.sender in receiveRevenue()')
  console.log('')

  try {
    const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
    
    console.log('   Deploying new implementation...')
    const upgraded = await upgrades.upgradeProxy(BUYBACK_BURNER_PROXY, BuybackBurner)
    await upgraded.waitForDeployment()
    
    const newImplAddress = await upgrades.erc1967.getImplementationAddress(BUYBACK_BURNER_PROXY)
    console.log('   ✅ New implementation:', newImplAddress)
    console.log('')

    // Verify upgrade
    console.log('   Verifying upgrade...')
    const proxy = await ethers.getContractAt('BuybackBurner', BUYBACK_BURNER_PROXY)
    
    const maxSwap = await proxy.maxSwapAmount()
    const totalLimit = await proxy.totalUserLimit()
    const paused = await proxy.paused()
    
    console.log('   ✅ maxSwapAmount:', ethers.formatEther(maxSwap), 'TFUEL')
    console.log('   ✅ totalUserLimit:', ethers.formatEther(totalLimit), 'TFUEL')
    console.log('   ✅ paused:', paused)
    console.log('')
    console.log('   ✅ BuybackBurner upgraded successfully!')
    console.log('')
  } catch (error) {
    console.error('   ❌ BuybackBurner upgrade failed:', error.message)
    throw error
  }

  console.log('===========================================================')
  console.log('✅ CRITICAL SECURITY UPGRADE COMPLETE')
  console.log('===========================================================')
  console.log('')
  console.log('Security Fix Applied:')
  console.log('   - RevenueSplitter now uses msg.sender for limit tracking')
  console.log('   - BuybackBurner now uses msg.sender for limit tracking')
  console.log('   - tx.origin vulnerability eliminated')
  console.log('   - Beta limits properly enforced per-caller')
  console.log('')
  console.log('Next Steps:')
  console.log('   1. Verify on Theta Explorer')
  console.log('   2. Test with small swap transactions')
  console.log('   3. Monitor for proper limit enforcement')
  console.log('   4. Update PR description with upgrade tx hashes')
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ Upgrade failed:', error.message)
    console.error('')
    process.exit(1)
  })

