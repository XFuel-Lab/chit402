/**
 * XFuel Protocol -- Public Testnet Activation Script
 *
 * Orchestrates a full public activation on Theta Testnet:
 *   Phase 0: Pre-flight (balance, chain, compiler)
 *   Phase 1: Core Layer deployment
 *   Phase 2: All 16 circuits deployment (incl. UplinkCircuit)
 *   Phase 3: BelieverRound deployment
 *   Phase 4: Role grants + on-chain verification
 *   Phase 5: Comprehensive smoke tests
 *   Phase 6: Dashboard manifest output
 *   Phase 7: Campaign copy + next-steps
 *
 * Usage:
 *   npx hardhat run activation/public-activation.cjs --network theta-testnet
 *   npx hardhat run activation/public-activation.cjs
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

const NET = {
  'theta-testnet': {
    name: 'Theta Testnet', chainId: 365,
    rpc: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    explorer: 'https://testnet-explorer.thetatoken.org',
    minBal: ethers.parseEther('0.5'),
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
  const cfg = NET[network.name] || {
    name: network.name, chainId: '?', rpc: '', explorer: null,
    minBal: ethers.parseEther('0.5'),
  };

  function resolveAddr(key, fb) {
    const v = process.env[key];
    if (!v) return fb;
    try { return ethers.getAddress(v); } catch { return fb; }
  }
  const ADMIN = resolveAddr('ADMIN_ADDRESS', deployer.address);

  console.log('');
  console.log('  =====================================================');
  console.log('   XFuel Protocol -- Public Testnet Activation (v1.95)');
  console.log('  =====================================================');
  console.log('  Network:  ' + cfg.name);
  console.log('  Chain:    ' + cfg.chainId);
  console.log('  Deployer: ' + deployer.address);
  console.log('  Admin:    ' + ADMIN);
  console.log('  Balance:  ' + ethers.formatEther(bal).slice(0, 18));
  console.log('  =====================================================');

  // Phase 0
  console.log('\n  -- Phase 0: Pre-Flight --');
  if (bal < cfg.minBal) throw new Error('Balance too low: ' + ethers.formatEther(bal));
  console.log('    OK Balance');
  if (network.name === 'theta-testnet') {
    const net = await ethers.provider.getNetwork();
    if (Number(net.chainId) !== 365) throw new Error('Chain ID mismatch: ' + net.chainId);
    console.log('    OK Chain ID 365');
  }
  console.log('    OK Pre-flight');

  const manifest = {
    protocol: 'XFuel Protocol', version: '1.95',
    network: network.name, chainId: cfg.chainId,
    rpc: cfg.rpc, explorer: cfg.explorer,
    deployer: deployer.address, admin: ADMIN,
    timestamp: new Date().toISOString(),
    contracts: {}, gasUsed: {}, roles: [],
    smokeTests: { passed: 0, failed: 0, details: [] },
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

  // Phase 1
  console.log('\n  -- Phase 1: Core Layer --');
  const d = deployer.address;
  const spl = await dep('CoreRevenueSplitter',
    await ethers.getContractFactory('CoreRevenueSplitter'), [d,d,d,d,d,d]);
  const sa = manifest.contracts.CoreRevenueSplitter;
  await dep('ZKVerifierSP1',
    await ethers.getContractFactory('ZKVerifierSP1'), [d, ethers.ZeroAddress]);
  const za = manifest.contracts.ZKVerifierSP1;

  // Phase 2
  console.log('\n  -- Phase 2: Circuits (16) --');
  const circuits = [
    { name: 'TAOCircuit',       args: [d,sa,za,ethers.ZeroAddress,ethers.ZeroAddress] },
    { name: 'A2ACircuit',       args: [d,sa,za] },
    { name: 'ThetaGPUCircuit',  args: [d,sa,za] },
    { name: 'ZKMLCircuit',      args: [d,sa,za] },
    { name: 'AkashCircuit',     args: [d,sa,za] },
    { name: 'AutonomousVaults', args: [d,sa,za] },
    { name: 'AgentRobotics',    args: [d,sa,za] },
    { name: 'DataHubs',         args: [d,sa,za] },
    { name: 'YieldCircuit',     args: [d,sa,za] },
    { name: 'NearAgents',       args: [d,sa,za] },
    { name: 'SolanaAIBridge',   args: [d,sa,za] },
    { name: 'FilecoinStorage',  args: [d,sa,za] },
    { name: 'EnergyGrid',       args: [d,sa,za] },
    { name: 'MappingSensor',   args: [d,sa,za] },
    { name: 'WirelessDePIN',  args: [d,sa,za] },
    { name: 'UplinkCircuit', args: [d,sa,za] },
  ];
  for (const c of circuits)
    await dep(c.name, await ethers.getContractFactory(c.name), c.args);

  // Phase 3
  console.log('\n  -- Phase 3: BelieverRound --');
  const hCap = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP) : ethers.parseEther('500');
  const believerXfCap = process.env.BELIEVER_XF_ALLOCATION_CAP
    ? ethers.parseEther(process.env.BELIEVER_XF_ALLOCATION_CAP)
    : ethers.parseEther('150000000');
  await dep('BelieverRound',
    await ethers.getContractFactory('BelieverRound'),
    [d, hCap, ethers.parseEther('5'), 10000n, 1n, 1, believerXfCap]);
  manifest.believerRound = {
    address: manifest.contracts.BelieverRound,
    hardCap: ethers.formatEther(hCap), maxPerWallet: '5.0',
    price: '10000 XF/TFUEL', cliff: '90d', vesting: '365d',
  };

  // Phase 4
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

  // Phase 5
  console.log('\n  -- Phase 5: Smoke Tests --');
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

  const psd = manifest.smokeTests.passed;
  const fld = manifest.smokeTests.failed;
  console.log('\n    Smoke tests: ' + psd + ' passed, ' + fld + ' failed');

  // Phase 6
  console.log('\n  -- Phase 6: Manifest --');
  manifest.totalGas = Number(totalGas);
  manifest.totalGasCostTFUEL = ethers.formatEther(totalGas * 4000000000n);
  manifest.elapsedMs = Date.now() - t0;

  const mDir = path.join(__dirname, '..', 'deploy', 'manifests');
  if (!fs.existsSync(mDir)) fs.mkdirSync(mDir, { recursive: true });
  const mFile = path.join(mDir, 'activation-' + Date.now() + '.json');
  fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2));
  console.log('    Manifest: ' + mFile);
  console.log('    Total gas: ' + totalGas + ' (~' + manifest.totalGasCostTFUEL + ' TFUEL)');
  console.log('    Duration: ' + (manifest.elapsedMs / 1000).toFixed(1) + 's');

  // Phase 7
  const cc = Object.keys(manifest.contracts).length;
  console.log('\n  -- Phase 7: Summary --');
  console.log('  ' + cc + ' contracts deployed on ' + cfg.name);
  console.log('  16 modular AI circuits + BelieverRound + Core Layer');
  console.log('  Smoke tests: ' + psd + '/' + (psd + fld) + ' passing');
  console.log('  NEW: EnergyGrid circuit (Daylight/Glow DePIN energy)');
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Open dashboard/index.html and load manifest');
  console.log('    2. Start event listener in dashboard');
  console.log('    3. Run: npx hardhat run believer/launch-round.cjs');
  console.log('    4. Run: node grant/submission-script.cjs --all');
  console.log('');

  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

main()
  .then(function() { process.exit(0); })
  .catch(function(e) { console.error('ACTIVATION FAILED:', e); process.exit(1); });
