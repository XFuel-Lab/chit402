/**
 * XFuel Protocol — Believer Round Launch Script
 *
 * Production launch workflow for the BelieverRound contract.
 * Extends activation-script.cjs with:
 *   - Manifest-aware deployment (skips if already deployed)
 *   - Enhanced campaign copy with traction metrics
 *   - Grant cross-reference (links to grant submissions)
 *   - Post-launch monitoring bootstrap
 *
 * Usage:
 *   npx hardhat run believer/launch-round.cjs --network theta-testnet
 *   npx hardhat run believer/launch-round.cjs                          # local
 *
 * Environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY
 *   ADMIN_ADDRESS              (optional, defaults to deployer)
 *   BELIEVER_HARD_CAP          (default 500)
 *   BELIEVER_MAX_PER_WALLET    (default 5)
 *   BELIEVER_PRICE_NUM         (default 10000)
 *   BELIEVER_PRICE_DEN         (default 1)
 *   EXISTING_MANIFEST          (path to manifest JSON, skips deploy if set)
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║  XFuel Protocol — Believer Round Launch                 ║');
  console.log('  ╠══════════════════════════════════════════════════════════╣');
  console.log(`  ║  Network:   ${network.name.padEnd(44)}║`);
  console.log(`  ║  Deployer:  ${deployer.address.padEnd(44)}║`);
  console.log(`  ║  Balance:   ${ethers.formatEther(balance).slice(0, 18).padEnd(44)}║`);
  console.log('  ╚══════════════════════════════════════════════════════════╝');

  function resolveAddr(key, fb) {
    const v = process.env[key];
    if (!v) return fb;
    try { return ethers.getAddress(v); } catch { return fb; }
  }

  const ADMIN = resolveAddr('ADMIN_ADDRESS', deployer.address);
  const HARD_CAP = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP) : ethers.parseEther('500');
  const MAX_PW = process.env.BELIEVER_MAX_PER_WALLET
    ? ethers.parseEther(process.env.BELIEVER_MAX_PER_WALLET) : ethers.parseEther('5');
  const P_NUM = process.env.BELIEVER_PRICE_NUM ? BigInt(process.env.BELIEVER_PRICE_NUM) : 10000n;
  const P_DEN = process.env.BELIEVER_PRICE_DEN ? BigInt(process.env.BELIEVER_PRICE_DEN) : 1n;

  // ═══ Phase 1: Check for Existing Deployment ═════════════════════
  console.log('\n  ═ Phase 1: Deployment Check ═══════════════════════');

  let roundAddr = null;
  let round = null;
  let deployGas = 0;

  const manifestPath = process.env.EXISTING_MANIFEST;
  if (manifestPath && fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (m.contracts && m.contracts.BelieverRound) {
      roundAddr = m.contracts.BelieverRound;
      round = await ethers.getContractAt('BelieverRound', roundAddr);
      console.log(`    ✓ Found existing: ${roundAddr}`);
      deployGas = m.gasUsed?.BelieverRound || 0;
    }
  }

  if (!round) {
    console.log('    Deploying new BelieverRound...');
    const F = await ethers.getContractFactory('BelieverRound');
    round = await F.deploy(ADMIN, HARD_CAP, MAX_PW, P_NUM, P_DEN);
    await round.waitForDeployment();
    roundAddr = await round.getAddress();
    const receipt = await round.deploymentTransaction().wait();
    deployGas = Number(receipt.gasUsed);
    console.log(`    ✓ Deployed: ${roundAddr} (${deployGas} gas)`);
  }

  // ═══ Phase 2: Configuration Verify ══════════════════════════════
  console.log('\n  ═ Phase 2: Configuration ═════════════════════════');
  console.log(`    Admin:       ${ADMIN}`);
  console.log(`    Hard cap:    ${ethers.formatEther(HARD_CAP)} TFUEL`);
  console.log(`    Max/wallet:  ${ethers.formatEther(MAX_PW)} TFUEL`);
  console.log(`    Price:       ${P_NUM}/${P_DEN} XF per TFUEL`);

  // ═══ Phase 3: Smoke Tests ═══════════════════════════════════════
  console.log('\n  ═ Phase 3: Smoke Tests ═══════════════════════════');
  let pass = 0;

  try {
    const s = await round.status();
    console.log(`    ✓ Status: ${['Open','Closed','TGE','Refunding'][Number(s)]}`);
    pass++;
  } catch (e) { console.log(`    ✗ Status: ${e.message.slice(0, 50)}`); }

  try {
    const hc = await round.hardCap();
    console.log(`    ✓ Hard cap: ${ethers.formatEther(hc)} TFUEL`);
    pass++;
  } catch (e) { console.log(`    ✗ Hard cap: ${e.message.slice(0, 50)}`); }

  try {
    const mpw = await round.maxCommitmentPerWallet();
    console.log(`    ✓ Max/wallet: ${ethers.formatEther(mpw)} TFUEL`);
    pass++;
  } catch (e) { console.log(`    ✗ Max/wallet: ${e.message.slice(0, 50)}`); }

  try {
    const cliff = await round.CLIFF_DURATION();
    const vest = await round.VESTING_DURATION();
    console.log(`    ✓ Cliff: ${Number(cliff)/86400}d, Vesting: ${Number(vest)/86400}d`);
    pass++;
  } catch (e) { console.log(`    ✗ Durations: ${e.message.slice(0, 50)}`); }

  // Test commit
  try {
    const tx = await round.connect(deployer).commit({ value: ethers.parseEther('0.1') });
    const r = await tx.wait();
    console.log(`    ✓ Test commit: ${r.gasUsed} gas`);
    pass++;

    const c = await round.getCommitment(deployer.address);
    if (c.amount >= ethers.parseEther('0.1')) {
      console.log(`    ✓ Commitment: ${ethers.formatEther(c.amount)} TFUEL`);
      pass++;
    }
  } catch (e) { console.log(`    ✗ Commit: ${e.message.slice(0, 50)}`); }

  try {
    const [committed, believers] = await round.getStats();
    console.log(`    ✓ Stats: ${ethers.formatEther(committed)} committed, ${believers} believers`);
    pass++;
  } catch (e) { console.log(`    ✗ Stats: ${e.message.slice(0, 50)}`); }

  console.log(`\n    Smoke tests: ${pass}/7 passed`);

  // ═══ Phase 4: Launch Report ═════════════════════════════════════
  console.log('\n  ═ Phase 4: Launch Report ═════════════════════════');

  const explorer = network.name === 'theta-testnet'
    ? 'https://testnet-explorer.thetatoken.org'
    : network.name === 'theta-mainnet'
      ? 'https://explorer.thetatoken.org' : null;

  const report = {
    protocol: 'XFuel Protocol',
    version: '1.95',
    event: 'Believer Round Launch',
    network: network.name,
    timestamp: new Date().toISOString(),
    contract: roundAddr,
    explorerUrl: explorer ? `${explorer}/account/${roundAddr}` : null,
    parameters: {
      hardCap: ethers.formatEther(HARD_CAP),
      maxPerWallet: ethers.formatEther(MAX_PW),
      priceXFPerTFUEL: `${P_NUM}/${P_DEN}`,
      cliffDays: 90, vestingDays: 365, refundDeadlineDays: 180,
    },
    smokeTests: { passed: pass, total: 7 },
    deploymentGas: deployGas,
    traction: {
      circuits: 13, contracts: 16, tests: '270+',
      newCircuit: 'EnergyGrid (DePIN energy + carbon credits)',
    },
  };

  const rFile = path.join(__dirname, `launch-round-${Date.now()}.json`);
  fs.writeFileSync(rFile, JSON.stringify(report, null, 2));
  console.log(`    Report: ${rFile}`);
  console.log(JSON.stringify(report, null, 2));

  // ═══ Phase 5: Campaign Copy ═════════════════════════════════════
  console.log('\n  ═ Phase 5: Campaign Copy ═════════════════════════');
  console.log(`
  ── Discord ──────────────────────────────────────────
  **XFuel Believer Round is LIVE!**

  Commit TFUEL to become an early XFuel Protocol supporter.
  - Min: 0.01 TFUEL | Max: ${ethers.formatEther(MAX_PW)} TFUEL/wallet
  - Hard cap: ${ethers.formatEther(HARD_CAP)} TFUEL
  - Vesting: 3-month cliff + 12-month linear
  - Refund: Full refund if TGE misses 180-day deadline

  Protocol traction: 13 circuits, 16 contracts, 270+ tests.
  NEW: EnergyGrid circuit (Daylight-inspired DePIN energy).

  Contract: \`${roundAddr}\`
  ${explorer ? `Explorer: ${explorer}/account/${roundAddr}` : ''}

  ── X/Twitter ────────────────────────────────────────
  1/ The XFuel Believer Round is LIVE.

  13 modular AI circuits. 16 deployed contracts. 270+ tests.
  ZK-verified compute across TAO, Solana, NEAR, Filecoin, Energy Grid.

  Commit TFUEL → receive XF tokens with transparent vesting.

  2/ Terms:
  - 3-month cliff, 12-month linear vest
  - ${ethers.formatEther(MAX_PW)} TFUEL per-wallet cap
  - On-chain refund if no TGE within 180 days
  - veXF governance bonus for long-term lockers

  3/ Grants submitted to:
  - Solana Foundation ($150-250K)
  - OpenTensor Foundation ($150-200K)
  - General ecosystem ($50-300K)
  Total potential: $350K-$750K

  Contract: ${roundAddr}
  `);

  console.log('  Next steps:');
  console.log('    1. Verify on block explorer');
  console.log('    2. Post Discord + X announcements');
  console.log('    3. Open dashboard/index.html with manifest');
  console.log('    4. Submit grants: node grant/submission-script.cjs --all');
  console.log('    5. Monitor: node grant-templates/grant-tracker.cjs');
  console.log('');

  return report;
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('LAUNCH FAILED:', e); process.exit(1); });
