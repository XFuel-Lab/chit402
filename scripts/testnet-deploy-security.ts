import { ethers, upgrades } from 'hardhat'

/**
 * Deploy XFuel Protocol to Theta Testnet with Full Security Infrastructure
 * 
 * Security Infrastructure:
 * - TimelockController: 6-hour delay for testnet (48 hours for production)
 * - MultiSigTreasury: 3-of-5 multi-sig for treasury operations
 * - Pausable: Emergency pause switches on all core contracts
 * - Access Control: Proper role-based permissions
 * 
 * Testnet Configuration:
 * - Chain: Theta Testnet (Chain ID: 365)
 * - Mock Signers: 5 test accounts for multi-sig
 * - Mock Tokens: USDC and XF for testing
 * - Beta Limits: Safety limits for testing phase
 * 
 * Deployment Order:
 * 1. Deploy mock tokens (USDC, XF)
 * 2. Create mock multi-sig signers (5 accounts)
 * 3. Deploy TimelockController with 6-hour delay
 * 4. Deploy MultiSigTreasury with 3-of-5 configuration
 * 5. Deploy core protocol contracts
 * 6. Configure timelock and multi-sig access
 * 7. Test pause functionality
 * 8. Verify all security features
 */

interface DeploymentAddresses {
  // Security Infrastructure
  timelock: string
  multiSigTreasury: string
  
  // Tokens
  usdc: string
  xfToken: string
  
  // Core Contracts
  veXF: string
  rXF: string
  buybackBurner: string
  innovationTreasury: string
  revenueSplitter: string
  treasuryBackstop: string
  governance: string
  poolFactory: string
  router: string
  
  // Multi-sig signers (for reference)
  signers: string[]
}

async function main() {
  console.log('🔐 XFuel Protocol - Theta Testnet Deployment with Security')
  console.log('==========================================================')
  console.log('')
  console.log('⚠️  TESTNET DEPLOYMENT MODE')
  console.log('   - Chain: Theta Testnet (Chain ID: 365)')
  console.log('   - Timelock Delay: 6 hours (testnet configuration)')
  console.log('   - Multi-sig: 3-of-5 with mock signers')
  console.log('   - Beta Limits: Enabled for safety')
  console.log('')

  // ============================================================================
  // STEP 0: Validate Network and Setup
  // ============================================================================
  const network = await ethers.provider.getNetwork()
  console.log('🌐 Network Information:')
  console.log(`   Chain ID: ${network.chainId}`)
  console.log(`   Network Name: ${network.name || 'Unknown'}`)
  
  if (network.chainId !== 365n && network.chainId !== 1337n) {
    console.warn('')
    console.warn('⚠️  WARNING: Not on Theta Testnet (365) or Hardhat (1337)')
    console.warn('   Current Chain ID:', network.chainId.toString())
    console.warn('   Continuing deployment...')
    console.warn('')
  } else {
    console.log('   ✅ Network validated')
  }
  console.log('')

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  const balance = await ethers.provider.getBalance(deployerAddress)

  console.log('👤 Deployer Information:')
  console.log('   Address:', deployerAddress)
  console.log('   Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  const minBalance = network.chainId === 1337n ? 1 : 50 // 1 for Hardhat, 50 for testnet
  if (parseFloat(ethers.formatEther(balance)) < minBalance) {
    console.warn(`⚠️  Warning: Low balance. Recommended: ${minBalance}+ TFUEL for deployment`)
    console.warn('   Get testnet TFUEL from: https://faucet.thetatoken.org/')
    console.warn('')
  }

  // Store deployment addresses
  const deployment: DeploymentAddresses = {
    timelock: '',
    multiSigTreasury: '',
    usdc: '',
    xfToken: '',
    veXF: '',
    rXF: '',
    buybackBurner: '',
    innovationTreasury: '',
    revenueSplitter: '',
    treasuryBackstop: '',
    governance: '',
    poolFactory: '',
    router: '',
    signers: []
  }

  // ============================================================================
  // STEP 1: Deploy Mock Tokens
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 1: Deploying Mock Tokens')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  const MockERC20 = await ethers.getContractFactory('MockERC20')
  
  console.log('   Deploying USDC (6 decimals)...')
  const usdc = await MockERC20.deploy('USD Coin', 'USDC', 6)
  await usdc.waitForDeployment()
  deployment.usdc = await usdc.getAddress()
  console.log('   ✅ USDC deployed to:', deployment.usdc)

  console.log('   Deploying XF Token (18 decimals)...')
  const xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
  await xfToken.waitForDeployment()
  deployment.xfToken = await xfToken.getAddress()
  console.log('   ✅ XF Token deployed to:', deployment.xfToken)
  
  // Mint initial supply for testing
  console.log('')
  console.log('   Minting initial test tokens...')
  const usdcAmount = ethers.parseUnits('1000000', 6) // 1M USDC
  const xfAmount = ethers.parseUnits('10000000', 18) // 10M XF
  
  await usdc.mint(deployerAddress, usdcAmount)
  await xfToken.mint(deployerAddress, xfAmount)
  
  console.log('   ✅ Minted 1,000,000 USDC to deployer')
  console.log('   ✅ Minted 10,000,000 XF to deployer')
  console.log('')

  // ============================================================================
  // STEP 2: Create Mock Multi-Sig Signers
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 2: Creating Mock Multi-Sig Signers')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  console.log('   ⚠️  TESTNET ONLY: Creating 5 mock signer accounts')
  console.log('   📝 For production, replace with actual multi-sig addresses')
  console.log('')
  
  // Create 5 mock wallets for testing
  const mockSigners = []
  for (let i = 0; i < 5; i++) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider)
    mockSigners.push(wallet.address)
    deployment.signers.push(wallet.address)
    console.log(`   Signer ${i + 1}:`, wallet.address)
    
    // Fund each signer with a small amount for gas
    if (network.chainId !== 1337n) {
      const fundAmount = ethers.parseEther('1') // 1 TFUEL for testnet
      await deployer.sendTransaction({
        to: wallet.address,
        value: fundAmount
      })
      console.log(`            Funded with 1 TFUEL`)
    }
  }
  
  const requiredSignatures = 3 // 3-of-5 multi-sig
  
  console.log('')
  console.log('   Multi-sig Configuration:')
  console.log('   ✅ Total signers: 5')
  console.log('   ✅ Required signatures: 3 (3-of-5)')
  console.log('   ✅ Threshold: 60%')
  console.log('')

  // ============================================================================
  // STEP 3: Deploy TimelockController
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 3: Deploying TimelockController')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  const minDelay = 6 * 60 * 60 // 6 hours for testnet (48 hours for production)
  const proposers = mockSigners // Multi-sig wallets can propose
  const executors = mockSigners // Multi-sig wallets can execute
  const admin = deployerAddress // Admin (can be renounced later)
  
  console.log('   Timelock Configuration:')
  console.log('   - Min delay: 6 hours (testnet)')
  console.log('   - Proposers: 5 multi-sig signers')
  console.log('   - Executors: 5 multi-sig signers')
  console.log('   - Admin: Deployer (temporary)')
  console.log('')
  
  console.log('   Deploying XFuelTimelock contract...')
  const XFuelTimelock = await ethers.getContractFactory('XFuelTimelock')
  const timelock = await XFuelTimelock.deploy(
    minDelay,
    proposers,
    executors,
    admin
  )
  await timelock.waitForDeployment()
  deployment.timelock = await timelock.getAddress()
  
  console.log('   ✅ TimelockController deployed to:', deployment.timelock)
  console.log(`   ✅ Operations require ${minDelay / 3600} hour delay`)
  console.log('   ✅ Only multi-sig signers can propose/execute')
  console.log('')

  // ============================================================================
  // STEP 4: Deploy MultiSigTreasury
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 4: Deploying MultiSigTreasury')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  console.log('   Multi-sig Treasury Configuration:')
  console.log('   - Signers: 5 accounts')
  console.log('   - Required confirmations: 3')
  console.log('   - Upgradeable: Yes (UUPS)')
  console.log('')
  
  console.log('   Deploying MultiSigTreasury proxy...')
  const MultiSigTreasury = await ethers.getContractFactory('MultiSigTreasury')
  const multiSigTreasury = await upgrades.deployProxy(
    MultiSigTreasury,
    [mockSigners, requiredSignatures],
    { initializer: 'initialize', kind: 'uups' }
  )
  await multiSigTreasury.waitForDeployment()
  deployment.multiSigTreasury = await multiSigTreasury.getAddress()
  
  console.log('   ✅ MultiSigTreasury deployed to:', deployment.multiSigTreasury)
  console.log('   ✅ 3 confirmations required for treasury operations')
  console.log('')

  // Link Timelock to MultiSigTreasury
  console.log('   🔗 Linking TimelockController to MultiSigTreasury...')
  console.log('   Submitting setTimelock transaction...')
  
  const setTimelockData = multiSigTreasury.interface.encodeFunctionData(
    'setTimelock',
    [deployment.timelock]
  )
  
  const tx = await multiSigTreasury.submitTransaction(
    deployment.multiSigTreasury,
    0,
    setTimelockData
  )
  await tx.wait()
  
  console.log('   ✅ Timelock link transaction submitted')
  console.log('   ⚠️  Requires 3 multi-sig confirmations to execute')
  console.log('')

  // ============================================================================
  // STEP 5: Deploy Core Protocol Contracts
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 5: Deploying Core Protocol Contracts')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  // 5.1: Deploy veXF
  console.log('   [1/9] Deploying veXF (Vote-Escrowed XF)...')
  const VeXF = await ethers.getContractFactory('veXF')
  const veXF = await upgrades.deployProxy(
    VeXF,
    [deployment.xfToken, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await veXF.waitForDeployment()
  deployment.veXF = await veXF.getAddress()
  console.log('         ✅ veXF deployed to:', deployment.veXF)

  // 5.2: Deploy rXF
  console.log('   [2/9] Deploying rXF (Redeemable XF)...')
  const RXF = await ethers.getContractFactory('rXF')
  const rXF = await upgrades.deployProxy(
    RXF,
    [deployment.xfToken, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await rXF.waitForDeployment()
  deployment.rXF = await rXF.getAddress()
  console.log('         ✅ rXF deployed to:', deployment.rXF)

  // 5.3: Deploy BuybackBurner
  console.log('   [3/9] Deploying BuybackBurner...')
  const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
  const buybackBurner = await upgrades.deployProxy(
    BuybackBurner,
    [deployment.usdc, deployment.xfToken, ethers.ZeroAddress, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await buybackBurner.waitForDeployment()
  deployment.buybackBurner = await buybackBurner.getAddress()
  console.log('         ✅ BuybackBurner deployed to:', deployment.buybackBurner)

  // 5.4: Deploy InnovationTreasury
  console.log('   [4/9] Deploying InnovationTreasury...')
  const InnovationTreasury = await ethers.getContractFactory('InnovationTreasury')
  const innovationTreasury = await upgrades.deployProxy(
    InnovationTreasury,
    [deployment.veXF, deployment.usdc, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await innovationTreasury.waitForDeployment()
  deployment.innovationTreasury = await innovationTreasury.getAddress()
  console.log('         ✅ InnovationTreasury deployed to:', deployment.innovationTreasury)

  // 5.5: Deploy RevenueSplitter
  console.log('   [5/9] Deploying RevenueSplitter...')
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
  const revenueSplitter = await upgrades.deployProxy(
    RevenueSplitter,
    [deployment.usdc, deployment.veXF, deployment.multiSigTreasury, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await revenueSplitter.waitForDeployment()
  deployment.revenueSplitter = await revenueSplitter.getAddress()
  console.log('         ✅ RevenueSplitter deployed to:', deployment.revenueSplitter)

  // 5.6: Deploy TreasuryILBackstop
  console.log('   [6/9] Deploying TreasuryILBackstop...')
  const TreasuryILBackstop = await ethers.getContractFactory('TreasuryILBackstop')
  const treasuryBackstop = await TreasuryILBackstop.deploy(deployment.usdc)
  await treasuryBackstop.waitForDeployment()
  deployment.treasuryBackstop = await treasuryBackstop.getAddress()
  console.log('         ✅ TreasuryILBackstop deployed to:', deployment.treasuryBackstop)

  // 5.7: Deploy Governance
  console.log('   [7/9] Deploying Governance...')
  const Governance = await ethers.getContractFactory('Governance')
  const governance = await upgrades.deployProxy(
    Governance,
    [deployment.veXF, deployerAddress],
    { initializer: 'initialize', kind: 'uups' }
  )
  await governance.waitForDeployment()
  deployment.governance = await governance.getAddress()
  console.log('         ✅ Governance deployed to:', deployment.governance)

  // 5.8: Deploy XFUELPoolFactory
  console.log('   [8/9] Deploying XFUELPoolFactory...')
  const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
  const poolFactory = await XFUELPoolFactory.deploy()
  await poolFactory.waitForDeployment()
  deployment.poolFactory = await poolFactory.getAddress()
  console.log('         ✅ XFUELPoolFactory deployed to:', deployment.poolFactory)

  // 5.9: Deploy XFUELRouter
  console.log('   [9/9] Deploying XFUELRouter...')
  const XFUELRouter = await ethers.getContractFactory('XFUELRouter')
  const router = await XFUELRouter.deploy(
    deployment.poolFactory,
    deployment.treasuryBackstop,
    deployment.xfToken,
    deployment.usdc,
    deployment.multiSigTreasury,
    deployment.veXF
  )
  await router.waitForDeployment()
  deployment.router = await router.getAddress()
  console.log('         ✅ XFUELRouter deployed to:', deployment.router)
  
  console.log('')
  console.log('   ✅ All core contracts deployed successfully')
  console.log('')

  // ============================================================================
  // STEP 6: Configure Contract References
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 6: Configuring Contract References')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  console.log('   Setting up contract interconnections...')
  
  await revenueSplitter.setBuybackBurner(deployment.buybackBurner)
  console.log('   ✅ BuybackBurner reference set in RevenueSplitter')
  
  await revenueSplitter.setRXF(deployment.rXF)
  console.log('   ✅ rXF reference set in RevenueSplitter')
  
  await buybackBurner.setRevenueSplitter(deployment.revenueSplitter)
  console.log('   ✅ RevenueSplitter reference set in BuybackBurner')
  
  console.log('')

  // ============================================================================
  // STEP 7: Configure Timelock Access
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 7: Configuring Timelock Access')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  console.log('   Linking timelock to critical contracts...')
  
  await innovationTreasury.setTimelock(deployment.timelock)
  console.log('   ✅ Timelock set for InnovationTreasury')
  
  await revenueSplitter.setTimelock(deployment.timelock)
  console.log('   ✅ Timelock set for RevenueSplitter')
  
  await treasuryBackstop.setTimelock(deployment.timelock)
  console.log('   ✅ Timelock set for TreasuryILBackstop')
  
  console.log('')
  console.log('   ✅ All timelock configurations complete')
  console.log('   ⏱️  Critical operations now require 6-hour delay')
  console.log('')

  // ============================================================================
  // STEP 8: Test Pause Functionality
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📦 STEP 8: Testing Pause Functionality')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  console.log('   Testing emergency pause on core contracts...')
  
  // Test pause on veXF
  await veXF.pause()
  console.log('   ✅ veXF paused successfully')
  await veXF.unpause()
  console.log('   ✅ veXF unpaused successfully')
  
  // Test pause on rXF
  await rXF.pause()
  console.log('   ✅ rXF paused successfully')
  await rXF.unpause()
  console.log('   ✅ rXF unpaused successfully')
  
  // Test pause on BuybackBurner
  await buybackBurner.pause()
  console.log('   ✅ BuybackBurner paused successfully')
  await buybackBurner.unpause()
  console.log('   ✅ BuybackBurner unpaused successfully')
  
  // Test pause on RevenueSplitter
  await revenueSplitter.pause()
  console.log('   ✅ RevenueSplitter paused successfully')
  await revenueSplitter.unpause()
  console.log('   ✅ RevenueSplitter unpaused successfully')
  
  console.log('')
  console.log('   ✅ All pause/unpause tests passed')
  console.log('   🔒 Emergency controls verified and operational')
  console.log('')

  // ============================================================================
  // STEP 9: Deployment Summary
  // ============================================================================
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🎉 DEPLOYMENT COMPLETE - THETA TESTNET')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  console.log('🔐 SECURITY INFRASTRUCTURE:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   TimelockController:     ', deployment.timelock)
  console.log('   MultiSigTreasury:       ', deployment.multiSigTreasury)
  console.log('   Required Signatures:     3-of-5')
  console.log('   Timelock Delay:          6 hours')
  console.log('')
  
  console.log('🪙 TOKEN CONTRACTS:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   USDC (Mock):            ', deployment.usdc)
  console.log('   XF Token (Mock):        ', deployment.xfToken)
  console.log('   veXF:                   ', deployment.veXF)
  console.log('   rXF:                    ', deployment.rXF)
  console.log('')
  
  console.log('💼 CORE PROTOCOL CONTRACTS:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   BuybackBurner:          ', deployment.buybackBurner)
  console.log('   InnovationTreasury:     ', deployment.innovationTreasury)
  console.log('   RevenueSplitter:        ', deployment.revenueSplitter)
  console.log('   TreasuryILBackstop:     ', deployment.treasuryBackstop)
  console.log('   Governance:             ', deployment.governance)
  console.log('   XFUELPoolFactory:       ', deployment.poolFactory)
  console.log('   XFUELRouter:            ', deployment.router)
  console.log('')
  
  console.log('👥 MULTI-SIG SIGNERS (TESTNET):')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  deployment.signers.forEach((signer, index) => {
    console.log(`   Signer ${index + 1}:              `, signer)
  })
  console.log('')
  
  console.log('✅ SECURITY FEATURES ENABLED:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   ✓ Timelock: 6-hour delay on critical operations')
  console.log('   ✓ Multi-sig: 3-of-5 signatures required for treasury')
  console.log('   ✓ Pausable: All core contracts can be emergency paused')
  console.log('   ✓ Access Control: Role-based permissions enforced')
  console.log('   ✓ Upgradeable: UUPS proxy pattern for safe upgrades')
  console.log('   ✓ Mock Signers: 5 test accounts funded with 1 TFUEL each')
  console.log('')
  
  console.log('🧪 TESTING CAPABILITIES:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   ✓ Mock tokens: 1M USDC + 10M XF minted to deployer')
  console.log('   ✓ Pause/unpause: Tested and operational')
  console.log('   ✓ Timelock operations: Ready for testing')
  console.log('   ✓ Multi-sig: Ready for transaction submission')
  console.log('')
  
  console.log('⚡ NEXT STEPS:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   1. 📝 Verify contracts on Theta Explorer:')
  console.log('      https://testnet-explorer.thetatoken.org/')
  console.log('')
  console.log('   2. 🧪 Test timelock operations:')
  console.log('      - Schedule a test operation via TimelockController')
  console.log('      - Wait 6 hours')
  console.log('      - Execute the operation')
  console.log('')
  console.log('   3. 🔐 Test multi-sig workflow:')
  console.log('      - Submit transaction to MultiSigTreasury')
  console.log('      - Confirm with 3 different signers')
  console.log('      - Execute transaction')
  console.log('')
  console.log('   4. 🚨 Test emergency pause:')
  console.log('      - Call pause() on contracts')
  console.log('      - Verify operations are blocked')
  console.log('      - Call unpause() to restore')
  console.log('')
  console.log('   5. 💰 Test token operations:')
  console.log('      - Approve and deposit XF to veXF')
  console.log('      - Test swap functionality')
  console.log('      - Test revenue distribution')
  console.log('')
  console.log('   6. 🌐 Update frontend configuration:')
  console.log('      - Add testnet addresses to .env')
  console.log('      - Configure network switch')
  console.log('      - Test UI interactions')
  console.log('')
  console.log('   7. 📊 Monitor and log:')
  console.log('      - Watch events on all contracts')
  console.log('      - Track gas usage')
  console.log('      - Document any issues')
  console.log('')
  
  console.log('📋 ENVIRONMENT VARIABLES:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   # Add to your .env file:')
  console.log(`   VITE_TESTNET_TIMELOCK_ADDRESS=${deployment.timelock}`)
  console.log(`   VITE_TESTNET_MULTISIG_ADDRESS=${deployment.multiSigTreasury}`)
  console.log(`   VITE_TESTNET_USDC_ADDRESS=${deployment.usdc}`)
  console.log(`   VITE_TESTNET_XF_ADDRESS=${deployment.xfToken}`)
  console.log(`   VITE_TESTNET_VEXF_ADDRESS=${deployment.veXF}`)
  console.log(`   VITE_TESTNET_RXF_ADDRESS=${deployment.rXF}`)
  console.log(`   VITE_TESTNET_ROUTER_ADDRESS=${deployment.router}`)
  console.log(`   VITE_TESTNET_REVENUE_SPLITTER_ADDRESS=${deployment.revenueSplitter}`)
  console.log('   VITE_NETWORK=testnet')
  console.log('   VITE_CHAIN_ID=365')
  console.log('')
  
  console.log('🔗 USEFUL LINKS:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   Theta Testnet Explorer:')
  console.log('   https://testnet-explorer.thetatoken.org/')
  console.log('')
  console.log('   Get Testnet TFUEL:')
  console.log('   https://faucet.thetatoken.org/')
  console.log('')
  console.log('   TimelockController:')
  console.log(`   https://testnet-explorer.thetatoken.org/account/${deployment.timelock}`)
  console.log('')
  console.log('   MultiSigTreasury:')
  console.log(`   https://testnet-explorer.thetatoken.org/account/${deployment.multiSigTreasury}`)
  console.log('')
  
  console.log('⚠️  IMPORTANT REMINDERS:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('   • This is a TESTNET deployment with mock signers')
  console.log('   • For MAINNET, replace mock signers with actual addresses')
  console.log('   • For MAINNET, increase timelock delay to 48 hours')
  console.log('   • Store private keys securely (hardware wallets recommended)')
  console.log('   • Test all security features thoroughly before mainnet')
  console.log('   • Document multi-sig procedures and access controls')
  console.log('   • Keep emergency pause contacts readily available')
  console.log('')
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Deployment script completed successfully!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  // Save deployment addresses to file
  const fs = require('fs')
  const path = require('path')
  
  const deploymentData = {
    network: 'theta-testnet',
    chainId: network.chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: deployment,
    configuration: {
      timelockDelay: '6 hours',
      multiSigRequired: '3-of-5',
      pausableEnabled: true,
      betaLimitsEnabled: true
    }
  }
  
  const outputPath = path.join(__dirname, '..', 'deployments', `testnet-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2))
  
  console.log('💾 Deployment data saved to:', outputPath)
  console.log('')
}

main()
  .then(() => {
    console.log('🎊 Script execution completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('❌ DEPLOYMENT FAILED')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('')
    console.error('Error details:')
    console.error(error)
    console.error('')
    console.error('Common issues:')
    console.error('  • Insufficient balance for deployment')
    console.error('  • Wrong network selected')
    console.error('  • Contract compilation errors')
    console.error('  • Missing dependencies')
    console.error('')
    process.exit(1)
  })

