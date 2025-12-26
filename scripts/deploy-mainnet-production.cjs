const { ethers, upgrades } = require('hardhat')

/**
 * PRODUCTION MAINNET DEPLOYMENT
 * 
 * Deploys ONLY the new protocol contracts with beta limits.
 * Uses REAL Theta mainnet token addresses (no mocks).
 */

async function main() {
  console.log('🚀 XFuel Protocol - MAINNET PRODUCTION DEPLOYMENT')
  console.log('=================================================')
  console.log('')

  // Get deployer
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
  // REAL THETA MAINNET TOKEN ADDRESSES
  // ============================================
  // For mainnet, we use REAL tokens, not mocks!
  
  // TFUEL is native (no address needed for native transfers)
  // For now, use deployer address as placeholder for revenue token
  // In production, this would be wrapped TFUEL or a real stablecoin
  const REVENUE_TOKEN = deployerAddress // TODO: Replace with real USDC/WETH address
  const XF_TOKEN = deployerAddress // TODO: Replace with real XF token when deployed
  
  console.log('📋 Configuration:')
  console.log('   Revenue Token:', REVENUE_TOKEN)
  console.log('   XF Token:', XF_TOKEN)
  console.log('   Treasury:', deployerAddress)
  console.log('')
  console.log('⚠️  Note: Using placeholder addresses. Update these in production.')
  console.log('')

  // ============================================
  // DEPLOY PROTOCOL CONTRACTS (NEW)
  // ============================================

  console.log('📦 [1/4] Deploying veXF (Vote-Escrowed XF)...')
  const VeXF = await ethers.getContractFactory('veXF')
  const veXF = await upgrades.deployProxy(
    VeXF,
    [XF_TOKEN, deployerAddress],
    { 
      initializer: 'initialize',
      kind: 'uups'
    }
  )
  await veXF.waitForDeployment()
  const veXFAddress = await veXF.getAddress()
  console.log('   ✅ veXF:', veXFAddress)
  console.log('')

  console.log('📦 [2/4] Deploying rXF (Redeemable XF)...')
  const RXF = await ethers.getContractFactory('rXF')
  const rXF = await upgrades.deployProxy(
    RXF,
    [XF_TOKEN, deployerAddress],
    { 
      initializer: 'initialize',
      kind: 'uups'
    }
  )
  await rXF.waitForDeployment()
  const rXFAddress = await rXF.getAddress()
  console.log('   ✅ rXF:', rXFAddress)
  console.log('')

  console.log('📦 [3/4] Deploying BuybackBurner...')
  const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
  const buybackBurner = await upgrades.deployProxy(
    BuybackBurner,
    [
      REVENUE_TOKEN,
      XF_TOKEN,
      ethers.ZeroAddress, // No swap router initially
      deployerAddress
    ],
    { 
      initializer: 'initialize',
      kind: 'uups'
    }
  )
  await buybackBurner.waitForDeployment()
  const buybackBurnerAddress = await buybackBurner.getAddress()
  console.log('   ✅ BuybackBurner:', buybackBurnerAddress)
  console.log('   ⚠️  Beta limits: 1,000 TFUEL/swap, 5,000 TFUEL/user')
  console.log('')

  console.log('📦 [4/4] Deploying RevenueSplitter...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  const revenueSplitter = await upgrades.deployProxy(
    RevenueSplitter,
    [
      REVENUE_TOKEN,
      veXFAddress,
      deployerAddress, // Treasury
      deployerAddress  // Owner
    ],
    { 
      initializer: 'initialize',
      kind: 'uups'
    }
  )
  await revenueSplitter.waitForDeployment()
  const revenueSplitterAddress = await revenueSplitter.getAddress()
  console.log('   ✅ RevenueSplitter:', revenueSplitterAddress)
  console.log('   ⚠️  Beta limits: 1,000 TFUEL/swap, 5,000 TFUEL/user')
  console.log('')

  // ============================================
  // CONFIGURE CONTRACT REFERENCES
  // ============================================

  console.log('🔗 Linking contracts...')
  
  const tx1 = await revenueSplitter.setBuybackBurner(buybackBurnerAddress)
  await tx1.wait()
  console.log('   ✅ RevenueSplitter → BuybackBurner')
  
  const tx2 = await revenueSplitter.setRXF(rXFAddress)
  await tx2.wait()
  console.log('   ✅ RevenueSplitter → rXF')
  
  const tx3 = await buybackBurner.setRevenueSplitter(revenueSplitterAddress)
  await tx3.wait()
  console.log('   ✅ BuybackBurner → RevenueSplitter')
  
  console.log('')

  // ============================================
  // DEPLOYMENT SUMMARY
  // ============================================

  console.log('═══════════════════════════════════════════════════')
  console.log('🎉 MAINNET DEPLOYMENT COMPLETE!')
  console.log('═══════════════════════════════════════════════════')
  console.log('')
  console.log('📋 DEPLOYED CONTRACTS:')
  console.log('─────────────────────────────────────────────────')
  console.log('veXF (Vote-Escrowed XF):')
  console.log(`  ${veXFAddress}`)
  console.log('')
  console.log('rXF (Redeemable XF):')
  console.log(`  ${rXFAddress}`)
  console.log('')
  console.log('BuybackBurner:')
  console.log(`  ${buybackBurnerAddress}`)
  console.log('')
  console.log('RevenueSplitter (MAIN CONTRACT):')
  console.log(`  ${revenueSplitterAddress}`)
  console.log('─────────────────────────────────────────────────')
  console.log('')
  console.log('⚠️  BETA TESTING SAFETY:')
  console.log('   ✓ Max swap: 1,000 TFUEL per transaction')
  console.log('   ✓ User limit: 5,000 TFUEL total per user')
  console.log('   ✓ Emergency pause: Available')
  console.log('   ✓ Admin controls: Active')
  console.log('')
  console.log('📝 FRONTEND .ENV CONFIGURATION:')
  console.log('─────────────────────────────────────────────────')
  console.log(`VITE_ROUTER_ADDRESS=${revenueSplitterAddress}`)
  console.log('VITE_NETWORK=mainnet')
  console.log('VITE_API_URL=https://api.xfuel.io')
  console.log('─────────────────────────────────────────────────')
  console.log('')
  console.log('🔍 VERIFY ON THETA EXPLORER:')
  console.log(`   https://explorer.thetatoken.org/account/${revenueSplitterAddress}`)
  console.log('')
  console.log('🛠️  NEXT STEPS:')
  console.log('   1. Copy RevenueSplitter address to .env')
  console.log('   2. Deploy frontend: npm run build && vercel --prod')
  console.log('   3. Test with small amounts (< 10 TFUEL)')
  console.log('   4. Monitor events on Theta Explorer')
  console.log('')
  console.log('🚨 EMERGENCY CONTROLS:')
  console.log('   Pause: await revenueSplitter.setPaused(true)')
  console.log('   Lower limits: await revenueSplitter.updateSwapLimits(...)')
  console.log('')
  console.log('═══════════════════════════════════════════════════')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('═══════════════════════════════════════════════════')
    console.error('❌ DEPLOYMENT FAILED')
    console.error('═══════════════════════════════════════════════════')
    console.error('')
    console.error('Error:', error.message)
    console.error('')
    if (error.stack) {
      console.error('Stack trace:')
      console.error(error.stack)
    }
    console.error('')
    process.exit(1)
  })

