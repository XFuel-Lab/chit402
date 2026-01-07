import hre from 'hardhat';
const { ethers, upgrades } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 Starting Phase 1 XFUEL Tokenomics deployment...\n');

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      '❌ No signers available. Please set THETA_MAINNET_PRIVATE_KEY in your .env file.\n' +
      '   Example: THETA_MAINNET_PRIVATE_KEY=0xYourPrivateKeyHere'
    );
  }

  const [deployer] = signers;
  console.log('📝 Deploying contracts with account:', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  const formatEther = ethers.formatEther;
  const parseEther = ethers.parseEther;
  console.log('💰 Account balance:', formatEther(balance), 'TFUEL\n');

  if (balance < parseEther('0.1')) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n');
  }

  // Get addresses from environment or use placeholders
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const XF_TOKEN = process.env.XF_TOKEN_ADDRESS || ZERO_ADDRESS;
  const REVENUE_TOKEN = process.env.REVENUE_TOKEN_ADDRESS || ZERO_ADDRESS; // USDC
  const TREASURY = process.env.TREASURY_ADDRESS || deployer.address; // Use deployer as default

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
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18);
    await xfToken.waitForDeployment();
    xfTokenAddress = await xfToken.getAddress();
    const xfTokenDeployTx = xfToken.deploymentTransaction();
    console.log('✅ Mock XF Token deployed to:', xfTokenAddress);
    if (xfTokenDeployTx) {
      console.log('   Transaction hash:', xfTokenDeployTx.hash);
      const receipt = await xfTokenDeployTx.wait();
      console.log('   Block number:', receipt?.blockNumber || 'pending\n');
    } else {
      console.log('   (deployment transaction info not available)\n');
    }
  }

  if (REVENUE_TOKEN === ZERO_ADDRESS) {
    console.log('📦 Deploying Mock Revenue Token (USDC)...');
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 6);
    await revenueToken.waitForDeployment();
    revenueTokenAddress = await revenueToken.getAddress();
    const revenueTokenDeployTx = revenueToken.deploymentTransaction();
    console.log('✅ Mock Revenue Token deployed to:', revenueTokenAddress);
    if (revenueTokenDeployTx) {
      console.log('   Transaction hash:', revenueTokenDeployTx.hash);
      const receipt = await revenueTokenDeployTx.wait();
      console.log('   Block number:', receipt?.blockNumber || 'pending\n');
    } else {
      console.log('   (deployment transaction info not available)\n');
    }
  }

  // Deploy veXF
  console.log('📦 Deploying veXF (vote-escrowed XF)...');
  const VeXF = await ethers.getContractFactory('veXF');
  const veXF = await upgrades.deployProxy(
    VeXF,
    [xfTokenAddress, deployer.address],
    { 
      initializer: 'initialize',
      kind: 'uups',
      txOverrides: {
        gasLimit: 5000000,
      }
    }
  );
  await veXF.waitForDeployment();
  const veXFAddress = await veXF.getAddress();
  console.log('✅ veXF deployed to:', veXFAddress);
  const veXFDeployTx = veXF.deploymentTransaction();
  if (veXFDeployTx) {
    console.log('   Transaction hash:', veXFDeployTx.hash);
    const receipt = await veXFDeployTx.wait();
    console.log('   Block number:', receipt?.blockNumber || 'pending\n');
  } else {
    console.log('   (deployment transaction info not available)\n');
  }

  // Deploy RevenueSplitter
  console.log('📦 Deploying RevenueSplitter...');
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter');
  const revenueSplitter = await upgrades.deployProxy(
    RevenueSplitter,
    [revenueTokenAddress, veXFAddress, TREASURY, deployer.address],
    { 
      initializer: 'initialize',
      kind: 'uups',
      txOverrides: {
        gasLimit: 5000000,
      }
    }
  );
  await revenueSplitter.waitForDeployment();
  const revenueSplitterAddress = await revenueSplitter.getAddress();
  console.log('✅ RevenueSplitter deployed to:', revenueSplitterAddress);
  const revenueSplitterDeployTx = revenueSplitter.deploymentTransaction();
  if (revenueSplitterDeployTx) {
    console.log('   Transaction hash:', revenueSplitterDeployTx.hash);
    const receipt = await revenueSplitterDeployTx.wait();
    console.log('   Block number:', receipt?.blockNumber || 'pending\n');
  } else {
    console.log('   (deployment transaction info not available)\n');
  }

  // Deploy CyberneticFeeSwitch
  console.log('📦 Deploying CyberneticFeeSwitch...');
  const CyberneticFeeSwitch = await ethers.getContractFactory('CyberneticFeeSwitch');
  const feeSwitch = await upgrades.deployProxy(
    CyberneticFeeSwitch,
    [veXFAddress, deployer.address],
    { 
      initializer: 'initialize',
      kind: 'uups',
      txOverrides: {
        gasLimit: 5000000,
      }
    }
  );
  await feeSwitch.waitForDeployment();
  const feeSwitchAddress = await feeSwitch.getAddress();
  console.log('✅ CyberneticFeeSwitch deployed to:', feeSwitchAddress);
  const feeSwitchDeployTx = feeSwitch.deploymentTransaction();
  if (feeSwitchDeployTx) {
    console.log('   Transaction hash:', feeSwitchDeployTx.hash);
    const receipt = await feeSwitchDeployTx.wait();
    console.log('   Block number:', receipt?.blockNumber || 'pending\n');
  } else {
    console.log('   (deployment transaction info not available)\n');
  }

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 PHASE 1 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  const network = await ethers.provider.getNetwork();
  console.log('🌐 Network:', network.name, '(Chain ID:', network.chainId + ')');
  console.log('👤 Deployer:', deployer.address);
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
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      xfToken: xfTokenAddress,
      revenueToken: revenueTokenAddress,
      treasury: TREASURY,
      veXF: veXFAddress,
      revenueSplitter: revenueSplitterAddress,
      feeSwitch: feeSwitchAddress,
    },
    implementationAddresses: {
      veXF: await upgrades.erc1967.getImplementationAddress(veXFAddress),
      revenueSplitter: await upgrades.erc1967.getImplementationAddress(revenueSplitterAddress),
      feeSwitch: await upgrades.erc1967.getImplementationAddress(feeSwitchAddress),
    },
  };

  // Use 'mainnet' for Theta mainnet (chainId 361), otherwise use chainId
  const deploymentFileName = network.chainId === 361n ? 'phase1-mainnet.json' : `phase1-${network.chainId}.json`;
  const deploymentPath = path.join(__dirname, '..', 'deployments', deploymentFileName);
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

  const updateEnvVar = (key: string, value: string) => {
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

