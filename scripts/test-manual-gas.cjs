const { ethers } = require('hardhat')

/**
 * Deploy without gas estimation - send directly
 */

async function main() {
  console.log('Testing deployment with manual gas...')
  console.log('')

  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', await deployer.getAddress())
  console.log('')

  console.log('Deploying veXF with manual gas settings...')
  const veXF = await ethers.getContractFactory('veXF')
  
  // Deploy with explicit gas settings to skip estimation
  const contract = await veXF.deploy({
    gasLimit: 10000000, // 10M gas
    gasPrice: 4000000000000 // 4000 Gwei - Theta minimum
  })
  
  console.log('Transaction sent, waiting for confirmation...')
  await contract.waitForDeployment()
  
  const address = await contract.getAddress()
  console.log('✅ Deployed at:', address)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message)
    console.error('')
    if (error.data) {
      console.error('Data:', error.data)
    }
    process.exit(1)
  })

