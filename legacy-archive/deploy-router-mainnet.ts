import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 Deploying XFUELRouter with IFeeAdapter integration to Theta Mainnet...\n');

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error('No signers available. Please set THETA_MAINNET_PRIVATE_KEY in .env');
  }

  const [deployer] = signers;
  console.log('📝 Deploying with account:', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('💰 Account balance:', ethers.formatEther(balance), 'TFUEL\n');

  if (balance < ethers.parseEther('0.1')) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n');
  }

  // Load Phase 1 deployment addresses
  const phase1Path = path.join(__dirname, '..', 'deployments', 'phase1-mainnet.json');
  if (!fs.existsSync(phase1Path)) {
    throw new Error('Phase 1 deployment not found. Please deploy Phase 1 contracts first.');
  }

  const phase1Deployment = JSON.parse(fs.readFileSync(phase1Path, 'utf8'));
  const { contracts: phase1Contracts } = phase1Deployment;

  console.log('📋 Using Phase 1 Contracts:');
  console.log('   veXF:', phase1Contracts.veXF);
  console.log('   FeeSwitch:', phase1Contracts.feeSwitch);
  console.log('   Treasury:', phase1Contracts.treasury);
  console.log('');

  // Check if we need to deploy dependencies first
  // For now, we'll use placeholder addresses for factory, backstop, and tokens
  // These should be updated with actual addresses if they exist
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  
  // Try to load existing router deployment if it exists
  const routerDeploymentPath = path.join(__dirname, '..', 'deployments', 'router-mainnet.json');
  let existingRouter = null;
  if (fs.existsSync(routerDeploymentPath)) {
    existingRouter = JSON.parse(fs.readFileSync(routerDeploymentPath, 'utf8'));
    console.log('📋 Found existing router deployment:', existingRouter.router);
    console.log('   Will update fee adapter connection\n');
  }

  // For mainnet, we need actual addresses for:
  // - XFUELPoolFactory (deploy if not exists)
  // - TreasuryILBackstop (deploy if not exists)
  // - XF Token address (from Phase 1 or env)
  // - USDC Token address (from Phase 1 or env)
  
  // Check environment for these addresses
  let factoryAddress = process.env.XFUEL_POOL_FACTORY_ADDRESS || ZERO_ADDRESS;
  let backstopAddress = process.env.TREASURY_IL_BACKSTOP_ADDRESS || ZERO_ADDRESS;
  const xfTokenAddress = phase1Contracts.xfToken || process.env.XF_TOKEN_ADDRESS || ZERO_ADDRESS;
  const usdcTokenAddress = phase1Contracts.revenueToken || process.env.USDC_TOKEN_ADDRESS || ZERO_ADDRESS;

  // Deploy factory if not provided
  if (factoryAddress === ZERO_ADDRESS) {
    console.log('📦 Deploying XFUELPoolFactory...');
    const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory');
    const factory = await XFUELPoolFactory.deploy({ gasLimit: 5000000 });
    await factory.waitForDeployment();
    factoryAddress = await factory.getAddress();
    const factoryTx = factory.deploymentTransaction();
    console.log('✅ XFUELPoolFactory deployed to:', factoryAddress);
    if (factoryTx) {
      console.log('   Transaction hash:', factoryTx.hash);
      const receipt = await factoryTx.wait();
      console.log('   Block number:', receipt?.blockNumber || 'pending');
    }
    console.log('');
  }

  // Deploy backstop if not provided
  if (backstopAddress === ZERO_ADDRESS) {
    console.log('📦 Deploying TreasuryILBackstop...');
    const TreasuryILBackstop = await ethers.getContractFactory('TreasuryILBackstop');
    // Use revenue token or zero address as placeholder
    const backstopToken = usdcTokenAddress !== ZERO_ADDRESS ? usdcTokenAddress : deployer.address; // Temporary placeholder
    const backstop = await TreasuryILBackstop.deploy(backstopToken, { gasLimit: 5000000 });
    await backstop.waitForDeployment();
    backstopAddress = await backstop.getAddress();
    const backstopTx = backstop.deploymentTransaction();
    console.log('✅ TreasuryILBackstop deployed to:', backstopAddress);
    if (backstopTx) {
      console.log('   Transaction hash:', backstopTx.hash);
      const receipt = await backstopTx.wait();
      console.log('   Block number:', receipt?.blockNumber || 'pending');
    }
    console.log('');
  }

  console.log('📋 Configuration:');
  console.log('   Factory:', factoryAddress || '(will use placeholder)');
  console.log('   Backstop:', backstopAddress || '(will use placeholder)');
  console.log('   XF Token:', xfTokenAddress || '(will use placeholder)');
  console.log('   USDC Token:', usdcTokenAddress || '(will use placeholder)');
  console.log('   veXF:', phase1Contracts.veXF);
  console.log('   Treasury:', phase1Contracts.treasury);
  console.log('');

  // Deploy XFUELRouter
  console.log('📦 Deploying XFUELRouter...');
  const XFUELRouter = await ethers.getContractFactory('XFUELRouter');
  
  const router = await XFUELRouter.deploy(
    factoryAddress,
    backstopAddress,
    xfTokenAddress,
    usdcTokenAddress,
    phase1Contracts.treasury,
    phase1Contracts.veXF,
    { gasLimit: 5000000 }
  );
  
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  const deployTx = router.deploymentTransaction();
  
  console.log('✅ XFUELRouter deployed to:', routerAddress);
  if (deployTx) {
    console.log('   Transaction hash:', deployTx.hash);
    const receipt = await deployTx.wait();
    console.log('   Block number:', receipt?.blockNumber || 'pending');
  }
  console.log('');

  // Connect fee adapter
  console.log('🔌 Connecting Fee Adapter...');
  const feeAdapterTx = await router.setFeeAdapter(phase1Contracts.feeSwitch, { gasLimit: 500000 });
  await feeAdapterTx.wait();
  console.log('✅ Fee adapter connected!');
  console.log('   Transaction hash:', feeAdapterTx.hash);
  console.log('');

  // Verify fee adapter connection
  const connectedFeeAdapter = await router.feeAdapter();
  const feesEnabled = await router.isFeesEnabled();
  const effectiveFee = await router.getEffectiveFee();
  
  console.log('✅ Fee Adapter Verification:');
  console.log('   Connected Fee Adapter:', connectedFeeAdapter);
  console.log('   Fees Enabled:', feesEnabled);
  console.log('   Effective Fee:', effectiveFee.toString(), 'bps');
  console.log('');

  // Get network info
  const network = await ethers.provider.getNetwork();

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    router: routerAddress,
    feeAdapter: phase1Contracts.feeSwitch,
    configuration: {
      factory: factoryAddress,
      backstop: backstopAddress,
      xfToken: xfTokenAddress,
      usdcToken: usdcTokenAddress,
      treasury: phase1Contracts.treasury,
      veXF: phase1Contracts.veXF,
    },
    phase1Integration: {
      veXF: phase1Contracts.veXF,
      revenueSplitter: phase1Contracts.revenueSplitter,
      feeSwitch: phase1Contracts.feeSwitch,
    },
  };

  const deploymentPath = path.join(__dirname, '..', 'deployments', 'router-mainnet.json');
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

  updateEnvVar('VITE_ROUTER_ADDRESS', routerAddress);
  updateEnvVar('ROUTER_FEE_ADAPTER_ADDRESS', phase1Contracts.feeSwitch);

  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('✅ Updated .env file with router address\n');

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 XFUELROUTER DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  console.log('🌐 Network:', network.name, '(Chain ID:', network.chainId + ')');
  console.log('👤 Deployer:', deployer.address);
  console.log('');
  console.log('📝 Contract Addresses:');
  console.log('   XFUELRouter:        ', routerAddress);
  console.log('   Fee Adapter:        ', phase1Contracts.feeSwitch);
  console.log('   veXF:               ', phase1Contracts.veXF);
  console.log('   Treasury:           ', phase1Contracts.treasury);
  console.log('='.repeat(60));
  console.log('');
  console.log('📌 Next Steps:');
  console.log('   1. Verify router on block explorer');
  console.log('   2. Test swap with dynamic fees');
  console.log('   3. Monitor fee changes via governance');
  console.log('   4. Update factory/backstop addresses if needed');
  console.log('');
  console.log('📌 Explorer Links:');
  console.log('   Router:', `https://explorer.thetatoken.org/address/${routerAddress}`);
  console.log('   FeeSwitch:', `https://explorer.thetatoken.org/address/${phase1Contracts.feeSwitch}`);
  console.log('');

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

