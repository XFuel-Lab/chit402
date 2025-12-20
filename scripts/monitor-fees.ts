import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('📊 Monitoring Fee Changes via veXF Governance...\n');

  // Load deployments
  const phase1Path = path.join(__dirname, '..', 'deployments', 'phase1-mainnet.json');
  if (!fs.existsSync(phase1Path)) {
    throw new Error('Phase 1 deployment not found.');
  }

  const phase1Deployment = JSON.parse(fs.readFileSync(phase1Path, 'utf8'));
  const { contracts } = phase1Deployment;

  const routerPath = path.join(__dirname, '..', 'deployments', 'router-mainnet.json');
  let routerAddress = null;
  if (fs.existsSync(routerPath)) {
    const routerDeployment = JSON.parse(fs.readFileSync(routerPath, 'utf8'));
    routerAddress = routerDeployment.router;
  }

  // Get contract instances
  const CyberneticFeeSwitch = await ethers.getContractFactory('CyberneticFeeSwitch');
  const feeSwitch = CyberneticFeeSwitch.attach(contracts.feeSwitch);

  const veXF = await ethers.getContractFactory('veXF');
  const veXFContract = veXF.attach(contracts.veXF);

  console.log('📋 Contract Addresses:');
  console.log('   FeeSwitch:', contracts.feeSwitch);
  console.log('   veXF:', contracts.veXF);
  if (routerAddress) {
    console.log('   Router:', routerAddress);
  }
  console.log('');

  // Current state
  console.log('📊 Current Fee State:');
  const feesEnabled = await feeSwitch.feesEnabled();
  const currentFeeBps = await feeSwitch.getCurrentFeeBps();
  const feeMode = await feeSwitch.getFeeMode();
  const modeName = Number(feeMode) === 0 ? 'Growth' : 'Extraction';
  const minVeXF = await feeSwitch.minVeXFForFeeChange();
  const cooldownActive = await feeSwitch.isCooldownActive();
  const cooldownRemaining = await feeSwitch.getCooldownTimeRemaining();
  const lastFeeChangeTime = await feeSwitch.lastFeeChangeTime();

  console.log('   Fees Enabled:', feesEnabled);
  console.log('   Fee Mode:', modeName);
  console.log('   Current Fee:', currentFeeBps.toString(), 'bps', `(${(Number(currentFeeBps) / 100).toFixed(2)}%)`);
  console.log('   Min veXF for Change:', ethers.formatEther(minVeXF));
  console.log('   Cooldown Active:', cooldownActive);
  if (cooldownActive) {
    const daysRemaining = Number(cooldownRemaining) / (24 * 60 * 60);
    const hoursRemaining = (Number(cooldownRemaining) % (24 * 60 * 60)) / (60 * 60);
    console.log('   Cooldown Remaining:', `${Math.floor(daysRemaining)}d ${Math.floor(hoursRemaining)}h`);
  }
  if (Number(lastFeeChangeTime) > 0) {
    const lastChangeDate = new Date(Number(lastFeeChangeTime) * 1000);
    console.log('   Last Fee Change:', lastChangeDate.toISOString());
  }
  console.log('');

  // Governance requirements
  console.log('🗳️  Governance Requirements:');
  console.log('   Minimum veXF Required:', ethers.formatEther(minVeXF));
  console.log('   Cooldown Period:', '7 days');
  console.log('   Fee Modes:');
  console.log('     - Growth: 0.1% fee multiplier (attract TVL)');
  console.log('     - Extraction: 1.0% fee multiplier (maximize revenue)');
  console.log('');

  // Router integration status
  if (routerAddress) {
    console.log('🔌 Router Integration:');
    try {
      const XFUELRouter = await ethers.getContractFactory('XFUELRouter');
      const router = XFUELRouter.attach(routerAddress);
      
      const routerFeeAdapter = await router.feeAdapter();
      const routerFeesEnabled = await router.isFeesEnabled();
      const routerEffectiveFee = await router.getEffectiveFee();
      const routerBaseFee = await router.baseFeeBps();

      console.log('   Router Fee Adapter:', routerFeeAdapter);
      console.log('   Router Fees Enabled:', routerFeesEnabled);
      console.log('   Router Base Fee:', routerBaseFee.toString(), 'bps');
      console.log('   Router Effective Fee:', routerEffectiveFee.toString(), 'bps');
      
      if (routerFeeAdapter.toLowerCase() === contracts.feeSwitch.toLowerCase()) {
        console.log('   ✅ Router connected to FeeSwitch');
      } else {
        console.log('   ⚠️  Router not connected to FeeSwitch');
      }
      console.log('');
    } catch (error: any) {
      console.log('   ⚠️  Could not read router state:', error.message);
      console.log('');
    }
  }

  // Fee impact analysis
  console.log('📈 Fee Impact Analysis:');
  const baseFee = routerAddress ? await (await ethers.getContractFactory('XFUELRouter')).attach(routerAddress).baseFeeBps() : 30n;
  const growthEffective = await feeSwitch.getEffectiveFee(baseFee);
  const extractionEffective = (baseFee * 100n) / 10000n; // 1.0% multiplier

  console.log(`   Base Fee: ${baseFee.toString()} bps (${(Number(baseFee) / 100).toFixed(2)}%)`);
  console.log('   Growth Mode Effective Fee:', growthEffective.toString(), 'bps', `(${(Number(growthEffective) / 100).toFixed(4)}%)`);
  console.log('   Extraction Mode Effective Fee:', extractionEffective.toString(), 'bps', `(${(Number(extractionEffective) / 100).toFixed(4)}%)`);
  console.log('');

  // Example swap impact
  console.log('💱 Example Swap Impact (100 TFUEL):');
  const swapAmount = ethers.parseEther('100');
  const growthFee = (swapAmount * growthEffective) / 10000n;
  const extractionFee = (swapAmount * extractionEffective) / 10000n;
  
  console.log('   Growth Mode:');
  console.log(`     Fee: ${ethers.formatEther(growthFee)} TFUEL`);
  console.log(`     Amount After Fee: ${ethers.formatEther(swapAmount - growthFee)} TFUEL`);
  console.log('   Extraction Mode:');
  console.log(`     Fee: ${ethers.formatEther(extractionFee)} TFUEL`);
  console.log(`     Amount After Fee: ${ethers.formatEther(swapAmount - extractionFee)} TFUEL`);
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('📊 Fee Monitoring Summary');
  console.log('='.repeat(60));
  console.log('\n✅ Current Status:');
  console.log(`   Mode: ${modeName}`);
  console.log(`   Fee: ${currentFeeBps.toString()} bps (${(Number(currentFeeBps) / 100).toFixed(2)}%)`);
  console.log(`   Enabled: ${feesEnabled}`);
  console.log(`   Cooldown: ${cooldownActive ? 'Active' : 'Inactive'}`);
  console.log('\n📌 Explorer Links:');
  console.log('   FeeSwitch:', `https://explorer.thetatoken.org/address/${contracts.feeSwitch}`);
  console.log('   veXF:', `https://explorer.thetatoken.org/address/${contracts.veXF}`);
  if (routerAddress) {
    console.log('   Router:', `https://explorer.thetatoken.org/address/${routerAddress}`);
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Monitoring failed:', error);
    process.exit(1);
  });


