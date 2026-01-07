import { ethers } from 'hardhat'

/**
 * Example Script: Interacting with Testnet Security Contracts
 * 
 * This script demonstrates how to interact with the deployed
 * security infrastructure on Theta Testnet:
 * - TimelockController operations
 * - MultiSigTreasury transactions
 * - Emergency pause/unpause
 * - Token operations
 */

// Replace these with your actual deployment addresses
const DEPLOYMENT = {
  timelock: '0x...', // Your TimelockController address
  multiSigTreasury: '0x...', // Your MultiSigTreasury address
  veXF: '0x...', // Your veXF address
  xfToken: '0x...', // Your XF Token address
  revenueSplitter: '0x...', // Your RevenueSplitter address
}

async function main() {
  console.log('🧪 Testing Theta Testnet Security Features')
  console.log('==========================================')
  console.log('')

  const [signer] = await ethers.getSigners()
  const signerAddress = await signer.getAddress()
  
  console.log('👤 Connected as:', signerAddress)
  console.log('')

  // ============================================================================
  // Example 1: Schedule a Timelock Operation
  // ============================================================================
  console.log('📋 Example 1: Scheduling Timelock Operation')
  console.log('──────────────────────────────────────────')
  console.log('')

  const timelock = await ethers.getContractAt('XFuelTimelock', DEPLOYMENT.timelock)
  
  // Example: Schedule a pause operation on RevenueSplitter
  const revenueSplitter = await ethers.getContractAt('RevenueSplitter', DEPLOYMENT.revenueSplitter)
  
  const target = DEPLOYMENT.revenueSplitter
  const value = 0
  const data = revenueSplitter.interface.encodeFunctionData('pause', [])
  const predecessor = ethers.ZeroHash
  const salt = ethers.id(`pause-operation-${Date.now()}`)
  const delay = await timelock.getMinDelay()
  
  console.log('   Target:', target)
  console.log('   Function: pause()')
  console.log('   Delay:', (Number(delay) / 3600).toFixed(1), 'hours')
  console.log('')
  
  try {
    const scheduleTx = await timelock.schedule(target, value, data, predecessor, salt, delay)
    await scheduleTx.wait()
    console.log('   ✅ Operation scheduled successfully')
    console.log('   Transaction:', scheduleTx.hash)
    console.log('   ⏰ Can be executed after delay expires')
    console.log('')
    
    // To execute later (after delay):
    // await timelock.execute(target, value, data, predecessor, salt)
  } catch (error: any) {
    console.log('   ❌ Error:', error.message)
    console.log('')
  }

  // ============================================================================
  // Example 2: Submit Multi-Sig Transaction
  // ============================================================================
  console.log('📋 Example 2: Multi-Sig Transaction')
  console.log('──────────────────────────────────')
  console.log('')

  const multiSig = await ethers.getContractAt('MultiSigTreasury', DEPLOYMENT.multiSigTreasury)
  
  // Example: Submit a transaction to withdraw tokens
  const withdrawAmount = ethers.parseUnits('100', 6) // 100 USDC
  const withdrawData = '0x' // Empty data for ETH transfer
  
  console.log('   Submitting transaction to multi-sig...')
  console.log('   Amount: 100 USDC')
  console.log('')
  
  try {
    const submitTx = await multiSig.submitTransaction(
      signerAddress, // recipient
      0, // value (0 for token transfer)
      withdrawData
    )
    const receipt = await submitTx.wait()
    
    // Get transaction ID from event
    const txId = receipt?.logs[0].topics[1]
    
    console.log('   ✅ Transaction submitted')
    console.log('   Transaction ID:', txId)
    console.log('   Transaction Hash:', submitTx.hash)
    console.log('   ⚠️  Requires 3 confirmations to execute')
    console.log('')
    
    // To confirm (requires 3 different signers):
    // await multiSig.connect(signer1).confirmTransaction(txId)
    // await multiSig.connect(signer2).confirmTransaction(txId)
    // await multiSig.connect(signer3).confirmTransaction(txId)
  } catch (error: any) {
    console.log('   ❌ Error:', error.message)
    console.log('')
  }

  // ============================================================================
  // Example 3: Emergency Pause
  // ============================================================================
  console.log('📋 Example 3: Emergency Pause/Unpause')
  console.log('──────────────────────────────────────')
  console.log('')

  console.log('   Testing pause functionality...')
  
  try {
    // Check current pause status
    const isPaused = await revenueSplitter.paused()
    console.log('   Current status:', isPaused ? 'PAUSED' : 'ACTIVE')
    console.log('')
    
    if (!isPaused) {
      // Pause the contract
      console.log('   Pausing contract...')
      const pauseTx = await revenueSplitter.pause()
      await pauseTx.wait()
      console.log('   ✅ Contract paused')
      console.log('   Transaction:', pauseTx.hash)
      console.log('')
      
      // Unpause immediately for testing
      console.log('   Unpausing contract...')
      const unpauseTx = await revenueSplitter.unpause()
      await unpauseTx.wait()
      console.log('   ✅ Contract unpaused')
      console.log('   Transaction:', unpauseTx.hash)
    } else {
      console.log('   ℹ️  Contract is already paused')
    }
    console.log('')
  } catch (error: any) {
    console.log('   ❌ Error:', error.message)
    console.log('')
  }

  // ============================================================================
  // Example 4: Token Operations
  // ============================================================================
  console.log('📋 Example 4: Token Operations')
  console.log('───────────────────────────────')
  console.log('')

  const xfToken = await ethers.getContractAt('MockERC20', DEPLOYMENT.xfToken)
  const veXF = await ethers.getContractAt('veXF', DEPLOYMENT.veXF)
  
  console.log('   Checking token balances...')
  
  try {
    const xfBalance = await xfToken.balanceOf(signerAddress)
    console.log('   XF Balance:', ethers.formatEther(xfBalance), 'XF')
    console.log('')
    
    // Example: Create a veXF lock
    const lockAmount = ethers.parseEther('100')
    const lockDuration = 365 * 24 * 60 * 60 // 1 year in seconds
    
    if (xfBalance >= lockAmount) {
      console.log('   Creating veXF lock...')
      console.log('   Amount:', ethers.formatEther(lockAmount), 'XF')
      console.log('   Duration: 1 year')
      console.log('')
      
      // Approve XF spending
      const approveTx = await xfToken.approve(DEPLOYMENT.veXF, lockAmount)
      await approveTx.wait()
      console.log('   ✅ Approved XF spending')
      
      // Create lock
      const lockTx = await veXF.createLock(lockAmount, lockDuration)
      await lockTx.wait()
      console.log('   ✅ veXF lock created')
      console.log('   Transaction:', lockTx.hash)
      console.log('')
      
      // Check veXF balance
      const veXFBalance = await veXF.balanceOf(signerAddress)
      console.log('   veXF Balance:', ethers.formatEther(veXFBalance))
    } else {
      console.log('   ⚠️  Insufficient XF balance for lock')
    }
    console.log('')
  } catch (error: any) {
    console.log('   ❌ Error:', error.message)
    console.log('')
  }

  // ============================================================================
  // Example 5: Query Contract State
  // ============================================================================
  console.log('📋 Example 5: Query Contract State')
  console.log('───────────────────────────────────')
  console.log('')

  try {
    // Query timelock info
    console.log('   TimelockController Info:')
    const minDelay = await timelock.getMinDelay()
    console.log('   - Min Delay:', (Number(minDelay) / 3600).toFixed(1), 'hours')
    console.log('')
    
    // Query multi-sig info
    console.log('   MultiSigTreasury Info:')
    const required = await multiSig.required()
    const ownerCount = await multiSig.getOwnerCount()
    console.log('   - Required Signatures:', required.toString())
    console.log('   - Total Owners:', ownerCount.toString())
    console.log('')
    
    // Query pause status of all contracts
    console.log('   Contract Pause Status:')
    const veXFPaused = await veXF.paused()
    const splitterPaused = await revenueSplitter.paused()
    console.log('   - veXF:', veXFPaused ? 'PAUSED' : 'ACTIVE')
    console.log('   - RevenueSplitter:', splitterPaused ? 'PAUSED' : 'ACTIVE')
    console.log('')
  } catch (error: any) {
    console.log('   ❌ Error:', error.message)
    console.log('')
  }

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Testing Complete')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  console.log('📝 Examples Covered:')
  console.log('   ✓ Timelock operation scheduling')
  console.log('   ✓ Multi-sig transaction submission')
  console.log('   ✓ Emergency pause/unpause')
  console.log('   ✓ Token operations (approve, lock)')
  console.log('   ✓ Contract state queries')
  console.log('')
  console.log('🔗 Useful Links:')
  console.log('   Theta Testnet Explorer:')
  console.log('   https://testnet-explorer.thetatoken.org/')
  console.log('')
  console.log('   TimelockController:')
  console.log(`   https://testnet-explorer.thetatoken.org/account/${DEPLOYMENT.timelock}`)
  console.log('')
  console.log('   MultiSigTreasury:')
  console.log(`   https://testnet-explorer.thetatoken.org/account/${DEPLOYMENT.multiSigTreasury}`)
  console.log('')
  console.log('📖 For more information, see:')
  console.log('   scripts/TESTNET_DEPLOYMENT_GUIDE.md')
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ Error during testing:')
    console.error(error)
    console.error('')
    process.exit(1)
  })

