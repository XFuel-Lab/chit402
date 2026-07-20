const { ethers } = require('hardhat')

/**
 * @title Deploy Theta EVM Bridge Vault System
 * @notice Deploys VaultFactory contract with configured admin and RevenueSplitter
 * @dev Run with: npx hardhat run scripts/deploy-vault-factory.cjs --network theta-testnet
 */
async function main() {
  console.log('🚀 Starting Theta EVM Bridge Vault System Deployment...\n')

  const [deployer] = await ethers.getSigners()
  console.log('📝 Deploying contracts with account:', deployer.address)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log('💰 Account balance:', ethers.formatEther(balance), 'TFUEL\n')

  // Configuration - Update these addresses for your deployment
  const ADMIN_ADDRESS = deployer.address // Change to multisig in production
  const REV_SPLITTER_ADDRESS = process.env.REV_SPLITTER_ADDRESS || deployer.address

  console.log('⚙️  Configuration:')
  console.log('   Admin Address:', ADMIN_ADDRESS)
  console.log('   RevenueSplitter Address:', REV_SPLITTER_ADDRESS)
  console.log('')

  // Validate addresses
  if (!ethers.isAddress(ADMIN_ADDRESS)) {
    throw new Error('Invalid admin address')
  }
  if (!ethers.isAddress(REV_SPLITTER_ADDRESS)) {
    throw new Error('Invalid RevenueSplitter address')
  }

  // Deploy VaultFactory
  console.log('📦 Deploying VaultFactory...')
  const VaultFactory = await ethers.getContractFactory('VaultFactory')
  const factory = await VaultFactory.deploy(ADMIN_ADDRESS, REV_SPLITTER_ADDRESS)

  await factory.waitForDeployment()
  const factoryAddress = await factory.getAddress()

  console.log('✅ VaultFactory deployed to:', factoryAddress)
  console.log('')

  // Verify deployment
  console.log('🔍 Verifying deployment...')
  const revSplitter = await factory.getRevSplitter()
  const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE()
  const PAUSER_ROLE = await factory.PAUSER_ROLE()
  const hasAdminRole = await factory.hasRole(DEFAULT_ADMIN_ROLE, ADMIN_ADDRESS)
  const hasPauserRole = await factory.hasRole(PAUSER_ROLE, ADMIN_ADDRESS)

  console.log('   RevenueSplitter configured:', revSplitter)
  console.log('   Admin has DEFAULT_ADMIN_ROLE:', hasAdminRole)
  console.log('   Admin has PAUSER_ROLE:', hasPauserRole)
  console.log('')

  // Test vault creation prediction
  console.log('🧪 Testing vault address prediction...')
  const testUserAddress = deployer.address
  const testNonce = 0
  const testSalt = await factory.generateSalt(testUserAddress, testNonce)
  const predictedVaultAddress = await factory.predictAddress(testSalt)

  console.log('   Test user address:', testUserAddress)
  console.log('   Test nonce:', testNonce)
  console.log('   Generated salt:', testSalt)
  console.log('   Predicted vault address:', predictedVaultAddress)
  console.log('')

  // Deployment summary
  console.log('=' .repeat(70))
  console.log('📋 DEPLOYMENT SUMMARY')
  console.log('=' .repeat(70))
  console.log('Network:', (await ethers.provider.getNetwork()).name)
  console.log('Chain ID:', (await ethers.provider.getNetwork()).chainId)
  console.log('Deployer:', deployer.address)
  console.log('VaultFactory:', factoryAddress)
  console.log('RevenueSplitter:', revSplitter)
  console.log('Admin:', ADMIN_ADDRESS)
  console.log('=' .repeat(70))
  console.log('')

  // Usage instructions
  console.log('📚 USAGE INSTRUCTIONS')
  console.log('=' .repeat(70))
  console.log('')
  console.log('1. CREATE A VAULT:')
  console.log('   const salt = await factory.generateSalt(userAddress, nonce)')
  console.log('   await factory.createVault(salt)')
  console.log('')
  console.log('2. PREDICT VAULT ADDRESS:')
  console.log('   const vaultAddr = await factory.predictAddress(salt)')
  console.log('')
  console.log('3. DEPOSIT TO VAULT:')
  console.log('   await signer.sendTransaction({ to: vaultAddr, value: amount })')
  console.log('')
  console.log('4. REFUND FROM VAULT (Admin only):')
  console.log('   await factory.refundFromVault(vaultAddr, recipient, amount)')
  console.log('')
  console.log('5. PAUSE/UNPAUSE (Pauser role):')
  console.log('   await factory.pause()')
  console.log('   await factory.unpause()')
  console.log('')
  console.log('6. UPDATE REV SPLITTER (Admin only):')
  console.log('   await factory.setRevSplitter(newAddress)')
  console.log('')
  console.log('=' .repeat(70))
  console.log('')

  // Save deployment info
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      VaultFactory: factoryAddress,
      RevenueSplitter: revSplitter,
    },
    roles: {
      admin: ADMIN_ADDRESS,
      defaultAdminRole: DEFAULT_ADMIN_ROLE,
      pauserRole: PAUSER_ROLE,
    },
    testData: {
      testSalt: testSalt,
      predictedVaultAddress: predictedVaultAddress,
    },
  }

  console.log('💾 Deployment Info (save this):')
  console.log(JSON.stringify(deploymentInfo, null, 2))
  console.log('')

  console.log('✅ Deployment completed successfully!')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error)
    process.exit(1)
  })

