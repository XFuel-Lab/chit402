const hre = require('hardhat')
const ethers = require('ethers')

/**
 * Verification script for deployed RevSplitterHybrid
 * Checks configuration, runs basic tests, validates setup
 * 
 * Usage: REVSPLITTER_ADDRESS=0x... node scripts/verify-revsplitter.cjs
 */

async function main() {
  console.log('🔍 RevSplitterHybrid Verification Script\n')

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
  const fs = require('fs')
  const keystoreJson = fs.readFileSync(KEYSTORE_PATH, 'utf8')
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, KEYSTORE_PASSWORD)
  
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const signer = wallet.connect(provider)

  console.log('📝 Verifier:', signer.address)
  console.log('📍 Contract:', REVSPLITTER_ADDRESS)
  console.log('')

  const RevSplitterHybrid = await hre.ethers.getContractFactory('RevSplitterHybrid', signer)
  const revSplitter = RevSplitterHybrid.attach(REVSPLITTER_ADDRESS)

  let checks = {
    passed: 0,
    failed: 0,
    warnings: 0
  }

  // Check 1: Contract exists
  console.log('✓ Checking contract exists...')
  const code = await provider.getCode(REVSPLITTER_ADDRESS)
  if (code === '0x') {
    console.log('  ❌ FAILED: No contract deployed at address')
    checks.failed++
    return
  }
  console.log('  ✅ Contract exists')
  checks.passed++

  // Check 2: Innovation Treasury
  console.log('\n✓ Checking Innovation Treasury...')
  const innovationTreasury = await revSplitter.innovationTreasuryAddr()
  const EXPECTED_INNOVATION = '0x043d5231651379970d52a13CEfB4e80733DDb989'
  if (innovationTreasury.toLowerCase() === EXPECTED_INNOVATION.toLowerCase()) {
    console.log('  ✅ Correct:', innovationTreasury)
    checks.passed++
  } else {
    console.log('  ❌ FAILED: Expected', EXPECTED_INNOVATION)
    console.log('            Got', innovationTreasury)
    checks.failed++
  }

  // Check 3: LP Treasury
  console.log('\n✓ Checking LP Treasury...')
  const lpTreasury = await revSplitter.lpTreasuryAddr()
  const EXPECTED_LP = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'
  if (lpTreasury === EXPECTED_LP) {
    console.log('  ✅ Correct:', lpTreasury)
    checks.passed++
  } else {
    console.log('  ❌ FAILED: Expected', EXPECTED_LP)
    console.log('            Got', lpTreasury)
    checks.failed++
  }

  // Check 4: Revenue Token
  console.log('\n✓ Checking Revenue Token...')
  const revenueToken = await revSplitter.revenueToken()
  if (revenueToken === ethers.ZeroAddress) {
    console.log('  ❌ FAILED: Revenue token is zero address')
    checks.failed++
  } else {
    console.log('  ✅ Set:', revenueToken)
    checks.passed++
  }

  // Check 5: BBB Contract
  console.log('\n✓ Checking BBB Contract...')
  const bbbContract = await revSplitter.bbbContract()
  if (bbbContract === ethers.ZeroAddress) {
    console.log('  ❌ FAILED: BBB contract is zero address')
    checks.failed++
  } else if (bbbContract === signer.address) {
    console.log('  ⚠️  WARNING: BBB is placeholder (deployer address)')
    console.log('     Update with: await revSplitter.setBBBContract("0x...")')
    checks.warnings++
  } else {
    console.log('  ✅ Set:', bbbContract)
    checks.passed++
  }

  // Check 6: veXF Distributor
  console.log('\n✓ Checking veXF Distributor...')
  const veXFDistributor = await revSplitter.veXFYieldsDistributor()
  if (veXFDistributor === ethers.ZeroAddress) {
    console.log('  ❌ FAILED: veXF distributor is zero address')
    checks.failed++
  } else if (veXFDistributor === signer.address) {
    console.log('  ⚠️  WARNING: Distributor is placeholder (deployer address)')
    console.log('     Update with: await revSplitter.setVeXFYieldsDistributor("0x...")')
    checks.warnings++
  } else {
    console.log('  ✅ Set:', veXFDistributor)
    checks.passed++
  }

  // Check 7: Axelar Adapter
  console.log('\n✓ Checking Axelar Bridge Adapter...')
  const axelarAdapter = await revSplitter.axelarBridgeAdapter()
  if (axelarAdapter === ethers.ZeroAddress) {
    console.log('  ⚠️  WARNING: Axelar adapter not set (LP funding will accumulate)')
    console.log('     Set with: await revSplitter.setAxelarBridgeAdapter("0x...")')
    checks.warnings++
  } else {
    console.log('  ✅ Set:', axelarAdapter)
    checks.passed++
  }

  // Check 8: Owner
  console.log('\n✓ Checking Owner...')
  const owner = await revSplitter.owner()
  console.log('  ℹ️  Owner:', owner)
  if (owner === signer.address) {
    console.log('  ✅ You are the owner')
    checks.passed++
  } else {
    console.log('  ⚠️  WARNING: You are not the owner (read-only access)')
    checks.warnings++
  }

  // Check 9: Governance Hook
  console.log('\n✓ Checking Governance Hook...')
  const [diversionBps, recipient, active] = await revSplitter.getGovernanceHookConfig()
  console.log('  Diversion:', (Number(diversionBps) / 100).toFixed(2) + '%')
  console.log('  Recipient:', recipient || '(not set)')
  console.log('  Active:', active)
  if (active && (diversionBps < 500 || diversionBps > 1000)) {
    console.log('  ❌ FAILED: Invalid diversion (must be 5-10%)')
    checks.failed++
  } else {
    console.log('  ✅ Valid configuration')
    checks.passed++
  }

  // Check 10: Split calculations
  console.log('\n✓ Checking Split Calculations...')
  const testAmount = ethers.parseUnits('10000', 6)
  const [bbb, lp, veXF, innovation, governance] = await revSplitter.calculateSplits(testAmount)
  
  const expectedBBB = ethers.parseUnits('3000', 6)
  const expectedVeXF = ethers.parseUnits('2500', 6)
  const expectedInnovation = ethers.parseUnits('1500', 6)
  
  if (bbb === expectedBBB && veXF === expectedVeXF && innovation === expectedInnovation) {
    console.log('  ✅ Split calculations correct')
    console.log('     BBB: 3,000 USDC (30%)')
    console.log('     LP: ' + ethers.formatUnits(lp, 6) + ' USDC (28.5-30%)')
    console.log('     veXF: 2,500 USDC (25%)')
    console.log('     Innovation: 1,500 USDC (15%)')
    if (governance > 0n) {
      console.log('     Governance: ' + ethers.formatUnits(governance, 6) + ' USDC')
    }
    checks.passed++
  } else {
    console.log('  ❌ FAILED: Split calculations incorrect')
    checks.failed++
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('📊 VERIFICATION SUMMARY')
  console.log('═'.repeat(60))
  console.log('✅ Passed:', checks.passed)
  console.log('❌ Failed:', checks.failed)
  console.log('⚠️  Warnings:', checks.warnings)
  console.log('')

  if (checks.failed === 0) {
    console.log('🎉 ALL CRITICAL CHECKS PASSED!')
    if (checks.warnings > 0) {
      console.log('⚠️  Note: There are ' + checks.warnings + ' warnings to address')
    }
  } else {
    console.log('❌ VERIFICATION FAILED - Please fix errors above')
    process.exit(1)
  }

  // Statistics
  console.log('\n' + '─'.repeat(60))
  console.log('📈 CONTRACT STATISTICS')
  console.log('─'.repeat(60))
  
  const totalRevenue = await revSplitter.totalRevenueCollected()
  const totalBBB = await revSplitter.totalBBBAllocated()
  const totalLP = await revSplitter.totalLPFundingAllocated()
  const totalVeXF = await revSplitter.totalVeXFYieldsAllocated()
  const totalInnovation = await revSplitter.totalInnovationTreasuryAllocated()
  const totalGovernance = await revSplitter.totalGovernanceDiverted()
  const pendingLP = await revSplitter.getPendingLPFunding()

  console.log('Total Revenue:', ethers.formatUnits(totalRevenue, 6), 'USDC')
  console.log('  BBB Allocated:', ethers.formatUnits(totalBBB, 6), 'USDC')
  console.log('  LP Allocated:', ethers.formatUnits(totalLP, 6), 'USDC')
  console.log('  veXF Allocated:', ethers.formatUnits(totalVeXF, 6), 'USDC')
  console.log('  Innovation Allocated:', ethers.formatUnits(totalInnovation, 6), 'USDC')
  console.log('  Governance Diverted:', ethers.formatUnits(totalGovernance, 6), 'USDC')
  console.log('')
  console.log('Pending LP Funding:', ethers.formatUnits(pendingLP, 6), 'USDC')

  // Next steps
  if (checks.warnings > 0 || checks.failed > 0) {
    console.log('\n' + '─'.repeat(60))
    console.log('📋 NEXT STEPS')
    console.log('─'.repeat(60))
    
    if (bbbContract === signer.address) {
      console.log('1. Update BBB contract:')
      console.log('   await revSplitter.setBBBContract("0xActualBBBAddress")')
    }
    
    if (veXFDistributor === signer.address) {
      console.log('2. Update veXF distributor:')
      console.log('   await revSplitter.setVeXFYieldsDistributor("0xActualDistributorAddress")')
    }
    
    if (axelarAdapter === ethers.ZeroAddress) {
      console.log('3. Set Axelar bridge adapter:')
      console.log('   await revSplitter.setAxelarBridgeAdapter("0xAxelarAdapterAddress")')
    }
    
    console.log('\nRun verification again after updates.')
  }

  console.log('\n✅ Verification complete!')
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ Verification error:', error.message)
      console.error(error)
      process.exit(1)
    })
}

module.exports = { main }



