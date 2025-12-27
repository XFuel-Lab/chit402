// Direct deployment and upgrade - Full security fix
const { ethers } = require('ethers')
const fs = require('fs')

async function main() {
  console.log('')
  console.log('🔴 CRITICAL SECURITY UPGRADE: Complete Deployment')
  console.log('==================================================')
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

  const REVENUE_SPLITTER_PROXY = '0x03973A67449557b14228541Df339Ae041567628B'
  const BUYBACK_BURNER_PROXY = '0x3b0C862A3376A3751d7bcEa88b29e2e595560e4E'
  const REVENUE_SPLITTER_IMPL = '0x44C751c4e8Da4C312Eab63e8932Baa9f1835716D' // Just deployed

  // Step 1: Deploy BuybackBurner implementation
  console.log('Step 1: Deploying BuybackBurner implementation...')
  console.log('')
  
  const buybackArtifact = JSON.parse(fs.readFileSync('./artifacts/contracts/BuybackBurner.sol/BuybackBurner.json', 'utf8'))
  const buybackFactory = new ethers.ContractFactory(buybackArtifact.abi, buybackArtifact.bytecode, wallet)
  
  const buybackImpl = await buybackFactory.deploy({
    gasLimit: 10000000,
    gasPrice: ethers.parseUnits('4000', 'gwei'),
  })
  
  console.log('Transaction sent:', buybackImpl.deploymentTransaction().hash)
  console.log('Waiting for confirmation...')
  
  await buybackImpl.waitForDeployment()
  const buybackImplAddress = await buybackImpl.getAddress()
  
  console.log('✅ BuybackBurner implementation deployed:', buybackImplAddress)
  console.log('')

  // Step 2: Upgrade RevenueSplitter proxy
  console.log('Step 2: Upgrading RevenueSplitter proxy...')
  console.log('')
  
  const revenueArtifact = JSON.parse(fs.readFileSync('./artifacts/contracts/RevenueSplitter.sol/RevenueSplitter.json', 'utf8'))
  const revenueProxy = new ethers.Contract(REVENUE_SPLITTER_PROXY, revenueArtifact.abi, wallet)
  
  const revenueUpgradeTx = await revenueProxy.upgradeToAndCall(REVENUE_SPLITTER_IMPL, '0x', {
    gasLimit: 1000000,
    gasPrice: ethers.parseUnits('4000', 'gwei'),
  })
  
  console.log('Transaction sent:', revenueUpgradeTx.hash)
  console.log('Waiting for confirmation...')
  
  await revenueUpgradeTx.wait()
  
  console.log('✅ RevenueSplitter proxy upgraded!')
  console.log('')

  // Verify RevenueSplitter
  console.log('Verifying RevenueSplitter...')
  const maxSwap1 = await revenueProxy.maxSwapAmount()
  const totalLimit1 = await revenueProxy.totalUserLimit()
  const paused1 = await revenueProxy.paused()
  
  console.log('  maxSwapAmount:', ethers.formatEther(maxSwap1), 'TFUEL')
  console.log('  totalUserLimit:', ethers.formatEther(totalLimit1), 'TFUEL')
  console.log('  paused:', paused1)
  console.log('')

  // Step 3: Upgrade BuybackBurner proxy
  console.log('Step 3: Upgrading BuybackBurner proxy...')
  console.log('')
  
  const buybackProxy = new ethers.Contract(BUYBACK_BURNER_PROXY, buybackArtifact.abi, wallet)
  
  const buybackUpgradeTx = await buybackProxy.upgradeToAndCall(buybackImplAddress, '0x', {
    gasLimit: 1000000,
    gasPrice: ethers.parseUnits('4000', 'gwei'),
  })
  
  console.log('Transaction sent:', buybackUpgradeTx.hash)
  console.log('Waiting for confirmation...')
  
  await buybackUpgradeTx.wait()
  
  console.log('✅ BuybackBurner proxy upgraded!')
  console.log('')

  // Verify BuybackBurner
  console.log('Verifying BuybackBurner...')
  const maxSwap2 = await buybackProxy.maxSwapAmount()
  const totalLimit2 = await buybackProxy.totalUserLimit()
  const paused2 = await buybackProxy.paused()
  
  console.log('  maxSwapAmount:', ethers.formatEther(maxSwap2), 'TFUEL')
  console.log('  totalUserLimit:', ethers.formatEther(totalLimit2), 'TFUEL')
  console.log('  paused:', paused2)
  console.log('')

  console.log('==================================================')
  console.log('✅ CRITICAL SECURITY UPGRADE COMPLETE')
  console.log('==================================================')
  console.log('')
  console.log('Deployment Summary:')
  console.log('  RevenueSplitter Proxy:', REVENUE_SPLITTER_PROXY)
  console.log('  RevenueSplitter Impl:', REVENUE_SPLITTER_IMPL)
  console.log('  BuybackBurner Proxy:', BUYBACK_BURNER_PROXY)
  console.log('  BuybackBurner Impl:', buybackImplAddress)
  console.log('')
  console.log('Transactions:')
  console.log('  BuybackBurner Deploy:', buybackImpl.deploymentTransaction().hash)
  console.log('  RevenueSplitter Upgrade:', revenueUpgradeTx.hash)
  console.log('  BuybackBurner Upgrade:', buybackUpgradeTx.hash)
  console.log('')
  console.log('Explorer Links:')
  console.log('  RevenueSplitter:', `https://explorer.thetatoken.org/account/${REVENUE_SPLITTER_PROXY}`)
  console.log('  BuybackBurner:', `https://explorer.thetatoken.org/account/${BUYBACK_BURNER_PROXY}`)
  console.log('')
}

// Load .env files
require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ Upgrade failed:', error.message)
    if (error.data) console.error('Error data:', error.data)
    console.error('')
    process.exit(1)
  })

