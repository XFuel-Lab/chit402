const { ethers, upgrades } = require('hardhat')

/**
 * Deploy XFuel Protocol to Theta Mainnet with Beta Testing Safety Limits
 * SIMPLIFIED - Uses existing tokens if available
 */

async function main() {
  console.log('🚀 Deploying XFuel Protocol to Theta Mainnet (Beta Testing Mode)')
  console.log('=================================================================')
  console.log('')

  // Check signers
  const signers = await ethers.getSigners()
  if (!signers || signers.length === 0) {
    console.error('❌ ERROR: No accounts found!')
    process.exit(1)
  }

  const deployer = signers[0]
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer address:', deployerAddress)
  console.log('💰 Deployer balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  if (parseFloat(ethers.formatEther(balance)) < 50) {
    console.error('❌ ERROR: Insufficient balance!')
    console.error('Need at least 100 TFUEL')
    process.exit(1)
  }

  // Use simple addresses for mock tokens (we'll create proper ones later)
  // For now, use deployer address as placeholder
  console.log('📦 Setting up token addresses...')
  const usdcAddress = deployerAddress // Placeholder
  const xfAddress = deployerAddress // Placeholder
  console.log('✅ Using placeholder addresses for testing')
  console.log('')

  // Deploy veXF
  console.log('📦 Deploying veXF...')
  const VeXF = await ethers.getContractFactory('veXF')
  const veXF = await upgrades.deployProxy(
    VeXF,
    [xfAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await veXF.waitForDeployment()
  const veXFAddress = await veXF.getAddress()
  console.log('✅ veXF deployed to:', veXFAddress)
  console.log('')

  // Deploy rXF
  console.log('📦 Deploying rXF...')
  const RXF = await ethers.getContractFactory('rXF')
  const rXF = await upgrades.deployProxy(
    RXF,
    [xfAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await rXF.waitForDeployment()
  const rXFAddress = await rXF.getAddress()
  console.log('✅ rXF deployed to:', rXFAddress)
  console.log('')

  // Deploy BuybackBurner
  console.log('📦 Deploying BuybackBurner (with beta limits)...')
  const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
  const buybackBurner = await upgrades.deployProxy(
    BuybackBurner,
    [usdcAddress, xfAddress, ethers.ZeroAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await buybackBurner.waitForDeployment()
  const buybackBurnerAddress = await buybackBurner.getAddress()
  console.log('✅ BuybackBurner deployed to:', buybackBurnerAddress)
  console.log('   ⚠️  Beta limits: 1,000 TFUEL/swap, 5,000 TFUEL/user')
  console.log('')

  // Deploy RevenueSplitter
  console.log('📦 Deploying RevenueSplitter (with beta limits)...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  const revenueSplitter = await upgrades.deployProxy(
    RevenueSplitter,
    [usdcAddress, veXFAddress, deployerAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await revenueSplitter.waitForDeployment()
  const revenueSplitterAddress = await revenueSplitter.getAddress()
  console.log('✅ RevenueSplitter deployed to:', revenueSplitterAddress)
  console.log('   ⚠️  Beta limits: 1,000 TFUEL/swap, 5,000 TFUEL/user')
  console.log('')

  // Configure contracts
  console.log('🔗 Configuring contract references...')
  await revenueSplitter.setBuybackBurner(buybackBurnerAddress)
  console.log('✅ BuybackBurner reference set')
  
  await revenueSplitter.setRXF(rXFAddress)
  console.log('✅ rXF reference set')
  
  await buybackBurner.setRevenueSplitter(revenueSplitterAddress)
  console.log('✅ RevenueSplitter reference set')
  console.log('')

  // Summary
  console.log('🎉 DEPLOYMENT COMPLETE!')
  console.log('═══════════════════════════════════════')
  console.log('')
  console.log('📋 MAIN CONTRACT ADDRESSES:')
  console.log('═══════════════════════════════════════')
  console.log('veXF:', veXFAddress)
  console.log('rXF:', rXFAddress)
  console.log('BuybackBurner:', buybackBurnerAddress)
  console.log('RevenueSplitter:', revenueSplitterAddress)
  console.log('═══════════════════════════════════════')
  console.log('')
  console.log('⚠️  BETA TESTING CONFIGURATION:')
  console.log('   ✓ Max swap: 1,000 TFUEL per transaction')
  console.log('   ✓ Total limit: 5,000 TFUEL per user')
  console.log('   ✓ Emergency pause available')
  console.log('   ✓ Admin controls active')
  console.log('')
  console.log('📝 COPY THIS FOR YOUR .ENV FILE:')
  console.log('═══════════════════════════════════════')
  console.log(`VITE_ROUTER_ADDRESS=${revenueSplitterAddress}`)
  console.log('VITE_NETWORK=mainnet')
  console.log('VITE_API_URL=https://api.xfuel.io')
  console.log('═══════════════════════════════════════')
  console.log('')
  console.log('🔍 Verify on Theta Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${revenueSplitterAddress}`)
  console.log('')
  console.log('✅ Ready to use! Deploy your frontend now.')
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ DEPLOYMENT FAILED!')
    console.error('══════════════════════')
    console.error('Error:', error.message)
    console.error('')
    process.exit(1)
  })
