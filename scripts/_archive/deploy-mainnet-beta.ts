import { ethers, upgrades } from 'hardhat'

/**
 * Deploy XFuel Protocol to Theta Mainnet with Beta Testing Safety Limits
 * 
 * Safety features:
 * - 1,000 TFUEL max per swap
 * - 5,000 TFUEL total per user
 * - Emergency pause/kill switches
 * - User tracking mappings
 * 
 * NEW Security Features (v2):
 * - TimelockController for critical operations
 * - Multi-sig treasury support
 * - Pausable contracts
 */

async function main() {
  console.log('🚀 Deploying XFuel Protocol to Theta Mainnet (Beta Testing Mode with Security)')
  console.log('================================================================================')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer address:', deployerAddress)
  console.log('💰 Deployer balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  if (parseFloat(ethers.formatEther(balance)) < 100) {
    console.warn('⚠️  Warning: Low balance. Recommended: 100+ TFUEL for deployment')
  }

  // Deploy TimelockController first
  console.log('📦 Deploying TimelockController...')
  const minDelay = 24 * 60 * 60 // 24 hours for beta (48 hours for production)
  const proposers = [deployerAddress] // Replace with actual multi-sig addresses
  const executors = [deployerAddress] // Replace with actual multi-sig addresses
  const admin = deployerAddress
  
  const XFuelTimelock = await ethers.getContractFactory('XFuelTimelock')
  const timelock = await XFuelTimelock.deploy(minDelay, proposers, executors, admin)
  await timelock.waitForDeployment()
  const timelockAddress = await timelock.getAddress()
  console.log('✅ TimelockController deployed to:', timelockAddress)
  console.log('   - Min delay: 24 hours (beta mode)')
  console.log('')

  // Deploy mock tokens for testing (if needed)
  console.log('📦 Deploying mock tokens...')
  const MockERC20 = await ethers.getContractFactory('MockERC20')
  
  const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6)
  await usdc.waitForDeployment()
  const usdcAddress = await usdc.getAddress()
  console.log('✅ USDC deployed to:', usdcAddress)

  const xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
  await xfToken.waitForDeployment()
  const xfAddress = await xfToken.getAddress()
  console.log('✅ XF Token deployed to:', xfAddress)
  console.log('')

  // Deploy veXF (Vote-Escrowed XF)
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

  // Deploy rXF (Redeemable XF)
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

  // Deploy BuybackBurner with beta limits
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

  // Deploy RevenueSplitter with beta limits
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

  // Set BuybackBurner and rXF references in RevenueSplitter
  console.log('🔗 Configuring contract references...')
  await revenueSplitter.setBuybackBurner(buybackBurnerAddress)
  console.log('✅ BuybackBurner reference set')
  
  await revenueSplitter.setRXF(rXFAddress)
  console.log('✅ rXF reference set')
  
  await buybackBurner.setRevenueSplitter(revenueSplitterAddress)
  console.log('✅ RevenueSplitter reference set in BuybackBurner')
  console.log('')
  
  // Configure timelock for contracts
  console.log('🔗 Configuring timelock for contracts...')
  await revenueSplitter.setTimelock(timelockAddress)
  console.log('✅ Timelock set for RevenueSplitter')
  console.log('')

  // Summary
  console.log('🎉 DEPLOYMENT COMPLETE!')
  console.log('======================')
  console.log('')
  console.log('🔐 Security Infrastructure:')
  console.log('   TimelockController:', timelockAddress)
  console.log('')
  console.log('📋 Contract Addresses:')
  console.log('   USDC (Mock):', usdcAddress)
  console.log('   XF Token:', xfAddress)
  console.log('   veXF:', veXFAddress)
  console.log('   rXF:', rXFAddress)
  console.log('   BuybackBurner:', buybackBurnerAddress)
  console.log('   RevenueSplitter:', revenueSplitterAddress)
  console.log('')
  console.log('⚠️  BETA TESTING CONFIGURATION:')
  console.log('   ✓ Max swap: 1,000 TFUEL')
  console.log('   ✓ Total limit: 5,000 TFUEL per user')
  console.log('   ✓ Emergency pause: Available via setPaused(true)')
  console.log('   ✓ Admin controls: Limit updates, user resets')
  console.log('   ✓ Timelock: 24-hour delay for critical operations')
  console.log('')
  console.log('📝 Save these addresses to your .env file:')
  console.log(`   VITE_ROUTER_ADDRESS=${revenueSplitterAddress}`)
  console.log(`   VITE_TIMELOCK_ADDRESS=${timelockAddress}`)
  console.log('   VITE_NETWORK=mainnet')
  console.log('')
  console.log('🔍 Verify on Theta Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${revenueSplitterAddress}`)
  console.log('')
  console.log('⚡ Next steps:')
  console.log('   1. Verify contracts on explorer')
  console.log('   2. Update frontend .env with addresses')
  console.log('   3. Test with small amounts (< 10 TFUEL)')
  console.log('   4. Monitor events: UserSwapRecorded, PauseToggled')
  console.log('   5. Keep emergency pause ready!')
  console.log('   6. Test timelock operations before going to production')
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

