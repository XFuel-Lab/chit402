/**
 * XFuel Protocol — Believer Round Launch Script
 *
 * Default parameters (env overrides):
 *   - TFUEL hard cap:  e.g. 2,000,000 TFUEL (BELIEVER_HARD_CAP)
 *   - XF ceiling:      150,000,000 XF on-chain (BELIEVER_XF_ALLOCATION_CAP = 15% of 1B)
 *   - Max/wallet:      0 = no cap
 *   - Price:           5 XF per 1 TFUEL base (BELIEVER_PRICE_NUM/DEN); multisig setTokenPrice while Open
 *   - Min commit:      100 TFUEL (contract constant)
 *   - Cliff / vesting: 90d + 270d linear
 *   - Admin/multisig:  0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257 (Gnosis Safe on Theta)
 *
 * Single open community round (no phased 4/12/24% tranches). See WHITEPAPER §10.
 *
 * Usage:
 *   npx hardhat run believer/launch-round.cjs --network theta-testnet
 *   npx hardhat run believer/launch-round.cjs                          # local
 *
 * Environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY
 *   ADMIN_ADDRESS              (defaults to 0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257)
 *   BELIEVER_PHASE             (default 1 — on-chain metadata only, 1–3; does NOT enable tranches; see below)
 *   BELIEVER_HARD_CAP          (default 2000000 TFUEL)
 *   BELIEVER_MAX_PER_WALLET    (default 0 = no cap)
 *   BELIEVER_PRICE_NUM         (default 5)
 *   BELIEVER_PRICE_DEN         (default 1)
 *   BELIEVER_XF_ALLOCATION_CAP (default 150000000 = 15% of 1B XF, human units → parseEther)
 *   EXISTING_MANIFEST          (path to manifest JSON, skips deploy if set)
 *   BELIEVER_SMOKE_COMMIT      (default on) Set to 0 or false to skip the 100 TFUEL test commit
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

  // Single open round: `xfAllocationCap` (15%) + optional TFUEL `hardCap` end the sale — not sequential tranches.
  // `PHASE` below is only the contract constructor uint8 (events/stats); BelieverRound does not branch logic on it.
  const MULTISIG = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';
  const ADMIN = resolveAddr('ADMIN_ADDRESS', MULTISIG);
  const PHASE = process.env.BELIEVER_PHASE ? parseInt(process.env.BELIEVER_PHASE, 10) : 1;
  if (PHASE < 1 || PHASE > 3) {
    throw new Error(`BELIEVER_PHASE must be 1–3 (constructor metadata only); got ${PHASE}`);
  }

  const DEFAULT_HARD_CAP = '2000000';
  const DEFAULT_MAX_PER_WALLET = '0';
  const DEFAULT_PRICE_NUM = 5n;
  const DEFAULT_PRICE_DEN = 1n;

  const HARD_CAP = process.env.BELIEVER_HARD_CAP
    ? ethers.parseEther(process.env.BELIEVER_HARD_CAP)
    : ethers.parseEther(DEFAULT_HARD_CAP);
  const MAX_PW_STR = process.env.BELIEVER_MAX_PER_WALLET ?? DEFAULT_MAX_PER_WALLET;
  const MAX_PW = MAX_PW_STR === '0' ? 0n : ethers.parseEther(MAX_PW_STR);
  const P_NUM = process.env.BELIEVER_PRICE_NUM ? BigInt(process.env.BELIEVER_PRICE_NUM) : DEFAULT_PRICE_NUM;
  const P_DEN = process.env.BELIEVER_PRICE_DEN ? BigInt(process.env.BELIEVER_PRICE_DEN) : DEFAULT_PRICE_DEN;

  const XF_CAP = process.env.BELIEVER_XF_ALLOCATION_CAP
    ? ethers.parseEther(process.env.BELIEVER_XF_ALLOCATION_CAP)
    : ethers.parseEther('150000000');

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
    round = await F.deploy(ADMIN, HARD_CAP, MAX_PW, P_NUM, P_DEN, PHASE, XF_CAP);
    await round.waitForDeployment();
    roundAddr = await round.getAddress();
    const receipt = await round.deploymentTransaction().wait();
    deployGas = Number(receipt.gasUsed);
    console.log(`    ✓ Deployed: ${roundAddr} (${deployGas} gas)`);
  }

  // ═══ Phase 2: Configuration Verify ══════════════════════════════
  console.log('\n  ═ Phase 2: Configuration ═════════════════════════');
  console.log(`    on-chain phase (metadata): ${PHASE} — not a sequential tranche; use 1 unless you need ABI compat`);
  console.log(`    Admin:       ${ADMIN}`);
  console.log(`    Hard cap:    ${ethers.formatEther(HARD_CAP)} TFUEL`);
  console.log(`    Max/wallet:  ${MAX_PW === 0n ? 'NO CAP (whale-friendly)' : ethers.formatEther(MAX_PW) + ' TFUEL'}`);
  console.log(`    Price:       ${P_NUM}/${P_DEN} XF per TFUEL`);
  console.log(`    XF cap:      ${ethers.formatEther(XF_CAP)} XF reserved (on-chain ceiling)`);

  // ═══ Phase 3: Smoke Tests ═══════════════════════════════════════
  console.log('\n  ═ Phase 3: Smoke Tests ═══════════════════════════');
  let pass = 0;
  const smokeCommitOn =
    process.env.BELIEVER_SMOKE_COMMIT !== '0' &&
    String(process.env.BELIEVER_SMOKE_COMMIT || '').toLowerCase() !== 'false';
  /** Baseline: status, hardCap, max/wallet, durations, getStats = 5. +2 if we run the on-chain commit smoke. */
  let smokeTotal = 5;
  let smokeCommitNote = '';

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

  // Optional on-chain commit smoke (100 TFUEL min) — needs native TFUEL + gas after deploy
  if (!smokeCommitOn) {
    console.log('    ⊘ Smoke commit disabled (BELIEVER_SMOKE_COMMIT=0)');
    smokeCommitNote = 'disabled_by_env';
  } else {
    const minCommit = ethers.parseEther('100');
    const bal = await ethers.provider.getBalance(deployer.address);
    let gasReserve = ethers.parseEther('0.2');
    try {
      const est = await round.connect(deployer).commit.estimateGas({ value: minCommit });
      const fee = await ethers.provider.getFeeData();
      const gp = fee.gasPrice ?? fee.maxFeePerGas ?? 500000000000n;
      gasReserve = (est * gp * 130n) / 100n;
    } catch {
      /* use fixed reserve */
    }
    const required = minCommit + gasReserve;
    if (bal < required) {
      console.log(
        `    ⊘ Smoke commit skipped: deployer has ${ethers.formatEther(bal)} TFUEL; need ≥ ${ethers.formatEther(required)} (100 min commit + ~gas). Top up testnet TFUEL or set BELIEVER_SMOKE_COMMIT=0.`
      );
      smokeCommitNote = 'skipped_insufficient_balance';
    } else {
      smokeTotal = 7;
      try {
        const tx = await round.connect(deployer).commit({ value: minCommit });
        const r = await tx.wait();
        console.log(`    ✓ Test commit: ${r.gasUsed} gas`);
        pass++;

        const c = await round.getCommitment(deployer.address);
        if (c.amount >= minCommit) {
          console.log(`    ✓ Commitment: ${ethers.formatEther(c.amount)} TFUEL`);
          pass++;
        }
      } catch (e) {
        console.log(`    ✗ Commit: ${e.message.slice(0, 120)}`);
        smokeCommitNote = 'commit_failed';
      }
    }
  }

  try {
    const [committed, believers] = await round.getStats();
    console.log(`    ✓ Stats: ${ethers.formatEther(committed)} committed, ${believers} believers`);
    pass++;
  } catch (e) { console.log(`    ✗ Stats: ${e.message.slice(0, 50)}`); }

  console.log(`\n    Smoke tests: ${pass}/${smokeTotal} passed`);

  // ═══ Phase 4: Launch Report ═════════════════════════════════════
  console.log('\n  ═ Phase 4: Launch Report ═════════════════════════');

  const cliffSec = await round.CLIFF_DURATION();
  const vestSec = await round.VESTING_DURATION();
  const cliffDaysOnChain = Math.round(Number(cliffSec) / 86400);
  const linearVestingDaysOnChain = Math.round(Number(vestSec) / 86400);
  const approxDaysCliffPlusLinear = cliffDaysOnChain + linearVestingDaysOnChain;

  const explorer = network.name === 'theta-testnet'
    ? 'https://testnet-explorer.thetatoken.org'
    : network.name === 'theta-mainnet'
      ? 'https://explorer.thetatoken.org' : null;

  const report = {
    protocol: 'XFuel Protocol',
    version: '2.0.0',
    event: 'Believer Round Launch',
    network: network.name,
    timestamp: new Date().toISOString(),
    contract: roundAddr,
    explorerUrl: explorer ? `${explorer}/account/${roundAddr}` : null,
    parameters: {
      onChainPhaseMetadata: PHASE,
      hardCap: ethers.formatEther(HARD_CAP),
      maxPerWallet: MAX_PW === 0n ? 'none' : ethers.formatEther(MAX_PW),
      priceXFPerTFUEL: `${P_NUM}/${P_DEN}`,
      minCommitmentTFUEL: '100',
      cliffDays: cliffDaysOnChain,
      linearVestingDaysAfterCliff: linearVestingDaysOnChain,
      approxDaysFromTGEToFullVestBySchedule: approxDaysCliffPlusLinear,
      refundDeadlineDays: 180,
      lockTiers: 'commit() = tier 0; commitWithLock(1|2|3) = +8%/+20%/+35% XF with longer min-claim delay (see BelieverRound.sol)',
      admin: ADMIN,
      xfAllocationCapXF: ethers.formatEther(XF_CAP),
    },
    tokenomics: {
      totalSupply: '1,000,000,000 XF',
      communityContributionRound: 'Up to 150,000,000 XF (15%) — on-chain xfAllocationCap',
      communityEngagementRewards: '150,000,000 XF (15%) — CommunityEngagementDistributor + Merkle seasons',
      angelStrategicRound: 'Up to 100,000,000 XF (10%) — AngelRound.sol',
      note: 'Single open community round (no phased 4/12/24% believer tranches). See WHITEPAPER §10.',
    },
    smokeTests: {
      passed: pass,
      total: smokeTotal,
      commitSmoke: smokeCommitNote || (smokeTotal === 7 ? 'ran' : 'not_run'),
    },
    deploymentGas: deployGas,
    traction: {
      circuits: 21, contracts: 22, tests: '755+',
      network: 'Theta Testnet (chain 365)',
      subchain: 'XFuel subchain (chain 365001) — registered, validators active',
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
  **XFuel Believer Round is LIVE on Theta!**

  Commit TFUEL to become an early XFuel Protocol supporter.
  - Min: 100 TFUEL | No wallet cap (first come, first served)
  - Hard cap: ${ethers.formatEther(HARD_CAP)} TFUEL total
  - Price: ${P_NUM} XF per 1 TFUEL base (optional lock tiers: commitWithLock for bonus XF)
  - Up to 15% of total XF supply for Community Contribution (on-chain cap)
  - Vesting: ${cliffDaysOnChain}-day cliff + ${linearVestingDaysOnChain}-day linear (~${approxDaysCliffPlusLinear}d from TGE to full schedule); lock tiers can delay first claim
  - On-chain refund: full TFUEL back if TGE missed (180 days)
  - Multisig-secured: ${ADMIN}

  Protocol traction: 21 circuits, 22 contracts, 755+ tests.
  Live on Theta Testnet (chain 365) + Subchain (365001).

  Contract: \`${roundAddr}\`
  ${explorer ? `Explorer: ${explorer}/account/${roundAddr}` : ''}

  ── X/Twitter ────────────────────────────────────────
  1/ XFuel Believer Round is LIVE.

  21 modular AI circuits. 22 deployed contracts. 755+ tests.
  ZK-verified compute on Theta — routing AI tasks to TAO, Akash, 
  Filecoin, and beyond.

  Commit TFUEL → receive XF tokens with transparent vesting.

  2/ Terms:
  - 100 TFUEL minimum | No wallet cap
  - ${ethers.formatEther(HARD_CAP)} TFUEL total hard cap
  - ${P_NUM} XF per 1 TFUEL
  - ${cliffDaysOnChain}d cliff + ${linearVestingDaysOnChain}d linear vest after cliff (~12mo from TGE); optional lock bonuses on-chain
  - On-chain refund if no TGE within 180 days
  - veXF lock = governance power + protocol revenue share

  3/ What XFuel does:
  → Route your AI tasks to the best GPU (Theta EdgeCloud → Akash → AWS)
  → ZK-prove the work was done on-chain
  → Auto-distribute fees: 30% burn, 30% growth, 25% stakers, 15% treasury
  → Full agent-to-agent economy (A2ACircuit, Bittensor, IBC)

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
  .then(() => {
    // Brief delay avoids occasional libuv "UV_HANDLE_CLOSING" assert on Windows when Hardhat exits.
    setTimeout(() => process.exit(0), 150);
  })
  .catch((e) => {
    console.error('LAUNCH FAILED:', e);
    process.exit(1);
  });
