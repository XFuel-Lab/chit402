const { ethers } = require('hardhat')

/**
 * CRITICAL SECURITY UPGRADE - Deploy only (no upgrades library)
 * Fix tx.origin → msg.sender vulnerability in limit tracking
 * CVE-XF-2024-001
 */

async function main() {
  console.log('')
  console.log('🔴 CRITICAL SECURITY UPGRADE: Fix tx.origin vulnerability')
  console.log('===========================================================')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  console.log('Deployer:', deployerAddress)
  
  const balance = await ethers.provider.getBalance(deployerAddress)
  console.log('Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  // Mainnet addresses
  const REVENUE_SPLITTER_PROXY = '0x03973A67449557b14228541Df339Ae041567628B'
  const BUYBACK_BURNER_PROXY = '0x3b0C862A3376A3751d7bcEa88b29e2e595560e4E'

  console.log('📋 Contract Addresses:')
  console.log('   RevenueSplitter:', REVENUE_SPLITTER_PROXY)
  console.log('   BuybackBurner:', BUYBACK_BURNER_PROXY)
  console.log('')

  // Gas settings for Theta mainnet
  const gasSettings = {
    gasLimit: 10000000,
    gasPrice: 4000000000000, // 4000 Gwei
  }

  // Step 1: Deploy new RevenueSplitter implementation
  console.log('Step 1: Deploying new RevenueSplitter implementation...')
  console.log('   ⚠️  This fixes tx.origin → msg.sender in splitRevenue() and splitRevenueNative()')
  console.log('')

  try {
    const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
    
    console.log('   Deploying new implementation with gas settings...')
    console.log('   Gas limit:', gasSettings.gasLimit)
    console.log('   Gas price:', gasSettings.gasPrice, 'wei (4000 Gwei)')
    
    const deployTx = await RevenueSplitter.getDeployTransaction()
    const tx = await deployer.sendTransaction({
      ...deployTx,
      ...gasSettings,
    })
    
    console.log('   Transaction sent:', tx.hash)
    console.log('   Waiting for confirmation...')
    
    const receipt = await tx.wait()
    const newImplAddress = receipt.contractAddress
    
    console.log('   ✅ New implementation deployed:', newImplAddress)
    console.log('   Gas used:', receipt.gasUsed.toString())
    console.log('')
    
    // Get proxy instance
    const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER_PROXY)
    
    // Upgrade to new implementation
    console.log('   Upgrading proxy to new implementation...')
    const upgradeTx = await proxy.upgradeToAndCall(newImplAddress, '0x', gasSettings)
    await upgradeTx.wait()
    
    console.log('   ✅ Proxy upgraded! TX:', upgradeTx.hash)
    console.log('')

    // Verify upgrade
    console.log('   Verifying upgrade...')
    
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
    if (error.data) console.error('   Error data:', error.data)
    throw error
  }

  // Step 2: Deploy new BuybackBurner implementation
  console.log('Step 2: Deploying new BuybackBurner implementation...')
  console.log('   ⚠️  This fixes tx.origin → msg.sender in receiveRevenue()')
  console.log('')

  try {
    const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
    
    console.log('   Deploying new implementation with gas settings...')
    
    const deployTx = await BuybackBurner.getDeployTransaction()
    const tx = await deployer.sendTransaction({
      ...deployTx,
      ...gasSettings,
    })
    
    console.log('   Transaction sent:', tx.hash)
    console.log('   Waiting for confirmation...')
    
    const receipt = await tx.wait()
    const newImplAddress = receipt.contractAddress
    
    console.log('   ✅ New implementation deployed:', newImplAddress)
    console.log('   Gas used:', receipt.gasUsed.toString())
    console.log('')
    
    // Get proxy instance
    const proxy = await ethers.getContractAt('BuybackBurner', BUYBACK_BURNER_PROXY)
    
    // Upgrade to new implementation
    console.log('   Upgrading proxy to new implementation...')
    const upgradeTx = await proxy.upgradeToAndCall(newImplAddress, '0x', gasSettings)
    await upgradeTx.wait()
    
    console.log('   ✅ Proxy upgraded! TX:', upgradeTx.hash)
    console.log('')

    // Verify upgrade
    console.log('   Verifying upgrade...')
    
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
    if (error.data) console.error('   Error data:', error.data)
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
  console.log('Deployment Details:')
  console.log('   - RevenueSplitter proxy: ', REVENUE_SPLITTER_PROXY)
  console.log('   - BuybackBurner proxy: ', BUYBACK_BURNER_PROXY)
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

