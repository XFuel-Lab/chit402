const { ethers } = require('hardhat')

/**
 * Deploy contract with NO constructor args
 */

async function main() {
  console.log('Testing zero-arg contract deployment...')
  console.log('')

  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', await deployer.getAddress())
  console.log('')

  console.log('Deploying veXF (no constructor args)...')
  const veXF = await ethers.getContractFactory('veXF')
  
  const contract = await veXF.deploy()
  
  console.log('Waiting for deployment...')
  await contract.waitForDeployment()
  
  const address = await contract.getAddress()
  console.log('✅ Deployed at:', address)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  })

