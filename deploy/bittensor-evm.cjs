/**
 * XFuel Protocol — Bittensor EVM Deployment Script
 *
 * Deploys the ZKVerifierSP1 (with SP1-CC, Hyperlane, dTAO extensions)
 * and TAOCircuit to Bittensor EVM (Chain ID 964).
 *
 * Usage:
 *   npx hardhat run deploy/bittensor-evm.cjs --network bittensor-evm
 *   npx hardhat run deploy/bittensor-evm.cjs --network hardhat
 *
 * Bittensor EVM:
 *   - RPC: https://lite.chain.opentensor.ai
 *   - Chain ID: 964
 *   - Native token: TAO
 *   - Staking precompile V2: 0x0000000000000000000000000000000000000805
 *   - Subnet precompile: 0x0000000000000000000000000000000000000803
 *
 * Required environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY
 *   HYPERLANE_MAILBOX (optional — address(0) disables cross-chain)
 *   SP1_GATEWAY (optional — address(0) for mock mode)
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

const BITTENSOR_CONFIG = {
  'bittensor-evm': {
    name: 'Bittensor EVM Mainnet',
    chainId: 964,
    explorer: null,
    minBalance: ethers.parseEther('0.5'),
    stakingPrecompile: '0x0000000000000000000000000000000000000805',
    hyperlaneDomain: 964,
  },
  'hardhat': {
    name: 'Hardhat Local (simulating Bittensor)',
    chainId: 1337,
    explorer: null,
    minBalance: ethers.parseEther('1'),
    stakingPrecompile: null,
    hyperlaneDomain: 964,
  },
};

const TAO_CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('TAO_EVM_CIRCUIT'));
const AI_TASK_CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('AITask'));
const AI_TASK_VKEY = ethers.keccak256(ethers.toUtf8Bytes('ai-task-program-v1'));

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const config = BITTENSOR_CONFIG[network.name] || BITTENSOR_CONFIG['hardhat'];

  console.log('═══════════════════════════════════════════════════════');
  console.log(' XFuel — Bittensor EVM Deployment');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Network:   ${config.name} (${network.name})`);
  console.log(`  Chain ID:  ${config.chainId}`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} TAO`);
  console.log('');

  if (balance < config.minBalance) {
    console.error(`  ✗ Insufficient balance (need >= ${ethers.formatEther(config.minBalance)} TAO)`);
    process.exit(1);
  }

  const manifest = {
    network: config.name,
    chainId: config.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {},
    gas: {},
  };

  const sp1Gateway = process.env.SP1_GATEWAY || ethers.ZeroAddress;
  const hyperlaneMailbox = process.env.HYPERLANE_MAILBOX || ethers.ZeroAddress;

  // ──────────────────────────────────────────────────────────────────
  //  1. Deploy ZKVerifierSP1
  // ──────────────────────────────────────────────────────────────────
  console.log('  [1/4] Deploying ZKVerifierSP1...');
  const ZKFactory = await ethers.getContractFactory('ZKVerifierSP1');
  const zkVerifier = await ZKFactory.deploy(deployer.address, sp1Gateway);
  await zkVerifier.waitForDeployment();
  const zkAddr = await zkVerifier.getAddress();
  const zkReceipt = await zkVerifier.deploymentTransaction().wait();
  console.log(`    ✓ ZKVerifierSP1 at ${zkAddr}`);
  console.log(`      Gas: ${zkReceipt.gasUsed.toString()}`);
  console.log(`      Mode: ${sp1Gateway === ethers.ZeroAddress ? 'MOCK' : 'LIVE'}`);
  manifest.contracts.ZKVerifierSP1 = zkAddr;
  manifest.gas.ZKVerifierSP1 = zkReceipt.gasUsed.toString();

  // ──────────────────────────────────────────────────────────────────
  //  2. Configure Hyperlane (if available)
  // ──────────────────────────────────────────────────────────────────
  console.log('  [2/4] Configuring Hyperlane...');
  if (hyperlaneMailbox !== ethers.ZeroAddress) {
    await zkVerifier.setMailbox(hyperlaneMailbox);
    console.log(`    ✓ Mailbox set to ${hyperlaneMailbox}`);

    const thetaDomain = 361;
    const zkBytes32 = ethers.zeroPadValue(zkAddr, 32);
    await zkVerifier.configureDomain(thetaDomain, zkBytes32, true);
    console.log(`    ✓ Theta domain (${thetaDomain}) configured`);
  } else {
    console.log('    ⊘ No mailbox — cross-chain relay disabled');
  }
  manifest.contracts.HyperlaneMailbox = hyperlaneMailbox;

  // ──────────────────────────────────────────────────────────────────
  //  3. Configure dTAO Staking (Bittensor only)
  // ──────────────────────────────────────────────────────────────────
  console.log('  [3/4] Configuring dTAO staking...');
  if (config.stakingPrecompile) {
    const minStake = ethers.parseEther('100');
    await zkVerifier.setStakeCheck(config.stakingPrecompile, minStake, true);
    console.log(`    ✓ Staking precompile: ${config.stakingPrecompile}`);
    console.log(`    ✓ Min stake: ${ethers.formatEther(minStake)} TAO`);
    manifest.contracts.StakingPrecompile = config.stakingPrecompile;
  } else {
    console.log('    ⊘ Not Bittensor — staking check disabled');
  }

  // ──────────────────────────────────────────────────────────────────
  //  4. Register Circuits
  // ──────────────────────────────────────────────────────────────────
  console.log('  [4/4] Registering circuits...');

  let tx = await zkVerifier.registerCircuit(AI_TASK_CIRCUIT_ID, AI_TASK_VKEY, 'AI Task');
  await tx.wait();
  console.log('    ✓ AI Task circuit registered');

  const taoVKey = ethers.keccak256(ethers.toUtf8Bytes('tao-evm-circuit-v1'));
  tx = await zkVerifier.registerCircuit(TAO_CIRCUIT_ID, taoVKey, 'TAO EVM Circuit');
  await tx.wait();
  console.log('    ✓ TAO EVM Circuit registered');

  // ──────────────────────────────────────────────────────────────────
  //  Smoke Tests
  // ──────────────────────────────────────────────────────────────────
  console.log('');
  console.log('  Running smoke tests...');

  const stats = await zkVerifier.getStats();
  console.assert(stats.registered === 2n, 'Expected 2 circuits');
  console.log('    ✓ Circuit count = 2');

  const [vkey] = await zkVerifier.getCircuit(AI_TASK_CIRCUIT_ID);
  console.assert(vkey === AI_TASK_VKEY, 'VKey mismatch');
  console.log('    ✓ AI Task VKey correct');

  const ext = await zkVerifier.getExtendedStats();
  console.assert(ext.composed === 0n, 'Expected 0 composed calls');
  console.assert(ext.relayed === 0n, 'Expected 0 relayed');
  console.log('    ✓ Extended stats initialized');

  // ──────────────────────────────────────────────────────────────────
  //  Write Manifest
  // ──────────────────────────────────────────────────────────────────
  const manifestDir = path.join(__dirname, '..', 'deploy-manifests');
  if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });

  const manifestFile = path.join(
    manifestDir,
    `bittensor-evm-${network.name}-${Date.now()}.json`
  );
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Deployment complete!');
  console.log(`  Manifest: ${manifestFile}`);
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
