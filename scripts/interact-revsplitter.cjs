const hre = require('hardhat')
const ethers = require('ethers')

/**
 * Example script showing how to interact with deployed RevSplitterHybrid
 * 
 * Usage:
 * 1. Set REVSPLITTER_ADDRESS in .env
 * 2. Run: node scripts/interact-revsplitter.cjs
 */

async function main() {
  console.log('🔧 RevSplitterHybrid Interaction Script\n')

  require('dotenv').config()
  require('dotenv').config({ path: '.env.local' })

  const KEYSTORE_PATH = process.env.KEYSTORE_PATH
  const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD
  const RPC_URL = process.env.RPC_URL || 'https://eth-rpc-api.thetatoken.org/rpc'
  const REVSPLITTER_ADDRESS = process.env.REVSPLITTER_ADDRESS

  if (!REVSPLITTER_ADDRESS) {
    throw new Error('❌ REVSPLITTER_ADDRESS not set in .env')
  }

  // Load keystore
  console.log('🔐 Loading keystore...')
  const fs = require('fs')
  const keystoreJson = fs.readFileSync(KEYSTORE_PATH, 'utf8')
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, KEYSTORE_PASSWORD)
  
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const signer = wallet.connect(provider)

  console.log('📝 Account:', signer.address)
  console.log('🌐 Network:', RPC_URL)
  console.log('📍 RevSplitter:', REVSPLITTER_ADDRESS)
  console.log('')

  // Get contract instance
  const RevSplitterHybrid = await hre.ethers.getContractFactory('RevSplitterHybrid', signer)
  const revSplitter = RevSplitterHybrid.attach(REVSPLITTER_ADDRESS)

  // Display current configuration
  console.log('📊 Current Configuration')
  console.log('─────────────────────────────────────────')
  
  const revenueToken = await revSplitter.revenueToken()
  console.log('Revenue Token:', revenueToken)
  
  const innovationTreasury = await revSplitter.innovationTreasuryAddr()
  console.log('Innovation Treasury:', innovationTreasury)
  
  const lpTreasury = await revSplitter.lpTreasuryAddr()
  console.log('LP Treasury:', lpTreasury)
  
  const bbbContract = await revSplitter.bbbContract()
  console.log('BBB Contract:', bbbContract)
  
  const veXFDistributor = await revSplitter.veXFYieldsDistributor()
  console.log('veXF Distributor:', veXFDistributor)
  
  const axelarAdapter = await revSplitter.axelarBridgeAdapter()
  console.log('Axelar Adapter:', axelarAdapter || '(not set)')
  
  const owner = await revSplitter.owner()
  console.log('Owner:', owner)
  console.log('')

  // Display governance hook config
  console.log('🏛️  Governance Hook')
  console.log('─────────────────────────────────────────')
  const [diversionBps, recipient, active] = await revSplitter.getGovernanceHookConfig()
  console.log('Diversion:', (Number(diversionBps) / 100).toFixed(2) + '%')
  console.log('Recipient:', recipient || '(not set)')
  console.log('Active:', active)
  console.log('')

  // Display statistics
  console.log('📈 Statistics')
  console.log('─────────────────────────────────────────')
  const totalRevenue = await revSplitter.totalRevenueCollected()
  const totalBBB = await revSplitter.totalBBBAllocated()
  const totalLP = await revSplitter.totalLPFundingAllocated()
  const totalVeXF = await revSplitter.totalVeXFYieldsAllocated()
  const totalInnovation = await revSplitter.totalInnovationTreasuryAllocated()
  const totalGovernance = await revSplitter.totalGovernanceDiverted()
  
  console.log('Total Revenue Collected:', ethers.formatUnits(totalRevenue, 6), 'USDC')
  console.log('  BBB Allocated:', ethers.formatUnits(totalBBB, 6), 'USDC')
  console.log('  LP Funding Allocated:', ethers.formatUnits(totalLP, 6), 'USDC')
  console.log('  veXF Yields Allocated:', ethers.formatUnits(totalVeXF, 6), 'USDC')
  console.log('  Innovation Treasury:', ethers.formatUnits(totalInnovation, 6), 'USDC')
  console.log('  Governance Diverted:', ethers.formatUnits(totalGovernance, 6), 'USDC')
  console.log('')

  // Display pending LP funding
  const pendingLP = await revSplitter.getPendingLPFunding()
  console.log('💰 Pending LP Funding (awaiting bridge):', ethers.formatUnits(pendingLP, 6), 'USDC')
  console.log('')

  // Preview split for example amount
  console.log('🔮 Example Split Preview (10,000 USDC)')
  console.log('─────────────────────────────────────────')
  const exampleAmount = ethers.parseUnits('10000', 6)
  const [bbb, lpFunding, veXFYields, innovation, governance] = await revSplitter.calculateSplits(exampleAmount)
  
  console.log('BBB (30%):', ethers.formatUnits(bbb, 6), 'USDC')
  console.log('LP Funding (30%):', ethers.formatUnits(lpFunding, 6), 'USDC')
  console.log('veXF Yields (25%):', ethers.formatUnits(veXFYields, 6), 'USDC')
  console.log('Innovation Treasury (15%):', ethers.formatUnits(innovation, 6), 'USDC')
  if (governance > 0n) {
    console.log('Governance Diverted:', ethers.formatUnits(governance, 6), 'USDC')
  }
  console.log('')

  // Available actions menu
  console.log('🎯 Available Actions')
  console.log('─────────────────────────────────────────')
  console.log('1. Configure Governance Hook')
  console.log('2. Set Axelar Bridge Adapter')
  console.log('3. Manually Bridge Pending LP Funding')
  console.log('4. Update Contract Addresses')
  console.log('5. Split Revenue (test with mock tokens)')
  console.log('')
  console.log('💡 Tip: Modify this script to perform desired actions')
  console.log('    or use Hardhat console: npx hardhat console --network theta-mainnet')
}

// Example functions (uncomment and modify as needed)

async function configureGovernanceHook(revSplitter, diversionBps, recipient, active) {
  console.log('⚙️  Configuring governance hook...')
  const tx = await revSplitter.configureGovernanceHook(diversionBps, recipient, active)
  console.log('   Transaction:', tx.hash)
  await tx.wait()
  console.log('   ✅ Governance hook configured!')
}

async function setAxelarAdapter(revSplitter, adapterAddress) {
  console.log('⚙️  Setting Axelar bridge adapter...')
  const tx = await revSplitter.setAxelarBridgeAdapter(adapterAddress)
  console.log('   Transaction:', tx.hash)
  await tx.wait()
  console.log('   ✅ Axelar adapter set!')
}

async function manualBridge(revSplitter, amount) {
  console.log('⚙️  Manually bridging LP funding...')
  const tx = await revSplitter.manualBridgeLPFunding(amount)
  console.log('   Transaction:', tx.hash)
  await tx.wait()
  console.log('   ✅ LP funding bridged!')
}

async function splitRevenue(revSplitter, revenueTokenAddress, amount) {
  console.log('⚙️  Splitting revenue...')
  
  // Approve first
  const ERC20 = await hre.ethers.getContractFactory('MockERC20')
  const token = ERC20.attach(revenueTokenAddress)
  
  console.log('   Approving...')
  const approveTx = await token.approve(await revSplitter.getAddress(), amount)
  await approveTx.wait()
  
  console.log('   Splitting...')
  const tx = await revSplitter.splitRevenue(amount)
  console.log('   Transaction:', tx.hash)
  const receipt = await tx.wait()
  console.log('   ✅ Revenue split! Gas used:', receipt.gasUsed.toString())
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ Error:', error.message)
      console.error(error)
      process.exit(1)
    })
}

module.exports = { 
  main,
  configureGovernanceHook,
  setAxelarAdapter,
  manualBridge,
  splitRevenue
}



