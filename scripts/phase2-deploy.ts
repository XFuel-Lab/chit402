import hre from 'hardhat';
const { ethers, upgrades } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 Starting Phase 2 XFUEL Tokenomics deployment...\n');

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      '❌ No signers available. Please set THETA_TESTNET_PRIVATE_KEY in your .env file.\n' +
      '   Example: THETA_TESTNET_PRIVATE_KEY=0xYourPrivateKeyHere'
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

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId.toString();

  // Load Phase 1 deployment info
  const phase1Path = path.join(__dirname, '..', 'deployments', `phase1-${chainId}.json`);
  let phase1Deployment: any = null;

  if (fs.existsSync(phase1Path)) {
    phase1Deployment = JSON.parse(fs.readFileSync(phase1Path, 'utf8'));
    console.log('📋 Loaded Phase 1 deployment info from:', phase1Path);
    console.log('   veXF:', phase1Deployment.contracts.veXF);
    console.log('   RevenueSplitter:', phase1Deployment.contracts.revenueSplitter);
    console.log('   XF Token:', phase1Deployment.contracts.xfToken);
    console.log('   Revenue Token:', phase1Deployment.contracts.revenueToken);
    console.log('');
  } else {
    // Try to get from environment variables or use provided addresses
    console.log('⚠️  Phase 1 deployment file not found. Using environment variables or provided addresses.\n');
  }

  // Get addresses from Phase 1 deployment or environment
  const XF_TOKEN = 
    phase1Deployment?.contracts?.xfToken || 
    process.env.XF_TOKEN_ADDRESS || 
    ethers.ZeroAddress;
  const REVENUE_TOKEN = 
    phase1Deployment?.contracts?.revenueToken || 
    process.env.REVENUE_TOKEN_ADDRESS || 
    ethers.ZeroAddress;
  const VEXF_ADDRESS = 
    phase1Deployment?.contracts?.veXF || 
    process.env.VEXF_ADDRESS || 
    ethers.ZeroAddress;
  const REVENUE_SPLITTER_ADDRESS = 
    phase1Deployment?.contracts?.revenueSplitter || 
    process.env.REVENUE_SPLITTER_ADDRESS || 
    ethers.ZeroAddress;
  const SWAP_ROUTER = process.env.SWAP_ROUTER_ADDRESS || ethers.ZeroAddress; // Optional

  // Validate Phase 1 addresses
  if (XF_TOKEN === ethers.ZeroAddress) {
    throw new Error('❌ XF_TOKEN_ADDRESS is required. Please set it in .env or deploy Phase 1 first.');
  }
  if (REVENUE_TOKEN === ethers.ZeroAddress) {
    throw new Error('❌ REVENUE_TOKEN_ADDRESS is required. Please set it in .env or deploy Phase 1 first.');
  }
  if (VEXF_ADDRESS === ethers.ZeroAddress) {
    throw new Error('❌ VEXF_ADDRESS is required. Please set it in .env or deploy Phase 1 first.');
  }
  if (REVENUE_SPLITTER_ADDRESS === ethers.ZeroAddress) {
    throw new Error('❌ REVENUE_SPLITTER_ADDRESS is required. Please set it in .env or deploy Phase 1 first.');
  }

  console.log('📋 Phase 2 Configuration:');
  console.log('   XF Token:', XF_TOKEN);
  console.log('   Revenue Token:', REVENUE_TOKEN);
  console.log('   veXF:', VEXF_ADDRESS);
  console.log('   RevenueSplitter:', REVENUE_SPLITTER_ADDRESS);
  console.log('   Swap Router:', SWAP_ROUTER || '(not set - manual buyback mode)');
  console.log('');

  // Deploy rXF
  console.log('📦 Deploying rXF (soulbound revenue receipts)...');
  const RXF = await ethers.getContractFactory('rXF');
  const rXF = await upgrades.deployProxy(
    RXF,
    [XF_TOKEN, VEXF_ADDRESS, REVENUE_SPLITTER_ADDRESS, deployer.address],
    { initializer: 'initialize' }
  );
  await rXF.waitForDeployment();
  const rXFAddress = await rXF.getAddress();
  console.log('✅ rXF deployed to:', rXFAddress);
  console.log('');

  // Deploy BuybackBurner
  console.log('📦 Deploying BuybackBurner...');
  const BuybackBurner = await ethers.getContractFactory('BuybackBurner');
  const buybackBurner = await upgrades.deployProxy(
    BuybackBurner,
    [REVENUE_TOKEN, XF_TOKEN, SWAP_ROUTER, deployer.address],
    { initializer: 'initialize' }
  );
  await buybackBurner.waitForDeployment();
  const buybackBurnerAddress = await buybackBurner.getAddress();
  console.log('✅ BuybackBurner deployed to:', buybackBurnerAddress);
  console.log('');

  // Connect to existing RevenueSplitter and update addresses
  console.log('🔗 Configuring RevenueSplitter with Phase 2 contracts...');
  const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter');
  const revenueSplitter = RevenueSplitter.attach(REVENUE_SPLITTER_ADDRESS);

  // Set rXF address
  const setRXFTx = await revenueSplitter.setRXF(rXFAddress);
  await setRXFTx.wait();
  console.log('✅ RevenueSplitter.rXFContract set to:', rXFAddress);

  // Set BuybackBurner address
  const setBuybackTx = await revenueSplitter.setBuybackBurner(buybackBurnerAddress);
  await setBuybackTx.wait();
  console.log('✅ RevenueSplitter.buybackBurner set to:', buybackBurnerAddress);

  // Set RevenueSplitter address in BuybackBurner
  const setSplitterTx = await buybackBurner.setRevenueSplitter(REVENUE_SPLITTER_ADDRESS);
  await setSplitterTx.wait();
  console.log('✅ BuybackBurner.revenueSplitter set to:', REVENUE_SPLITTER_ADDRESS);
  console.log('');

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 PHASE 2 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  console.log('🌐 Network:', network.name, '(Chain ID:', chainId + ')');
  console.log('👤 Deployer:', deployer.address);
  console.log('');
  console.log('📝 Phase 2 Contract Addresses:');
  console.log('   rXF:                  ', rXFAddress);
  console.log('   BuybackBurner:        ', buybackBurnerAddress);
  console.log('');
  console.log('📝 Phase 1 Contract Addresses (for reference):');
  console.log('   XF Token:             ', XF_TOKEN);
  console.log('   Revenue Token:       ', REVENUE_TOKEN);
  console.log('   veXF:                ', VEXF_ADDRESS);
  console.log('   RevenueSplitter:     ', REVENUE_SPLITTER_ADDRESS);
  console.log('='.repeat(60));
  console.log('');
  console.log('📌 Next Steps:');
  console.log('   1. Verify all contract addresses on block explorer');
  console.log('   2. Test rXF minting via RevenueSplitter.splitRevenue()');
  console.log('   3. Test buyback and burn via BuybackBurner');
  console.log('   4. Configure swap router in BuybackBurner if using automatic swaps');
  console.log('   5. Test rXF redemption after 365 days');
  console.log('   6. Test voting boost (4× rXF balance)');
  console.log('   7. Transfer ownership to multisig/governance if needed');
  console.log('');

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    phase1: phase1Deployment || {
      contracts: {
        xfToken: XF_TOKEN,
        revenueToken: REVENUE_TOKEN,
        veXF: VEXF_ADDRESS,
        revenueSplitter: REVENUE_SPLITTER_ADDRESS,
      },
    },
    contracts: {
      rXF: rXFAddress,
      buybackBurner: buybackBurnerAddress,
    },
    implementationAddresses: {
      rXF: await upgrades.erc1967.getImplementationAddress(rXFAddress),
      buybackBurner: await upgrades.erc1967.getImplementationAddress(buybackBurnerAddress),
    },
  };

  const deploymentPath = path.join(__dirname, '..', 'deployments', `phase2-${chainId}.json`);
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

  updateEnvVar('VITE_RXF_ADDRESS', rXFAddress);
  updateEnvVar('VITE_BUYBACK_BURNER_ADDRESS', buybackBurnerAddress);
  if (SWAP_ROUTER !== ethers.ZeroAddress) {
    updateEnvVar('SWAP_ROUTER_ADDRESS', SWAP_ROUTER);
  }

  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('✅ Updated .env file with Phase 2 contract addresses\n');

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

