const { ethers } = require('hardhat')

/**
 * @title Interact with VaultFactory
 * @notice Helper script to interact with deployed VaultFactory contract
 * @dev Run with: npx hardhat run scripts/interact-vault-factory.cjs --network theta-testnet
 */

// Configuration - Update with your deployed contract address
const FACTORY_ADDRESS = process.env.VAULT_FACTORY_ADDRESS || ''

async function main() {
  if (!FACTORY_ADDRESS || !ethers.isAddress(FACTORY_ADDRESS)) {
    throw new Error('Please set VAULT_FACTORY_ADDRESS environment variable')
  }

  console.log('🔧 VaultFactory Interaction Script\n')

  const [signer] = await ethers.getSigners()
  console.log('Connected account:', signer.address)
  console.log('Account balance:', ethers.formatEther(await ethers.provider.getBalance(signer.address)), 'TFUEL\n')

  // Connect to factory
  const VaultFactory = await ethers.getContractFactory('VaultFactory')
  const factory = VaultFactory.attach(FACTORY_ADDRESS)

  console.log('Factory address:', FACTORY_ADDRESS)
  console.log('RevenueSplitter:', await factory.getRevSplitter())
  console.log('Factory paused:', await factory.paused())
  console.log('')

  // Interactive menu
  const action = process.env.ACTION || 'info'

  switch (action) {
    case 'info':
      await displayInfo(factory, signer)
      break

    case 'create':
      await createVault(factory, signer)
      break

    case 'predict':
      await predictVault(factory, signer)
      break

    case 'deposit':
      await depositToVault(factory, signer)
      break

    case 'refund':
      await refundFromVault(factory, signer)
      break

    case 'pause':
      await pauseFactory(factory, signer)
      break

    case 'unpause':
      await unpauseFactory(factory, signer)
      break

    default:
      console.log('❌ Unknown action:', action)
      console.log('Available actions: info, create, predict, deposit, refund, pause, unpause')
  }
}

async function displayInfo(factory, signer) {
  console.log('📊 Factory Information\n')

  const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE()
  const PAUSER_ROLE = await factory.PAUSER_ROLE()

  console.log('Roles for', signer.address)
  console.log('  - Has Admin Role:', await factory.hasRole(DEFAULT_ADMIN_ROLE, signer.address))
  console.log('  - Has Pauser Role:', await factory.hasRole(PAUSER_ROLE, signer.address))
  console.log('')

  // Test vault prediction
  const testNonce = 0
  const salt = await factory.generateSalt(signer.address, testNonce)
  const predictedAddr = await factory.predictAddress(salt)
  const isDeployed = await factory.isVaultDeployed(predictedAddr)

  console.log('Your vault (nonce 0):')
  console.log('  - Salt:', salt)
  console.log('  - Address:', predictedAddr)
  console.log('  - Deployed:', isDeployed)

  if (isDeployed) {
    const balance = await ethers.provider.getBalance(predictedAddr)
    console.log('  - Balance:', ethers.formatEther(balance), 'TFUEL')
  }
  console.log('')
}

async function createVault(factory, signer) {
  const nonce = parseInt(process.env.NONCE || '0')
  const userAddress = process.env.USER_ADDRESS || signer.address

  console.log(`📦 Creating vault for user: ${userAddress} with nonce: ${nonce}\n`)

  const salt = await factory.generateSalt(userAddress, nonce)
  const predictedAddr = await factory.predictAddress(salt)

  console.log('Predicted address:', predictedAddr)
  console.log('Creating vault...')

  const tx = await factory.createVault(salt)
  console.log('Transaction hash:', tx.hash)

  const receipt = await tx.wait()
  console.log('✅ Vault created! Gas used:', receipt.gasUsed.toString())

  // Verify
  const isDeployed = await factory.isVaultDeployed(predictedAddr)
  console.log('Verification - Deployed:', isDeployed)
}

async function predictVault(factory, signer) {
  const nonce = parseInt(process.env.NONCE || '0')
  const userAddress = process.env.USER_ADDRESS || signer.address

  console.log(`🔮 Predicting vault address\n`)
  console.log('User address:', userAddress)
  console.log('Nonce:', nonce)

  const salt = await factory.generateSalt(userAddress, nonce)
  const predictedAddr = await factory.predictAddress(salt)
  const isDeployed = await factory.isVaultDeployed(predictedAddr)

  console.log('')
  console.log('Salt:', salt)
  console.log('Predicted vault address:', predictedAddr)
  console.log('Is deployed:', isDeployed)

  if (isDeployed) {
    const balance = await ethers.provider.getBalance(predictedAddr)
    console.log('Vault balance:', ethers.formatEther(balance), 'TFUEL')
  }
}

async function depositToVault(factory, signer) {
  const nonce = parseInt(process.env.NONCE || '0')
  const amount = process.env.AMOUNT || '1.0'
  const userAddress = process.env.USER_ADDRESS || signer.address

  console.log(`💸 Depositing to vault\n`)

  const salt = await factory.generateSalt(userAddress, nonce)
  const vaultAddr = await factory.predictAddress(salt)
  const isDeployed = await factory.isVaultDeployed(vaultAddr)

  if (!isDeployed) {
    console.log('❌ Vault not deployed yet. Create it first.')
    return
  }

  console.log('Vault address:', vaultAddr)
  console.log('Deposit amount:', amount, 'TFUEL')

  const depositAmount = ethers.parseEther(amount)
  const tx = await signer.sendTransaction({ to: vaultAddr, value: depositAmount })
  console.log('Transaction hash:', tx.hash)

  const receipt = await tx.wait()
  console.log('✅ Deposit successful! Gas used:', receipt.gasUsed.toString())

  const balance = await ethers.provider.getBalance(vaultAddr)
  console.log('Vault balance:', ethers.formatEther(balance), 'TFUEL')
}

async function refundFromVault(factory, signer) {
  const vaultAddr = process.env.VAULT_ADDRESS
  const recipient = process.env.RECIPIENT_ADDRESS || signer.address
  const amount = process.env.AMOUNT || '1.0'

  if (!vaultAddr) {
    console.log('❌ Please set VAULT_ADDRESS environment variable')
    return
  }

  console.log(`💰 Initiating refund\n`)
  console.log('Vault address:', vaultAddr)
  console.log('Recipient:', recipient)
  console.log('Amount:', amount, 'TFUEL')

  const refundAmount = ethers.parseEther(amount)
  const tx = await factory.refundFromVault(vaultAddr, recipient, refundAmount)
  console.log('Transaction hash:', tx.hash)

  const receipt = await tx.wait()
  console.log('✅ Refund successful! Gas used:', receipt.gasUsed.toString())
}

async function pauseFactory(factory, signer) {
  console.log('⏸️  Pausing factory...\n')

  const tx = await factory.pause()
  console.log('Transaction hash:', tx.hash)

  await tx.wait()
  console.log('✅ Factory paused!')
}

async function unpauseFactory(factory, signer) {
  console.log('▶️  Unpausing factory...\n')

  const tx = await factory.unpause()
  console.log('Transaction hash:', tx.hash)

  await tx.wait()
  console.log('✅ Factory unpaused!')
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })

