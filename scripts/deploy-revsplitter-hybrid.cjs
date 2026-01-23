const hre = require('hardhat')
const fs = require('fs')
const path = require('path')
const ethers = require('ethers')

/**
 * Deploy RevSplitterHybrid with keystore authentication
 * 
 * Required .env variables:
 * - KEYSTORE_PATH: Path to encrypted keystore file
 * - KEYSTORE_PASSWORD: Password to decrypt keystore
 * - RPC_URL: (optional) Theta RPC URL, defaults to mainnet
 * - REVENUE_TOKEN: Address of revenue token (USDC)
 * - BBB_CONTRACT: (optional) BBB contract address
 * - VEXF_DISTRIBUTOR: (optional) veXF yields distributor address
 */

async function main() {
  console.log('🚀 Deploying RevSplitterHybrid with keystore authentication...\n')

  // Load environment variables
  require('dotenv').config()
  require('dotenv').config({ path: '.env.local' })

  const KEYSTORE_PATH = process.env.KEYSTORE_PATH
  const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD
  const RPC_URL = process.env.RPC_URL || 'https://eth-rpc-api.thetatoken.org/rpc'
  const REVENUE_TOKEN = process.env.REVENUE_TOKEN
  const BBB_CONTRACT = process.env.BBB_CONTRACT
  const VEXF_DISTRIBUTOR = process.env.VEXF_DISTRIBUTOR

  // Treasury addresses (hardcoded as per spec)
  const INNOVATION_TREASURY_ADDR = '0x043d5231651379970d52a13CEfB4e80733DDb989'
  const LP_TREASURY_ADDR = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'

  // Validate required env vars
  if (!KEYSTORE_PATH) {
    throw new Error('❌ KEYSTORE_PATH not set in .env')
  }
  if (!KEYSTORE_PASSWORD) {
    throw new Error('❌ KEYSTORE_PASSWORD not set in .env')
  }
  if (!REVENUE_TOKEN) {
    throw new Error('❌ REVENUE_TOKEN not set in .env')
  }

  // Load and decrypt keystore
  console.log('🔐 Loading keystore from:', KEYSTORE_PATH)
  let keystoreJson
  try {
    keystoreJson = fs.readFileSync(KEYSTORE_PATH, 'utf8')
  } catch (error) {
    throw new Error(`❌ Failed to read keystore file: ${error.message}`)
  }

  console.log('🔓 Decrypting keystore...')
  let wallet
  try {
    wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, KEYSTORE_PASSWORD)
  } catch (error) {
    throw new Error(`❌ Failed to decrypt keystore: ${error.message}`)
  }

  // Connect to network
  console.log('🌐 Connecting to network:', RPC_URL)
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const signer = wallet.connect(provider)

  console.log('\n📝 Deployer address:', signer.address)
  
  const balance = await provider.getBalance(signer.address)
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL\n')

  if (balance < ethers.parseEther('1')) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n')
  }

  // Get contract factory with custom signer
  console.log('📦 Preparing RevSplitterHybrid deployment...\n')
  console.log('Configuration:')
  console.log('  Revenue Token:', REVENUE_TOKEN)
  console.log('  Innovation Treasury:', INNOVATION_TREASURY_ADDR)
  console.log('  LP Treasury (Persistence):', LP_TREASURY_ADDR)
  console.log('  BBB Contract:', BBB_CONTRACT || '(to be set later)')
  console.log('  veXF Distributor:', VEXF_DISTRIBUTOR || '(to be set later)')
  console.log('')

  // For deployment, use placeholder addresses if not provided
  const bbbAddress = BBB_CONTRACT || signer.address // Use deployer as placeholder
  const veXFDistributorAddress = VEXF_DISTRIBUTOR || signer.address // Use deployer as placeholder

  if (!BBB_CONTRACT) {
    console.warn('⚠️  BBB_CONTRACT not set, using deployer as placeholder. Update after deployment!')
  }
  if (!VEXF_DISTRIBUTOR) {
    console.warn('⚠️  VEXF_DISTRIBUTOR not set, using deployer as placeholder. Update after deployment!')
  }
  console.log('')

  const RevSplitterHybrid = await hre.ethers.getContractFactory('RevSplitterHybrid', signer)
  
  console.log('🚀 Deploying RevSplitterHybrid...')
  const revSplitter = await RevSplitterHybrid.deploy(
    REVENUE_TOKEN,
    INNOVATION_TREASURY_ADDR,
    LP_TREASURY_ADDR,
    bbbAddress,
    veXFDistributorAddress,
    signer.address // Owner
  )

  console.log('⏳ Waiting for deployment...')
  await revSplitter.waitForDeployment()

  const address = await revSplitter.getAddress()
  console.log('✅ RevSplitterHybrid deployed to:', address)

  // Get deployment transaction
  const deployTx = revSplitter.deploymentTransaction()
  if (deployTx) {
    console.log('   Transaction hash:', deployTx.hash)
    console.log('   Block number:', deployTx.blockNumber || 'pending')
    
    // Estimate gas cost
    const receipt = await deployTx.wait()
    if (receipt) {
      const gasUsed = receipt.gasUsed
      const gasPrice = deployTx.gasPrice || 0n
      const gasCost = gasUsed * gasPrice
      console.log('   Gas used:', gasUsed.toString())
      console.log('   Gas cost:', ethers.formatEther(gasCost), 'TFUEL')
    }
  }

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: (await provider.getNetwork()).chainId.toString(),
    contractAddress: address,
    deployer: signer.address,
    timestamp: new Date().toISOString(),
    configuration: {
      revenueToken: REVENUE_TOKEN,
      innovationTreasury: INNOVATION_TREASURY_ADDR,
      lpTreasury: LP_TREASURY_ADDR,
      bbbContract: BBB_CONTRACT || 'PLACEHOLDER - UPDATE REQUIRED',
      veXFDistributor: VEXF_DISTRIBUTOR || 'PLACEHOLDER - UPDATE REQUIRED'
    },
    transactionHash: deployTx?.hash,
    blockNumber: deployTx?.blockNumber
  }

  const deploymentDir = path.join(__dirname, '..', 'deployments')
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true })
  }

  const filename = `RevSplitterHybrid-${hre.network.name}-${Date.now()}.json`
  const filepath = path.join(deploymentDir, filename)
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2))

  console.log('\n📄 Deployment info saved to:', filepath)

  // Print next steps
  console.log('\n📋 Next Steps:')
  console.log('─────────────────────────────────────────────────')
  if (!BBB_CONTRACT) {
    console.log('1. Update BBB contract:')
    console.log(`   await revSplitter.setBBBContract("0x...")`)
  }
  if (!VEXF_DISTRIBUTOR) {
    console.log('2. Update veXF Distributor:')
    console.log(`   await revSplitter.setVeXFYieldsDistributor("0x...")`)
  }
  console.log('3. (Optional) Set Axelar bridge adapter:')
  console.log(`   await revSplitter.setAxelarBridgeAdapter("0x...")`)
  console.log('4. (Optional) Configure governance hook:')
  console.log(`   await revSplitter.configureGovernanceHook(500, "0x...", true)`)
  console.log('5. Test revenue split:')
  console.log(`   await revenueToken.approve("${address}", amount)`)
  console.log(`   await revSplitter.splitRevenue(amount)`)
  console.log('─────────────────────────────────────────────────')

  console.log('\n✅ Deployment complete!')

  return {
    address,
    contract: revSplitter,
    deploymentInfo
  }
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ Deployment failed:', error.message)
      console.error(error)
      process.exit(1)
    })
}

module.exports = { main }




