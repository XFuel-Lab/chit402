import { ethers } from 'hardhat'

/**
 * Emergency Unpause Script
 * 
 * Unpauses all critical contracts after emergency is resolved
 * 
 * Usage:
 * npx hardhat run scripts/emergency-unpause.ts --network theta-mainnet
 */

async function main() {
  console.log('✅ EMERGENCY UNPAUSE')
  console.log('====================')
  console.log('')

  const [operator] = await ethers.getSigners()
  console.log('Operator:', await operator.getAddress())
  console.log('')

  // Contract addresses (update these after deployment)
  const addresses = {
    xfuelRouter: process.env.XFUEL_ROUTER_ADDRESS || '',
    xfuelPool: process.env.XFUEL_POOL_ADDRESS || '',
    revenueSplitter: process.env.REVENUE_SPLITTER_ADDRESS || '',
    innovationTreasury: process.env.INNOVATION_TREASURY_ADDRESS || '',
    treasuryBackstop: process.env.TREASURY_BACKSTOP_ADDRESS || '',
  }

  // Validate addresses
  for (const [name, address] of Object.entries(addresses)) {
    if (!address) {
      console.error(`❌ Missing address for ${name}`)
      process.exit(1)
    }
  }

  console.log('🔍 Contract Addresses:')
  for (const [name, address] of Object.entries(addresses)) {
    console.log(`   ${name}: ${address}`)
  }
  console.log('')

  // Confirm action
  console.log('⚠️  WARNING: This will unpause all critical contracts!')
  console.log('   Make sure the issue has been resolved!')
  console.log('')
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...')
  
  await new Promise(resolve => setTimeout(resolve, 5000))
  
  console.log('')
  console.log('✅ Unpausing contracts...')
  console.log('')

  try {
    // Unpause XFUELRouter
    console.log('Unpausing XFUELRouter...')
    const router = await ethers.getContractAt('XFUELRouter', addresses.xfuelRouter)
    const routerTx = await router.unpause()
    await routerTx.wait()
    console.log('✅ XFUELRouter unpaused')

    // Unpause XFUELPool
    console.log('Unpausing XFUELPool...')
    const pool = await ethers.getContractAt('XFUELPool', addresses.xfuelPool)
    const poolTx = await pool.unpause()
    await poolTx.wait()
    console.log('✅ XFUELPool unpaused')

    // Unpause RevenueSplitter
    console.log('Unpausing RevenueSplitter...')
    const revenueSplitter = await ethers.getContractAt('RevenueSplitter', addresses.revenueSplitter)
    const splitterTx = await revenueSplitter.setPaused(false)
    await splitterTx.wait()
    console.log('✅ RevenueSplitter unpaused')

    // Unpause InnovationTreasury
    console.log('Unpausing InnovationTreasury...')
    const treasury = await ethers.getContractAt('InnovationTreasury', addresses.innovationTreasury)
    const treasuryTx = await treasury.unpause()
    await treasuryTx.wait()
    console.log('✅ InnovationTreasury unpaused')

    // Unpause TreasuryILBackstop
    console.log('Unpausing TreasuryILBackstop...')
    const backstop = await ethers.getContractAt('TreasuryILBackstop', addresses.treasuryBackstop)
    const backstopTx = await backstop.unpause()
    await backstopTx.wait()
    console.log('✅ TreasuryILBackstop unpaused')

    console.log('')
    console.log('🎉 ALL CONTRACTS UNPAUSED!')
    console.log('')
    console.log('Protocol is now operational.')
    console.log('Monitor closely for any issues.')
    console.log('')
  } catch (error) {
    console.error('❌ Error unpausing contracts:', error)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

