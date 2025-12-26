const { ethers } = require('hardhat')

/**
 * Simple deployment test - Deploy RevenueSplitter implementation only
 */

async function main() {
  console.log('Testing RevenueSplitter deployment...')
  console.log('')

  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', await deployer.getAddress())
  console.log('')

  console.log('Getting contract factory...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  
  console.log('Deploying...')
  const impl = await RevenueSplitter.deploy()
  
  console.log('Waiting for deployment...')
  await impl.waitForDeployment()
  
  const address = await impl.getAddress()
  console.log('✅ Deployed at:', address)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    process.exit(1)
  })

