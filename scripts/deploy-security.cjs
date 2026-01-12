const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Security-Enhanced XFUEL Protocol Deployment Script
 * 
 * Deploys:
 * - rXF token with 48h timelock on mints
 * - LP Treasury with 2-sig multisig
 * - XFuel Timelock (48h delay)
 * - Enhanced TreasuryILBackstop with pausables and low reserve backstop
 * - Existing contracts (TipPool, XFUELPoolFactory, XFUELRouter)
 */
async function main() {
  console.log('🔐 Starting Security-Enhanced XFUEL Protocol Deployment...\n');
  console.log('📦 Network: Theta Testnet (Chain ID: 365)\n');

  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      '❌ No signers available. Please set THETA_TESTNET_PRIVATE_KEY in your .env file.\n' +
      '   Example: THETA_TESTNET_PRIVATE_KEY=0xYourPrivateKeyHere'
    );
  }

  const [deployer] = signers;
  console.log('👤 Deploying with account:', deployer.address);
  const balance = await deployer.getBalance();
  console.log('💰 Account balance:', hre.ethers.utils.formatEther(balance), 'TFUEL\n');

  if (balance.lt(hre.ethers.utils.parseEther('0.1'))) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n');
  }

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const deployed = {};

  // ============ SECURITY CONTRACTS ============
  
  console.log('🔒 === SECURITY LAYER DEPLOYMENT ===\n');

  // 1. Deploy XFuel Timelock (48 hours delay)
  console.log('📦 [1/7] Deploying XFuelTimelock (48h delay)...');
  const TIMELOCK_DELAY = 48 * 60 * 60; // 48 hours in seconds
  const proposers = [deployer.address]; // Add multisig addresses here
  const executors = [deployer.address]; // Can be changed to multisig
  
  const XFuelTimelock = await hre.ethers.getContractFactory('XFuelTimelock');
  const timelock = await XFuelTimelock.deploy(
    TIMELOCK_DELAY,
    proposers,
    executors,
    deployer.address // admin
  );
  await timelock.deployed();
  deployed.timelock = timelock.address;
  console.log('   ✅ XFuelTimelock deployed:', timelock.address);
  console.log('      Delay: 48 hours\n');

  // 2. Deploy rXF Token with Timelock
  console.log('📦 [2/7] Deploying rXF Token (Rewards XFuel)...');
  const INITIAL_SUPPLY_CAP = hre.ethers.utils.parseEther('10000000'); // 10M cap
  
  const RXF = await hre.ethers.getContractFactory('rXF');
  const rXF = await RXF.deploy();
  await rXF.deployed();
  
  // Initialize rXF
  await rXF.initialize(deployer.address, INITIAL_SUPPLY_CAP);
  console.log('   ✅ rXF Token deployed:', rXF.address);
  console.log('      Supply Cap: 10M rXF');
  console.log('      Timelock Delay: 48h on all mints\n');
  deployed.rXF = rXF.address;

  // 3. Deploy LP Treasury with 2-Sig
  console.log('📦 [3/7] Deploying LPTreasury (2-sig multisig)...');
  const signers2 = [deployer.address, deployer.address]; // Add 2nd signer address
  const requiredSigs = 2; // Minimum 2 signatures
  const lowReserveThreshold = 1000; // 10% threshold
  
  const LPTreasury = await hre.ethers.getContractFactory('LPTreasury');
  const lpTreasury = await LPTreasury.deploy();
  await lpTreasury.deployed();
  
  // Initialize LP Treasury
  await lpTreasury.initialize(signers2, requiredSigs, lowReserveThreshold);
  console.log('   ✅ LPTreasury deployed:', lpTreasury.address);
  console.log('      Required Signatures: 2');
  console.log('      Low Reserve Threshold: 10%\n');
  deployed.lpTreasury = lpTreasury.address;

  // ============ CORE CONTRACTS ============
  
  console.log('⚙️  === CORE PROTOCOL DEPLOYMENT ===\n');

  // 4. Deploy TreasuryILBackstop (Enhanced)
  console.log('📦 [4/7] Deploying TreasuryILBackstop (Enhanced)...');
  const backstopThreshold = 1000; // 10%
  const minimumReserve = hre.ethers.utils.parseEther('10000'); // 10k min reserve
  
  const TreasuryILBackstop = await hre.ethers.getContractFactory('TreasuryILBackstop');
  const treasuryBackstop = await TreasuryILBackstop.deploy(
    ZERO_ADDRESS, // Treasury token (set later)
    backstopThreshold,
    minimumReserve
  );
  await treasuryBackstop.deployed();
  console.log('   ✅ TreasuryILBackstop deployed:', treasuryBackstop.address);
  console.log('      Pausable: ✓ (payouts + unwrap)');
  console.log('      Low Reserve Backstop: ✓');
  console.log('      Minimum Reserve: 10k tokens\n');
  deployed.treasuryBackstop = treasuryBackstop.address;

  // 5. Deploy TipPool
  console.log('📦 [5/7] Deploying TipPool...');
  const TipPool = await hre.ethers.getContractFactory('TipPool');
  const tipPool = await TipPool.deploy();
  await tipPool.deployed();
  console.log('   ✅ TipPool deployed:', tipPool.address);
  console.log('');
  deployed.tipPool = tipPool.address;

  // 6. Deploy XFUELPoolFactory
  console.log('📦 [6/7] Deploying XFUELPoolFactory...');
  const XFUELPoolFactory = await hre.ethers.getContractFactory('XFUELPoolFactory');
  const poolFactory = await XFUELPoolFactory.deploy();
  await poolFactory.deployed();
  console.log('   ✅ XFUELPoolFactory deployed:', poolFactory.address);
  console.log('');
  deployed.poolFactory = poolFactory.address;

  // 7. Deploy XFUELRouter
  console.log('📦 [7/7] Deploying XFUELRouter...');
  const XFUELRouter = await hre.ethers.getContractFactory('XFUELRouter');
  const router = await XFUELRouter.deploy(
    poolFactory.address,
    treasuryBackstop.address,
    ZERO_ADDRESS, // xfuelToken (set later)
    ZERO_ADDRESS, // usdcToken (set later)
    lpTreasury.address, // treasury (LP Treasury)
    ZERO_ADDRESS  // veXFContract (set later)
  );
  await router.deployed();
  console.log('   ✅ XFUELRouter deployed:', router.address);
  console.log('      Treasury: LP Treasury (2-sig)');
  console.log('      Pausable: ✓\n');
  deployed.router = router.address;

  // ============ POST-DEPLOYMENT SETUP ============
  
  console.log('🔧 === POST-DEPLOYMENT CONFIGURATION ===\n');

  // Connect contracts
  console.log('🔗 Connecting contracts...');
  
  // Set timelock on rXF
  await rXF.setTimelockController(timelock.address);
  console.log('   ✅ rXF → Timelock connected');
  
  // Set timelock on TreasuryBackstop
  await treasuryBackstop.setTimelock(timelock.address);
  console.log('   ✅ TreasuryBackstop → Timelock connected');
  
  // Set LP Treasury as backstop funder
  await treasuryBackstop.setBackstopFunder(lpTreasury.address);
  console.log('   ✅ TreasuryBackstop → LP Treasury (backstop funder)');
  
  console.log('');

  // ============ DEPLOYMENT SUMMARY ============
  
  console.log('='.repeat(70));
  console.log('📋 SECURITY-ENHANCED DEPLOYMENT SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log('🔐 SECURITY LAYER:');
  console.log('   XFuelTimelock:       ', deployed.timelock);
  console.log('   rXF Token:           ', deployed.rXF);
  console.log('   LPTreasury (2-sig):  ', deployed.lpTreasury);
  console.log('');
  console.log('⚙️  CORE PROTOCOL:');
  console.log('   TreasuryILBackstop:  ', deployed.treasuryBackstop);
  console.log('   TipPool:             ', deployed.tipPool);
  console.log('   XFUELPoolFactory:    ', deployed.poolFactory);
  console.log('   XFUELRouter:         ', deployed.router);
  console.log('');
  console.log('🔒 SECURITY FEATURES ENABLED:');
  console.log('   ✓ 48h timelock on rXF mints/changes');
  console.log('   ✓ 2-signature multisig on LP treasury');
  console.log('   ✓ Pausable unwraps/payouts on TreasuryBackstop');
  console.log('   ✓ Low reserve backstop with automatic triggering');
  console.log('   ✓ No multisig on Theta (direct deployment)');
  console.log('');
  console.log('='.repeat(70));
  console.log('');
  console.log('📌 NEXT STEPS:');
  console.log('   1. Add 2nd signer to LPTreasury (replace deployer duplicate)');
  console.log('   2. Set real token addresses (xfuelToken, usdcToken, treasuryToken)');
  console.log('   3. Deploy veXF contract and connect to router');
  console.log('   4. Add proposers/executors to XFuelTimelock');
  console.log('   5. Test timelock operations (48h delay)');
  console.log('   6. Test multisig operations (2-sig requirement)');
  console.log('   7. Test pausable functions (emergency stops)');
  console.log('   8. Test low reserve backstop triggering');
  console.log('');

  // Update deployment addresses file
  const deploymentsPath = path.join(__dirname, '..', 'deployments.json');
  fs.writeFileSync(deploymentsPath, JSON.stringify({
    network: 'theta-testnet',
    chainId: 365,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: deployed,
    securityFeatures: {
      timelockDelay: '48h',
      multisigRequired: 2,
      pausableOperations: ['unwrap', 'payout'],
      lowReserveBackstop: true
    }
  }, null, 2));
  console.log('💾 Deployment info saved to deployments.json\n');

  // Update .env file
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const updates = {
    'VITE_ROUTER_ADDRESS': deployed.router,
    'VITE_TIP_POOL_ADDRESS': deployed.tipPool,
    'VITE_RXF_TOKEN_ADDRESS': deployed.rXF,
    'VITE_LP_TREASURY_ADDRESS': deployed.lpTreasury,
    'VITE_TIMELOCK_ADDRESS': deployed.timelock
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('✅ Updated .env file with contract addresses\n');

  return deployed;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

