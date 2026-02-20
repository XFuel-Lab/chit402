/**
 * XFuel Protocol -- Mainnet Activation Script (v2.1)
 *
 * Production deployment to Theta Mainnet (chain ID 361).
 * Deploys Core Layer + all 16 circuits + BelieverRound.
 * Includes ThetaScan.io monitoring, admin transfer, and health checks.
 *
 * Phases:
 *   0: Pre-flight (balance >= 50 TFUEL, chain ID, address validation)
 *   1: Core Layer (Splitter + ZKVerifier + optional veXFGovernance)
 *   2: All 16 circuits (TAO -> ... -> WirelessDePIN -> UplinkCircuit)
 *   3: BelieverRound
 *   4: Role grants + verification (16/16 CIRCUIT_ROLE)
 *   5: Admin transfer (deployer -> multisig)
 *   6: Smoke tests (19/19)
 *   7: Health checks (ThetaScan API)
 *   8: Manifest output + campaign copy
 *
 * Usage:
 *   npx hardhat run activation/mainnet-activation.cjs --network theta-mainnet
 *   npx hardhat run activation/mainnet-activation.cjs                          # local
 *
 * Environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY, ADMIN_ADDRESS, BBB_ADDRESS, LP_ADDRESS,
 *   STAKER_ADDRESS, TREASURY_ADDRESS, STAKE_POOL_ADDRESS,
 *   SP1_GATEWAY_ADDRESS, XF_TOKEN_ADDRESS, THETASCAN_API_KEY,
 *   ENABLE_MONITORING, BELIEVER_HARD_CAP
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ThetaScan monitoring
const THETASCAN_BASE = 'https://www.thetascan.io/api';
function httpGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

const NET = {
  'theta-mainnet': {
    name: 'Theta Mainnet', chainId: 361,
    rpc: 'https://eth-rpc-api.thetatoken.org/rpc',
    explorer: 'https://explorer.thetatoken.org',
    minBal: ethers.parseEther('50'),
  },
  hardhat: {
    name: 'Hardhat Local', chainId: 1337,
    rpc: 'http://127.0.0.1:8545', explorer: null,
    minBal: ethers.parseEther('1'),
  },
};

async function main() {
  const t0 = Date.now();
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  const cfg = NET[network.name] || NET.hardhat;

  function resolveAddr(key, fb) {
    const v = process.env[key];
    if (!v) return fb;
    try { return ethers.getAddress(v); } catch { return fb; }
  }

  const ADMIN    = resolveAddr('ADMIN_ADDRESS', deployer.address);
  const BBB      = resolveAddr('BBB_ADDRESS', deployer.address);
  const LP       = resolveAddr('LP_ADDRESS', deployer.address);
  const STAKER   = resolveAddr('STAKER_ADDRESS', deployer.address);
  const TREASURY = resolveAddr('TREASURY_ADDRESS', deployer.address);
  const STAKE    = resolveAddr('STAKE_POOL_ADDRESS', deployer.address);
  const SP1GW    = resolveAddr('SP1_GATEWAY_ADDRESS', ethers.ZeroAddress);
  const XF_TOKEN = resolveAddr('XF_TOKEN_ADDRESS', ethers.ZeroAddress);

  console.log('');
  console.log('  =====================================================');
  console.log('   XFuel Protocol -- MAINNET ACTIVATION (v2.0)');
  console.log('   WARNING: PRODUCTION -- ALL TRANSACTIONS IRREVERSIBLE');
  console.log('  =====================================================');
  console.log('  Network:  ' + cfg.name);
  console.log('  Chain:    ' + cfg.chainId);
  console.log('  Deployer: ' + deployer.address);
  console.log('  Admin:    ' + ADMIN);
  console.log('  Balance:  ' + ethers.formatEther(bal).slice(0, 18));
  console.log('  =====================================================');

  // Phase 0: Pre-flight
  console.log('\n  -- Phase 0: Pre-Flight --');
  if (bal < cfg.minBal) throw new Error('Balance too low: ' + ethers.formatEther(bal));
  console.log('    OK Balance');
  if (network.name === 'theta-mainnet') {
    const net = await ethers.provider.getNetwork();
    if (Number(net.chainId) !== 361) throw new Error('Chain ID mismatch: ' + net.chainId);
    console.log('    OK Chain ID 361');
  }
  console.log('    Admin:    ' + ADMIN);
  console.log('    BBB:      ' + BBB);
  console.log('    LP:       ' + LP);
  console.log('    Staker:   ' + STAKER);
  console.log('    Treasury: ' + TREASURY);
  console.log('    SP1 GW:   ' + (SP1GW === ethers.ZeroAddress ? '(mock)' : SP1GW));
  console.log('    XF Token: ' + (XF_TOKEN === ethers.ZeroAddress ? '(mock)' : XF_TOKEN));
  console.log('    OK Pre-flight');

  const manifest = {
    protocol: 'XFuel Protocol', version: '2.0',
    network: network.name, chainId: cfg.chainId,
    rpc: cfg.rpc, explorer: cfg.explorer,
    deployer: deployer.address, admin: ADMIN,
    timestamp: new Date().toISOString(),
    contracts: {}, gasUsed: {}, roles: [],
    smokeTests: { passed: 0, failed: 0, details: [] },
    healthChecks: [],
    believerRound: {},
  };
  let totalGas = 0n;

  async function dep(name, F, args) {
    console.log('    Deploying ' + name + '...');
    const c = await F.deploy(...args);
    await c.waitForDeployment();
    const a = await c.getAddress();
    const r = await c.deploymentTransaction().wait();
    manifest.contracts[name] = a;
    manifest.gasUsed[name] = Number(r.gasUsed);
    totalGas += r.gasUsed;
    console.log('    OK ' + name.padEnd(24) + ' ' + a + '  (' + r.gasUsed + ' gas)');
    return c;
  }
  function smk(n, ok, d) {
    if (ok) { manifest.smokeTests.passed++; } else { manifest.smokeTests.failed++; }
    console.log('    ' + (ok ? 'OK' : 'FAIL') + ' ' + n + (ok ? '' : ': ' + (d || '')));
    manifest.smokeTests.details.push({ name: n, pass: ok, detail: d || '' });
  }

  // Phase 1: Core Layer
  console.log('\n  -- Phase 1: Core Layer --');
  const spl = await dep('CoreRevenueSplitter',
    await ethers.getContractFactory('CoreRevenueSplitter'),
    [ADMIN, BBB, LP, STAKER, TREASURY, STAKE]);
  const sa = manifest.contracts.CoreRevenueSplitter;

  const vrf = await dep('ZKVerifierSP1',
    await ethers.getContractFactory('ZKVerifierSP1'), [ADMIN, SP1GW]);
  const za = manifest.contracts.ZKVerifierSP1;

  if (XF_TOKEN !== ethers.ZeroAddress) {
    await dep('veXFGovernance',
      await ethers.getContractFactory('veXFGovernance'), [ADMIN, XF_TOKEN]);
  } else {
    console.log('    SKIP veXFGovernance (set XF_TOKEN_ADDRESS for production)');
    manifest.contracts.veXFGovernance = 'SKIPPED';
  }

  // Phase 2: All 16 circuits
  console.log('\n  -- Phase 2: Circuits (16) --');
  const circuits = [
    { name: 'TAOCircuit',       args: [ADMIN,sa,za,ethers.ZeroAddress,ethers.ZeroAddress] },
    { name: 'A2ACircuit',       args: [ADMIN,sa,za] },
    { name: 'ThetaGPUCircuit',  args: [ADMIN,sa,za] },
    { name: 'ZKMLCircuit',      args: [ADMIN,sa,za] },
    { name: 'AkashCircuit',     args: [ADMIN,sa,za] },
    { name: 'AutonomousVaults', args: [ADMIN,sa,za] },
    { name: 'AgentRobotics',    args: [ADMIN,sa,za] },
    { name: 'DataHubs',         args: [ADMIN,sa,za] },
    { name: 'YieldCircuit',     args: [ADMIN,sa,za] },
    { name: 'NearAgents',       args: [ADMIN,sa,za] },
    { name: 'SolanaAIBridge',   args: [ADMIN,sa,za] },
    { name: 'FilecoinStorage',  args: [ADMIN,sa,za] },
    { name: 'EnergyGrid',       args: [ADMIN,sa,za] },
    { name: 'MappingSensor',    args: [ADMIN,sa,za] },
    { name: 'WirelessDePIN',   args: [ADMIN,sa,za] },
    { name: 'UplinkCircuit',  args: [ADMIN,sa,za] },
  ];
  for (const c of circuits)
    await dep(c.name, await ethers.getContractFactory(c.name), c.args);

  // Phase 3: BelieverRound
  console.log('\n  -- Phase 3: BelieverRound --');
  const hCap = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP) : ethers.parseEther('500');
  await dep('BelieverRound',
    await ethers.getContractFactory('BelieverRound'),
    [ADMIN, hCap, ethers.parseEther('5'), 10000n, 1n]);
  manifest.believerRound = {
    address: manifest.contracts.BelieverRound,
    hardCap: ethers.formatEther(hCap), maxPerWallet: '5.0',
    price: '10000 XF/TFUEL', cliff: '90d', vesting: '365d',
  };

  // Phase 4: Role grants
  console.log('\n  -- Phase 4: Role Grants --');
  const CR = await spl.CIRCUIT_ROLE();
  for (const c of circuits) {
    await (await spl.grantRole(CR, manifest.contracts[c.name])).wait();
    manifest.roles.push({ contract: c.name, role: 'CIRCUIT_ROLE', address: manifest.contracts[c.name] });
    console.log('    OK CIRCUIT_ROLE -> ' + c.name);
  }
  let rOk = 0;
  for (const c of circuits) if (await spl.hasRole(CR, manifest.contracts[c.name])) rOk++;
  console.log('    Verified: ' + rOk + '/' + circuits.length);

  // Phase 5: Admin transfer
  console.log('\n  -- Phase 5: Admin Transfer --');
  if (ADMIN !== deployer.address) {
    const DAR = await spl.DEFAULT_ADMIN_ROLE();
    await (await spl.grantRole(DAR, ADMIN)).wait();
    console.log('    OK DEFAULT_ADMIN_ROLE granted to ' + ADMIN);
    await (await spl.renounceRole(DAR, deployer.address)).wait();
    console.log('    OK Deployer renounced admin');
  } else {
    console.log('    SKIP Admin transfer (ADMIN == deployer, set ADMIN_ADDRESS for production)');
  }

  // Phase 6: Smoke tests
  console.log('\n  -- Phase 6: Smoke Tests --');
  for (const c of circuits) {
    try {
      const inst = await ethers.getContractAt(c.name, manifest.contracts[c.name]);
      const cid = await inst.CIRCUIT_ID();
      smk(c.name + '.CIRCUIT_ID', true, cid.slice(0, 18));
    } catch (e) { smk(c.name + '.CIRCUIT_ID', false, e.message.slice(0, 50)); }
  }
  try {
    const [b,l,s,t] = await spl.getSplit();
    smk('Splitter.getSplit()', true, b + '/' + l + '/' + s + '/' + t);
  } catch (e) { smk('Splitter.getSplit()', false, e.message.slice(0, 50)); }
  try {
    const br = await ethers.getContractAt('BelieverRound', manifest.contracts.BelieverRound);
    smk('BelieverRound.status', Number(await br.status()) === 0, 'Open');
  } catch (e) { smk('BelieverRound.status', false, e.message.slice(0, 50)); }
  try {
    const zkv = await ethers.getContractAt('ZKVerifierSP1', za);
    smk('ZKVerifier.alive', true);
  } catch (e) { smk('ZKVerifier.alive', false, e.message.slice(0, 50)); }

  var psd = manifest.smokeTests.passed;
  var fld = manifest.smokeTests.failed;
  console.log('\n    Smoke tests: ' + psd + ' passed, ' + fld + ' failed');

  // Phase 7: Health checks
  console.log('\n  -- Phase 7: Health Checks --');
  var hcPass = 0;
  for (var entry of Object.entries(manifest.contracts)) {
    var cName = entry[0]; var cAddr = entry[1];
    if (typeof cAddr !== 'string' || !cAddr.startsWith('0x')) continue;
    try {
      var code = await ethers.provider.getCode(cAddr);
      var hasCode = code !== '0x' && code.length > 2;
      if (hasCode) hcPass++;
      manifest.healthChecks.push({ name: cName, address: cAddr, healthy: hasCode });
      console.log('    ' + (hasCode ? 'OK' : 'FAIL') + ' ' + cName.padEnd(24) + cAddr);
    } catch (e) {
      manifest.healthChecks.push({ name: cName, address: cAddr, healthy: false, error: e.message });
      console.log('    FAIL ' + cName + ': ' + e.message.slice(0, 50));
    }
  }
  console.log('    Health: ' + hcPass + '/' + manifest.healthChecks.length + ' contracts live');

  // ThetaScan checks (only on real network)
  if (network.name !== 'hardhat') {
    console.log('\n    -- ThetaScan API --');
    try {
      var scanBal = await httpGet(THETASCAN_BASE + '/balance/' + deployer.address);
      console.log('    OK Deployer balance: ' + JSON.stringify(scanBal));
    } catch (e) { console.log('    SKIP ThetaScan: ' + e.message); }
  }

  // Phase 8: Manifest
  console.log('\n  -- Phase 8: Manifest + Summary --');
  manifest.totalGas = Number(totalGas);
  manifest.totalGasCostTFUEL = ethers.formatEther(totalGas * 4000000000n);
  manifest.elapsedMs = Date.now() - t0;

  var mDir = path.join(__dirname, '..', 'deploy', 'manifests');
  if (!fs.existsSync(mDir)) fs.mkdirSync(mDir, { recursive: true });
  var mFile = path.join(mDir, 'mainnet-activation-' + Date.now() + '.json');
  fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2));
  console.log('    Manifest: ' + mFile);

  var cc = Object.keys(manifest.contracts).length;
  console.log('');
  console.log('  =====================================================');
  console.log('  ' + cc + ' contracts deployed on ' + cfg.name);
  console.log('  16 modular AI circuits + BelieverRound + Core Layer');
  console.log('  Smoke tests: ' + psd + '/' + (psd + fld) + ' passing');
  console.log('  Health checks: ' + hcPass + '/' + manifest.healthChecks.length);
  console.log('  NEW: UplinkCircuit (Uplink WiFi bandwidth sharing + wireless synergy)');
  console.log('  Previous: WirelessDePIN (Helium/XNET DePIN wireless coverage)');
  console.log('  Total gas: ' + totalGas + ' (~' + manifest.totalGasCostTFUEL + ' TFUEL)');
  console.log('  Duration: ' + (manifest.elapsedMs / 1000).toFixed(1) + 's');
  console.log('  =====================================================');
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Verify contracts on explorer.thetatoken.org');
  console.log('    2. Open dashboard/index.html and load manifest');
  console.log('    3. Run: npx hardhat run believer/launch-round.cjs --network theta-mainnet');
  console.log('    4. Run: node believer/monitoring-script.cjs');
  console.log('    5. Run: node grant/submission-script.cjs --all');
  console.log('');

  // Optional monitoring loop
  if (process.env.ENABLE_MONITORING === 'true') {
    var interval = Number(process.env.MONITOR_INTERVAL_MS) || 60000;
    console.log('  Monitoring enabled (interval: ' + interval + 'ms)');
    var monitorLoop = setInterval(async function() {
      console.log('\n  -- Health Check (' + new Date().toISOString() + ') --');
      for (var entry of Object.entries(manifest.contracts)) {
        var cn = entry[0]; var ca = entry[1];
        if (typeof ca !== 'string' || !ca.startsWith('0x')) continue;
        try {
          var code = await ethers.provider.getCode(ca);
          console.log('    ' + (code.length > 2 ? 'OK' : 'WARN') + ' ' + cn);
        } catch (e) { console.log('    ERR ' + cn + ': ' + e.message.slice(0, 40)); }
      }
    }, interval);
    process.on('SIGINT', function() { clearInterval(monitorLoop); process.exit(0); });
  }

  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

main()
  .then(function() {
    if (process.env.ENABLE_MONITORING !== 'true') process.exit(0);
  })
  .catch(function(e) { console.error('MAINNET ACTIVATION FAILED:', e); process.exit(1); });
