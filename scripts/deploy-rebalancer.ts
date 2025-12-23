import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 Deploying LPRebalancer contract...\n');

  const network = await hre.ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? 'localhost' : network.name;
  console.log(`📡 Network: ${networkName} (chainId: ${network.chainId})\n`);

  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error('No signers available');
  }

  const [deployer] = signers;
  console.log('📝 Deploying with account:', deployer.address);
  const balance = await deployer.getBalance();
  console.log('💰 Account balance:', ethers.formatEther(balance), 'ETH/TFUEL\n');

  // Load existing deployments to get router and treasury addresses
  const routerPath = path.join(__dirname, '..', 'deployments', `router-${networkName}.json`);
  let routerAddress = null;
  let treasuryAddress = null;

  if (fs.existsSync(routerPath)) {
    const routerDeployment = JSON.parse(fs.readFileSync(routerPath, 'utf8'));
    routerAddress = routerDeployment.router;
  }

  // Try to get treasury from phase deployments
  const phase1Path = path.join(__dirname, '..', 'deployments', `phase1-${networkName}.json`);
  if (fs.existsSync(phase1Path)) {
    const phase1Deployment = JSON.parse(fs.readFileSync(phase1Path, 'utf8'));
    treasuryAddress = phase1Deployment.contracts?.treasury || phase1Deployment.contracts?.innovationTreasury;
  }

  // Prompt for addresses if not found
  if (!routerAddress) {
    console.warn('⚠️  Router address not found in deployments.');
    console.warn('   You can find it in deployments/router-*.json');
    throw new Error('Router address required');
  }

  if (!treasuryAddress) {
    console.warn('⚠️  Treasury address not found in deployments.');
    console.warn('   Using router address as fallback (update later via setTreasury())');
    treasuryAddress = routerAddress; // Fallback, should be updated later
  }

  console.log('📋 Configuration:');
  console.log('   Router:', routerAddress);
  console.log('   Treasury:', treasuryAddress);
  console.log('   Threshold: 1000 bps (10%)');
  console.log('');

  // Deploy LPRebalancer
  console.log('📦 Deploying LPRebalancer...');
  const LPRebalancer = await ethers.getContractFactory('LPRebalancer');
  
  const rebalancer = await LPRebalancer.deploy(
    routerAddress,
    treasuryAddress,
    1000 // 10% threshold (1000 basis points)
  );

  await rebalancer.waitForDeployment();
  const rebalancerAddress = await rebalancer.getAddress();

  console.log('✅ LPRebalancer deployed to:', rebalancerAddress);
  console.log('   Transaction hash:', rebalancer.deploymentTransaction()?.hash);
  console.log('');

  // Save deployment info
  const deploymentDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const deploymentPath = path.join(deploymentDir, `rebalancer-${networkName}.json`);
  const deploymentInfo = {
    network: networkName,
    chainId: network.chainId.toString(),
    rebalancer: rebalancerAddress,
    router: routerAddress,
    treasury: treasuryAddress,
    thresholdBps: '1000',
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log('💾 Deployment info saved to:', deploymentPath);

  // Also update router deployment if it exists
  if (fs.existsSync(routerPath)) {
    const routerDeployment = JSON.parse(fs.readFileSync(routerPath, 'utf8'));
    routerDeployment.rebalancer = rebalancerAddress;
    fs.writeFileSync(routerPath, JSON.stringify(routerDeployment, null, 2));
    console.log('   Updated router deployment file');
  }

  console.log('\n📋 Next Steps:');
  console.log('   1. Update treasury approvals if needed');
  console.log('   2. Configure rebalance cooldown per pool (optional)');
  console.log('   3. Start monitoring: npx hardhat run scripts/monitor-rebalance.ts');
  console.log('   4. Run as daemon: npx hardhat run scripts/monitor-rebalance.ts --daemon');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

