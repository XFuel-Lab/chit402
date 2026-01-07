import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 Testing CyberneticFeeSwitch on Theta Mainnet...\n');

  // Load deployment addresses
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'phase1-mainnet.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error('Deployment file not found. Please deploy Phase 1 contracts first.');
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const { contracts } = deployment;

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error('No signers available. Please set THETA_MAINNET_PRIVATE_KEY in .env');
  }

  const [deployer] = signers;
  console.log('📝 Testing with account:', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('💰 Account balance:', ethers.formatEther(balance), 'TFUEL\n');

  // Get contract instances
  const CyberneticFeeSwitch = await ethers.getContractFactory('CyberneticFeeSwitch');
  const feeSwitch = CyberneticFeeSwitch.attach(contracts.feeSwitch);

  const veXF = await ethers.getContractFactory('veXF');
  const veXFContract = veXF.attach(contracts.veXF);

  console.log('📋 Contract Addresses:');
  console.log('   CyberneticFeeSwitch:', contracts.feeSwitch);
  console.log('   veXF:', contracts.veXF);
  console.log('');

  // Check initial state
  console.log('📊 Initial State:');
  const initialFeesEnabled = await feeSwitch.feesEnabled();
  const initialFeeBps = await feeSwitch.getCurrentFeeBps();
  const initialMode = await feeSwitch.getFeeMode();
  const initialMinVeXF = await feeSwitch.minVeXFForFeeChange();

  console.log('   Fees Enabled:', initialFeesEnabled);
  console.log('   Current Fee (bps):', initialFeeBps.toString());
  console.log('   Fee Mode:', initialMode === 0 ? 'Growth' : 'Extraction');
  console.log('   Min veXF for Fee Change:', ethers.formatEther(initialMinVeXF));
  console.log('');

  // Test IFeeAdapter interface
  console.log('🔌 Testing IFeeAdapter Interface:');
  const feeMultiplier = await feeSwitch.getFeeMultiplier();
  const isEnabled = await feeSwitch.isFeesEnabled();
  const baseFee = 100; // 1% base fee
  const effectiveFee = await feeSwitch.getEffectiveFee(baseFee);

  console.log('   getFeeMultiplier():', feeMultiplier.toString(), 'bps');
  console.log('   isFeesEnabled():', isEnabled);
  console.log('   getEffectiveFee(100 bps):', effectiveFee.toString(), 'bps');
  console.log('');

  // Test fee mode switching (owner only)
  console.log('🔄 Testing Fee Mode Switching...');
  
  // Check current mode
  const currentMode = await feeSwitch.getFeeMode();
  // FeeMode enum: 0 = Growth, 1 = Extraction
  const newMode = Number(currentMode) === 0 ? 1 : 0; // Toggle between Growth and Extraction

  try {
    const modeName = newMode === 0 ? 'Growth' : 'Extraction';
    console.log(`   Switching to ${modeName} mode...`);
    
    const switchTx = await feeSwitch.setFeeMode(newMode, { gasLimit: 500000 });
    const receipt = await switchTx.wait();
    
    console.log('✅ Fee mode switched!');
    console.log('   Transaction hash:', receipt.hash);
    console.log('   Block number:', receipt.blockNumber);
    console.log('');

    // Check new state
    const newFeeBps = await feeSwitch.getCurrentFeeBps();
    const newModeCheck = await feeSwitch.getFeeMode();
    const newEffectiveFee = await feeSwitch.getEffectiveFee(baseFee);

    console.log('📊 New State:');
    console.log('   Fee Mode:', newModeCheck === 0 ? 'Growth' : 'Extraction');
    console.log('   Current Fee (bps):', newFeeBps.toString());
    console.log('   Effective Fee (100 bps base):', newEffectiveFee.toString(), 'bps');
    console.log('');

    // Check cooldown
    const cooldownActive = await feeSwitch.isCooldownActive();
    const cooldownRemaining = await feeSwitch.getCooldownTimeRemaining();
    console.log('⏱️  Cooldown Status:');
    console.log('   Cooldown Active:', cooldownActive);
    if (cooldownActive) {
      const daysRemaining = Number(cooldownRemaining) / (24 * 60 * 60);
      console.log('   Time Remaining:', daysRemaining.toFixed(2), 'days');
    }
    console.log('');

  } catch (error: any) {
    if (error.message.includes('cooldown')) {
      console.log('⚠️  Cooldown active. Cannot switch fee mode yet.');
      const cooldownRemaining = await feeSwitch.getCooldownTimeRemaining();
      const daysRemaining = Number(cooldownRemaining) / (24 * 60 * 60);
      console.log('   Time Remaining:', daysRemaining.toFixed(2), 'days');
    } else {
      throw error;
    }
  }

  // Test custom fee setting (owner only)
  console.log('🎛️  Testing Custom Fee Setting...');
  const customFeeBps = 50; // 0.5%
  
  try {
    console.log(`   Setting custom fee to ${customFeeBps} bps (0.5%)...`);
    const customFeeTx = await feeSwitch.setCustomFee(customFeeBps, { gasLimit: 500000 });
    const receipt = await customFeeTx.wait();
    
    console.log('✅ Custom fee set!');
    console.log('   Transaction hash:', receipt.hash);
    console.log('   Block number:', receipt.blockNumber);
    console.log('');

    // Verify custom fee
    const updatedFeeBps = await feeSwitch.getCurrentFeeBps();
    const updatedEffectiveFee = await feeSwitch.getEffectiveFee(baseFee);
    
    console.log('📊 Updated State:');
    console.log('   Current Fee (bps):', updatedFeeBps.toString());
    console.log('   Effective Fee (100 bps base):', updatedEffectiveFee.toString(), 'bps');
    console.log('');

    // Reset to Growth mode for consistency
    console.log('   Resetting to Growth mode...');
    const resetTx = await feeSwitch.setFeeMode(0);
    await resetTx.wait();
    console.log('✅ Reset to Growth mode\n');

  } catch (error: any) {
    console.log('⚠️  Could not set custom fee:', error.message);
    console.log('');
  }

  // Test fee enable/disable
  console.log('🔌 Testing Fee Enable/Disable...');
  const currentEnabled = await feeSwitch.feesEnabled();
  
  try {
    console.log(`   ${currentEnabled ? 'Disabling' : 'Enabling'} fees...`);
    const toggleTx = await feeSwitch.setFeesEnabled(!currentEnabled, { gasLimit: 500000 });
    const receipt = await toggleTx.wait();
    
    console.log('✅ Fees toggled!');
    console.log('   Transaction hash:', receipt.hash);
    console.log('');

    // Verify
    const newEnabled = await feeSwitch.feesEnabled();
    const newFeeMultiplier = await feeSwitch.getFeeMultiplier();
    const newEffectiveFeeDisabled = await feeSwitch.getEffectiveFee(baseFee);

    console.log('📊 Updated State:');
    console.log('   Fees Enabled:', newEnabled);
    console.log('   Fee Multiplier:', newFeeMultiplier.toString(), 'bps');
    console.log('   Effective Fee (should be 0 if disabled):', newEffectiveFeeDisabled.toString(), 'bps');
    console.log('');

    // Re-enable for consistency
    if (!newEnabled) {
      console.log('   Re-enabling fees...');
      const reenableTx = await feeSwitch.setFeesEnabled(true);
      await reenableTx.wait();
      console.log('✅ Fees re-enabled\n');
    }

  } catch (error: any) {
    console.log('⚠️  Could not toggle fees:', error.message);
    console.log('');
  }

  // Final state summary
  const finalFeesEnabled = await feeSwitch.feesEnabled();
  const finalFeeBps = await feeSwitch.getCurrentFeeBps();
  const finalMode = await feeSwitch.getFeeMode();
  const finalFeeMultiplier = await feeSwitch.getFeeMultiplier();
  const finalEffectiveFee = await feeSwitch.getEffectiveFee(baseFee);

  console.log('='.repeat(60));
  console.log('✅ Fee Switch Test Complete!');
  console.log('='.repeat(60));
  console.log('\n📊 Final State:');
  console.log('   Fees Enabled:', finalFeesEnabled);
  console.log('   Fee Mode:', finalMode === 0 ? 'Growth' : 'Extraction');
  console.log('   Current Fee (bps):', finalFeeBps.toString());
  console.log('   Fee Multiplier:', finalFeeMultiplier.toString(), 'bps');
  console.log('   Effective Fee (100 bps base):', finalEffectiveFee.toString(), 'bps');
  console.log('\n📌 Explorer Links:');
  console.log('   CyberneticFeeSwitch:', `https://explorer.thetatoken.org/address/${contracts.feeSwitch}`);
  console.log('   veXF:', `https://explorer.thetatoken.org/address/${contracts.veXF}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });

