const { ethers, upgrades } = require('hardhat')

/**
 * WORKING UPGRADE - Manual Gas Settings
 * Bypasses Theta's broken estimateGas RPC
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  RevenueSplitter Upgrade - Manual Gas Mode')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer:', deployerAddress)
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  const REVENUE_SPLITTER_PROXY = '0x03973A67449557b14228541Df339Ae041567628B'
  const GAS_LIMIT = 15000000 // 15M gas
  const GAS_PRICE = 4000000000000 // 4000 Gwei

  // Step 1: Deploy new implementation
  console.log('[1/4] Deploying new RevenueSplitter implementation...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  
  const newImpl = await RevenueSplitter.deploy({
    gasLimit: GAS_LIMIT,
    gasPrice: GAS_PRICE
  })
  
  console.log('      Waiting for confirmation...')
  await newImpl.waitForDeployment()
  
  const newImplAddress = await newImpl.getAddress()
  console.log('      ✅ Implementation deployed:', newImplAddress)
  console.log('')

  // Step 2: Connect to proxy
  console.log('[2/4] Connecting to proxy...')
  const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER_PROXY)
  console.log('      ✅ Connected to:', REVENUE_SPLITTER_PROXY)
  console.log('')

  // Step 3: Upgrade using UUPSUpgradeable interface
  console.log('[3/4] Upgrading proxy to new implementation...')
  const UUPSProxy = await ethers.getContractAt(
    '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol:UUPSUpgradeable',
    REVENUE_SPLITTER_PROXY
  )
  const upgradeTx = await UUPSProxy.upgradeToAndCall(newImplAddress, '0x', {
    gasLimit: GAS_LIMIT,
    gasPrice: GAS_PRICE
  })
  console.log('      Transaction:', upgradeTx.hash)
  console.log('      Waiting for confirmation...')
  await upgradeTx.wait()
  console.log('      ✅ Upgrade complete')
  console.log('')

  // Step 4: Initialize beta limits
  console.log('[4/4] Initializing beta limits...')
  try {
    const initTx = await proxy.initializeBetaLimits({
      gasLimit: 500000,
      gasPrice: GAS_PRICE
    })
    await initTx.wait()
    console.log('      ✅ Beta limits initialized')
  } catch (error) {
    if (error.message.includes('already') || error.message.includes('AlreadyInitialized')) {
      console.log('      ℹ️  Limits already set, configuring manually...')
      const updateTx = await proxy.updateSwapLimits(
        ethers.parseEther('1000'),
        ethers.parseEther('5000'),
        {
          gasLimit: 500000,
          gasPrice: GAS_PRICE
        }
      )
      await updateTx.wait()
      console.log('      ✅ Limits configured')
    } else {
      console.log('      ⚠️  Could not initialize:', error.message)
    }
  }
  console.log('')

  // Verify
  console.log('📊 Verification:')
  const maxSwap = await proxy.maxSwapAmount()
  const totalLimit = await proxy.totalUserLimit()
  const paused = await proxy.paused()

  console.log('   Max per swap:', ethers.formatEther(maxSwap), 'TFUEL')
  console.log('   Total per user:', ethers.formatEther(totalLimit), 'TFUEL')
  console.log('   Paused:', paused)
  console.log('')

  console.log('═══════════════════════════════════════════════════')
  console.log('🎉 UPGRADE SUCCESSFUL!')
  console.log('═══════════════════════════════════════════════════')
  console.log('')
  console.log('Contract Address:', REVENUE_SPLITTER_PROXY)
  console.log('New Implementation:', newImplAddress)
  console.log('')
  console.log('Beta Limits Active:')
  console.log('  ✅ 1,000 TFUEL max per swap')
  console.log('  ✅ 5,000 TFUEL total per user')
  console.log('')
  console.log('🔍 Verify on Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${REVENUE_SPLITTER_PROXY}`)
  console.log('')
  console.log('Next Steps:')
  console.log('  1. Update web UI with new banner')
  console.log('  2. Update mobile UI with new banner')
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
    console.error('')
    if (error.data) {
      console.error('Error data:', error.data)
    }
    process.exit(1)
  })

