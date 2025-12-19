const hre = require('hardhat');
const { upgrades } = hre;
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
  const deployerAddress = await deployer.getAddress();
  console.log('📝 Deploying contracts with account:', deployerAddress);
  const balance = await hre.ethers.provider.getBalance(deployerAddress);
  console.log('💰 Account balance:', hre.ethers.formatEther(balance), 'TFUEL\n');

  if (balance < hre.ethers.parseEther('0.1')) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n');
  }

  // Get addresses from environment or use placeholders
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const XF_TOKEN = process.env.XF_TOKEN_ADDRESS || ZERO_ADDRESS;
  const REVENUE_TOKEN = process.env.REVENUE_TOKEN_ADDRESS || ZERO_ADDRESS; // USDC
  const TREASURY = process.env.TREASURY_ADDRESS || deployerAddress; // Use deployer as default

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
    await xfToken.waitForDeployment();
    xfTokenAddress = await xfToken.getAddress();
    const xfTokenTx = xfToken.deploymentTransaction();
    console.log('✅ Mock XF Token deployed to:', xfTokenAddress);
    if (xfTokenTx) {
      console.log('   Transaction hash:', xfTokenTx.hash);
      console.log('   Block number:', xfTokenTx.blockNumber || 'pending\n');
    }
  }

  if (REVENUE_TOKEN === ZERO_ADDRESS) {
    console.log('📦 Deploying Mock Revenue Token (USDC)...');
    const MockERC20 = await hre.ethers.getContractFactory('MockERC20');
    const revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 6);
    await revenueToken.waitForDeployment();
    revenueTokenAddress = await revenueToken.getAddress();
    const revenueTokenTx = revenueToken.deploymentTransaction();
    console.log('✅ Mock Revenue Token deployed to:', revenueTokenAddress);
    if (revenueTokenTx) {
      console.log('   Transaction hash:', revenueTokenTx.hash);
      console.log('   Block number:', revenueTokenTx.blockNumber || 'pending\n');
    }
  }

  // Deploy veXF
  console.log('📦 Deploying veXF (vote-escrowed XF)...');
  const VeXF = await hre.ethers.getContractFactory('veXF');
  const veXF = await upgrades.deployProxy(
    VeXF,
    [xfTokenAddress, deployerAddress],
    { initializer: 'initialize' }
  );
  await veXF.waitForDeployment();
  const veXFAddress = await veXF.getAddress();
  const veXFTx = veXF.deploymentTransaction();
  console.log('✅ veXF deployed to:', veXFAddress);
  if (veXFTx) {
    console.log('   Transaction hash:', veXFTx.hash);
    console.log('   Block number:', veXFTx.blockNumber || 'pending\n');
  }

  // Deploy RevenueSplitter
  console.log('📦 Deploying RevenueSplitter...');
  const RevenueSplitter = await hre.ethers.getContractFactory('RevenueSplitter');
  const revenueSplitter = await upgrades.deployProxy(
    RevenueSplitter,
    [revenueTokenAddress, veXFAddress, TREASURY, deployerAddress],
    { initializer: 'initialize' }
  );
  await revenueSplitter.waitForDeployment();
  const revenueSplitterAddress = await revenueSplitter.getAddress();
  const revenueSplitterTx = revenueSplitter.deploymentTransaction();
  console.log('✅ RevenueSplitter deployed to:', revenueSplitterAddress);
  if (revenueSplitterTx) {
    console.log('   Transaction hash:', revenueSplitterTx.hash);
    console.log('   Block number:', revenueSplitterTx.blockNumber || 'pending\n');
  }

  // Deploy CyberneticFeeSwitch
  console.log('📦 Deploying CyberneticFeeSwitch...');
  const CyberneticFeeSwitch = await hre.ethers.getContractFactory('CyberneticFeeSwitch');
  const feeSwitch = await upgrades.deployProxy(
    CyberneticFeeSwitch,
    [veXFAddress, deployerAddress],
    { initializer: 'initialize' }
  );
  await feeSwitch.waitForDeployment();
  const feeSwitchAddress = await feeSwitch.getAddress();
  const feeSwitchTx = feeSwitch.deploymentTransaction();
  console.log('✅ CyberneticFeeSwitch deployed to:', feeSwitchAddress);
  if (feeSwitchTx) {
    console.log('   Transaction hash:', feeSwitchTx.hash);
    console.log('   Block number:', feeSwitchTx.blockNumber || 'pending\n');
  }

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 PHASE 1 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  const network = await hre.ethers.provider.getNetwork();
  console.log('🌐 Network:', network.name, '(Chain ID:', network.chainId.toString() + ')');
  console.log('👤 Deployer:', deployerAddress);
  console.log('');
  console.log('📝 Contract Addresses:');
  console.log('   XF Token:            ', xfTokenAddress);
  console.log('   Revenue Token:       ', revenueTokenAddress);
  console.log('   Treasury:            ', TREASURY);
  console.log('   veXF:                ', veXFAddress);
  console.log('   RevenueSplitter:     ', revenueSplitterAddress);
  console.log('   CyberneticFeeSwitch:  ', feeSwitchAddress);
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
    deployer: deployerAddress,
    timestamp: new Date().toISOString(),
    contracts: {
      xfToken: xfTokenAddress,
      revenueToken: revenueTokenAddress,
      treasury: TREASURY,
      veXF: veXFAddress,
      revenueSplitter: revenueSplitterAddress,
      feeSwitch: feeSwitchAddress,
    },
  };

  // Get implementation addresses
  try {
    deploymentInfo.implementationAddresses = {
      veXF: await upgrades.erc1967.getImplementationAddress(veXFAddress),
      revenueSplitter: await upgrades.erc1967.getImplementationAddress(revenueSplitterAddress),
      feeSwitch: await upgrades.erc1967.getImplementationAddress(feeSwitchAddress),
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

  updateEnvVar('VITE_VEXF_ADDRESS', veXFAddress);
  updateEnvVar('VITE_REVENUE_SPLITTER_ADDRESS', revenueSplitterAddress);
  updateEnvVar('VITE_FEE_SWITCH_ADDRESS', feeSwitchAddress);
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

