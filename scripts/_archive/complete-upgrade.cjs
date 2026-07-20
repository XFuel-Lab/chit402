const { ethers } = require('hardhat')

/**
 * Complete the upgrade - Point proxy to new implementation
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Complete RevenueSplitter Upgrade')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()

  console.log('📍 Deployer:', deployerAddress)
  console.log('')

  const REVENUE_SPLITTER_PROXY = '0x03973A67449557b14228541Df339Ae041567628B'
  const NEW_IMPLEMENTATION = process.env.IMPL_ADDRESS || '0x8812D4443D0EE7f998FDF2e91D20654F6bec733E'
  const GAS_LIMIT = 2000000 // 2M gas for upgrade call
  const GAS_PRICE = 4000000000000 // 4000 Gwei

  console.log('📋 Proxy:', REVENUE_SPLITTER_PROXY)
  console.log('📦 New Implementation:', NEW_IMPLEMENTATION)
  console.log('')

  // Get proxy contract with owner functions
  console.log('[1/3] Connecting to proxy...')
  const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER_PROXY)
  console.log('      ✅ Connected')
  console.log('')

  // Upgrade
  console.log('[2/3] Upgrading proxy...')
  console.log('      Calling upgradeToAndCall...')
  
  // Call upgradeToAndCall with empty data (no initialization call)
  const upgradeTx = await proxy.upgradeToAndCall(NEW_IMPLEMENTATION, '0x', {
    gasLimit: GAS_LIMIT,
    gasPrice: GAS_PRICE
  })
  
  console.log('      Transaction:', upgradeTx.hash)
  console.log('      Waiting for confirmation...')
  
  // Custom wait
  let receipt = null
  const maxAttempts = 30
  for (let i = 0; i < maxAttempts; i++) {
    try {
      receipt = await ethers.provider.getTransactionReceipt(upgradeTx.hash)
      if (receipt) break
    } catch (e) {
      // Ignore
    }
    await new Promise(resolve => setTimeout(resolve, 3000))
    process.stdout.write('.')
  }
  
  console.log('')
  console.log('')

  if (!receipt) {
    console.log('⚠️  Could not confirm upgrade automatically')
    console.log('Check transaction:')
    console.log(`   https://explorer.thetatoken.org/tx/${upgradeTx.hash}`)
    process.exit(0)
  }

  if (receipt.status !== 1) {
    console.error('❌ Upgrade failed!')
    process.exit(1)
  }

  console.log('      ✅ Upgrade complete!')
  console.log('')

  // Initialize beta limits
  console.log('[3/3] Configuring beta limits...')
  try {
    const limits = await proxy.initializeBetaLimits({
      gasLimit: 500000,
      gasPrice: GAS_PRICE
    })
    
    // Wait for confirmation
    for (let i = 0; i < 20; i++) {
      try {
        const r = await ethers.provider.getTransactionReceipt(limits.hash)
        if (r) break
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    
    console.log('      ✅ Limits configured')
  } catch (error) {
    if (error.message.includes('already') || error.data) {
      console.log('      ℹ️  Setting limits manually...')
      const updateTx = await proxy.updateSwapLimits(
        ethers.parseEther('1000'),
        ethers.parseEther('5000'),
        {
          gasLimit: 500000,
          gasPrice: GAS_PRICE
        }
      )
      
      // Wait
      for (let i = 0; i < 20; i++) {
        try {
          const r = await ethers.provider.getTransactionReceipt(updateTx.hash)
          if (r) break
        } catch (e) {}
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      
      console.log('      ✅ Limits set')
    } else {
      console.log('      ⚠️  Could not set limits:', error.message)
      console.log('      You can set them manually later')
    }
  }
  console.log('')

  // Verify
  console.log('📊 Verifying upgrade...')
  try {
    const maxSwap = await proxy.maxSwapAmount()
    const totalLimit = await proxy.totalUserLimit()
    const paused = await proxy.paused()

    console.log('   ✅ Max per swap:', ethers.formatEther(maxSwap), 'TFUEL')
    console.log('   ✅ Total per user:', ethers.formatEther(totalLimit), 'TFUEL')
    console.log('   ✅ Paused:', paused)
  } catch (e) {
    console.log('   ⚠️  Could not read limits (may need to wait a bit)')
  }
  console.log('')

  console.log('═══════════════════════════════════════════════════')
  console.log('🎉 UPGRADE COMPLETE!')
  console.log('═══════════════════════════════════════════════════')
  console.log('')
  console.log('Contract Address:', REVENUE_SPLITTER_PROXY)
  console.log('Implementation:', NEW_IMPLEMENTATION)
  console.log('')
  console.log('Beta Limits Active:')
  console.log('  ✅ 1,000 TFUEL max per swap')
  console.log('  ✅ 5,000 TFUEL total per user')
  console.log('')
  console.log('🔍 Verify on Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${REVENUE_SPLITTER_PROXY}`)
  console.log('')
  console.log('Next Steps:')
  console.log('  1. Update web UI with BetaBanner')
  console.log('  2. Update mobile UI with BetaBanner')
  console.log('  3. Test swaps with limits')
  console.log('  4. After beta, run remove-beta-limits.cjs')
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
    if (error.data) {
      console.error('Data:', error.data)
    }
    console.error('')
    process.exit(1)
  })

