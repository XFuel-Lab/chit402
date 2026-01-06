import { ethers } from 'hardhat'

/**
 * Emergency Pause Script
 * 
 * Pauses all critical contracts in case of emergency
 * 
 * Usage:
 * npx hardhat run scripts/emergency-pause.ts --network theta-mainnet
 */

async function main() {
  console.log('🚨 EMERGENCY PAUSE')
  console.log('==================')
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
      console.log('Please set environment variables:')
      console.log('  XFUEL_ROUTER_ADDRESS')
      console.log('  XFUEL_POOL_ADDRESS')
      console.log('  REVENUE_SPLITTER_ADDRESS')
      console.log('  INNOVATION_TREASURY_ADDRESS')
      console.log('  TREASURY_BACKSTOP_ADDRESS')
      process.exit(1)
    }
  }

  console.log('🔍 Contract Addresses:')
  for (const [name, address] of Object.entries(addresses)) {
    console.log(`   ${name}: ${address}`)
  }
  console.log('')

  // Confirm action
  console.log('⚠️  WARNING: This will pause all critical contracts!')
  console.log('   - XFUELRouter')
  console.log('   - XFUELPool')
  console.log('   - RevenueSplitter')
  console.log('   - InnovationTreasury')
  console.log('   - TreasuryILBackstop')
  console.log('')
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...')
  
  await new Promise(resolve => setTimeout(resolve, 5000))
  
  console.log('')
  console.log('🚨 Pausing contracts...')
  console.log('')

  try {
    // Pause XFUELRouter
    console.log('Pausing XFUELRouter...')
    const router = await ethers.getContractAt('XFUELRouter', addresses.xfuelRouter)
    const routerTx = await router.pause()
    await routerTx.wait()
    console.log('✅ XFUELRouter paused')

    // Pause XFUELPool (via factory)
    console.log('Pausing XFUELPool...')
    const pool = await ethers.getContractAt('XFUELPool', addresses.xfuelPool)
    const poolTx = await pool.pause()
    await poolTx.wait()
    console.log('✅ XFUELPool paused')

    // Pause RevenueSplitter
    console.log('Pausing RevenueSplitter...')
    const revenueSplitter = await ethers.getContractAt('RevenueSplitter', addresses.revenueSplitter)
    const splitterTx = await revenueSplitter.setPaused(true)
    await splitterTx.wait()
    console.log('✅ RevenueSplitter paused')

    // Pause InnovationTreasury
    console.log('Pausing InnovationTreasury...')
    const treasury = await ethers.getContractAt('InnovationTreasury', addresses.innovationTreasury)
    const treasuryTx = await treasury.pause()
    await treasuryTx.wait()
    console.log('✅ InnovationTreasury paused')

    // Pause TreasuryILBackstop
    console.log('Pausing TreasuryILBackstop...')
    const backstop = await ethers.getContractAt('TreasuryILBackstop', addresses.treasuryBackstop)
    const backstopTx = await backstop.pause()
    await backstopTx.wait()
    console.log('✅ TreasuryILBackstop paused')

    console.log('')
    console.log('🎉 ALL CONTRACTS PAUSED!')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Investigate the issue')
    console.log('  2. Deploy fixes if needed')
    console.log('  3. Test thoroughly')
    console.log('  4. Unpause contracts')
    console.log('')
    console.log('To unpause, run:')
    console.log('  npx hardhat run scripts/emergency-unpause.ts --network theta-mainnet')
    console.log('')
  } catch (error) {
    console.error('❌ Error pausing contracts:', error)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

