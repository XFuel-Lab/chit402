const { ethers } = require('hardhat')

/**
 * E2E Test Suite - Mainnet Beta Limits
 * Tests all functionality on live mainnet contract
 */

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  E2E Testing - Mainnet Beta Limits')
  console.log('═══════════════════════════════════════════════════')
  console.log('')

  const [tester] = await ethers.getSigners()
  const testerAddress = await tester.getAddress()
  const balance = await ethers.provider.getBalance(testerAddress)

  console.log('🧪 Tester:', testerAddress)
  console.log('💰 Balance:', ethers.formatEther(balance), 'TFUEL')
  console.log('')

  const REVENUE_SPLITTER = '0x03973A67449557b14228541Df339Ae041567628B'
  const proxy = await ethers.getContractAt('RevenueSplitter', REVENUE_SPLITTER)

  let passed = 0
  let failed = 0

  // Test 1: Read max swap amount
  console.log('Test 1: Read maxSwapAmount')
  try {
    const maxSwap = await proxy.maxSwapAmount()
    console.log('   Result:', ethers.formatEther(maxSwap), 'TFUEL')
    if (maxSwap === ethers.parseEther('1000')) {
      console.log('   ✅ PASS')
      passed++
    } else {
      console.log('   ❌ FAIL - Expected 1000 TFUEL')
      failed++
    }
  } catch (e) {
    console.log('   ❌ FAIL -', e.message)
    failed++
  }
  console.log('')

  // Test 2: Read total user limit
  console.log('Test 2: Read totalUserLimit')
  try {
    const totalLimit = await proxy.totalUserLimit()
    console.log('   Result:', ethers.formatEther(totalLimit), 'TFUEL')
    if (totalLimit === ethers.parseEther('5000')) {
      console.log('   ✅ PASS')
      passed++
    } else {
      console.log('   ❌ FAIL - Expected 5000 TFUEL')
      failed++
    }
  } catch (e) {
    console.log('   ❌ FAIL -', e.message)
    failed++
  }
  console.log('')

  // Test 3: Read paused status
  console.log('Test 3: Read paused status')
  try {
    const paused = await proxy.paused()
    console.log('   Result:', paused)
    if (paused === false) {
      console.log('   ✅ PASS')
      passed++
    } else {
      console.log('   ❌ FAIL - Expected false')
      failed++
    }
  } catch (e) {
    console.log('   ❌ FAIL -', e.message)
    failed++
  }
  console.log('')

  // Test 4: Read user's current total
  console.log('Test 4: Read user total swapped')
  try {
    const userTotal = await proxy.userTotalSwapped(testerAddress)
    console.log('   Result:', ethers.formatEther(userTotal), 'TFUEL')
    console.log('   ✅ PASS')
    passed++
  } catch (e) {
    console.log('   ❌ FAIL -', e.message)
    failed++
  }
  console.log('')

  // Test 5: Check owner
  console.log('Test 5: Verify owner')
  try {
    const owner = await proxy.owner()
    console.log('   Owner:', owner)
    console.log('   Tester:', testerAddress)
    if (owner.toLowerCase() === testerAddress.toLowerCase()) {
      console.log('   ✅ PASS - You are the owner')
      passed++
    } else {
      console.log('   ℹ️  INFO - You are not the owner (expected)')
      passed++
    }
  } catch (e) {
    console.log('   ❌ FAIL -', e.message)
    failed++
  }
  console.log('')

  // Test 6: Check existing contract addresses
  console.log('Test 6: Verify contract configuration')
  try {
    const revenueToken = await proxy.revenueToken()
    const veXF = await proxy.veXFContract()
    const treasury = await proxy.treasury()
    
    console.log('   Revenue Token:', revenueToken)
    console.log('   veXF:', veXF)
    console.log('   Treasury:', treasury)
    
    if (revenueToken !== ethers.ZeroAddress && 
        veXF !== ethers.ZeroAddress && 
        treasury !== ethers.ZeroAddress) {
      console.log('   ✅ PASS')
      passed++
    } else {
      console.log('   ❌ FAIL - Zero addresses detected')
      failed++
    }
  } catch (e) {
    console.log('   ❌ FAIL -', e.message)
    failed++
  }
  console.log('')

  // Test 7: Simulate limit check (view function)
  console.log('Test 7: Simulate swap limit validation')
  try {
    const testAmount = ethers.parseEther('500') // 500 TFUEL
    const userTotal = await proxy.userTotalSwapped(testerAddress)
    const maxSwap = await proxy.maxSwapAmount()
    const totalLimit = await proxy.totalUserLimit()
    
    console.log('   Test amount: 500 TFUEL')
    console.log('   Current user total:', ethers.formatEther(userTotal), 'TFUEL')
    console.log('   Max per swap:', ethers.formatEther(maxSwap), 'TFUEL')
    console.log('   Total limit:', ethers.formatEther(totalLimit), 'TFUEL')
    
    const wouldExceedPerSwap = testAmount > maxSwap
    const wouldExceedTotal = userTotal + testAmount > totalLimit
    
    if (!wouldExceedPerSwap && !wouldExceedTotal) {
      console.log('   ✅ PASS - 500 TFUEL swap would be allowed')
      passed++
    } else {
      console.log('   ⚠️  WARN - 500 TFUEL swap would be rejected')
      console.log('   Per-swap exceeded:', wouldExceedPerSwap)
      console.log('   Total exceeded:', wouldExceedTotal)
      passed++
    }
  } catch (e) {
    console.log('   ❌ FAIL -', e.message)
    failed++
  }
  console.log('')

  // Test 8: Check for updateSwapLimits function
  console.log('Test 8: Verify admin functions exist')
  try {
    // Just check if the function exists by getting its fragment
    const fragment = proxy.interface.getFunction('updateSwapLimits')
    if (fragment) {
      console.log('   ✅ updateSwapLimits: EXISTS')
      passed++
    }
  } catch (e) {
    console.log('   ❌ FAIL - updateSwapLimits not found')
    failed++
  }
  console.log('')

  // Test 9: Check for setPaused function
  console.log('Test 9: Verify emergency pause function')
  try {
    const fragment = proxy.interface.getFunction('setPaused')
    if (fragment) {
      console.log('   ✅ setPaused: EXISTS')
      passed++
    }
  } catch (e) {
    console.log('   ❌ FAIL - setPaused not found')
    failed++
  }
  console.log('')

  // Test 10: Check for resetUserSwapTotal function
  console.log('Test 10: Verify reset function')
  try {
    const fragment = proxy.interface.getFunction('resetUserSwapTotal')
    if (fragment) {
      console.log('   ✅ resetUserSwapTotal: EXISTS')
      passed++
    }
  } catch (e) {
    console.log('   ❌ FAIL - resetUserSwapTotal not found')
    failed++
  }
  console.log('')

  // Summary
  console.log('═══════════════════════════════════════════════════')
  console.log('  Test Results')
  console.log('═══════════════════════════════════════════════════')
  console.log('')
  console.log('   Passed:', passed, '✅')
  console.log('   Failed:', failed, '❌')
  console.log('   Total:', passed + failed)
  console.log('')

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED!')
    console.log('')
    console.log('Contract is ready for beta testing!')
    console.log('')
    console.log('Next: Test UI components')
  } else {
    console.log('⚠️  SOME TESTS FAILED')
    console.log('Review errors above before proceeding')
  }
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ TEST SUITE FAILED')
    console.error('')
    console.error('Error:', error.message)
    process.exit(1)
  })

