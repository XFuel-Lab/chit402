import hre from 'hardhat';
const { ethers } = hre;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🧪 Testing XFUELRouter IFeeAdapter Integration on Theta Mainnet...\n');

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

  console.log('📋 Contract Addresses:');
  console.log('   CyberneticFeeSwitch:', contracts.feeSwitch);
  console.log('');

  // Check if XFUELRouter is deployed (it may not be in Phase 1)
  // For now, we'll test the integration logic
  console.log('🔌 Testing IFeeAdapter Interface Integration:\n');

  // Test 1: Check fee adapter state
  console.log('1️⃣  Checking Fee Adapter State:');
  const feesEnabled = await feeSwitch.isFeesEnabled();
  const feeMultiplier = await feeSwitch.getFeeMultiplier();
  const currentFeeBps = await feeSwitch.getCurrentFeeBps();
  
  console.log('   Fees Enabled:', feesEnabled);
  console.log('   Fee Multiplier:', feeMultiplier.toString(), 'bps');
  console.log('   Current Fee:', currentFeeBps.toString(), 'bps');
  console.log('');

  // Test 2: Test effective fee calculation
  console.log('2️⃣  Testing Effective Fee Calculation:');
  const testBaseFees = [30, 50, 100, 300]; // 0.3%, 0.5%, 1%, 3%
  
  for (const baseFee of testBaseFees) {
    const effectiveFee = await feeSwitch.getEffectiveFee(baseFee);
    const expectedFee = feesEnabled ? (baseFee * Number(currentFeeBps)) / 10000 : 0;
    console.log(`   Base Fee: ${baseFee} bps (${(baseFee / 100).toFixed(2)}%)`);
    console.log(`   Effective Fee: ${effectiveFee.toString()} bps (${(Number(effectiveFee) / 100).toFixed(2)}%)`);
    console.log(`   Expected: ${expectedFee} bps`);
    console.log('');
  }

  // Test 3: Simulate router integration
  console.log('3️⃣  Simulating Router Integration:');
  console.log('   Router would call:');
  console.log('   - feeAdapter.isFeesEnabled()');
  console.log('   - feeAdapter.getEffectiveFee(baseFeeBps)');
  console.log('   - Apply fee to swap amount');
  console.log('');

  // Test 4: Test fee mode switching impact
  console.log('4️⃣  Testing Fee Mode Impact:');
  const currentMode = await feeSwitch.getFeeMode();
  const modeName = currentMode === 0 ? 'Growth' : 'Extraction';
  console.log(`   Current Mode: ${modeName}`);
  
  // Calculate effective fees for both modes
  const growthFeeBps = 10; // 0.1%
  const extractionFeeBps = 100; // 1.0%
  
  // Simulate Growth mode
  const growthEffective30 = (30 * growthFeeBps) / 10000;
  const growthEffective100 = (100 * growthFeeBps) / 10000;
  
  // Simulate Extraction mode
  const extractionEffective30 = (30 * extractionFeeBps) / 10000;
  const extractionEffective100 = (100 * extractionFeeBps) / 10000;
  
  console.log('   Growth Mode (0.1% multiplier):');
  console.log(`     Base 0.3% → Effective: ${growthEffective30.toFixed(4)}%`);
  console.log(`     Base 1.0% → Effective: ${growthEffective100.toFixed(4)}%`);
  console.log('   Extraction Mode (1.0% multiplier):');
  console.log(`     Base 0.3% → Effective: ${extractionEffective30.toFixed(4)}%`);
  console.log(`     Base 1.0% → Effective: ${extractionEffective100.toFixed(4)}%`);
  console.log('');

  // Test 5: Integration summary
  console.log('='.repeat(60));
  console.log('✅ Integration Test Summary');
  console.log('='.repeat(60));
  console.log('\n📋 Integration Points:');
  console.log('   1. XFUELRouter.setFeeAdapter(feeSwitchAddress)');
  console.log('   2. Router queries feeAdapter.isFeesEnabled()');
  console.log('   3. Router calls feeAdapter.getEffectiveFee(baseFeeBps)');
  console.log('   4. Router applies effective fee to swap amounts');
  console.log('   5. Fees can be dynamically adjusted via governance');
  console.log('\n🎯 Benefits:');
  console.log('   - Dynamic fee control via veXF governance');
  console.log('   - Growth mode: Lower fees to attract TVL');
  console.log('   - Extraction mode: Higher fees for revenue');
  console.log('   - Cooldown protection prevents rapid changes');
  console.log('\n📌 Next Steps:');
  console.log('   1. Deploy or update XFUELRouter with IFeeAdapter integration');
  console.log('   2. Call router.setFeeAdapter(feeSwitchAddress)');
  console.log('   3. Test swap with dynamic fees');
  console.log('   4. Monitor fee changes via governance');
  console.log('\n📌 Explorer Links:');
  console.log('   CyberneticFeeSwitch:', `https://explorer.thetatoken.org/address/${contracts.feeSwitch}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });


