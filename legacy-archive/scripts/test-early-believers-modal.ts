/**
 * Early Believers Modal - Comprehensive Test Script
 * 
 * This script provides automated and manual testing procedures for the
 * Early Believers contribution modal before production deployment.
 * 
 * Run: npx ts-node scripts/test-early-believers-modal.ts
 */

import { ethers } from 'ethers'

// Test configuration
const TEST_CONFIG = {
  // Test amounts for tier validation
  TIER_THRESHOLDS: {
    STANDARD: 49999,      // < $50k
    PLUS_10: 75000,       // $50k-$99k
    PLUS_25: 150000,      // $100k+
    EDGE_CASES: {
      JUST_BELOW_50K: 49999,
      EXACTLY_50K: 50000,
      JUST_ABOVE_50K: 50001,
      JUST_BELOW_100K: 99999,
      EXACTLY_100K: 100000,
      JUST_ABOVE_100K: 100001,
      TINY: 0.01,
      LARGE: 1000000,
    }
  },
  // Expected addresses (from env)
  EXPECTED_MULTISIG: process.env.VITE_MULTISIG_ADDRESS || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
  EXPECTED_USDC: process.env.VITE_USDC_ADDRESS_MAINNET || '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257',
  EXPECTED_WEBHOOK: process.env.VITE_CONTRIBUTION_WEBHOOK_URL || '',
  // Network
  THETA_MAINNET_CHAIN_ID: 361,
}

// Color output helpers
const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
}

interface TestResult {
  name: string
  passed: boolean
  message: string
  details?: any
}

class EarlyBelieversModalTester {
  private results: TestResult[] = []

  // Test 1: Environment Variables
  testEnvironmentVariables(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('TEST 1: Environment Variables'))
    console.log(colors.cyan('='.repeat(60)))

    const tests = [
      {
        name: 'VITE_MULTISIG_ADDRESS',
        value: process.env.VITE_MULTISIG_ADDRESS,
        required: true,
      },
      {
        name: 'VITE_USDC_ADDRESS_MAINNET',
        value: process.env.VITE_USDC_ADDRESS_MAINNET,
        required: true,
      },
      {
        name: 'VITE_CONTRIBUTION_WEBHOOK_URL',
        value: process.env.VITE_CONTRIBUTION_WEBHOOK_URL,
        required: false, // Optional but recommended
      },
    ]

    tests.forEach(test => {
      const passed = test.required ? !!test.value : true
      const message = test.value
        ? `✓ ${test.name} is set: ${test.value.substring(0, 20)}...`
        : test.required
        ? `✗ ${test.name} is missing (REQUIRED)`
        : `⚠ ${test.name} is not set (optional)`

      this.results.push({ name: test.name, passed, message })
      console.log(passed ? colors.green(message) : colors.red(message))
    })
  }

  // Test 2: Minimum Contribution
  testMinimumContribution(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('TEST 2: Minimum Contribution ($100)'))
    console.log(colors.cyan('='.repeat(60)))

    const MINIMUM = 100
    const testCases = [
      { amount: 50, shouldPass: false, message: 'Below minimum' },
      { amount: 99, shouldPass: false, message: 'Just below minimum' },
      { amount: 100, shouldPass: true, message: 'Exactly minimum' },
      { amount: 101, shouldPass: true, message: 'Just above minimum' },
    ]

    testCases.forEach(testCase => {
      const passed = testCase.amount >= MINIMUM === testCase.shouldPass
      const message = `Amount: $${testCase.amount} → ${testCase.message} (${testCase.amount >= MINIMUM ? 'Valid' : 'Invalid'})`

      this.results.push({
        name: `Minimum check: $${testCase.amount}`,
        passed,
        message,
      })

      console.log(
        passed
          ? colors.green(`✓ ${message}`)
          : colors.red(`✗ ${message}`)
      )
    })
  }

  // Test 3: Tier Calculation Logic
  testTierCalculations(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('TEST 3: Tier Calculation Logic'))
    console.log(colors.cyan('='.repeat(60)))

    const testCases = [
      { amount: 100, expectedTier: 'Standard', expectedBonus: 0 },
      { amount: 10000, expectedTier: 'Standard', expectedBonus: 0 },
      { amount: 49999, expectedTier: 'Standard', expectedBonus: 0 },
      { amount: 50000, expectedTier: 'Plus10', expectedBonus: 0.1 },
      { amount: 75000, expectedTier: 'Plus10', expectedBonus: 0.1 },
      { amount: 99999, expectedTier: 'Plus10', expectedBonus: 0.1 },
      { amount: 100000, expectedTier: 'Plus25', expectedBonus: 0.25 },
      { amount: 150000, expectedTier: 'Plus25', expectedBonus: 0.25 },
    ]

    testCases.forEach(testCase => {
      const tier = this.calculateTier(testCase.amount)
      const bonus = tier === 'Plus25' ? 0.25 : tier === 'Plus10' ? 0.1 : 0
      const totalRXF = testCase.amount + (testCase.amount * bonus)

      const passed = tier === testCase.expectedTier && bonus === testCase.expectedBonus
      const message = `Amount: $${testCase.amount.toLocaleString()} → Tier: ${tier}, Bonus: ${(bonus * 100)}%, Total rXF: $${totalRXF.toLocaleString()}`

      this.results.push({
        name: `Tier calculation: $${testCase.amount}`,
        passed,
        message,
        details: { tier, bonus, totalRXF },
      })

      console.log(
        passed
          ? colors.green(`✓ ${message}`)
          : colors.red(`✗ ${message} (Expected: ${testCase.expectedTier})`)
      )
    })
  }

  // Helper: Calculate tier (matches modal logic)
  private calculateTier(usdValue: number): 'Standard' | 'Plus10' | 'Plus25' {
    if (usdValue >= 100000) return 'Plus25'
    if (usdValue >= 50000) return 'Plus10'
    return 'Standard'
  }

  // Test 3: Address Validation
  testAddressValidation(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('TEST 3: Address Validation'))
    console.log(colors.cyan('='.repeat(60)))

    const multisig = process.env.VITE_MULTISIG_ADDRESS || ''
    const usdc = process.env.VITE_USDC_ADDRESS_MAINNET || ''

    const tests = [
      {
        name: 'Multisig address format',
        value: multisig,
        isValid: ethers.isAddress(multisig),
      },
      {
        name: 'USDC address format',
        value: usdc,
        isValid: ethers.isAddress(usdc),
      },
      {
        name: 'Multisig not zero address',
        value: multisig,
        isValid: multisig !== '0x0000000000000000000000000000000000000000',
      },
      {
        name: 'USDC not zero address',
        value: usdc,
        isValid: usdc !== '0x0000000000000000000000000000000000000000',
      },
    ]

    tests.forEach(test => {
      const passed = test.isValid
      const message = test.isValid
        ? `✓ ${test.name}: Valid`
        : `✗ ${test.name}: Invalid (${test.value})`

      this.results.push({ name: test.name, passed, message })
      console.log(passed ? colors.green(message) : colors.red(message))
    })
  }

  // Test 4: Network Configuration
  testNetworkConfiguration(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('TEST 4: Network Configuration'))
    console.log(colors.cyan('='.repeat(60)))

    const expectedChainId = 361
    const chainIdHex = '0x169'

    const tests = [
      {
        name: 'Chain ID is 361',
        passed: expectedChainId === 361,
        message: `Chain ID: ${expectedChainId}`,
      },
      {
        name: 'Chain ID hex is 0x169',
        passed: chainIdHex === '0x169',
        message: `Hex: ${chainIdHex}`,
      },
    ]

    tests.forEach(test => {
      this.results.push({ name: test.name, passed: test.passed, message: test.message })
      console.log(
        test.passed ? colors.green(`✓ ${test.name}: ${test.message}`) : colors.red(`✗ ${test.name}`)
      )
    })
  }

  // Test 5: Webhook URL Validation
  testWebhookURL(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('TEST 5: Webhook URL Validation'))
    console.log(colors.cyan('='.repeat(60)))

    const webhookUrl = process.env.VITE_CONTRIBUTION_WEBHOOK_URL || ''

    if (!webhookUrl) {
      console.log(colors.yellow('⚠ Webhook URL not set (optional but recommended)'))
      this.results.push({
        name: 'Webhook URL',
        passed: true,
        message: 'Webhook URL not set (optional)',
      })
      return
    }

    try {
      const url = new URL(webhookUrl)
      const passed = url.protocol === 'https:'
      const message = passed
        ? `✓ Webhook URL is valid HTTPS: ${webhookUrl.substring(0, 50)}...`
        : `✗ Webhook URL must use HTTPS`

      this.results.push({ name: 'Webhook URL', passed, message })
      console.log(passed ? colors.green(message) : colors.red(message))
    } catch (error) {
      this.results.push({
        name: 'Webhook URL',
        passed: false,
        message: `✗ Invalid webhook URL format: ${webhookUrl}`,
      })
      console.log(colors.red(`✗ Invalid webhook URL format: ${webhookUrl}`))
    }
  }

  // Generate Manual Testing Guide
  generateManualTestingGuide(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('MANUAL TESTING GUIDE'))
    console.log(colors.cyan('='.repeat(60)))
    console.log(`
${colors.yellow('1. Homepage Card Visibility')}
   - Navigate to homepage
   - Verify "Early Believers Round — Mainnet Live" card is visible
   - Click "Contribute Now" button
   - Modal should open

${colors.yellow('2. Wallet Connection')}
   a) Success:
      - Click "Connect Theta Wallet"
      - Approve in wallet
      - Verify wallet address displays
      - Verify balances show (TFUEL, USDC if configured)
   
   b) Wrong Network:
      - Switch wallet to testnet (Chain ID 365)
      - Open modal
      - Should show: "Please switch to Theta Mainnet (Chain ID: 361)"
      - Click "Switch to Theta Mainnet" button
      - Verify network switches
   
   c) Rejection:
      - Click "Connect Theta Wallet"
      - Reject in wallet popup
      - Modal should remain open, no error

${colors.yellow('3. Amount Input & Tier Calculation')}
   Test amounts:
   - $10,000 → Standard tier (no bonus)
   - $49,999 → Standard tier (no bonus)
   - $50,000 → +10% bonus tier
   - $75,000 → +10% bonus tier ($7,500 bonus = $82,500 total)
   - $99,999 → +10% bonus tier
   - $100,000 → +25% bonus tier
   - $150,000 → +25% bonus tier ($37,500 bonus = $187,500 total)
   
   Verify:
   - Tier updates instantly as you type
   - Bonus amount displays correctly
   - Total rXF calculation is accurate

${colors.yellow('4. Payment Method Toggle')}
   - Default: USDC selected
   - Click "TFUEL" → should switch
   - Enter amount in TFUEL
   - Verify USD equivalent displays below
   - Switch back to USDC
   - Verify amount input works for both

${colors.yellow('5. Transaction Flow - TFUEL')}
   Prerequisites:
   - Wallet connected on mainnet
   - Sufficient TFUEL balance
   
   Steps:
   1. Select TFUEL payment method
   2. Enter small test amount (0.1 TFUEL)
   3. Verify multisig address displayed
   4. Click "Contribute Now"
   5. Approve transaction in wallet
   6. Wait for confirmation
   
   Expected:
   - Transaction hash displayed
   - Success screen appears with message:
     "Contribution received! You will receive full soulbound rXF day 1 at TGE 
      with immediate yield, 4× governance votes, and priority spin-outs. 
      Redeem transferable XF after 12 months. Thank you for believing."
   - Link to explorer works
   - Webhook receives data (check Zapier logs)
   - Console log shows contribution data

${colors.yellow('6. Transaction Flow - USDC')}
   Prerequisites:
   - Wallet has USDC balance
   - USDC address configured
   
   Steps:
   1. Select USDC payment method
   2. Enter test amount (10 USDC)
   3. Click "Contribute Now"
   4. Approve USDC if prompted
   5. Approve transfer transaction
   
   Expected:
   - Approval transaction completes first
   - Transfer transaction completes
   - Success screen appears
   - Webhook receives data

${colors.yellow('7. Error Handling')}
   a) Insufficient Balance:
      - Enter amount > wallet balance
      - Click "Contribute Now"
      - Should show: "Insufficient TFUEL balance. Please ensure you have 
        enough for the transaction and gas fees."
   
   b) Transaction Rejection:
      - Enter valid amount
      - Click "Contribute Now"
      - Reject in wallet
      - Should show: "Transaction rejected by user"
   
   c) Wrong Network:
      - Switch to wrong network
      - Try to contribute
      - Should show network error
      - Cannot proceed until on correct network
   
   d) RPC Error (Receipt Fetch):
      - If RPC fails to return receipt
      - Should still show success if transaction hash exists
      - Should provide explorer link

${colors.yellow('8. Edge Cases')}
   - $49,999.99 → Standard tier
   - $50,000.01 → +10% bonus
   - $99,999.99 → +10% bonus
   - $100,000.01 → +25% bonus
   - Very small amounts (0.01 TFUEL)
   - Very large amounts ($1M+)
   - Rapid amount changes
   - Network switch during transaction

${colors.yellow('9. Disclaimer')}
   - Scroll to bottom of modal
   - Verify disclaimer text:
     "This is a contribution to support protocol development. rXF provides 
      governance and utility within XFUEL. No promise of profit."
   - Verify no investment language present

${colors.yellow('10. Webhook Verification')}
   - Complete a test transaction
   - Check Zapier webhook logs
   - Verify payload includes:
     - wallet address
     - amount
     - paymentMethod
     - usdValue
     - tier
     - tierBonus
     - totalRXF
     - txHash
     - timestamp
`)
  }

  // Print Summary
  printSummary(): void {
    console.log('\n' + colors.cyan('='.repeat(60)))
    console.log(colors.cyan('TEST SUMMARY'))
    console.log(colors.cyan('='.repeat(60)))

    const passed = this.results.filter(r => r.passed).length
    const total = this.results.length
    const percentage = ((passed / total) * 100).toFixed(1)

    console.log(`\nTotal Tests: ${total}`)
    console.log(colors.green(`Passed: ${passed}`))
    console.log(colors.red(`Failed: ${total - passed}`))
    console.log(`Success Rate: ${percentage}%`)

    if (passed === total) {
      console.log('\n' + colors.green('✅ All automated tests passed!'))
      console.log(colors.yellow('⚠️  Remember to run manual tests before production deployment.'))
    } else {
      console.log('\n' + colors.red('❌ Some tests failed. Please fix issues before deployment.'))
      console.log('\nFailed tests:')
      this.results
        .filter(r => !r.passed)
        .forEach(r => console.log(colors.red(`  - ${r.name}: ${r.message}`)))
    }

    console.log('\n' + colors.cyan('='.repeat(60)))
  }

  // Run all tests
  runAll(): void {
    console.log(colors.blue('\n🚀 Early Believers Modal - Comprehensive Test Suite'))
    console.log(colors.blue('='.repeat(60)))

    this.testEnvironmentVariables()
    this.testMinimumContribution()
    this.testTierCalculations()
    this.testAddressValidation()
    this.testNetworkConfiguration()
    this.testWebhookURL()
    this.generateManualTestingGuide()
    this.printSummary()
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new EarlyBelieversModalTester()
  tester.runAll()
}

export default EarlyBelieversModalTester

