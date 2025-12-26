const { ethers } = require('hardhat')

/**
 * Deploy without waiting (Theta RPC workaround)
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  RevenueSplitter Deployment (No Wait)')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer:', deployerAddress)
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  const GAS_LIMIT = 15000000 // 15M gas
  const GAS_PRICE = 4000000000000 // 4000 Gwei

  console.log('[1/2] Deploying new RevenueSplitter implementation...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  
  // Get deployment transaction
  const deployTx = await RevenueSplitter.getDeployTransaction()
  
  // Send transaction manually
  const tx = await deployer.sendTransaction({
    data: deployTx.data,
    gasLimit: GAS_LIMIT,
    gasPrice: GAS_PRICE
  })
  
  console.log('      Transaction sent:', tx.hash)
  console.log('')
  console.log('[2/2] Waiting for confirmation...')
  console.log('      (This may take 1-2 minutes on Theta)')
  console.log('')

  // Wait with timeout
  let receipt = null
  const maxAttempts = 30
  for (let i = 0; i < maxAttempts; i++) {
    try {
      receipt = await ethers.provider.getTransactionReceipt(tx.hash)
      if (receipt) break
    } catch (e) {
      // Ignore
    }
    await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3s
    process.stdout.write('.')
  }
  
  console.log('')
  console.log('')

  if (!receipt) {
    console.log('⚠️  Could not get receipt automatically')
    console.log('')
    console.log('Check transaction manually:')
    console.log(`   https://explorer.thetatoken.org/tx/${tx.hash}`)
    console.log('')
    console.log('Then run this to continue upgrade:')
    console.log(`   npx hardhat run scripts/complete-upgrade.cjs --network theta-mainnet`)
    process.exit(0)
  }

  if (receipt.status !== 1) {
    console.error('❌ Transaction failed!')
    process.exit(1)
  }

  const contractAddress = receipt.contractAddress
  console.log('✅ Implementation deployed at:', contractAddress)
  console.log('')
  console.log('Now run:')
  console.log(`   IMPL_ADDRESS=${contractAddress} npx hardhat run scripts/complete-upgrade.cjs --network theta-mainnet`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ DEPLOYMENT FAILED')
    console.error('══════════════════════')
    console.error('')
    console.error('Error:', error.message)
    process.exit(1)
  })

