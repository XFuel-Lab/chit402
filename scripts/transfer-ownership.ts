import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🔐 Starting ownership transfer to new wallet...\n');

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      '❌ No signers available. Please set THETA_MAINNET_PRIVATE_KEY in your .env file.'
    );
  }

  const [deployer] = signers;
  console.log('📝 Current owner (deployer):', deployer.address);
  
  // New owner address
  const NEW_OWNER = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';
  console.log('🎯 New owner address:', NEW_OWNER);
  console.log('');

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId.toString();

  // Load deployment info
  const phase1Path = path.join(__dirname, '..', 'deployments', `phase1-${chainId}.json`);
  const phase2Path = path.join(__dirname, '..', 'deployments', `phase2-${chainId}.json`);
  const phase3Path = path.join(__dirname, '..', 'deployments', `phase3-${chainId}.json`);

  let phase1Deployment: any = null;
  let phase2Deployment: any = null;
  let phase3Deployment: any = null;

  if (fs.existsSync(phase1Path)) {
    phase1Deployment = JSON.parse(fs.readFileSync(phase1Path, 'utf8'));
  }
  if (fs.existsSync(phase2Path)) {
    phase2Deployment = JSON.parse(fs.readFileSync(phase2Path, 'utf8'));
  }
  if (fs.existsSync(phase3Path)) {
    phase3Deployment = JSON.parse(fs.readFileSync(phase3Path, 'utf8'));
  }

  // Collect all contract addresses
  const contracts: { name: string; address: string }[] = [];

  if (phase1Deployment?.contracts) {
    if (phase1Deployment.contracts.veXF) {
      contracts.push({ name: 'veXF', address: phase1Deployment.contracts.veXF });
    }
    if (phase1Deployment.contracts.revenueSplitter) {
      contracts.push({ name: 'RevenueSplitter', address: phase1Deployment.contracts.revenueSplitter });
    }
    if (phase1Deployment.contracts.feeSwitch) {
      contracts.push({ name: 'CyberneticFeeSwitch', address: phase1Deployment.contracts.feeSwitch });
    }
  }

  if (phase2Deployment?.contracts) {
    if (phase2Deployment.contracts.rXF) {
      contracts.push({ name: 'rXF', address: phase2Deployment.contracts.rXF });
    }
    if (phase2Deployment.contracts.buybackBurner) {
      contracts.push({ name: 'BuybackBurner', address: phase2Deployment.contracts.buybackBurner });
    }
  }

  if (phase3Deployment?.contracts) {
    if (phase3Deployment.contracts.thetaPulseProof) {
      contracts.push({ name: 'ThetaPulseProof', address: phase3Deployment.contracts.thetaPulseProof });
    }
    if (phase3Deployment.contracts.innovationTreasury) {
      contracts.push({ name: 'InnovationTreasury', address: phase3Deployment.contracts.innovationTreasury });
    }
  }

  if (contracts.length === 0) {
    throw new Error('❌ No contracts found in deployment files.');
  }

  console.log(`📋 Found ${contracts.length} contracts to transfer:\n`);
  contracts.forEach((c) => {
    console.log(`   - ${c.name}: ${c.address}`);
  });
  console.log('');

  // Transfer ownership for each contract
  const results: { name: string; address: string; success: boolean; txHash?: string; error?: string }[] = [];

  for (const contract of contracts) {
    try {
      console.log(`🔄 Transferring ownership of ${contract.name}...`);
      
      // Get contract factory and attach to address
      const ContractFactory = await ethers.getContractFactory(contract.name);
      const contractInstance = ContractFactory.attach(contract.address);

      // Verify current owner
      const currentOwner = await contractInstance.owner();
      if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        console.log(`   ⚠️  Current owner is ${currentOwner}, not deployer. Skipping...`);
        results.push({ name: contract.name, address: contract.address, success: false, error: 'Owner mismatch' });
        continue;
      }

      // Transfer ownership
      const tx = await contractInstance.transferOwnership(NEW_OWNER, { gasLimit: 500000 });
      console.log(`   📝 Transaction sent: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Ownership transferred! Block: ${receipt?.blockNumber}`);
      
      // Verify new owner
      const newOwner = await contractInstance.owner();
      if (newOwner.toLowerCase() === NEW_OWNER.toLowerCase()) {
        console.log(`   ✅ Verified: New owner is ${newOwner}\n`);
        results.push({ name: contract.name, address: contract.address, success: true, txHash: tx.hash });
      } else {
        console.log(`   ⚠️  Warning: Owner verification failed. Expected ${NEW_OWNER}, got ${newOwner}\n`);
        results.push({ name: contract.name, address: contract.address, success: false, error: 'Verification failed' });
      }
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}\n`);
      results.push({ name: contract.name, address: contract.address, success: false, error: error.message });
    }
  }

  // Print summary
  console.log('='.repeat(60));
  console.log('📋 OWNERSHIP TRANSFER SUMMARY');
  console.log('='.repeat(60));
  console.log(`🌐 Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`👤 Previous Owner: ${deployer.address}`);
  console.log(`🎯 New Owner: ${NEW_OWNER}`);
  console.log('');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Successful transfers: ${successful.length}`);
  successful.forEach((r) => {
    console.log(`   - ${r.name}: ${r.txHash}`);
  });

  if (failed.length > 0) {
    console.log(`\n❌ Failed transfers: ${failed.length}`);
    failed.forEach((r) => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }

  console.log('='.repeat(60));
  console.log('');

  // Save transfer log
  const transferLog = {
    network: network.name,
    chainId: chainId.toString(),
    timestamp: new Date().toISOString(),
    previousOwner: deployer.address,
    newOwner: NEW_OWNER,
    results: results,
  };

  const logPath = path.join(__dirname, '..', 'deployments', `ownership-transfer-${chainId}-${Date.now()}.json`);
  const deploymentsDir = path.dirname(logPath);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(logPath, JSON.stringify(transferLog, null, 2));
  console.log(`✅ Transfer log saved to: ${logPath}\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Ownership transfer failed:', error);
    process.exit(1);
  });


