// Direct deployment using ethers without Hardhat's deploy() wrapper
const { ethers } = require('ethers')
const fs = require('fs')

async function main() {
  console.log('')
  console.log('🔴 DIRECT DEPLOYMENT: RevenueSplitter Implementation')
  console.log('=================================================')
  console.log('')

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider('https://eth-rpc-api.thetatoken.org/rpc')
  const privateKey = process.env.THETA_MAINNET_PRIVATE_KEY
  
  if (!privateKey) {
    throw new Error('THETA_MAINNET_PRIVATE_KEY not found in environment')
  }
  
  const wallet = new ethers.Wallet(privateKey, provider)
  
  console.log('Deployer:', wallet.address)
  const balance = await provider.getBalance(wallet.address)
  console.log('Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  // Read compiled contract
  const artifactPath = './artifacts/contracts/RevenueSplitter.sol/RevenueSplitter.json'
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  
  console.log('Contract bytecode loaded')
  console.log('Bytecode length:', artifact.bytecode.length)
  console.log('')

  // Create contract factory
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet)
  
  console.log('Deploying RevenueSplitter implementation...')
  
  // Deploy with explicit gas settings
  const contract = await factory.deploy({
    gasLimit: 10000000,
    gasPrice: ethers.parseUnits('4000', 'gwei'),
  })
  
  console.log('Transaction sent:', contract.deploymentTransaction().hash)
  console.log('Waiting for confirmation...')
  
  await contract.waitForDeployment()
  const address = await contract.getAddress()
  
  console.log('')
  console.log('✅ RevenueSplitter implementation deployed!')
  console.log('Address:', address)
  console.log('')
  console.log('Next steps:')
  console.log('1. Deploy BuybackBurner implementation (modify this script)')
  console.log('2. Call upgradeToAndCall on RevenueSplitter proxy: 0x03973A67449557b14228541Df339Ae041567628B')
  console.log('3. Call upgradeToAndCall on BuybackBurner proxy: 0x3b0C862A3376A3751d7bcEa88b29e2e595560e4E')
  console.log('')
}

// Load .env files
require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ Deployment failed:', error.message)
    console.error('')
    process.exit(1)
  })

