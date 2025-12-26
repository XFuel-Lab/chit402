const { ethers } = require('hardhat')

/**
 * Check Recent Transactions
 */

async function main() {
  const deployer = '0x627082bFAdffb16B979d99A8eFc8F1874c0990C4'
  
  console.log('Checking recent transactions for:', deployer)
  console.log('')

  const latestBlock = await ethers.provider.getBlockNumber()
  console.log('Latest block:', latestBlock)
  console.log('')

  // Get recent blocks
  console.log('Checking last 50 blocks...')
  let foundTxs = []
  
  for (let i = 0; i < 50; i++) {
    const blockNum = latestBlock - i
    const block = await ethers.provider.getBlock(blockNum, true)
    
    if (block && block.transactions) {
      for (const tx of block.transactions) {
        if (typeof tx === 'object' && tx.from && tx.from.toLowerCase() === deployer.toLowerCase()) {
          foundTxs.push({
            hash: tx.hash,
            block: blockNum,
            to: tx.to,
            value: ethers.formatEther(tx.value || 0)
          })
        }
      }
    }
  }

  if (foundTxs.length === 0) {
    console.log('No recent transactions found')
  } else {
    console.log(`Found ${foundTxs.length} recent transaction(s):`)
    console.log('')
    for (const tx of foundTxs) {
      console.log('Transaction:', tx.hash)
      console.log('  Block:', tx.block)
      console.log('  To:', tx.to || '(contract creation)')
      console.log('  Value:', tx.value, 'TFUEL')
      console.log('')
      
      // Try to get receipt
      try {
        const receipt = await ethers.provider.getTransactionReceipt(tx.hash)
        if (receipt && receipt.contractAddress) {
          console.log('  ✅ Contract deployed at:', receipt.contractAddress)
        }
        if (receipt) {
          console.log('  Gas used:', receipt.gasUsed.toString())
          console.log('  Status:', receipt.status === 1 ? 'Success' : 'Failed')
        }
      } catch (e) {
        console.log('  Could not get receipt')
      }
      console.log('')
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    process.exit(1)
  })

