/**
 * XFuel Protocol — Testnet Deployment Script (v2 — production-safe)
 *
 * Deploys Core + all 11 circuits + BelieverRound to Theta Testnet.
 * Includes pre-flight checks, gas tracking, role verification,
 * comprehensive smoke tests, and manifest output.
 *
 * Usage:
 *   npx hardhat run deploy/testnet.cjs --network theta-testnet
 *   npx hardhat run deploy/testnet.cjs --network hardhat
 *
 * Theta Testnet:
 *   - RPC: https://eth-rpc-api-testnet.thetatoken.org/rpc
 *   - Chain ID: 365
 *   - Explorer: https://testnet-explorer.thetatoken.org
 *   - Faucet: thirdweb (0.01 TFUEL / 24h)
 *
 * Required environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY
 */
const hre = require('hardhat');
const { ethers, network } = hre;
const fs = require('fs');
const path = require('path');

const TESTNET_CONFIG = {
  'theta-testnet': {
    name: 'Theta Testnet',
    chainId: 365,
    explorer: 'https://testnet-explorer.thetatoken.org',
    minBalance: ethers.parseEther('0.5'),
  },
  'hardhat': {
    name: 'Hardhat Local',
    chainId: 1337,
    explorer: null,
    minBalance: ethers.parseEther('1'),
  },
};

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      'No deployer account configured.\n' +
      '  Set DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) in .env.local:\n' +
      '    DEPLOYER_PRIVATE_KEY=0xYourPrivateKeyHere\n' +
      '  Fund it with testnet TFUEL: https://faucet.thetatoken.org'
    );
  }
  const deployer = signers[0];
  const balance = await ethers.provider.getBalance(deployer.address);
  const netConfig = TESTNET_CONFIG[network.name] || {
    name: network.name, chainId: 'unknown', explorer: null,
    minBalance: ethers.parseEther('0.5'),
  };

  // ══════════════════════════════════════════════════════════════════
  //  PRE-FLIGHT CHECKS
  // ══════════════════════════════════════════════════════════════════
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Protocol — Testnet Deployment (v2)                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Network:   ${netConfig.name.padEnd(48)}║`);
  console.log(`║  Chain ID:  ${String(netConfig.chainId).padEnd(48)}║`);
  console.log(`║  Deployer:  ${deployer.address.padEnd(48)}║`);
  console.log(`║  Balance:   ${ethers.formatEther(balance).slice(0, 20).padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Balance check
  if (balance < netConfig.minBalance) {
    throw new Error(
      `Insufficient balance: ${ethers.formatEther(balance)} < ${ethers.formatEther(netConfig.minBalance)} required.\n` +
      `  Faucet: https://thirdweb.com/theta-testnet (0.01 TFUEL / 24h)`
    );
  }
  console.log('\n  ✓ Pre-flight: balance OK');

  // Chain ID verification (skip on hardhat)
  if (network.name === 'theta-testnet') {
    const net = await ethers.provider.getNetwork();
    if (Number(net.chainId) !== 365) {
      throw new Error(`Chain ID mismatch: expected 365, got ${net.chainId}`);
    }
    console.log('  ✓ Pre-flight: chain ID 365 confirmed');
  }

  // Load partial manifest from a previous interrupted run (resumable deploys)
  const manifestDir = path.join(__dirname, 'manifests');
  const resumeFile = path.join(manifestDir, 'testnet-progress.json');
  let prior = {};
  if (fs.existsSync(resumeFile)) {
    try {
      prior = JSON.parse(fs.readFileSync(resumeFile, 'utf8'));
      console.log(`\n  ↻ Resuming from prior run (${Object.keys(prior).length} contracts cached)`);
    } catch { prior = {}; }
  }

  const manifest = {
    network: network.name,
    chainId: netConfig.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    explorer: netConfig.explorer,
    contracts: { ...prior },
    gasUsed: {},
    roles: [],
    smokeTests: { passed: 0, failed: 0 },
  };

  let totalGas = 0n;

  const TX = { gasLimit: 8000000, gasPrice: 4000000000000n };

  function saveProgress() {
    if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(resumeFile, JSON.stringify(manifest.contracts, null, 2));
  }

  async function deployContract(name, Factory, args) {
    if (manifest.contracts[name]) {
      const existingAddr = manifest.contracts[name];
      try {
        const code = await ethers.provider.getCode(existingAddr);
        if (code && code !== '0x') {
          console.log(`  ⏩ ${name.padEnd(24)} ${existingAddr}  (resumed)`);
          return Factory.attach(existingAddr);
        }
      } catch {}
    }
    console.log(`  Deploying ${name}...`);
    const contract = await Factory.deploy(...args, TX);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    const receipt = await contract.deploymentTransaction().wait();
    const gas = receipt.gasUsed;
    manifest.contracts[name] = addr;
    manifest.gasUsed[name] = Number(gas);
    totalGas += gas;
    console.log(`  ✓ ${name.padEnd(24)} ${addr}  (${gas} gas)`);
    saveProgress();
    return contract;
  }

  // ══════════════════════════════════════════════════════════════════
  //  PHASE 1: CORE LAYER
  // ══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 1: Core Layer ═════════════════════════════════');

  const d = deployer.address;
  const splitter = await deployContract('CoreRevenueSplitter',
    await ethers.getContractFactory('CoreRevenueSplitter'),
    [d, d, d, d, d, d]
  );
  const splAddr = manifest.contracts.CoreRevenueSplitter;

  const verifier = await deployContract('ZKVerifierSP1',
    await ethers.getContractFactory('ZKVerifierSP1'),
    [d, ethers.ZeroAddress]
  );
  const zkAddr = manifest.contracts.ZKVerifierSP1;

  await deployContract('ZKVerifierZkGPT',
    await ethers.getContractFactory('ZKVerifierZkGPT'),
    [d]
  );

  // ══════════════════════════════════════════════════════════════════
  //  PHASE 2: CIRCUITS (16)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 2: Circuits (16) ══════════════════════════════');

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
    { name: 'EnergyGrid',        args: [d, splAddr, zkAddr] },
    { name: 'MappingSensor',     args: [d, splAddr, zkAddr] },
    { name: 'WirelessDePIN',    args: [d, splAddr, zkAddr] },
    { name: 'UplinkCircuit',    args: [d, splAddr, zkAddr] },
  ];

  const deployedCircuits = {};
  for (const c of circuitDefs) {
    const contract = await deployContract(c.name,
      await ethers.getContractFactory(c.name), c.args);
    deployedCircuits[c.name] = contract;
  }

  // ══════════════════════════════════════════════════════════════════
  //  PHASE 2b: BELIEVER ROUND
  // ══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 2b: BelieverRound ═════════════════════════════');
  const believerXfCap = process.env.BELIEVER_XF_ALLOCATION_CAP
    ? ethers.parseEther(process.env.BELIEVER_XF_ALLOCATION_CAP)
    : ethers.parseEther('150000000');
  const believerHardCap = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP)
    : ethers.parseEther('2000000');
  const believerMaxPwStr = process.env.BELIEVER_MAX_PER_WALLET ?? '0';
  const believerMaxPw = believerMaxPwStr === '0' ? 0n : ethers.parseEther(believerMaxPwStr);
  const believerPriceNum = process.env.BELIEVER_PRICE_NUM ? BigInt(process.env.BELIEVER_PRICE_NUM) : 5n;
  const believerPriceDen = process.env.BELIEVER_PRICE_DEN ? BigInt(process.env.BELIEVER_PRICE_DEN) : 1n;
  const believerPhase = process.env.BELIEVER_PHASE ? parseInt(process.env.BELIEVER_PHASE, 10) : 1;
  const believerMin = process.env.BELIEVER_MIN_COMMITMENT
    ? ethers.parseEther(process.env.BELIEVER_MIN_COMMITMENT)
    : ethers.parseEther('100');
  await deployContract('BelieverRound',
    await ethers.getContractFactory('BelieverRound'),
    [d, believerHardCap, believerMaxPw, believerPriceNum, believerPriceDen, believerPhase, believerXfCap, believerMin]
  );

  // ══════════════════════════════════════════════════════════════════
  //  PHASE 3: ROLE GRANTS + VERIFICATION
  // ══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 3: Role Configuration ═════════════════════════');

  const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
  for (const c of circuitDefs) {
    const addr = manifest.contracts[c.name];
    const already = await splitter.hasRole(CIRCUIT_ROLE, addr);
    if (already) {
      manifest.roles.push({ contract: c.name, role: 'CIRCUIT_ROLE', address: addr });
      console.log(`  ⏩ CIRCUIT_ROLE → ${c.name} (already granted)`);
      continue;
    }
    const tx = await splitter.grantRole(CIRCUIT_ROLE, addr, TX);
    await tx.wait();
    manifest.roles.push({ contract: c.name, role: 'CIRCUIT_ROLE', address: addr });
    console.log(`  ✓ CIRCUIT_ROLE → ${c.name}`);
  }

  // Role verification
  console.log('\n── Role Verification ───────────────────────────────────');
  let rolesOk = 0;
  for (const c of circuitDefs) {
    const hasRole = await splitter.hasRole(CIRCUIT_ROLE, manifest.contracts[c.name]);
    if (hasRole) {
      rolesOk++;
    } else {
      console.log(`  ✗ ${c.name} missing CIRCUIT_ROLE`);
    }
  }
  console.log(`  ✓ Role verification: ${rolesOk}/${circuitDefs.length} circuits confirmed`);

  // Phase 3b: Set ZKVerifierZkGPT on ZKMLCircuit (Phase 1 zkGPT path)
  if (manifest.contracts.ZKVerifierZkGPT && manifest.contracts.ZKMLCircuit) {
    console.log('\n── Phase 3b: ZKVerifierZkGPT → ZKMLCircuit ───────────────────');
    const zkml = await ethers.getContractAt('ZKMLCircuit', manifest.contracts.ZKMLCircuit);
    const tx = await zkml.setZKVerifierZkGPT(manifest.contracts.ZKVerifierZkGPT, TX);
    await tx.wait();
    console.log('  ✓ ZKMLCircuit.setZKVerifierZkGPT(ZKVerifierZkGPT)');
  }

  // Phase 3c: Fair Exchange proxy (Phase 1, optional)
  const fairExchangeProxy = process.env.FAIR_EXCHANGE_PROXY_ADDRESS || null;
  if (fairExchangeProxy && manifest.contracts.A2ACircuit) {
    console.log('\n── Phase 3c: Fair Exchange proxy → A2ACircuit ─────────────────');
    const a2a = await ethers.getContractAt('A2ACircuit', manifest.contracts.A2ACircuit);
    const txFe = await a2a.setFairExchangeProxy(fairExchangeProxy, TX);
    await txFe.wait();
    console.log(`  ✓ A2ACircuit.setFairExchangeProxy(${fairExchangeProxy})`);
  }

  // ══════════════════════════════════════════════════════════════════
  //  PHASE 4: COMPREHENSIVE SMOKE TESTS
  // ══════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 4: Smoke Tests ════════════════════════════════');

  // 4a. Verify CIRCUIT_ID on every circuit
  for (const c of circuitDefs) {
    try {
      const inst = await ethers.getContractAt(c.name, manifest.contracts[c.name]);
      const cid = await inst.CIRCUIT_ID();
      console.log(`  ✓ ${c.name.padEnd(22)} CIRCUIT_ID: ${cid.slice(0, 18)}...`);
      manifest.smokeTests.passed++;
    } catch (e) {
      console.log(`  ✗ ${c.name.padEnd(22)} FAILED: ${e.message.slice(0, 50)}`);
      manifest.smokeTests.failed++;
    }
  }

  // 4b. Verify splitter shares
  try {
    const [bbb, lp, staker, treasury] = await splitter.getSplit();
    console.log(`  ✓ Splitter shares:     BBB=${bbb} LP=${lp} Staker=${staker} Treasury=${treasury}`);
    manifest.smokeTests.passed++;
  } catch (e) {
    console.log(`  ✗ Splitter shares:     FAILED: ${e.message.slice(0, 50)}`);
    manifest.smokeTests.failed++;
  }

  // 4c. BelieverRound status
  try {
    const br = await ethers.getContractAt('BelieverRound', manifest.contracts.BelieverRound);
    const status = await br.status();
    console.log(`  ✓ BelieverRound:       status=${Number(status) === 0 ? 'Open' : status}`);
    manifest.smokeTests.passed++;
  } catch (e) {
    console.log(`  ✗ BelieverRound:       FAILED: ${e.message.slice(0, 50)}`);
    manifest.smokeTests.failed++;
  }

  const { passed, failed } = manifest.smokeTests;
  console.log(`\n  Smoke tests: ${passed} passed, ${failed} failed`);

  // ══════════════════════════════════════════════════════════════════
  //  PHASE 5: MANIFEST OUTPUT
  // ══════════════════════════════════════════════════════════════════
  manifest.totalGas = Number(totalGas);
  manifest.totalGasCostTFUEL = ethers.formatEther(totalGas * TX.gasPrice);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  TESTNET DEPLOYMENT MANIFEST                                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(JSON.stringify(manifest, null, 2));

  // Write final manifest file
  const manifestFile = path.join(manifestDir, `testnet-${Date.now()}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest saved: ${manifestFile}`);

  if (netConfig.explorer) {
    console.log(`  Explorer: ${netConfig.explorer}`);
  }
  console.log(`  Total gas: ${totalGas} (~${manifest.totalGasCostTFUEL} TFUEL)`);

  console.log('\n  NEXT STEPS:');
  console.log('    1. Open dashboard/index.html and load the manifest file');
  console.log('    2. Verify contracts on explorer');
  console.log('    3. Run: node grant-templates/grant-tracker.cjs');
  console.log('    4. Announce on Discord / X');

  return manifest;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('TESTNET DEPLOY FAILED:', err); process.exit(1); });
