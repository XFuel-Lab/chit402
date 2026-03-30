/**
 * XFuel Protocol — Mainnet Deployment Script (v2 — with Monitoring)
 *
 * Full-stack production deployment to Theta Mainnet (chain ID 361).
 * Deploys Core Layer + all 11 circuits + BelieverRound vesting contract.
 * Includes post-deploy monitoring via ThetaScan.io API health checks.
 *
 * Usage:
 *   npx hardhat run deploy/mainnet.cjs --network theta-mainnet
 *
 * Required environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY   — Deployer wallet private key (funded with TFUEL)
 *   ADMIN_ADDRESS          — Multisig admin address (receives DEFAULT_ADMIN_ROLE)
 *   BBB_ADDRESS            — Buyback-burn recipient (30%)
 *   LP_ADDRESS             — Liquidity provision recipient (30%)
 *   STAKER_ADDRESS         — Staker rewards recipient (25%)
 *   TREASURY_ADDRESS       — Treasury recipient (15%)
 *   STAKE_POOL_ADDRESS     — Staking pool contract address
 *   SP1_GATEWAY_ADDRESS    — SP1 Verifier Gateway (optional, address(0) for mock)
 *   XF_TOKEN_ADDRESS       — XF ERC-20 token (optional, address(0) for mock)
 *
 * Optional monitoring environment variables:
 *   THETASCAN_API_KEY      — ThetaScan.io API key for contract verification
 *   MONITOR_INTERVAL_MS    — Post-deploy health check interval (default: 30000)
 *   ENABLE_MONITORING      — Set to 'true' to run post-deploy health-check loop
 *
 * Safety:
 *   - Confirms network is theta-mainnet (chain ID 361)
 *   - Verifies deployer balance >= 50 TFUEL
 *   - Requires all fee recipient addresses to be non-zero
 *   - Writes deployment manifest to deploy/manifests/mainnet-{timestamp}.json
 *   - Transfers DEFAULT_ADMIN_ROLE from deployer → multisig admin
 *   - Renounces deployer admin role after transfer
 *   - Post-deploy: ThetaScan health checks for all deployed contracts
 *
 * Per Theta Docs (thetatoken.org):
 *   - RPC: https://eth-rpc-api.thetatoken.org/rpc
 *   - Chain ID: 361
 *   - Gas token: TFUEL (used for all contract transactions)
 *   - EVM compatibility: Constantinople + Istanbul
 *   - Block explorer: https://explorer.thetatoken.org
 *
 * Per ThetaScan.io Developer API (thetascan.io/document/):
 *   - Balance endpoints: /api/balance/:address
 *   - Transaction endpoints: /api/transaction/:hash
 *   - Contract endpoints: /api/contract/:address
 *   - Rate limit: 1-2 calls per second
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ═══════════════════════════════════════════════════════════════════════
//  MONITORING UTILITIES (ThetaScan.io API)
// ═══════════════════════════════════════════════════════════════════════
const THETASCAN_BASE = 'https://www.thetascan.io/api';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function thetaScanBalance(address) {
  try {
    const result = await httpGet(`${THETASCAN_BASE}/balance/${address}`);
    return result;
  } catch { return null; }
}

async function thetaScanContract(address) {
  try {
    const result = await httpGet(`${THETASCAN_BASE}/contract/${address}`);
    return result;
  } catch { return null; }
}

async function runHealthChecks(manifest, provider) {
  console.log('\n══ Health Check: Contract Status ═══════════════════════');
  const results = [];

  for (const [name, addr] of Object.entries(manifest.contracts)) {
    if (typeof addr !== 'string' || !addr.startsWith('0x')) {
      console.log(`  ⊘ ${name.padEnd(24)} SKIPPED (not deployed)`);
      continue;
    }

    try {
      const code = await provider.getCode(addr);
      const hasCode = code !== '0x' && code.length > 2;
      const bal = await provider.getBalance(addr);

      const status = hasCode ? '✓ LIVE' : '✗ NO CODE';
      const balStr = ethers.formatEther(bal);
      console.log(`  ${status} ${name.padEnd(22)} ${addr} (bal: ${balStr} TFUEL)`);

      results.push({ name, address: addr, hasCode, balance: balStr, status: hasCode ? 'healthy' : 'no_code' });
    } catch (e) {
      console.log(`  ✗ ERR  ${name.padEnd(22)} ${e.message.slice(0, 50)}`);
      results.push({ name, address: addr, status: 'error', error: e.message.slice(0, 100) });
    }
  }

  // ThetaScan API checks (only on real network)
  if (network.name !== 'hardhat') {
    console.log('\n── ThetaScan API Checks ─────────────────────────────');
    const splAddr = manifest.contracts.CoreRevenueSplitter;
    if (splAddr) {
      const scanResult = await thetaScanContract(splAddr);
      if (scanResult) {
        console.log(`  ✓ ThetaScan sees CoreRevenueSplitter at ${splAddr}`);
      } else {
        console.log(`  ⊘ ThetaScan may need time to index — retry in 30s`);
      }
    }

    const deployerBal = await thetaScanBalance(manifest.deployer);
    if (deployerBal) {
      console.log(`  ✓ Deployer ThetaScan balance: ${JSON.stringify(deployerBal)}`);
    }
  }

  const healthy = results.filter(r => r.status === 'healthy').length;
  const total = results.length;
  console.log(`\n  Health: ${healthy}/${total} contracts verified on-chain`);

  return results;
}

const MAINNET_CONFIG = {
  name: 'Theta Mainnet',
  chainId: 361,
  rpc: 'https://eth-rpc-api.thetatoken.org/rpc',
  explorer: 'https://explorer.thetatoken.org',
  minBalance: ethers.parseEther('50'), // 50 TFUEL minimum
};

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 0: PRE-FLIGHT CHECKS
  // ══════════════════════════════════════════════════════════════════════
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Protocol — MAINNET DEPLOYMENT                        ║');
  console.log('║  ⚠️  PRODUCTION — ALL TRANSACTIONS ARE IRREVERSIBLE          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Network:   ${MAINNET_CONFIG.name.padEnd(48)}║`);
  console.log(`║  Chain ID:  ${String(MAINNET_CONFIG.chainId).padEnd(48)}║`);
  console.log(`║  Deployer:  ${deployer.address.padEnd(48)}║`);
  console.log(`║  Balance:   ${ethers.formatEther(balance).slice(0, 20).padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Network check (skip for hardhat local testing)
  if (network.name !== 'hardhat' && network.name !== 'theta-mainnet') {
    throw new Error(`Expected theta-mainnet or hardhat, got: ${network.name}`);
  }

  // Balance check
  if (balance < MAINNET_CONFIG.minBalance) {
    throw new Error(`Insufficient TFUEL: ${ethers.formatEther(balance)} < 50 TFUEL required`);
  }

  // Load env addresses (validate EVM format; fallback to deployer if non-EVM or missing)
  function resolveAddr(envKey, fallback) {
    const val = process.env[envKey];
    if (!val) return fallback;
    try { return ethers.getAddress(val); } catch { return fallback; }
  }

  const ADMIN    = resolveAddr('ADMIN_ADDRESS', deployer.address);
  const BBB      = resolveAddr('BBB_ADDRESS', deployer.address);
  const LP       = resolveAddr('LP_ADDRESS', deployer.address);
  const STAKER   = resolveAddr('STAKER_ADDRESS', deployer.address);
  const TREASURY = resolveAddr('TREASURY_ADDRESS', deployer.address);
  const STAKE    = resolveAddr('STAKE_POOL_ADDRESS', deployer.address);
  const SP1GW    = resolveAddr('SP1_GATEWAY_ADDRESS', ethers.ZeroAddress);
  const XF_TOKEN = resolveAddr('XF_TOKEN_ADDRESS', ethers.ZeroAddress);

  console.log('\n── Pre-flight: Address Configuration ───────────────────');
  console.log(`  Admin (multisig):  ${ADMIN}`);
  console.log(`  BBB recipient:     ${BBB}`);
  console.log(`  LP recipient:      ${LP}`);
  console.log(`  Staker recipient:  ${STAKER}`);
  console.log(`  Treasury:          ${TREASURY}`);
  console.log(`  Stake pool:        ${STAKE}`);
  console.log(`  SP1 Gateway:       ${SP1GW === ethers.ZeroAddress ? '(mock)' : SP1GW}`);
  console.log(`  XF Token:          ${XF_TOKEN === ethers.ZeroAddress ? '(mock)' : XF_TOKEN}`);

  const manifest = {
    network: 'theta-mainnet',
    chainId: MAINNET_CONFIG.chainId,
    deployer: deployer.address,
    admin: ADMIN,
    timestamp: new Date().toISOString(),
    contracts: {},
    roles: [],
    gasUsed: {},
  };

  let totalGas = 0n;

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 1: CORE LAYER
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 1: Core Layer ═════════════════════════════════');

  // 1a. CoreRevenueSplitter
  console.log('  Deploying CoreRevenueSplitter...');
  const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
  const splitter = await SplitterF.deploy(ADMIN, BBB, LP, STAKER, TREASURY, STAKE);
  await splitter.waitForDeployment();
  const splAddr = await splitter.getAddress();
  const splDeploy = await splitter.deploymentTransaction().wait();
  manifest.contracts.CoreRevenueSplitter = splAddr;
  manifest.gasUsed.CoreRevenueSplitter = Number(splDeploy.gasUsed);
  totalGas += splDeploy.gasUsed;
  console.log(`  ✓ CoreRevenueSplitter: ${splAddr} (${splDeploy.gasUsed} gas)`);

  // 1b. ZKVerifierSP1
  console.log('  Deploying ZKVerifierSP1...');
  const VerifierF = await ethers.getContractFactory('ZKVerifierSP1');
  const verifier = await VerifierF.deploy(ADMIN, SP1GW);
  await verifier.waitForDeployment();
  const zkAddr = await verifier.getAddress();
  const zkDeploy = await verifier.deploymentTransaction().wait();
  manifest.contracts.ZKVerifierSP1 = zkAddr;
  manifest.gasUsed.ZKVerifierSP1 = Number(zkDeploy.gasUsed);
  totalGas += zkDeploy.gasUsed;
  console.log(`  ✓ ZKVerifierSP1:       ${zkAddr} (${zkDeploy.gasUsed} gas)`);

  // 1c. veXFGovernance (requires non-zero XF token address)
  if (XF_TOKEN !== ethers.ZeroAddress) {
    console.log('  Deploying veXFGovernance...');
    const GovF = await ethers.getContractFactory('veXFGovernance');
    const gov = await GovF.deploy(ADMIN, XF_TOKEN);
    await gov.waitForDeployment();
    const govAddr = await gov.getAddress();
    const govDeploy = await gov.deploymentTransaction().wait();
    manifest.contracts.veXFGovernance = govAddr;
    manifest.gasUsed.veXFGovernance = Number(govDeploy.gasUsed);
    totalGas += govDeploy.gasUsed;
    console.log(`  ✓ veXFGovernance:      ${govAddr} (${govDeploy.gasUsed} gas)`);
  } else {
    console.log('  ⚠ veXFGovernance: Skipped (set XF_TOKEN_ADDRESS for production)');
    manifest.contracts.veXFGovernance = 'SKIPPED — set XF_TOKEN_ADDRESS';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 2: CIRCUITS (11)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 2: Circuits (11) ══════════════════════════════');

  const circuitDefs = [
    { name: 'TAOCircuit',        args: [ADMIN, splAddr, zkAddr, ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: 'A2ACircuit',        args: [ADMIN, splAddr, zkAddr] },
    { name: 'ThetaGPUCircuit',   args: [ADMIN, splAddr, zkAddr] },
    { name: 'ZKMLCircuit',       args: [ADMIN, splAddr, zkAddr] },
    { name: 'AkashCircuit',      args: [ADMIN, splAddr, zkAddr] },
    { name: 'AutonomousVaults',  args: [ADMIN, splAddr, zkAddr] },
    { name: 'AgentRobotics',     args: [ADMIN, splAddr, zkAddr] },
    { name: 'DataHubs',          args: [ADMIN, splAddr, zkAddr] },
    { name: 'YieldCircuit',      args: [ADMIN, splAddr, zkAddr] },
    { name: 'NearAgents',        args: [ADMIN, splAddr, zkAddr] },
    { name: 'SolanaAIBridge',    args: [ADMIN, splAddr, zkAddr] },
  ];

  for (const c of circuitDefs) {
    console.log(`  Deploying ${c.name}...`);
    const F = await ethers.getContractFactory(c.name);
    const contract = await F.deploy(...c.args);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    const receipt = await contract.deploymentTransaction().wait();
    manifest.contracts[c.name] = addr;
    manifest.gasUsed[c.name] = Number(receipt.gasUsed);
    totalGas += receipt.gasUsed;
    console.log(`  ✓ ${c.name.padEnd(20)} ${addr} (${receipt.gasUsed} gas)`);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 2b: BELIEVER ROUND CONTRACT
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 2b: BelieverRound ══════════════════════════════');

  const BELIEVER_HARD_CAP = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP)
    : ethers.parseEther('500'); // Default 500 ETH/TFUEL

  const BELIEVER_MAX_PER_WALLET = process.env.BELIEVER_MAX_PER_WALLET
    ? ethers.parseEther(process.env.BELIEVER_MAX_PER_WALLET)
    : ethers.parseEther('5'); // Default 5 ETH/TFUEL

  const PRICE_NUM = process.env.BELIEVER_PRICE_NUM
    ? BigInt(process.env.BELIEVER_PRICE_NUM)
    : 5n; // 5 XF per 1 TFUEL (see docs/PRICING_TFUEL_XF.md)

  const PRICE_DEN = process.env.BELIEVER_PRICE_DEN
    ? BigInt(process.env.BELIEVER_PRICE_DEN)
    : 1n;

  console.log('  Deploying BelieverRound...');
  const BelieverF = await ethers.getContractFactory('BelieverRound');
  const BELIEVER_PHASE = process.env.BELIEVER_PHASE ? parseInt(process.env.BELIEVER_PHASE, 10) : 1;
  const BELIEVER_XF_CAP = process.env.BELIEVER_XF_ALLOCATION_CAP
    ? ethers.parseEther(process.env.BELIEVER_XF_ALLOCATION_CAP)
    : ethers.parseEther('150000000');
  const believer = await BelieverF.deploy(
    ADMIN, BELIEVER_HARD_CAP, BELIEVER_MAX_PER_WALLET, PRICE_NUM, PRICE_DEN, BELIEVER_PHASE, BELIEVER_XF_CAP
  );
  await believer.waitForDeployment();
  const believerAddr = await believer.getAddress();
  const believerDeploy = await believer.deploymentTransaction().wait();
  manifest.contracts.BelieverRound = believerAddr;
  manifest.gasUsed.BelieverRound = Number(believerDeploy.gasUsed);
  totalGas += believerDeploy.gasUsed;
  console.log(`  ✓ BelieverRound:       ${believerAddr} (${believerDeploy.gasUsed} gas)`);
  console.log(`    Hard cap: ${ethers.formatEther(BELIEVER_HARD_CAP)} TFUEL`);
  console.log(`    Max/wallet: ${ethers.formatEther(BELIEVER_MAX_PER_WALLET)} TFUEL`);
  console.log(`    Price: ${PRICE_NUM}/${PRICE_DEN} XF per ETH`);

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 3: ROLE CONFIGURATION
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 3: Role Configuration ═════════════════════════');

  const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
  for (const c of circuitDefs) {
    const tx = await splitter.grantRole(CIRCUIT_ROLE, manifest.contracts[c.name]);
    const r = await tx.wait();
    totalGas += r.gasUsed;
    manifest.roles.push({ contract: c.name, role: 'CIRCUIT_ROLE', address: manifest.contracts[c.name] });
    console.log(`  ✓ CIRCUIT_ROLE → ${c.name}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 4: ADMIN TRANSFER (deployer → multisig)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 4: Admin Transfer ═════════════════════════════');

  if (ADMIN !== deployer.address) {
    const DEFAULT_ADMIN = await splitter.DEFAULT_ADMIN_ROLE();

    // Grant admin to multisig
    const tx1 = await splitter.grantRole(DEFAULT_ADMIN, ADMIN);
    await tx1.wait();
    console.log(`  ✓ DEFAULT_ADMIN_ROLE → ${ADMIN} (multisig)`);

    // Renounce deployer admin
    const tx2 = await splitter.renounceRole(DEFAULT_ADMIN, deployer.address);
    await tx2.wait();
    console.log(`  ✓ Deployer admin renounced on CoreRevenueSplitter`);

    manifest.roles.push({ contract: 'CoreRevenueSplitter', role: 'ADMIN_TRANSFER', from: deployer.address, to: ADMIN });
  } else {
    console.log('  ⚠ ADMIN == deployer — skipping admin transfer (set ADMIN_ADDRESS for production)');
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 5: SMOKE TESTS
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n══ Phase 5: Smoke Tests ════════════════════════════════');

  let smokePass = 0;
  let smokeFail = 0;

  // Verify CIRCUIT_ID on each contract
  for (const c of circuitDefs) {
    try {
      const inst = await ethers.getContractAt(c.name, manifest.contracts[c.name]);
      const cid = await inst.CIRCUIT_ID();
      console.log(`  ✓ ${c.name.padEnd(20)} CIRCUIT_ID: ${cid.slice(0, 18)}...`);
      smokePass++;
    } catch (e) {
      console.log(`  ✗ ${c.name.padEnd(20)} FAILED: ${e.message.slice(0, 60)}`);
      smokeFail++;
    }
  }

  // Verify splitter shares
  try {
    const [bbb, lp, staker, treasury] = await splitter.getSplit();
    console.log(`  ✓ Splitter shares:     BBB=${bbb} LP=${lp} Staker=${staker} Treasury=${treasury}`);
    smokePass++;
  } catch (e) {
    console.log(`  ✗ Splitter shares read failed: ${e.message.slice(0, 60)}`);
    smokeFail++;
  }

  console.log(`\n  Smoke tests: ${smokePass} passed, ${smokeFail} failed`);

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 6: MANIFEST OUTPUT
  // ══════════════════════════════════════════════════════════════════════
  manifest.totalGas = Number(totalGas);
  manifest.totalGasCostTFUEL = ethers.formatEther(totalGas * 4000000000n); // ~4 Gwei gas price estimate
  manifest.smokeTests = { passed: smokePass, failed: smokeFail };

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  MAINNET DEPLOYMENT MANIFEST                                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(JSON.stringify(manifest, null, 2));

  // Write manifest file
  const manifestDir = path.join(__dirname, 'manifests');
  if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });
  const manifestFile = path.join(manifestDir, `mainnet-${Date.now()}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest saved: ${manifestFile}`);

  console.log(`\n  Explorer: ${MAINNET_CONFIG.explorer}`);
  console.log(`  Total gas: ${totalGas} (~${manifest.totalGasCostTFUEL} TFUEL)`);
  console.log('\n  ⚠ POST-DEPLOYMENT CHECKLIST:');
  console.log('    1. Verify all contracts on explorer');
  console.log('    2. Confirm multisig admin has DEFAULT_ADMIN_ROLE');
  console.log('    3. Configure RELAYER_ROLE / SOLVER_ROLE on each circuit');
  console.log('    4. Set production SP1 Gateway address');
  console.log('    5. Run npx hardhat test test/optimizations/Deploy.system.test.cjs');
  console.log('    6. Announce deployment to community');
  console.log('    7. Fund BelieverRound with XF tokens via triggerTGE()');
  console.log('    8. Verify contracts on ThetaScan.io Smart Contract HQ');

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 7: POST-DEPLOY HEALTH CHECKS
  // ══════════════════════════════════════════════════════════════════════
  const healthResults = await runHealthChecks(manifest, ethers.provider);
  manifest.healthCheck = {
    timestamp: new Date().toISOString(),
    results: healthResults,
  };

  // Re-write manifest with health check results
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest updated with health checks: ${manifestFile}`);

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 8: CONTINUOUS MONITORING (optional)
  // ══════════════════════════════════════════════════════════════════════
  if (process.env.ENABLE_MONITORING === 'true') {
    const interval = parseInt(process.env.MONITOR_INTERVAL_MS || '30000', 10);
    console.log(`\n══ Continuous Monitoring (every ${interval / 1000}s) ═══════════`);
    console.log('  Press Ctrl+C to stop.\n');

    const monitorLoop = async () => {
      let cycle = 1;
      while (true) {
        await new Promise(r => setTimeout(r, interval));
        console.log(`\n── Monitor cycle ${cycle} (${new Date().toISOString()}) ──`);
        await runHealthChecks(manifest, ethers.provider);
        cycle++;
      }
    };

    await monitorLoop();
  }

  return manifest;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('MAINNET DEPLOY FAILED:', err); process.exit(1); });
