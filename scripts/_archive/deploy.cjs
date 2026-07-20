const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🚀 Starting Real XFUEL contracts deployment to Theta Testnet...\n');

  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      '❌ No signers available. Please set THETA_TESTNET_PRIVATE_KEY in your .env file.\n' +
      '   Example: THETA_TESTNET_PRIVATE_KEY=0xYourPrivateKeyHere'
    );
  }

  const [deployer] = signers;
  console.log('📝 Deploying contracts with account:', deployer.address);
  const balance = await deployer.getBalance();
  console.log('💰 Account balance:', hre.ethers.utils.formatEther(balance), 'TFUEL\n');

  if (balance.lt(hre.ethers.utils.parseEther('0.1'))) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n');
  }

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  // Deploy TipPool (no constructor parameters needed)
  console.log('📦 Deploying TipPool...');
  const TipPool = await hre.ethers.getContractFactory('TipPool');
  const tipPool = await TipPool.deploy();
  await tipPool.deployed();
  console.log('✅ TipPool deployed to:', tipPool.address);
  console.log('   Transaction hash:', tipPool.deployTransaction.hash);
  console.log('   Block number:', tipPool.deployTransaction.blockNumber || 'pending\n');

  // Deploy XFUELPoolFactory (no constructor parameters needed)
  console.log('📦 Deploying XFUELPoolFactory...');
  const XFUELPoolFactory = await hre.ethers.getContractFactory('XFUELPoolFactory');
  const xfuelPoolFactory = await XFUELPoolFactory.deploy();
  await xfuelPoolFactory.deployed();
  console.log('✅ XFUELPoolFactory deployed to:', xfuelPoolFactory.address);
  console.log('   Transaction hash:', xfuelPoolFactory.deployTransaction.hash);
  console.log('   Block number:', xfuelPoolFactory.deployTransaction.blockNumber || 'pending\n');

  // Deploy TreasuryILBackstop (requires treasury token address - using zero as placeholder)
  console.log('📦 Deploying TreasuryILBackstop...');
  console.log('   Using zero address as treasury token placeholder (can be updated later)');
  const TreasuryILBackstop = await hre.ethers.getContractFactory('TreasuryILBackstop');
  const treasuryILBackstop = await TreasuryILBackstop.deploy(ZERO_ADDRESS);
  await treasuryILBackstop.deployed();
  console.log('✅ TreasuryILBackstop deployed to:', treasuryILBackstop.address);
  console.log('   Transaction hash:', treasuryILBackstop.deployTransaction.hash);
  console.log('   Block number:', treasuryILBackstop.deployTransaction.blockNumber || 'pending\n');

  // Deploy XFUELRouter (using real factory and backstop addresses)
  console.log('📦 Deploying XFUELRouter...');
  console.log('   Using deployed factory and backstop addresses');
  console.log('   Token addresses (xfuelToken, usdcToken) are placeholders - update later');
  
  const XFUELRouter = await hre.ethers.getContractFactory('XFUELRouter');
  const xfuelRouter = await XFUELRouter.deploy(
    xfuelPoolFactory.address, // factory (real address)
    treasuryILBackstop.address, // backstop (real address)
    ZERO_ADDRESS, // xfuelToken (placeholder - update later)
    ZERO_ADDRESS, // usdcToken (placeholder - update later)
    ZERO_ADDRESS, // treasury (can be updated via setTreasury)
    ZERO_ADDRESS  // veXFContract (can be updated via setVeXFContract)
  );
  await xfuelRouter.deployed();
  console.log('✅ XFUELRouter deployed to:', xfuelRouter.address);
  console.log('   Transaction hash:', xfuelRouter.deployTransaction.hash);
  console.log('   Block number:', xfuelRouter.deployTransaction.blockNumber || 'pending\n');

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  console.log('🌐 Network: Theta Testnet (Chain ID: 365)');
  console.log('👤 Deployer:', deployer.address);
  console.log('');
  console.log('📝 Contract Addresses:');
  console.log('   TipPool:            ', tipPool.address);
  console.log('   XFUELPoolFactory:   ', xfuelPoolFactory.address);
  console.log('   TreasuryILBackstop: ', treasuryILBackstop.address);
  console.log('   XFUELRouter:        ', xfuelRouter.address);
  console.log('='.repeat(60));
  console.log('');
  console.log('📌 Next Steps:');
  console.log('   1. Update XFUELRouter with real token addresses (xfuelToken, usdcToken)');
  console.log('   2. Update TreasuryILBackstop treasury token address');
  console.log('   3. Set treasury and veXFContract addresses in XFUELRouter');
  console.log('   4. Create pools using XFUELPoolFactory');
  console.log('');

  // Update .env file
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  
  // Read existing .env if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Update or add contract addresses
  const routerRegex = /^VITE_ROUTER_ADDRESS=.*$/m;
  const tipPoolRegex = /^VITE_TIP_POOL_ADDRESS=.*$/m;

  if (routerRegex.test(envContent)) {
    envContent = envContent.replace(routerRegex, `VITE_ROUTER_ADDRESS=${xfuelRouter.address}`);
  } else {
    envContent += `\nVITE_ROUTER_ADDRESS=${xfuelRouter.address}`;
  }

  if (tipPoolRegex.test(envContent)) {
    envContent = envContent.replace(tipPoolRegex, `VITE_TIP_POOL_ADDRESS=${tipPool.address}`);
  } else {
    envContent += `\nVITE_TIP_POOL_ADDRESS=${tipPool.address}`;
  }

  // Write .env file
  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('✅ Updated .env file with contract addresses\n');

  return {
    tipPool: tipPool.address,
    xfuelPoolFactory: xfuelPoolFactory.address,
    treasuryILBackstop: treasuryILBackstop.address,
    xfuelRouter: xfuelRouter.address,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });




