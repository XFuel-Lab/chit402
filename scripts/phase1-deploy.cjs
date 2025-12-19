const hre = require('hardhat');
const { upgrades } = require('@openzeppelin/hardhat-upgrades');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🚀 Starting Phase 1 XFUEL Tokenomics deployment...\n');

  // Use the same pattern as deploy.cjs
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

  // Get addresses from environment or use placeholders
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const XF_TOKEN = process.env.XF_TOKEN_ADDRESS || ZERO_ADDRESS;
  const REVENUE_TOKEN = process.env.REVENUE_TOKEN_ADDRESS || ZERO_ADDRESS; // USDC
  const TREASURY = process.env.TREASURY_ADDRESS || (deployer.address || await deployer.getAddress()); // Use deployer as default

  console.log('📋 Configuration:');
  console.log('   XF Token:', XF_TOKEN || '(will deploy mock)');
  console.log('   Revenue Token (USDC):', REVENUE_TOKEN || '(will deploy mock)');
  console.log('   Treasury:', TREASURY);
  console.log('');

  // Deploy mock tokens if not provided
  let xfTokenAddress = XF_TOKEN;
  let revenueTokenAddress = REVENUE_TOKEN;

  if (XF_TOKEN === ZERO_ADDRESS) {
    console.log('📦 Deploying Mock XF Token...');
    const MockERC20 = await hre.ethers.getContractFactory('MockERC20');
    const xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18);
    await xfToken.deployed();
    xfTokenAddress = xfToken.address;
    console.log('✅ Mock XF Token deployed to:', xfTokenAddress);
    console.log('   Transaction hash:', xfToken.deployTransaction.hash);
    console.log('   Block number:', xfToken.deployTransaction.blockNumber || 'pending\n');
  }

  if (REVENUE_TOKEN === ZERO_ADDRESS) {
    console.log('📦 Deploying Mock Revenue Token (USDC)...');
    const MockERC20 = await hre.ethers.getContractFactory('MockERC20');
    const revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 6);
    await revenueToken.deployed();
    revenueTokenAddress = revenueToken.address;
    console.log('✅ Mock Revenue Token deployed to:', revenueTokenAddress);
    console.log('   Transaction hash:', revenueToken.deployTransaction.hash);
    console.log('   Block number:', revenueToken.deployTransaction.blockNumber || 'pending\n');
  }

  // Deploy veXF
  console.log('📦 Deploying veXF (vote-escrowed XF)...');
  const VeXF = await hre.ethers.getContractFactory('veXF');
  const veXF = await upgrades.deployProxy(
    VeXF,
    [xfTokenAddress, deployer.address],
    { initializer: 'initialize' }
  );
  await veXF.deployed();
  console.log('✅ veXF deployed to:', veXF.address);
  console.log('   Transaction hash:', veXF.deployTransaction.hash);
  console.log('   Block number:', veXF.deployTransaction.blockNumber || 'pending\n');

  // Deploy RevenueSplitter
  console.log('📦 Deploying RevenueSplitter...');
  const RevenueSplitter = await hre.ethers.getContractFactory('RevenueSplitter');
  const revenueSplitter = await upgrades.deployProxy(
    RevenueSplitter,
    [revenueTokenAddress, veXF.address, TREASURY, deployer.address],
    { initializer: 'initialize' }
  );
  await revenueSplitter.deployed();
  console.log('✅ RevenueSplitter deployed to:', revenueSplitter.address);
  console.log('   Transaction hash:', revenueSplitter.deployTransaction.hash);
  console.log('   Block number:', revenueSplitter.deployTransaction.blockNumber || 'pending\n');

  // Deploy CyberneticFeeSwitch
  console.log('📦 Deploying CyberneticFeeSwitch...');
  const CyberneticFeeSwitch = await hre.ethers.getContractFactory('CyberneticFeeSwitch');
  const feeSwitch = await upgrades.deployProxy(
    CyberneticFeeSwitch,
    [veXF.address, deployer.address],
    { initializer: 'initialize' }
  );
  await feeSwitch.deployed();
  console.log('✅ CyberneticFeeSwitch deployed to:', feeSwitch.address);
  console.log('   Transaction hash:', feeSwitch.deployTransaction.hash);
  console.log('   Block number:', feeSwitch.deployTransaction.blockNumber || 'pending\n');

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 PHASE 1 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  const network = await hre.ethers.provider.getNetwork();
  console.log('🌐 Network:', network.name, '(Chain ID:', network.chainId.toString() + ')');
  console.log('👤 Deployer:', deployer.address);
  console.log('');
  console.log('📝 Contract Addresses:');
  console.log('   XF Token:            ', xfTokenAddress);
  console.log('   Revenue Token:       ', revenueTokenAddress);
  console.log('   Treasury:            ', TREASURY);
  console.log('   veXF:                ', veXF.address);
  console.log('   RevenueSplitter:     ', revenueSplitter.address);
  console.log('   CyberneticFeeSwitch:  ', feeSwitch.address);
  console.log('='.repeat(60));
  console.log('');
  console.log('📌 Next Steps:');
  console.log('   1. Verify all contract addresses on block explorer');
  console.log('   2. Update XF_TOKEN_ADDRESS and REVENUE_TOKEN_ADDRESS in .env if using mocks');
  console.log('   3. Transfer ownership to multisig/governance if needed');
  console.log('   4. Test revenue splitting via RevenueSplitter.splitRevenue()');
  console.log('   5. Test fee switching via CyberneticFeeSwitch');
  console.log('   6. Integrate with XFUELRouter via IFeeAdapter interface');
  console.log('');

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      xfToken: xfTokenAddress,
      revenueToken: revenueTokenAddress,
      treasury: TREASURY,
      veXF: veXF.address,
      revenueSplitter: revenueSplitter.address,
      feeSwitch: feeSwitch.address,
    },
  };

  // Get implementation addresses
  try {
    deploymentInfo.implementationAddresses = {
      veXF: await upgrades.erc1967.getImplementationAddress(veXF.address),
      revenueSplitter: await upgrades.erc1967.getImplementationAddress(revenueSplitter.address),
      feeSwitch: await upgrades.erc1967.getImplementationAddress(feeSwitch.address),
    };
  } catch (error) {
    console.warn('⚠️  Could not fetch implementation addresses:', error.message);
  }

  const deploymentPath = path.join(__dirname, '..', 'deployments', `phase1-${network.chainId}.json`);
  const deploymentsDir = path.dirname(deploymentPath);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log('✅ Deployment info saved to:', deploymentPath);
  console.log('');

  // Update .env file
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const updateEnvVar = (key, value) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  };

  updateEnvVar('VITE_VEXF_ADDRESS', veXF.address);
  updateEnvVar('VITE_REVENUE_SPLITTER_ADDRESS', revenueSplitter.address);
  updateEnvVar('VITE_FEE_SWITCH_ADDRESS', feeSwitch.address);
  if (XF_TOKEN === ZERO_ADDRESS) {
    updateEnvVar('XF_TOKEN_ADDRESS', xfTokenAddress);
  }
  if (REVENUE_TOKEN === ZERO_ADDRESS) {
    updateEnvVar('REVENUE_TOKEN_ADDRESS', revenueTokenAddress);
  }

  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('✅ Updated .env file with contract addresses\n');

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

