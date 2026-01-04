const hre = require('hardhat');

async function main() {
  console.log('🔍 Checking Theta Testnet balance...\n');

  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    console.error('❌ No signers available. Please set THETA_TESTNET_PRIVATE_KEY in your .env file.');
    process.exit(1);
  }

  const [deployer] = signers;
  console.log('📝 Account address:', deployer.address);
  
  try {
    const balance = await deployer.getBalance();
    const balanceInTfuel = hre.ethers.utils.formatEther(balance);
    
    console.log('💰 Current balance:', balanceInTfuel, 'TFUEL');
    
    const minRequired = hre.ethers.utils.parseEther('0.5');
    if (balance.gte(minRequired)) {
      console.log('✅ Sufficient balance for deployment!\n');
      console.log('🚀 Ready to deploy. Run: npm run deploy:theta-testnet');
    } else {
      console.log('⚠️  Insufficient balance. Need at least 0.5 TFUEL for deployment.');
      console.log('📧 If you requested TFUEL from Theta support, please wait for them to send it.');
    }
    
    // Show explorer link
    console.log('\n🔗 View on explorer:');
    console.log(`   https://testnet-explorer.thetatoken.org/address/${deployer.address}`);
    
  } catch (error) {
    console.error('❌ Error checking balance:', error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });




