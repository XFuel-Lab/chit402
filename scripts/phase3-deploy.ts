import hre from 'hardhat';
const { ethers, upgrades } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 Starting Phase 3 XFUEL Tokenomics deployment...\n');

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
  const networkName = network.name === 'theta-mainnet' ? 'mainnet' : chainId;

  // Load Phase 1 & 2 deployment info
  const phase1Path = path.join(__dirname, '..', 'deployments', `phase1-${networkName}.json`);
  const phase2Path = path.join(__dirname, '..', 'deployments', `phase2-${networkName}.json`);
  let phase1Deployment: any = null;
  let phase2Deployment: any = null;

  if (fs.existsSync(phase1Path)) {
    phase1Deployment = JSON.parse(fs.readFileSync(phase1Path, 'utf8'));
    console.log('📋 Loaded Phase 1 deployment info from:', phase1Path);
    console.log('   veXF:', phase1Deployment.contracts.veXF);
    console.log('');
  } else {
    console.log('⚠️  Phase 1 deployment file not found. Using environment variables.\n');
  }

  if (fs.existsSync(phase2Path)) {
    phase2Deployment = JSON.parse(fs.readFileSync(phase2Path, 'utf8'));
    console.log('📋 Loaded Phase 2 deployment info from:', phase2Path);
    console.log('');
  }

  // Get addresses from deployments or environment
  const VEXF_ADDRESS = 
    phase1Deployment?.contracts?.veXF || 
    process.env.VEXF_ADDRESS || 
    ethers.ZeroAddress;
  const REVENUE_TOKEN = 
    phase1Deployment?.contracts?.revenueToken || 
    process.env.REVENUE_TOKEN_ADDRESS || 
    ethers.ZeroAddress;

  // Validate Phase 1 addresses
  if (VEXF_ADDRESS === ethers.ZeroAddress) {
    throw new Error('❌ VEXF_ADDRESS is required. Please set it in .env or deploy Phase 1 first.');
  }
  if (REVENUE_TOKEN === ethers.ZeroAddress) {
    throw new Error('❌ REVENUE_TOKEN_ADDRESS is required. Please set it in .env or deploy Phase 1 first.');
  }

  console.log('📋 Phase 3 Configuration:');
  console.log('   veXF:', VEXF_ADDRESS);
  console.log('   Revenue Token:', REVENUE_TOKEN);
  console.log('');

  // Deploy ThetaPulseProof
  console.log('📦 Deploying ThetaPulseProof...');
  const ThetaPulseProof = await ethers.getContractFactory('ThetaPulseProof');
  const pulseProof = await upgrades.deployProxy(
    ThetaPulseProof,
    [VEXF_ADDRESS, deployer.address],
    { 
      initializer: 'initialize',
      kind: 'uups',
      txOverrides: {
        gasLimit: 5000000,
        gasPrice: 4000000000000, // 4000 gwei
      }
    }
  );
  await pulseProof.waitForDeployment();
  const pulseProofAddress = await pulseProof.getAddress();
  console.log('✅ ThetaPulseProof deployed to:', pulseProofAddress);
  console.log('');

  // Configure veXF to allow ThetaPulseProof to set multipliers
  console.log('🔗 Configuring veXF with ThetaPulseProof...');
  const VeXF = await ethers.getContractFactory('veXF');
  const veXF = VeXF.attach(VEXF_ADDRESS);
  const setMultiplierSetterTx = await veXF.setMultiplierSetter(pulseProofAddress, {
    gasLimit: 500000,
  });
  await setMultiplierSetterTx.wait();
  console.log('✅ veXF.multiplierSetter set to:', pulseProofAddress);
  console.log('');

  // Deploy InnovationTreasury
  console.log('📦 Deploying InnovationTreasury...');
  const InnovationTreasury = await ethers.getContractFactory('InnovationTreasury');
  const treasury = await upgrades.deployProxy(
    InnovationTreasury,
    [VEXF_ADDRESS, REVENUE_TOKEN, deployer.address],
    { 
      initializer: 'initialize',
      kind: 'uups',
      txOverrides: {
        gasLimit: 5000000,
      }
    }
  );
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log('✅ InnovationTreasury deployed to:', treasuryAddress);
  console.log('');

  // Optionally authorize Edge Node signers (if provided)
  const edgeNodeSigners = process.env.EDGE_NODE_SIGNERS?.split(',') || [];
  if (edgeNodeSigners.length > 0) {
    console.log('🔐 Authorizing Edge Node signers...');
    for (const signer of edgeNodeSigners) {
      if (ethers.isAddress(signer)) {
        const authTx = await pulseProof.authorizeSigner(signer, {
          gasLimit: 500000,
          gasPrice: 4000000000000, // 4000 gwei
        });
        await authTx.wait();
        console.log('   ✅ Authorized:', signer);
      }
    }
    console.log('');
  } else {
    console.log('⚠️  No Edge Node signers provided in EDGE_NODE_SIGNERS env variable.');
    console.log('   You can authorize signers later using pulseProof.authorizeSigner()\n');
  }

  // Get implementation addresses for explorer links
  const pulseProofImpl = await upgrades.erc1967.getImplementationAddress(pulseProofAddress);
  const treasuryImpl = await upgrades.erc1967.getImplementationAddress(treasuryAddress);
  
  // Generate explorer links (Theta mainnet)
  const explorerBase = 'https://explorer.thetatoken.org/address';
  const explorerLinks: any = {
    deployer: `${explorerBase}/${deployer.address}`,
    thetaPulseProof: `${explorerBase}/${pulseProofAddress}`,
    thetaPulseProofImpl: `${explorerBase}/${pulseProofImpl}`,
    innovationTreasury: `${explorerBase}/${treasuryAddress}`,
    innovationTreasuryImpl: `${explorerBase}/${treasuryImpl}`,
    veXF: `${explorerBase}/${VEXF_ADDRESS}`,
    revenueToken: `${explorerBase}/${REVENUE_TOKEN}`,
  };

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 PHASE 3 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  console.log('🌐 Network:', network.name, '(Chain ID:', chainId + ')');
  console.log('👤 Deployer:', deployer.address);
  console.log('   Explorer:', explorerLinks.deployer);
  console.log('');
  console.log('📝 Phase 3 Contract Addresses:');
  console.log('   ThetaPulseProof:      ', pulseProofAddress);
  console.log('   Explorer:             ', explorerLinks.thetaPulseProof);
  console.log('   Implementation:       ', pulseProofImpl);
  console.log('   Impl Explorer:        ', explorerLinks.thetaPulseProofImpl);
  console.log('');
  console.log('   InnovationTreasury:   ', treasuryAddress);
  console.log('   Explorer:             ', explorerLinks.innovationTreasury);
  console.log('   Implementation:       ', treasuryImpl);
  console.log('   Impl Explorer:        ', explorerLinks.innovationTreasuryImpl);
  console.log('');
  console.log('📝 Phase 1 & 2 Contract Addresses (for reference):');
  console.log('   veXF:                 ', VEXF_ADDRESS);
  console.log('   Explorer:             ', explorerLinks.veXF);
  console.log('   Revenue Token:        ', REVENUE_TOKEN);
  console.log('   Explorer:             ', explorerLinks.revenueToken);
  if (phase2Deployment) {
    console.log('   rXF:                  ', phase2Deployment.contracts.rXF);
    console.log('   BuybackBurner:        ', phase2Deployment.contracts.buybackBurner);
  }
  console.log('='.repeat(60));
  console.log('');
  console.log('📌 Next Steps:');
  console.log('   1. Verify all contract addresses on block explorer');
  console.log('   2. Authorize Edge Node signers in ThetaPulseProof');
  console.log('   3. Test proof verification via backend endpoint or direct contract calls');
  console.log('   4. Deposit funds into InnovationTreasury vaults');
  console.log('   5. Test proposal creation and voting with veXF holders');
  console.log('   6. Transfer ownership to multisig/governance if needed');
  console.log('');

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    phase1: phase1Deployment || {
      contracts: {
        veXF: VEXF_ADDRESS,
        revenueToken: REVENUE_TOKEN,
      },
    },
    phase2: phase2Deployment || {},
    contracts: {
      thetaPulseProof: pulseProofAddress,
      innovationTreasury: treasuryAddress,
    },
    implementationAddresses: {
      thetaPulseProof: pulseProofImpl,
      innovationTreasury: treasuryImpl,
    },
    explorerLinks: explorerLinks,
  };

  const deploymentPath = path.join(__dirname, '..', 'deployments', `phase3-${networkName}.json`);
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

  updateEnvVar('VITE_THETA_PULSE_PROOF_ADDRESS', pulseProofAddress);
  updateEnvVar('VITE_INNOVATION_TREASURY_ADDRESS', treasuryAddress);
  updateEnvVar('THETA_PULSE_PROOF_ADDRESS', pulseProofAddress);

  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('✅ Updated .env file with Phase 3 contract addresses\n');

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

