/**
 * XFuel Protocol — Full Stack Deployment
 *
 * One-shot deployment: Core Layer + all 10 circuits + role configuration.
 *
 * Usage:
 *   npx hardhat run deploy/deploy-full.cjs --network theta-testnet
 *   npx hardhat run deploy/deploy-full.cjs --network theta-mainnet
 *   npx hardhat run deploy/deploy-full.cjs --network hardhat
 *
 * Required environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY
 *   ADMIN_ADDRESS          (defaults to deployer)
 *   BBB_ADDRESS            (defaults to deployer)
 *   LP_ADDRESS             (defaults to deployer)
 *   STAKER_ADDRESS         (defaults to deployer)
 *   TREASURY_ADDRESS       (defaults to deployer)
 *   STAKE_POOL_ADDRESS     (defaults to deployer)
 */
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const bbb = process.env.BBB_ADDRESS || deployer.address;
  const lp = process.env.LP_ADDRESS || deployer.address;
  const staker = process.env.STAKER_ADDRESS || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const stakePool = process.env.STAKE_POOL_ADDRESS || deployer.address;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel Protocol — Full Stack Deployment');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:   ${network.name}`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('');

  const manifest = { network: network.name, timestamp: new Date().toISOString(), contracts: {} };

  // ─── Phase 1: Core Layer ────────────────────────────────────────────
  console.log('──── Phase 1: Core Layer ─────────────────────────────────');

  const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
  const splitter = await SplitterF.deploy(admin, bbb, lp, staker, treasury, stakePool);
  await splitter.waitForDeployment();
  manifest.contracts.CoreRevenueSplitter = await splitter.getAddress();
  console.log(`  ✓ CoreRevenueSplitter: ${manifest.contracts.CoreRevenueSplitter}`);

  const VerifierF = await ethers.getContractFactory('ZKVerifierSP1');
  const verifier = await VerifierF.deploy(admin, ethers.ZeroAddress);
  await verifier.waitForDeployment();
  manifest.contracts.ZKVerifierSP1 = await verifier.getAddress();
  console.log(`  ✓ ZKVerifierSP1:       ${manifest.contracts.ZKVerifierSP1}`);

  // SP1ProofHooks is a library — linked at compile time, not deployed separately.

  const xfToken = process.env.XF_TOKEN_ADDRESS;
  if (xfToken && xfToken !== ethers.ZeroAddress) {
    const GovF = await ethers.getContractFactory('veXFGovernance');
    const gov = await GovF.deploy(admin, xfToken);
    await gov.waitForDeployment();
    manifest.contracts.veXFGovernance = await gov.getAddress();
    console.log(`  ✓ veXFGovernance:      ${manifest.contracts.veXFGovernance}`);
  } else {
    console.log(`  ⚠ veXFGovernance skipped (set XF_TOKEN_ADDRESS to deploy)`);
  }

  // ─── Phase 2: Circuits ──────────────────────────────────────────────
  console.log('\n──── Phase 2: All 10 Circuits ────────────────────────────');
  const splAddr = manifest.contracts.CoreRevenueSplitter;
  const zkAddr = manifest.contracts.ZKVerifierSP1;

  const circuitDefs = [
    { name: 'TAOCircuit',        args: [admin, splAddr, zkAddr, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'A2ACircuit',        args: [admin, splAddr, zkAddr] },
    { name: 'ThetaGPUCircuit',   args: [admin, splAddr, zkAddr] },
    { name: 'ZKMLCircuit',       args: [admin, splAddr, zkAddr] },
    { name: 'AkashCircuit',      args: [admin, splAddr, zkAddr] },
    { name: 'AutonomousVaults',  args: [admin, splAddr, zkAddr] },
    { name: 'AgentRobotics',     args: [admin, splAddr, zkAddr] },
    { name: 'DataHubs',          args: [admin, splAddr, zkAddr] },
    { name: 'YieldCircuit',      args: [admin, splAddr, zkAddr] },
    { name: 'NearAgents',        args: [admin, splAddr, zkAddr] },
  ];

  for (const c of circuitDefs) {
    const F = await ethers.getContractFactory(c.name);
    const contract = await F.deploy(...c.args);
    await contract.waitForDeployment();
    manifest.contracts[c.name] = await contract.getAddress();
    console.log(`  ✓ ${c.name.padEnd(20)} ${manifest.contracts[c.name]}`);
  }

  // ─── Phase 3: Role Configuration ───────────────────────────────────
  console.log('\n──── Phase 3: Role Configuration ─────────────────────────');
  const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();

  for (const c of circuitDefs) {
    await splitter.grantRole(CIRCUIT_ROLE, manifest.contracts[c.name]);
    console.log(`  ✓ CIRCUIT_ROLE → ${c.name}`);
  }

  // ─── Deployment Manifest ────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DEPLOYMENT MANIFEST');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(JSON.stringify(manifest, null, 2));
  console.log('═══════════════════════════════════════════════════════════');

  return manifest;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
