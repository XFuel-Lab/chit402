const { ethers } = require('hardhat')

/**
 * Remove Beta Limits - Run after successful beta testing
 * Sets both limits to max uint256 (effectively unlimited)
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Remove Beta Limits')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()

  console.log('📍 Deployer:', deployerAddress)
  console.log('')

  const REVENUE_SPLITTER = '0x03973A67449557b14228541Df339Ae041567628B'
  const GAS_PRICE = 4000000000000 // 4000 Gwei

  console.log('⚠️  WARNING: This will remove all beta limits!')
  console.log('After this:')
  console.log('  - Max swap: UNLIMITED')
  console.log('  - Total per user: UNLIMITED')
  console.log('')
  console.log('Make sure you want to do this!')
  console.log('')

  const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER)

  console.log('Setting limits to max uint256...')
  const tx = await proxy.updateSwapLimits(
    ethers.MaxUint256,
    ethers.MaxUint256,
    {
      gasLimit: 500000,
      gasPrice: GAS_PRICE
    }
  )

  console.log('Transaction:', tx.hash)
  console.log('Waiting for confirmation...')

  // Custom wait
  let receipt = null
  for (let i = 0; i < 30; i++) {
    try {
      receipt = await ethers.provider.getTransactionReceipt(tx.hash)
      if (receipt) break
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 3000))
    process.stdout.write('.')
  }

  console.log('')
  console.log('')

  if (!receipt) {
    console.log('⚠️  Could not confirm automatically')
    console.log('Check transaction:')
    console.log(`   https://explorer.thetatoken.org/tx/${tx.hash}`)
    process.exit(0)
  }

  if (receipt.status !== 1) {
    console.error('❌ Transaction failed!')
    process.exit(1)
  }

  console.log('✅ Limits removed!')
  console.log('')

  // Verify
  const maxSwap = await proxy.maxSwapAmount()
  const totalLimit = await proxy.totalUserLimit()

  console.log('New limits:')
  console.log('  Max swap:', maxSwap.toString() === ethers.MaxUint256.toString() ? 'UNLIMITED' : ethers.formatEther(maxSwap))
  console.log('  Total per user:', totalLimit.toString() === ethers.MaxUint256.toString() ? 'UNLIMITED' : ethers.formatEther(totalLimit))
  console.log('')

  console.log('🎉 Beta testing complete! Contract is now in full production mode.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ FAILED')
    console.error('══════════')
    console.error('')
    console.error('Error:', error.message)
    process.exit(1)
  })
