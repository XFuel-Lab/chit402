const { ethers } = require('hardhat')

/**
 * Deploy a simple Mock contract to test network
 */

async function main() {
  console.log('Testing simple contract deployment...')
  console.log('')

  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', await deployer.getAddress())
  const balance = await ethers.provider.getBalance(await deployer.getAddress())
  console.log('Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  console.log('Deploying MockERC20...')
  const MockERC20 = await ethers.getContractFactory('MockERC20')
  
  const mock = await MockERC20.deploy("Test", "TEST", 18)
  
  console.log('Waiting for deployment...')
  await mock.waitForDeployment()
  
  const address = await mock.getAddress()
  console.log('✅ Deployed at:', address)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    process.exit(1)
  })

