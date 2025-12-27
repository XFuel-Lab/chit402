const { ethers, upgrades } = require('hardhat')

/**
 * Deploy using cast/manual approach
 * Get bytecode and deploy manually
 */

async function main() {
  console.log('Getting RevenueSplitter bytecode...')
  
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  const bytecode = RevenueSplitter.bytecode
  
  console.log('Bytecode length:', bytecode.length)
  console.log('Bytecode (first 100 chars):', bytecode.substring(0, 100))
  console.log('')
  console.log('To deploy manually:')
  console.log('1. Use Theta Wallet or MetaMask')
  console.log('2. Send transaction with this data as bytecode')
  console.log('3. Or use the Theta Explorer contract deployment tool')
  console.log('')
  console.log('Addresses to upgrade:')
  console.log('  RevenueSplitter: 0x03973A67449557b14228541Df339Ae041567628B')
  console.log('  BuybackBurner: 0x3b0C862A3376A3751d7bcEa88b29e2e595560e4E')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    process.exit(1)
  })

