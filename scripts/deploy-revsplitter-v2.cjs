/**
 * Deploy script for RevSplitterHybridV2
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-revsplitter-v2.cjs --network theta-mainnet
 *   npx hardhat run scripts/deploy-revsplitter-v2.cjs --network theta-testnet
 */

const { ethers } = require('hardhat')

// Configuration for different networks
const CONFIG = {
  'theta-mainnet': {
    treasuryAddr: '0x043d5231651379970d52a13CEfB4e80733DDb989',
    lpTreasuryAddr: 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj',
    // Replace these with actual deployed contract addresses on mainnet
    bbbContract: '0x0000000000000000000000000000000000000000',  // TODO: Set BBB contract address
    veXFYieldsDistributor: '0x0000000000000000000000000000000000000000',  // TODO: Set veXF distributor
    axelarBridgeAdapter: '0x0000000000000000000000000000000000000000',  // TODO: Set Axelar adapter (optional)
  },
  'theta-testnet': {
    treasuryAddr: '0x043d5231651379970d52a13CEfB4e80733DDb989',
    lpTreasuryAddr: 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj',
    // Test addresses - replace with actual testnet deployments
    bbbContract: '0x0000000000000000000000000000000000000000',
    veXFYieldsDistributor: '0x0000000000000000000000000000000000000000',
    axelarBridgeAdapter: '0x0000000000000000000000000000000000000000',
  },
  'hardhat': {
    // For local testing
    treasuryAddr: '0x043d5231651379970d52a13CEfB4e80733DDb989',
    lpTreasuryAddr: 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj',
    bbbContract: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',  // Hardhat test account
    veXFYieldsDistributor: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',  // Hardhat test account
    axelarBridgeAdapter: '0x0000000000000000000000000000000000000000',
  }
}

async function main() {
  const [deployer] = await ethers.getSigners()
  const network = hre.network.name
  
  console.log('\n=================================================')
  console.log('🚀 Deploying RevSplitterHybridV2')
  console.log('=================================================\n')
  
  console.log('Network:', network)
  console.log('Deployer address:', deployer.address)
  
  const balance = await ethers.provider.getBalance(deployer.address)
  console.log('Deployer balance:', ethers.formatEther(balance), 'TFUEL\n')

  // Get network configuration
  const config = CONFIG[network]
  if (!config) {
    throw new Error(`No configuration found for network: ${network}`)
  }

  // Validate configuration
  console.log('📋 Configuration:')
  console.log('  Treasury:', config.treasuryAddr)
  console.log('  LP Treasury:', config.lpTreasuryAddr)
  console.log('  BBB Contract:', config.bbbContract)
  console.log('  veXF Distributor:', config.veXFYieldsDistributor)
  console.log('  Axelar Adapter:', config.axelarBridgeAdapter || '(not set)')
  console.log('')

  // Check if addresses are set (mainnet only)
  if (network === 'theta-mainnet') {
    if (config.bbbContract === '0x0000000000000000000000000000000000000000' ||
        config.veXFYieldsDistributor === '0x0000000000000000000000000000000000000000') {
      throw new Error('❌ Please set BBB Contract and veXF Distributor addresses in mainnet config!')
    }
  }

  // Deploy RevSplitterHybridV2
  console.log('📦 Deploying RevSplitterHybridV2...')
  const RevSplitterHybridV2 = await ethers.getContractFactory('RevSplitterHybridV2')
  const revSplitter = await RevSplitterHybridV2.deploy(
    config.treasuryAddr,
    config.lpTreasuryAddr,
    config.bbbContract,
    config.veXFYieldsDistributor,
    deployer.address  // Owner
  )

  await revSplitter.waitForDeployment()
  const revSplitterAddress = await revSplitter.getAddress()
  
  console.log('✅ RevSplitterHybridV2 deployed to:', revSplitterAddress)
  console.log('')

  // Set Axelar bridge adapter if configured
  if (config.axelarBridgeAdapter && config.axelarBridgeAdapter.startsWith('0x')) {
    console.log('🔗 Setting Axelar bridge adapter...')
    const tx = await revSplitter.setAxelarBridgeAdapter(config.axelarBridgeAdapter)
    await tx.wait()
    console.log('✅ Axelar bridge adapter set')
    console.log('')
  }

  // Verify deployment
  console.log('🔍 Verifying deployment...')
  const treasuryAddr = await revSplitter.treasuryAddr()
  const lpTreasuryAddr = await revSplitter.lpTreasuryAddr()
  const bbbContract = await revSplitter.bbbContract()
  const veXFDistributor = await revSplitter.veXFYieldsDistributor()
  const owner = await revSplitter.owner()

  console.log('  Treasury:', treasuryAddr)
  console.log('  LP Treasury:', lpTreasuryAddr)
  console.log('  BBB Contract:', bbbContract)
  console.log('  veXF Distributor:', veXFDistributor)
  console.log('  Owner:', owner)
  console.log('')

  // Display split percentages
  console.log('📊 Revenue Split Configuration:')
  console.log('  BBB (Buyback/Burn):   30%')
  console.log('  LP Funding:           30%')
  console.log('  veXF Yields:          25%')
  console.log('  Treasury:             15%')
  console.log('  Governance Hook:      0% (disabled by default)')
  console.log('')

  // Test split calculation
  const testAmount = ethers.parseEther('1000')  // 1000 TFUEL
  const [bbb, lpFunding, veXFYields, treasury, governance] = await revSplitter.calculateSplits(testAmount)
  console.log('💰 Example: 1000 TFUEL split:')
  console.log('  BBB:        ', ethers.formatEther(bbb), 'TFUEL (30%)')
  console.log('  LP Funding: ', ethers.formatEther(lpFunding), 'TFUEL (30%)')
  console.log('  veXF Yields:', ethers.formatEther(veXFYields), 'TFUEL (25%)')
  console.log('  Treasury:   ', ethers.formatEther(treasury), 'TFUEL (15%)')
  console.log('  Governance: ', ethers.formatEther(governance), 'TFUEL (0%)')
  console.log('')

  console.log('=================================================')
  console.log('✅ Deployment Complete!')
  console.log('=================================================\n')

  console.log('📝 Contract Address:', revSplitterAddress)
  console.log('📝 Owner Address:', deployer.address)
  console.log('')

  console.log('Next Steps:')
  console.log('1. Send TFUEL to contract address to test automatic splitting')
  console.log('2. Configure governance hook (if needed):')
  console.log('   await revSplitter.configureGovernanceHook(500, recipientAddr, true, "Purpose")')
  console.log('3. Set revenue milestones (optional):')
  console.log('   await revSplitter.setMilestone(0, ethers.parseEther("10000"), "First 10K TFUEL")')
  console.log('4. Update addresses as needed using setters')
  console.log('')

  // Save deployment info to file
  const fs = require('fs')
  const deploymentInfo = {
    network: network,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contract: revSplitterAddress,
    config: config,
    gasUsed: 'See transaction receipt'
  }

  const filename = `deployment-revsplitterv2-${network}-${Date.now()}.json`
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2))
  console.log('💾 Deployment info saved to:', filename)
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Deployment failed!\n')
    console.error(error)
    process.exit(1)
  })




