const { ethers, upgrades } = require('hardhat')

/**
 * Manual Upgrade - Deploy Implementation then Upgrade
 * Workaround for Theta network deployment issues
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Manual Upgrade: RevenueSplitter')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer:', deployerAddress)
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  const REVENUE_SPLITTER_PROXY = '0x03973A67449557b14228541Df339Ae041567628B'

  // Step 1: Deploy new implementation manually
  console.log('Step 1: Deploying new RevenueSplitter implementation...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  
  // Deploy without constructor args (upgradeable contracts don't use constructors)
  const newImpl = await RevenueSplitter.deploy()
  await newImpl.waitForDeployment()
  
  const newImplAddress = await newImpl.getAddress()
  console.log('✅ New implementation deployed at:', newImplAddress)
  console.log('')

  // Step 2: Connect to proxy and upgrade
  console.log('Step 2: Upgrading proxy to new implementation...')
  const proxyAdmin = await upgrades.erc1967.getAdminAddress(REVENUE_SPLITTER_PROXY)
  console.log('📋 Proxy Admin:', proxyAdmin)

  // Get the proxy contract
  const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER_PROXY)
  
  // Upgrade using upgradeTo
  console.log('🔄 Calling upgradeTo...')
  const tx = await proxy.upgradeTo(newImplAddress)
  console.log('📝 Transaction sent:', tx.hash)
  
  console.log('⏳ Waiting for confirmation...')
  await tx.wait()
  console.log('✅ Upgrade complete!')
  console.log('')

  // Step 3: Initialize beta limits
  console.log('Step 3: Initializing beta limits...')
  try {
    const initTx = await proxy.initializeBetaLimits()
    await initTx.wait()
    console.log('✅ Beta limits initialized')
  } catch (error) {
    if (error.message.includes('already set')) {
      console.log('ℹ️  Beta limits already initialized')
    } else {
      throw error
    }
  }
  console.log('')

  // Step 4: Verify
  console.log('Step 4: Verifying upgrade...')
  const maxSwap = await proxy.maxSwapAmount()
  const totalLimit = await proxy.totalUserLimit()
  const paused = await proxy.paused()

  console.log('✅ maxSwapAmount:', ethers.formatEther(maxSwap), 'TFUEL')
  console.log('✅ totalUserLimit:', ethers.formatEther(totalLimit), 'TFUEL')
  console.log('✅ paused:', paused)
  console.log('')

  console.log('═══════════════════════════════════════════════════')
  console.log('🎉 UPGRADE SUCCESSFUL!')
  console.log('═══════════════════════════════════════════════════')
  console.log('')
  console.log('Contract Address:', REVENUE_SPLITTER_PROXY)
  console.log('New Implementation:', newImplAddress)
  console.log('')
  console.log('🔍 Verify on Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${REVENUE_SPLITTER_PROXY}`)
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
    process.exit(1)
  })

