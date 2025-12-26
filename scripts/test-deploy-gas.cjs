const { ethers } = require('hardhat')

/**
 * Deploy with explicit gas limit
 */

async function main() {
  console.log('Testing RevenueSplitter deployment with gas limit...')
  console.log('')

  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', await deployer.getAddress())
  console.log('')

  console.log('Getting contract factory...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  
  console.log('Deploying with gas limit...')
  const impl = await RevenueSplitter.deploy({
    gasLimit: 20000000 // Theta max: 20M gas
  })
  
  console.log('Waiting for deployment...')
  await impl.waitForDeployment()
  
  const address = await impl.getAddress()
  console.log('✅ Deployed at:', address)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    if (error.data) {
      console.error('Error data:', error.data)
    }
    process.exit(1)
  })

