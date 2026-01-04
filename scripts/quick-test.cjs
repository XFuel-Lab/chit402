const hre = require('hardhat');

/**
 * Quick VaultFactory verification and SubVault creation
 * Simpler version for quick testing
 */

async function main() {
  console.log('🧪 Quick VaultFactory Test');
  console.log('Network:', hre.network.name);
  console.log('');

  // Get signer
  const [signer] = await hre.ethers.getSigners();
  console.log('Signer address:', signer.address);
  
  // Check balance
  const balance = await hre.ethers.provider.getBalance(signer.address);
  console.log('Balance:', hre.ethers.formatEther(balance), 'TFUEL');
  console.log('');

  // Attach to VaultFactory
  const VAULT_FACTORY = '0xB0a26600074dADC69186632a1B8dFd7c3146Ce56';
  console.log('Attaching to VaultFactory:', VAULT_FACTORY);
  
  const factory = await hre.ethers.getContractAt('VaultFactory', VAULT_FACTORY);
  console.log('✅ Attached successfully');
  console.log('');

  // Check if paused
  try {
    const paused = await factory.paused();
    console.log('Contract paused:', paused);
  } catch (error) {
    console.log('⚠️  Could not check pause status');
  }

  // Get RevenueSplitter
  try {
    const revSplitter = await factory.getRevSplitter();
    console.log('RevenueSplitter:', revSplitter);
  } catch (error) {
    console.log('⚠️  Could not get RevenueSplitter');
  }

  console.log('');
  console.log('✅ Basic verification complete');
  console.log('');
  console.log('To create a SubVault, run:');
  console.log('');
  console.log('> salt = ethers.keccak256(ethers.toUtf8Bytes("test-vault-" + Date.now()))');
  console.log('> tx = await factory.createVault(salt, {gasPrice: ethers.parseUnits("4000", "gwei")})');
  console.log('> await tx.wait()');
  console.log('> vaultAddr = await factory.predictAddress(salt)');
  console.log('> console.log("SubVault:", vaultAddr)');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });

