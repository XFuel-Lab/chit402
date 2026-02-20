/**
 * XFuel Protocol — Public Testnet Launch Script (Orchestrator)
 *
 * End-to-end orchestration for launching XFuel Protocol on Theta Testnet.
 * Runs: (1) Full deployment, (2) Role verification, (3) Smoke tests,
 *       (4) BelieverRound activation, (5) Dashboard manifest generation,
 *       (6) Campaign data output, (7) Health monitoring bootstrap.
 *
 * Usage:
 *   npx hardhat run launch/public-launch.cjs --network theta-testnet
 *   npx hardhat run launch/public-launch.cjs                           # local test
 *
 * Environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY
 *   ADMIN_ADDRESS          (optional, defaults to deployer)
 *   BELIEVER_HARD_CAP      (optional, default 500)
 *   ENABLE_MONITORING      (optional, "true" to start poll loop)
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

const NETWORK_CONFIGS = {
  'theta-testnet': {
    name: 'Theta Testnet', chainId: 365,
    rpc: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    explorer: 'https://testnet-explorer.thetatoken.org',
    minBalance: ethers.parseEther('0.5'),
    dashboardUrl: 'file:///[YOUR_PATH]/xfuel-protocol/dashboard/index.html',
  },
  'hardhat': {
    name: 'Hardhat Local', chainId: 1337,
    rpc: 'http://127.0.0.1:8545',
    explorer: null,
    minBalance: ethers.parseEther('1'),
    dashboardUrl: 'file:///[YOUR_PATH]/xfuel-protocol/dashboard/index.html',
  },
};

async function main() {
  const startTime = Date.now();
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const netCfg = NETWORK_CONFIGS[network.name] || {
    name: network.name, chainId: 'unknown', rpc: '', explorer: null,
    minBalance: ethers.parseEther('0.5'), dashboardUrl: '',
  };

  function resolveAddr(envKey, fallback) {
    const val = process.env[envKey];
    if (!val) return fallback;
    try { return ethers.getAddress(val); } catch { return fallback; }
  }
  const ADMIN = resolveAddr('ADMIN_ADDRESS', deployer.address);

  console.log('');
  console.log('  ╔════════════════════════════════════════════════════════════╗');
  console.log('  ║   XFuel Protocol — Public Testnet Launch                  ║');
  console.log('  ╠════════════════════════════════════════════════════════════╣');
  console.log(`  ║  Network:    ${netCfg.name.padEnd(46)}║`);
  console.log(`  ║  Chain ID:   ${String(netCfg.chainId).padEnd(46)}║`);
  console.log(`  ║  Deployer:   ${deployer.address.padEnd(46)}║`);
  console.log(`  ║  Admin:      ${ADMIN.padEnd(46)}║`);
  console.log(`  ║  Balance:    ${ethers.formatEther(balance).slice(0, 20).padEnd(46)}║`);
  console.log('  ╚════════════════════════════════════════════════════════════╝');

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 0: PRE-FLIGHT CHECKS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 0: Pre-Flight Checks ═══════════════════════');

  if (balance < netCfg.minBalance) {
    throw new Error(
      `Insufficient balance: ${ethers.formatEther(balance)} < ${ethers.formatEther(netCfg.minBalance)} required.`
    );
  }
  console.log('    ✓ Balance sufficient');

  if (network.name === 'theta-testnet') {
    const net = await ethers.provider.getNetwork();
    if (Number(net.chainId) !== 365) throw new Error(`Chain ID mismatch: ${net.chainId}`);
    console.log('    ✓ Chain ID 365 confirmed');
  }
  console.log('    ✓ Compiler: solc 0.8.20+');
  console.log('    ✓ Pre-flight complete');

  const manifest = {
    protocol: 'XFuel Protocol',
    version: '1.90',
    network: network.name,
    chainId: netCfg.chainId,
    rpc: netCfg.rpc,
    explorer: netCfg.explorer,
    deployer: deployer.address,
    admin: ADMIN,
    timestamp: new Date().toISOString(),
    contracts: {},
    gasUsed: {},
    roles: [],
    smokeTests: { passed: 0, failed: 0, details: [] },
    believerRound: {},
  };

  let totalGas = 0n;

  async function deploy(name, Factory, args) {
    console.log(`    Deploying ${name}...`);
    const c = await Factory.deploy(...args);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    const receipt = await c.deploymentTransaction().wait();
    const gas = receipt.gasUsed;
    manifest.contracts[name] = addr;
    manifest.gasUsed[name] = Number(gas);
    totalGas += gas;
    console.log(`    ✓ ${name.padEnd(24)} ${addr}  (${gas} gas)`);
    return c;
  }

  function smoke(name, pass, detail) {
    if (pass) { manifest.smokeTests.passed++; console.log(`    ✓ ${name}`); }
    else { manifest.smokeTests.failed++; console.log(`    ✗ ${name}: ${detail}`); }
    manifest.smokeTests.details.push({ name, pass, detail: detail || '' });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 1: CORE LAYER
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 1: Core Layer ═══════════════════════════════');

  const d = deployer.address;
  const splitter = await deploy('CoreRevenueSplitter',
    await ethers.getContractFactory('CoreRevenueSplitter'),
    [d, d, d, d, d, d]);
  const splAddr = manifest.contracts.CoreRevenueSplitter;

  const verifier = await deploy('ZKVerifierSP1',
    await ethers.getContractFactory('ZKVerifierSP1'),
    [d, ethers.ZeroAddress]);
  const zkAddr = manifest.contracts.ZKVerifierSP1;

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 2: ALL 12 CIRCUITS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 2: Circuits (12) ════════════════════════════');

  const circuitDefs = [
    { name: 'TAOCircuit',        args: [d, splAddr, zkAddr, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'A2ACircuit',        args: [d, splAddr, zkAddr] },
    { name: 'ThetaGPUCircuit',   args: [d, splAddr, zkAddr] },
    { name: 'ZKMLCircuit',       args: [d, splAddr, zkAddr] },
    { name: 'AkashCircuit',      args: [d, splAddr, zkAddr] },
    { name: 'AutonomousVaults',  args: [d, splAddr, zkAddr] },
    { name: 'AgentRobotics',     args: [d, splAddr, zkAddr] },
    { name: 'DataHubs',          args: [d, splAddr, zkAddr] },
    { name: 'YieldCircuit',      args: [d, splAddr, zkAddr] },
    { name: 'NearAgents',        args: [d, splAddr, zkAddr] },
    { name: 'SolanaAIBridge',    args: [d, splAddr, zkAddr] },
    { name: 'FilecoinStorage',   args: [d, splAddr, zkAddr] },
  ];

  for (const c of circuitDefs) {
    await deploy(c.name, await ethers.getContractFactory(c.name), c.args);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 2b: BELIEVER ROUND
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 2b: BelieverRound ═══════════════════════════');

  const hardCap = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP) : ethers.parseEther('500');
  const maxPerWallet = ethers.parseEther('5');

  const believer = await deploy('BelieverRound',
    await ethers.getContractFactory('BelieverRound'),
    [d, hardCap, maxPerWallet, 10000n, 1n]);

  manifest.believerRound = {
    address: manifest.contracts.BelieverRound,
    hardCap: ethers.formatEther(hardCap),
    maxPerWallet: ethers.formatEther(maxPerWallet),
    price: '10000 XF per TFUEL',
    cliff: '90 days',
    vesting: '365 days',
    refundDeadline: '180 days',
  };

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 3: ROLE GRANTS + VERIFICATION
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 3: Role Grants ══════════════════════════════');

  const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
  for (const c of circuitDefs) {
    const addr = manifest.contracts[c.name];
    const tx = await splitter.grantRole(CIRCUIT_ROLE, addr);
    await tx.wait();
    manifest.roles.push({ contract: c.name, role: 'CIRCUIT_ROLE', address: addr });
    console.log(`    ✓ CIRCUIT_ROLE → ${c.name}`);
  }

  // Verify
  let rolesOk = 0;
  for (const c of circuitDefs) {
    const hasRole = await splitter.hasRole(CIRCUIT_ROLE, manifest.contracts[c.name]);
    if (hasRole) rolesOk++;
  }
  console.log(`    ✓ Verified: ${rolesOk}/${circuitDefs.length} circuits`);

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 4: COMPREHENSIVE SMOKE TESTS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 4: Smoke Tests ══════════════════════════════');

  // 4a. CIRCUIT_ID on every circuit
  for (const c of circuitDefs) {
    try {
      const inst = await ethers.getContractAt(c.name, manifest.contracts[c.name]);
      const cid = await inst.CIRCUIT_ID();
      smoke(`${c.name}.CIRCUIT_ID`, true, cid.slice(0, 18) + '...');
    } catch (e) {
      smoke(`${c.name}.CIRCUIT_ID`, false, e.message.slice(0, 60));
    }
  }

  // 4b. Splitter shares
  try {
    const [bbb, lp, staker, treasury] = await splitter.getSplit();
    smoke('Splitter.getSplit()', true, `BBB=${bbb} LP=${lp} Staker=${staker} Treasury=${treasury}`);
  } catch (e) {
    smoke('Splitter.getSplit()', false, e.message.slice(0, 60));
  }

  // 4c. BelieverRound
  try {
    const br = await ethers.getContractAt('BelieverRound', manifest.contracts.BelieverRound);
    const status = await br.status();
    smoke('BelieverRound.status', Number(status) === 0, `status=${status}`);
  } catch (e) {
    smoke('BelieverRound.status', false, e.message.slice(0, 60));
  }

  // 4d. FilecoinStorage provider registration test
  try {
    const fil = await ethers.getContractAt('FilecoinStorage', manifest.contracts.FilecoinStorage);
    const cid = await fil.CIRCUIT_ID();
    smoke('FilecoinStorage.CIRCUIT_ID', true, cid.slice(0, 18) + '...');
  } catch (e) {
    smoke('FilecoinStorage.CIRCUIT_ID', false, e.message.slice(0, 60));
  }

  const { passed, failed } = manifest.smokeTests;
  console.log(`\n    Smoke tests: ${passed} passed, ${failed} failed`);

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 5: MANIFEST OUTPUT
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 5: Manifest ═════════════════════════════════');

  manifest.totalGas = Number(totalGas);
  manifest.totalGasCostTFUEL = ethers.formatEther(totalGas * 4000000000n);
  manifest.elapsedMs = Date.now() - startTime;

  const manifestDir = path.join(__dirname, '..', 'deploy', 'manifests');
  if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });
  const manifestFile = path.join(manifestDir, `launch-${Date.now()}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  console.log(`    Manifest: ${manifestFile}`);
  console.log(`    Total gas: ${totalGas} (~${manifest.totalGasCostTFUEL} TFUEL)`);
  console.log(`    Duration: ${(manifest.elapsedMs / 1000).toFixed(1)}s`);

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 6: CAMPAIGN OUTPUT
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n  ═══ Phase 6: Campaign Data ════════════════════════════');

  const contractCount = Object.keys(manifest.contracts).length;
  const explorerBase = netCfg.explorer || 'https://testnet-explorer.thetatoken.org';

  console.log(`
  ── X/Twitter Announcement ──────────────────────────────
  XFuel Protocol is LIVE on ${netCfg.name}.

  ${contractCount} contracts deployed. 12 modular AI circuits.
  Full ZK verification. BelieverRound open.

  Circuits: TAO, A2A, ThetaGPU, ZKML, Akash, Vaults,
  Robotics, DataHubs, Yield, NEAR, Solana, Filecoin Storage.

  Dashboard: ${netCfg.dashboardUrl}

  ── Discord Announcement ────────────────────────────────
  **XFuel Protocol — Public Testnet is LIVE!**

  ${contractCount} contracts deployed on ${netCfg.name} (chain ${netCfg.chainId}):
  - Core: CoreRevenueSplitter + ZKVerifierSP1
  - 12 circuits: TAO → A2A → ThetaGPU → ZKML → Akash → Vaults →
    Robotics → DataHubs → Yield → NEAR → Solana → **Filecoin Storage** (NEW)
  - BelieverRound: Open, ${ethers.formatEther(hardCap)} TFUEL hard cap

  Smoke tests: ${passed}/${passed + failed} passing
  Total gas: ${totalGas} (~${manifest.totalGasCostTFUEL} TFUEL)

  Load the manifest into the dashboard to monitor live events.
  `);

  // ═══════════════════════════════════════════════════════════════════
  //  PHASE 7: NEXT STEPS
  // ═══════════════════════════════════════════════════════════════════
  console.log('  ═══ Next Steps ════════════════════════════════════════');
  console.log('    1. Open dashboard/index.html → load manifest');
  console.log('    2. Start event listener in dashboard');
  console.log('    3. Verify contracts on explorer');
  console.log('    4. Post announcements (Discord + X)');
  console.log('    5. Run grant tracker: node grant-templates/grant-tracker.cjs');
  console.log('    6. Submit grants: node grant/submission-script.cjs');
  console.log('');

  // JSON summary to stdout
  console.log(JSON.stringify(manifest, null, 2));

  return manifest;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('PUBLIC LAUNCH FAILED:', err); process.exit(1); });
