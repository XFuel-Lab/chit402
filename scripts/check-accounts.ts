import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  const address = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(address)
  
  console.log('Deployer address:', address)
  console.log('Balance:', ethers.formatEther(balance), 'TFUEL')
  
  if (parseFloat(ethers.formatEther(balance)) < 50) {
    console.log('WARNING: Low balance. Recommended: 100+ TFUEL')
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR:', error.message)
    process.exit(1)
  })
