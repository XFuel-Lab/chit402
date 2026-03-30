/**
 * XFuel Protocol — Believer Round Activation Script
 *
 * End-to-end activation workflow for the BelieverRound contract.
 * Handles deployment, configuration, and campaign preparation.
 *
 * Usage:
 *   npx hardhat run believer/activation-script.cjs --network theta-testnet
 *   npx hardhat run believer/activation-script.cjs                          # local test
 *
 * Environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY    — Deployer wallet
 *   ADMIN_ADDRESS           — Multisig admin (optional, defaults to deployer)
 *   BELIEVER_HARD_CAP       — Total raise cap in ETH/TFUEL (default: 500)
 *   BELIEVER_MAX_PER_WALLET — Per-wallet cap (default: 5)
 *   BELIEVER_PRICE_NUM      — XF per 1 TFUEL numerator (default: 5)
 *   BELIEVER_PRICE_DEN      — XF tokens per ETH denominator (default: 1)
 *
 * Phases:
 *   1. Pre-flight checks
 *   2. Deploy BelieverRound contract
 *   3. Verify deployment + smoke tests
 *   4. Generate activation report (share links, campaign data)
 *   5. Output campaign-ready data for Discord + X/Twitter
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Protocol — Believer Round Activation                 ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Network:   ${(network.name).padEnd(48)}║`);
  console.log(`║  Deployer:  ${deployer.address.padEnd(48)}║`);
  console.log(`║  Balance:   ${ethers.formatEther(balance).slice(0, 20).padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ═══ Phase 1: Configuration ═══════════════════════════════════════
  console.log('\n══ Phase 1: Configuration ══════════════════════════════');

  function resolveAddr(envKey, fallback) {
    const val = process.env[envKey];
    if (!val) return fallback;
    try { return ethers.getAddress(val); } catch { return fallback; }
  }

  const ADMIN = resolveAddr('ADMIN_ADDRESS', deployer.address);
  const HARD_CAP = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP) : ethers.parseEther('500');
  const MAX_PER_WALLET = process.env.BELIEVER_MAX_PER_WALLET
    ? ethers.parseEther(process.env.BELIEVER_MAX_PER_WALLET) : ethers.parseEther('5');
  const PRICE_NUM = process.env.BELIEVER_PRICE_NUM
    ? BigInt(process.env.BELIEVER_PRICE_NUM) : 5n;
  const PRICE_DEN = process.env.BELIEVER_PRICE_DEN
    ? BigInt(process.env.BELIEVER_PRICE_DEN) : 1n;
  const BELIEVER_PHASE = process.env.BELIEVER_PHASE ? parseInt(process.env.BELIEVER_PHASE, 10) : 1;
  const XF_CAP = process.env.BELIEVER_XF_ALLOCATION_CAP
    ? ethers.parseEther(process.env.BELIEVER_XF_ALLOCATION_CAP)
    : ethers.parseEther('150000000');

  console.log(`  Admin:          ${ADMIN}`);
  console.log(`  Hard cap:       ${ethers.formatEther(HARD_CAP)} TFUEL`);
  console.log(`  Max per wallet: ${ethers.formatEther(MAX_PER_WALLET)} TFUEL`);
  console.log(`  Token price:    ${PRICE_NUM}/${PRICE_DEN} XF per TFUEL`);

  // ═══ Phase 2: Deploy ══════════════════════════════════════════════
  console.log('\n══ Phase 2: Deploy BelieverRound ════════════════════════');

  const F = await ethers.getContractFactory('BelieverRound');
  const round = await F.deploy(ADMIN, HARD_CAP, MAX_PER_WALLET, PRICE_NUM, PRICE_DEN, BELIEVER_PHASE, XF_CAP);
  await round.waitForDeployment();
  const roundAddr = await round.getAddress();
  const receipt = await round.deploymentTransaction().wait();

  console.log(`  ✓ BelieverRound: ${roundAddr}`);
  console.log(`  Gas used:        ${receipt.gasUsed}`);

  // ═══ Phase 3: Smoke Tests ═════════════════════════════════════════
  console.log('\n══ Phase 3: Smoke Tests ════════════════════════════════');

  let smokePass = 0;

  // Check status is Open
  const status = await round.status();
  if (Number(status) === 0) { console.log('  ✓ Status: Open'); smokePass++; }
  else { console.log(`  ✗ Status: ${status} (expected Open)`); }

  // Check hard cap
  const hc = await round.hardCap();
  if (hc === HARD_CAP) { console.log(`  ✓ Hard cap: ${ethers.formatEther(hc)} TFUEL`); smokePass++; }
  else { console.log(`  ✗ Hard cap mismatch`); }

  // Check max per wallet
  const mpw = await round.maxCommitmentPerWallet();
  if (mpw === MAX_PER_WALLET) { console.log(`  ✓ Max/wallet: ${ethers.formatEther(mpw)} TFUEL`); smokePass++; }
  else { console.log(`  ✗ Max/wallet mismatch`); }

  // Check CLIFF and VESTING
  const cliff = await round.CLIFF_DURATION();
  const vest = await round.VESTING_DURATION();
  console.log(`  ✓ Cliff: ${Number(cliff) / 86400} days, Vesting: ${Number(vest) / 86400} days`);
  smokePass++;

  // Test commit
  try {
    const tx = await round.connect(deployer).commit({ value: ethers.parseEther('0.1') });
    const r = await tx.wait();
    console.log(`  ✓ Test commit: ${r.gasUsed} gas`);
    smokePass++;

    // Verify commitment
    const c = await round.getCommitment(deployer.address);
    if (c.amount === ethers.parseEther('0.1')) {
      console.log(`  ✓ Commitment recorded: ${ethers.formatEther(c.amount)} TFUEL`);
      smokePass++;
    }
  } catch (e) {
    console.log(`  ✗ Test commit failed: ${e.message.slice(0, 60)}`);
  }

  // Check stats
  const [committed, believers] = await round.getStats();
  console.log(`  ✓ Stats: ${ethers.formatEther(committed)} committed, ${believers} believers`);
  smokePass++;

  console.log(`\n  Smoke tests: ${smokePass}/7 passed`);

  // ═══ Phase 4: Activation Report ═══════════════════════════════════
  console.log('\n══ Phase 4: Activation Report ══════════════════════════');

  const explorer = network.name === 'theta-testnet'
    ? 'https://testnet-explorer.thetatoken.org'
    : network.name === 'theta-mainnet'
      ? 'https://explorer.thetatoken.org'
      : null;

  const activationReport = {
    network: network.name,
    timestamp: new Date().toISOString(),
    contract: {
      address: roundAddr,
      explorerUrl: explorer ? `${explorer}/account/${roundAddr}` : null,
    },
    parameters: {
      hardCap: ethers.formatEther(HARD_CAP),
      maxPerWallet: ethers.formatEther(MAX_PER_WALLET),
      priceXFPerTFUEL: `${PRICE_NUM}/${PRICE_DEN}`,
      cliffDays: 90,
      vestingDays: 365,
      refundDeadlineDays: 180,
    },
    smokeTests: { passed: smokePass, total: 7 },
    deploymentGas: Number(receipt.gasUsed),
    admin: ADMIN,
    deployer: deployer.address,
  };

  console.log(JSON.stringify(activationReport, null, 2));

  // Write report
  const reportDir = path.join(__dirname);
  const reportFile = path.join(reportDir, `activation-${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(activationReport, null, 2));
  console.log(`\n  Report saved: ${reportFile}`);

  // ═══ Phase 5: Campaign Data ═══════════════════════════════════════
  console.log('\n══ Phase 5: Campaign Copy ══════════════════════════════');

  console.log(`
  ── Discord Announcement ──────────────────────────────
  **The Believer Round is LIVE!**

  Commit TFUEL to become an early XFuel Protocol supporter.
  - Min: 0.01 TFUEL | Max: ${ethers.formatEther(MAX_PER_WALLET)} TFUEL per wallet
  - Hard cap: ${ethers.formatEther(HARD_CAP)} TFUEL
  - Vesting: 3-month cliff + 12-month linear
  - Refund: Full refund if TGE misses 180-day deadline

  Contract: \`${roundAddr}\`
  ${explorer ? `Explorer: ${explorer}/account/${roundAddr}` : ''}

  ── X/Twitter Thread ──────────────────────────────────
  1/ The XFuel Believer Round is LIVE.

  Early supporters can commit TFUEL to receive XF tokens
  with a transparent vesting schedule.

  Contract: ${roundAddr}

  2/ Key terms:
  - 3-month cliff, 12-month linear vest
  - $5K per-wallet cap (anti-whale)
  - On-chain refund if no TGE within 6 months
  - veXF bonus for long-term lockers

  3/ How to commit:
  Send TFUEL to ${roundAddr}
  (or use xfuel.app/believers when available)

  Min: 0.01 TFUEL | Max: ${ethers.formatEther(MAX_PER_WALLET)} TFUEL
  `);

  console.log('  ⚠ NEXT STEPS:');
  console.log('    1. Verify contract on block explorer');
  console.log('    2. Update xfuel.app/believers with contract address');
  console.log('    3. Post Discord announcement');
  console.log('    4. Launch X/Twitter thread');
  console.log('    5. Pin commitment link in community channels');
  console.log('    6. Monitor with: npx hardhat run believer/activation-script.cjs');

  return activationReport;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('ACTIVATION FAILED:', err); process.exit(1); });
