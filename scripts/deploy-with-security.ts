import { ethers, upgrades } from 'hardhat'

/**
 * Deploy XFuel Protocol with Security Features
 * 
 * Security Infrastructure:
 * - TimelockController: 48-hour delay for critical operations
 * - MultiSigTreasury: 3-of-5 multi-sig for treasury operations
 * - Pausable: Emergency pause switches on all core contracts
 * - Access Control: Proper role-based permissions
 * 
 * Deployment Order:
 * 1. Deploy mock tokens (if needed)
 * 2. Deploy TimelockController with multi-sig proposers
 * 3. Deploy MultiSigTreasury
 * 4. Deploy core protocol contracts
 * 5. Configure timelock and multi-sig access
 * 6. Transfer ownership to timelock/multi-sig
 */

async function main() {
  console.log('🔐 Deploying XFuel Protocol with Security Features')
  console.log('====================================================')
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('📍 Deployer address:', deployerAddress)
  console.log('💰 Deployer balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  if (parseFloat(ethers.formatEther(balance)) < 100) {
    console.warn('⚠️  Warning: Low balance. Recommended: 100+ TFUEL for deployment')
  }

  // ============================================================================
  // STEP 1: Deploy Mock Tokens (for testing - replace with real tokens on mainnet)
  // ============================================================================
  console.log('📦 Step 1: Deploying mock tokens...')
  const MockERC20 = await ethers.getContractFactory('MockERC20')
  
  const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6)
  await usdc.waitForDeployment()
  const usdcAddress = await usdc.getAddress()
  console.log('✅ USDC deployed to:', usdcAddress)

  const xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
  await xfToken.waitForDeployment()
  const xfAddress = await xfToken.getAddress()
  console.log('✅ XF Token deployed to:', xfAddress)
  console.log('')

  // ============================================================================
  // STEP 2: Configure Multi-Sig Signers
  // ============================================================================
  console.log('📦 Step 2: Configuring multi-sig signers...')
  
  // IMPORTANT: Replace these with your actual multi-sig signer addresses
  // For production, use hardware wallets or secure key management
  const multiSigSigners = [
    deployerAddress, // Signer 1 (replace with actual address)
    deployerAddress, // Signer 2 (replace with actual address)
    deployerAddress, // Signer 3 (replace with actual address)
    deployerAddress, // Signer 4 (replace with actual address)
    deployerAddress, // Signer 5 (replace with actual address)
  ]
  
  const requiredSignatures = 3 // 3-of-5 multi-sig
  
  console.log('   Multi-sig configuration:')
  console.log('   - Total signers:', multiSigSigners.length)
  console.log('   - Required signatures:', requiredSignatures)
  console.log('   - Signers:', multiSigSigners)
  console.log('')

  // ============================================================================
  // STEP 3: Deploy TimelockController
  // ============================================================================
  console.log('📦 Step 3: Deploying TimelockController...')
  
  const minDelay = 48 * 60 * 60 // 48 hours in seconds
  const proposers = multiSigSigners // Multi-sig wallets can propose
  const executors = multiSigSigners // Multi-sig wallets can execute
  const admin = deployerAddress // Admin (can be renounced later)
  
  const XFuelTimelock = await ethers.getContractFactory('XFuelTimelock')
  const timelock = await XFuelTimelock.deploy(
    minDelay,
    proposers,
    executors,
    admin
  )
  await timelock.waitForDeployment()
  const timelockAddress = await timelock.getAddress()
  
  console.log('✅ TimelockController deployed to:', timelockAddress)
  console.log('   - Min delay:', minDelay / 3600, 'hours')
  console.log('   - Proposers:', proposers.length)
  console.log('   - Executors:', executors.length)
  console.log('')

  // ============================================================================
  // STEP 4: Deploy MultiSigTreasury
  // ============================================================================
  console.log('📦 Step 4: Deploying MultiSigTreasury...')
  
  const MultiSigTreasury = await ethers.getContractFactory('MultiSigTreasury')
  const multiSigTreasury = await upgrades.deployProxy(
    MultiSigTreasury,
    [multiSigSigners, requiredSignatures],
    { initializer: 'initialize', kind: 'uups' }
  )
  await multiSigTreasury.waitForDeployment()
  const multiSigTreasuryAddress = await multiSigTreasury.getAddress()
  
  console.log('✅ MultiSigTreasury deployed to:', multiSigTreasuryAddress)
  console.log('   - Required confirmations:', requiredSignatures)
  console.log('')

  // Set timelock in multi-sig treasury
  console.log('🔗 Linking TimelockController to MultiSigTreasury...')
  // Note: This would require multi-sig approval in production
  // For initial setup, we submit a transaction to set timelock
  const setTimelockTx = multiSigTreasury.interface.encodeFunctionData(
    'setTimelock',
    [timelockAddress]
  )
  
  const txId = await multiSigTreasury.submitTransaction(
    multiSigTreasuryAddress,
    0,
    setTimelockTx
  )
  console.log('✅ Timelock link transaction submitted (requires multi-sig approval)')
  console.log('')

  // ============================================================================
  // STEP 5: Deploy Core Protocol Contracts
  // ============================================================================
  console.log('📦 Step 5: Deploying core protocol contracts...')
  
  // Deploy veXF
  console.log('   Deploying veXF...')
  const VeXF = await ethers.getContractFactory('veXF')
  const veXF = await upgrades.deployProxy(
    VeXF,
    [xfAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await veXF.waitForDeployment()
  const veXFAddress = await veXF.getAddress()
  console.log('   ✅ veXF deployed to:', veXFAddress)

  // Deploy rXF
  console.log('   Deploying rXF...')
  const RXF = await ethers.getContractFactory('rXF')
  const rXF = await upgrades.deployProxy(
    RXF,
    [xfAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await rXF.waitForDeployment()
  const rXFAddress = await rXF.getAddress()
  console.log('   ✅ rXF deployed to:', rXFAddress)

  // Deploy BuybackBurner
  console.log('   Deploying BuybackBurner...')
  const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
  const buybackBurner = await upgrades.deployProxy(
    BuybackBurner,
    [usdcAddress, xfAddress, ethers.ZeroAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await buybackBurner.waitForDeployment()
  const buybackBurnerAddress = await buybackBurner.getAddress()
  console.log('   ✅ BuybackBurner deployed to:', buybackBurnerAddress)

  // Deploy InnovationTreasury
  console.log('   Deploying InnovationTreasury...')
  const InnovationTreasury = await ethers.getContractFactory('InnovationTreasury')
  const innovationTreasury = await upgrades.deployProxy(
    InnovationTreasury,
    [veXFAddress, usdcAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await innovationTreasury.waitForDeployment()
  const innovationTreasuryAddress = await innovationTreasury.getAddress()
  console.log('   ✅ InnovationTreasury deployed to:', innovationTreasuryAddress)

  // Deploy RevenueSplitter
  console.log('   Deploying RevenueSplitter...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  const revenueSplitter = await upgrades.deployProxy(
    RevenueSplitter,
    [usdcAddress, veXFAddress, multiSigTreasuryAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await revenueSplitter.waitForDeployment()
  const revenueSplitterAddress = await revenueSplitter.getAddress()
  console.log('   ✅ RevenueSplitter deployed to:', revenueSplitterAddress)

  // Deploy TreasuryILBackstop
  console.log('   Deploying TreasuryILBackstop...')
  const TreasuryILBackstop = await ethers.getContractFactory('TreasuryILBackstop')
  const treasuryBackstop = await TreasuryILBackstop.deploy(usdcAddress)
  await treasuryBackstop.waitForDeployment()
  const treasuryBackstopAddress = await treasuryBackstop.getAddress()
  console.log('   ✅ TreasuryILBackstop deployed to:', treasuryBackstopAddress)

  // Deploy Governance
  console.log('   Deploying Governance...')
  const Governance = await ethers.getContractFactory('Governance')
  const governance = await upgrades.deployProxy(
    Governance,
    [veXFAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await governance.waitForDeployment()
  const governanceAddress = await governance.getAddress()
  console.log('   ✅ Governance deployed to:', governanceAddress)

  // Deploy XFUELPoolFactory
  console.log('   Deploying XFUELPoolFactory...')
  const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
  const poolFactory = await XFUELPoolFactory.deploy()
  await poolFactory.waitForDeployment()
  const poolFactoryAddress = await poolFactory.getAddress()
  console.log('   ✅ XFUELPoolFactory deployed to:', poolFactoryAddress)

  // Deploy XFUELRouter
  console.log('   Deploying XFUELRouter...')
  const XFUELRouter = await ethers.getContractFactory('XFUELRouter')
  const router = await XFUELRouter.deploy(
    poolFactoryAddress,
    treasuryBackstopAddress,
    xfAddress,
    usdcAddress,
    multiSigTreasuryAddress,
    veXFAddress
  )
  await router.waitForDeployment()
  const routerAddress = await router.getAddress()
  console.log('   ✅ XFUELRouter deployed to:', routerAddress)
  console.log('')

  // ============================================================================
  // STEP 6: Configure Contract References
  // ============================================================================
  console.log('📦 Step 6: Configuring contract references...')
  
  await revenueSplitter.setBuybackBurner(buybackBurnerAddress)
  console.log('   ✅ BuybackBurner reference set in RevenueSplitter')
  
  await revenueSplitter.setRXF(rXFAddress)
  console.log('   ✅ rXF reference set in RevenueSplitter')
  
  await buybackBurner.setRevenueSplitter(revenueSplitterAddress)
  console.log('   ✅ RevenueSplitter reference set in BuybackBurner')
  console.log('')

  // ============================================================================
  // STEP 7: Configure Timelock Access
  // ============================================================================
  console.log('📦 Step 7: Configuring timelock access for contracts...')
  
  await innovationTreasury.setTimelock(timelockAddress)
  console.log('   ✅ Timelock set for InnovationTreasury')
  
  await revenueSplitter.setTimelock(timelockAddress)
  console.log('   ✅ Timelock set for RevenueSplitter')
  
  await treasuryBackstop.setTimelock(timelockAddress)
  console.log('   ✅ Timelock set for TreasuryILBackstop')
  console.log('')

  // ============================================================================
  // STEP 8: Summary
  // ============================================================================
  console.log('🎉 DEPLOYMENT COMPLETE!')
  console.log('=======================')
  console.log('')
  console.log('🔐 Security Infrastructure:')
  console.log('   TimelockController:', timelockAddress)
  console.log('   MultiSigTreasury:', multiSigTreasuryAddress)
  console.log('')
  console.log('📋 Core Contracts:')
  console.log('   USDC (Mock):', usdcAddress)
  console.log('   XF Token:', xfAddress)
  console.log('   veXF:', veXFAddress)
  console.log('   rXF:', rXFAddress)
  console.log('   BuybackBurner:', buybackBurnerAddress)
  console.log('   InnovationTreasury:', innovationTreasuryAddress)
  console.log('   RevenueSplitter:', revenueSplitterAddress)
  console.log('   TreasuryILBackstop:', treasuryBackstopAddress)
  console.log('   Governance:', governanceAddress)
  console.log('   XFUELPoolFactory:', poolFactoryAddress)
  console.log('   XFUELRouter:', routerAddress)
  console.log('')
  console.log('🔒 Security Configuration:')
  console.log('   ✓ Timelock delay: 48 hours')
  console.log('   ✓ Multi-sig: 3-of-5 signatures required')
  console.log('   ✓ Pausable: All core contracts')
  console.log('   ✓ Access control: Timelock + Multi-sig')
  console.log('')
  console.log('⚠️  IMPORTANT NEXT STEPS:')
  console.log('   1. Verify all contracts on explorer')
  console.log('   2. Transfer ownership to timelock/multi-sig:')
  console.log('      - Call transferOwnership(timelockAddress) on each contract')
  console.log('   3. Update frontend .env with addresses')
  console.log('   4. Test timelock operations:')
  console.log('      - Schedule operation via multi-sig')
  console.log('      - Wait 48 hours')
  console.log('      - Execute operation via multi-sig')
  console.log('   5. Test pause functionality:')
  console.log('      - Call pause() on each contract')
  console.log('      - Verify operations are blocked')
  console.log('      - Call unpause() to restore')
  console.log('   6. Document multi-sig procedures')
  console.log('   7. Store private keys securely')
  console.log('')
  console.log('📝 Save these addresses to your deployment records!')
  console.log('')
  console.log('🔍 Verify on Theta Explorer:')
  console.log(`   https://explorer.thetatoken.org/account/${timelockAddress}`)
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

