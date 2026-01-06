// Deploy script for YieldOptimizer and updated XFUELRouter
// Usage: node scripts/deployYieldOptimizer.cjs

const hre = require('hardhat')

async function main() {
  console.log('🚀 Starting deployment of YieldOptimizer and integration...\n')

  const [deployer] = await hre.ethers.getSigners()
  console.log('Deployer address:', deployer.address)
  console.log('Deployer balance:', hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), 'ETH\n')

  // Step 1: Deploy YieldOptimizer
  console.log('📦 Deploying YieldOptimizer...')
  const YieldOptimizer = await hre.ethers.getContractFactory('YieldOptimizer')
  const yieldOptimizer = await YieldOptimizer.deploy()
  await yieldOptimizer.waitForDeployment()
  const yieldOptimizerAddress = await yieldOptimizer.getAddress()
  console.log('✅ YieldOptimizer deployed to:', yieldOptimizerAddress, '\n')

  // Step 2: Configure yield sources (example LSTs)
  console.log('⚙️  Configuring yield sources...')
  
  // Example: Add stkTIA yield source
  // In production, replace these with actual token and oracle addresses
  const stkTIAConfig = {
    symbol: 'stkTIA',
    token: '0x0000000000000000000000000000000000000001', // Replace with actual stkTIA address
    oracle: '0x0000000000000000000000000000000000000002', // Replace with actual Chainlink oracle
    minLiquidity: hre.ethers.parseEther('10000') // 10k minimum liquidity
  }
  
  console.log('Adding stkTIA yield source...')
  const tx1 = await yieldOptimizer.addYieldSource(
    stkTIAConfig.symbol,
    stkTIAConfig.token,
    stkTIAConfig.oracle,
    stkTIAConfig.minLiquidity
  )
  await tx1.wait()
  console.log('✅ stkTIA yield source added\n')

  // Example: Add stkXPRT yield source
  const stkXPRTConfig = {
    symbol: 'stkXPRT',
    token: '0x0000000000000000000000000000000000000003', // Replace with actual stkXPRT address
    oracle: '0x0000000000000000000000000000000000000004', // Replace with actual Chainlink oracle
    minLiquidity: hre.ethers.parseEther('5000') // 5k minimum liquidity
  }
  
  console.log('Adding stkXPRT yield source...')
  const tx2 = await yieldOptimizer.addYieldSource(
    stkXPRTConfig.symbol,
    stkXPRTConfig.token,
    stkXPRTConfig.oracle,
    stkXPRTConfig.minLiquidity
  )
  await tx2.wait()
  console.log('✅ stkXPRT yield source added\n')

  // Example: Add stkATOM yield source
  const stkATOMConfig = {
    symbol: 'stkATOM',
    token: '0x0000000000000000000000000000000000000005', // Replace with actual stkATOM address
    oracle: '0x0000000000000000000000000000000000000006', // Replace with actual Chainlink oracle
    minLiquidity: hre.ethers.parseEther('8000') // 8k minimum liquidity
  }
  
  console.log('Adding stkATOM yield source...')
  const tx3 = await yieldOptimizer.addYieldSource(
    stkATOMConfig.symbol,
    stkATOMConfig.token,
    stkATOMConfig.oracle,
    stkATOMConfig.minLiquidity
  )
  await tx3.wait()
  console.log('✅ stkATOM yield source added\n')

  // Step 3: Get XFUELRouter address (assume it's already deployed)
  // Replace with your actual XFUELRouter address
  const xfuelRouterAddress = process.env.XFUEL_ROUTER_ADDRESS || '0x0000000000000000000000000000000000000000'
  
  if (xfuelRouterAddress !== '0x0000000000000000000000000000000000000000') {
    console.log('🔗 Connecting YieldOptimizer to XFUELRouter...')
    const XFUELRouter = await hre.ethers.getContractFactory('XFUELRouter')
    const router = XFUELRouter.attach(xfuelRouterAddress)
    
    const tx4 = await router.setYieldOptimizer(yieldOptimizerAddress)
    await tx4.wait()
    console.log('✅ YieldOptimizer connected to XFUELRouter\n')
  } else {
    console.log('⚠️  XFUELRouter address not provided. Please set manually using setYieldOptimizer()\n')
  }

  // Step 4: Update APYs from oracles
  console.log('🔄 Updating APYs from Chainlink oracles...')
  try {
    const tx5 = await yieldOptimizer.updateAllAPYs()
    await tx5.wait()
    console.log('✅ APYs updated successfully\n')
  } catch (error) {
    console.log('⚠️  Failed to update APYs (expected if using mock oracles):', error.message, '\n')
  }

  // Step 5: Display best yield source
  console.log('📊 Fetching best yield source...')
  try {
    const [bestLST, bestAPY] = await yieldOptimizer.getBestYieldSource()
    console.log('Best LST:', bestLST)
    console.log('Best APY:', bestAPY.toString(), 'bps (', (Number(bestAPY) / 100).toFixed(2), '%)\n')
  } catch (error) {
    console.log('⚠️  Could not fetch best yield source:', error.message, '\n')
  }

  console.log('🎉 Deployment complete!\n')
  console.log('📝 Contract Addresses:')
  console.log('   YieldOptimizer:', yieldOptimizerAddress)
  console.log('   XFUELRouter:', xfuelRouterAddress, '\n')
  
  console.log('📋 Next Steps:')
  console.log('1. Update LST token addresses in the configuration')
  console.log('2. Set up Chainlink oracle addresses for each LST')
  console.log('3. Call setYieldOptimizer() on XFUELRouter if not done automatically')
  console.log('4. Verify contracts on block explorer')
  console.log('5. Test yield optimization with small amounts first\n')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error)
    process.exit(1)
  })

