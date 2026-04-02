/**
 * XFuel Protocol — Angel Round launch (pre-TGE treasury / audit funding).
 *
 * Separate from BelieverRound: no TFUEL refund path; admin may withdrawToTreasury before TGE
 * (disclosed memo on-chain). TGE is a separate triggerTGE from BelieverRound.
 *
 * Defaults (override via env):
 *   Hard cap: 2,000,000 TFUEL
 *   Min commit: 10,000 TFUEL
 *   Price: 8 XF per 1 TFUEL
 *   Phase: 1 (metadata only)
 *
 * Usage:
 *   npx hardhat run believer/launch-angel-round.cjs --network theta-testnet
 *
 * Env (.env.local):
 *   ADMIN_ADDRESS
 *   ANGEL_PHASE
 *   ANGEL_HARD_CAP
 *   ANGEL_MIN_COMMITMENT
 *   ANGEL_MAX_PER_WALLET   (0 = no cap)
 *   ANGEL_PRICE_NUM / ANGEL_PRICE_DEN
 *   ANGEL_XF_ALLOCATION_CAP (default 100000000 = 10% of 1B XF)
 *   EXISTING_ANGEL_MANIFEST — JSON with contracts.AngelRound to skip deploy
 *   ANGEL_SMOKE_COMMIT — set 0 to skip test commit (needs min TFUEL + gas)
 *   ANGEL_MIN_COMMITMENT — human TFUEL string (default 10000); use e.g. 0.01 for testnet
 *   ANGEL_MIN_COMMITMENT_WEI — optional raw wei min (e.g. 1 for 1-wei floor); overrides ANGEL_MIN_COMMITMENT when set
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║  XFuel Protocol — Angel Round Launch                    ║');
  console.log('  ╠══════════════════════════════════════════════════════════╣');
  console.log(`  ║  Network:   ${network.name.padEnd(44)}║`);
  console.log(`  ║  Deployer:  ${deployer.address.padEnd(44)}║`);
  console.log(`  ║  Balance:   ${ethers.formatEther(balance).slice(0, 18).padEnd(44)}║`);
  console.log('  ╚══════════════════════════════════════════════════════════╝');

  function resolveAddr(key, fb) {
    const v = process.env[key];
    if (!v) return fb;
    try {
      return ethers.getAddress(v);
    } catch {
      return fb;
    }
  }

  const MULTISIG = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';
  const ADMIN = resolveAddr('ADMIN_ADDRESS', MULTISIG);
  const PHASE = process.env.ANGEL_PHASE ? parseInt(process.env.ANGEL_PHASE, 10) : 1;

  const HARD_CAP = process.env.ANGEL_HARD_CAP
    ? ethers.parseEther(process.env.ANGEL_HARD_CAP)
    : ethers.parseEther('2000000');
  let MIN_COMMIT;
  if (process.env.ANGEL_MIN_COMMITMENT_WEI) {
    MIN_COMMIT = BigInt(process.env.ANGEL_MIN_COMMITMENT_WEI);
  } else if (process.env.ANGEL_MIN_COMMITMENT) {
    MIN_COMMIT = ethers.parseEther(process.env.ANGEL_MIN_COMMITMENT);
  } else {
    MIN_COMMIT = ethers.parseEther('10000');
  }
  const MAX_PW_STR = process.env.ANGEL_MAX_PER_WALLET ?? '0';
  const MAX_PW = MAX_PW_STR === '0' ? 0n : ethers.parseEther(MAX_PW_STR);
  const P_NUM = process.env.ANGEL_PRICE_NUM ? BigInt(process.env.ANGEL_PRICE_NUM) : 8n;
  const P_DEN = process.env.ANGEL_PRICE_DEN ? BigInt(process.env.ANGEL_PRICE_DEN) : 1n;
  const XF_CAP = process.env.ANGEL_XF_ALLOCATION_CAP
    ? ethers.parseEther(process.env.ANGEL_XF_ALLOCATION_CAP)
    : ethers.parseEther('100000000');

  console.log('\n  ═ Phase 1: Deployment ═════════════════════════════');

  let roundAddr = null;
  let round = null;
  let deployGas = 0;

  const manifestPath = process.env.EXISTING_ANGEL_MANIFEST;
  if (manifestPath && fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (m.contracts && m.contracts.AngelRound) {
      roundAddr = m.contracts.AngelRound;
      round = await ethers.getContractAt('AngelRound', roundAddr);
      console.log(`    ✓ Existing AngelRound: ${roundAddr}`);
      deployGas = m.gasUsed?.AngelRound || 0;
    }
  }

  if (!round) {
    console.log('    Deploying AngelRound...');
    const F = await ethers.getContractFactory('AngelRound');
    round = await F.deploy(ADMIN, HARD_CAP, MAX_PW, MIN_COMMIT, P_NUM, P_DEN, PHASE, XF_CAP);
    await round.waitForDeployment();
    roundAddr = await round.getAddress();
    const receipt = await round.deploymentTransaction().wait();
    deployGas = Number(receipt.gasUsed);
    console.log(`    ✓ Deployed: ${roundAddr} (${deployGas} gas)`);
  }

  console.log('\n  ═ Phase 2: Configuration ═════════════════════════');
  console.log(`    Admin:       ${ADMIN}`);
  console.log(`    Phase:       ${PHASE}`);
  console.log(`    Hard cap:    ${ethers.formatEther(HARD_CAP)} TFUEL`);
  console.log(`    Min commit:  ${ethers.formatEther(MIN_COMMIT)} TFUEL`);
  console.log(`    Max/wallet:  ${MAX_PW === 0n ? 'none' : ethers.formatEther(MAX_PW) + ' TFUEL'}`);
  console.log(`    Price:       ${P_NUM}/${P_DEN} XF per TFUEL`);
  console.log(`    XF cap:      ${ethers.formatEther(XF_CAP)} XF reserved (on-chain ceiling)`);

  console.log('\n  ═ Phase 3: Smoke ════════════════════════════════');
  let pass = 0;
  const smokeOn =
    process.env.ANGEL_SMOKE_COMMIT !== '0' &&
    String(process.env.ANGEL_SMOKE_COMMIT || '').toLowerCase() !== 'false';
  let smokeTotal = 4;
  let smokeNote = '';

  try {
    const s = await round.status();
    console.log(`    ✓ Status: ${['Open', 'Closed', 'TGE'][Number(s)]}`);
    pass++;
  } catch (e) {
    console.log(`    ✗ Status: ${e.message.slice(0, 50)}`);
  }

  try {
    const mc = await round.minCommitment();
    console.log(`    ✓ Min commitment: ${ethers.formatEther(mc)} TFUEL`);
    pass++;
  } catch (e) {
    console.log(`    ✗ minCommitment: ${e.message.slice(0, 50)}`);
  }

  try {
    const cliff = await round.CLIFF_DURATION();
    const vest = await round.VESTING_DURATION();
    console.log(`    ✓ Cliff: ${Number(cliff) / 86400}d, Vesting: ${Number(vest) / 86400}d`);
    pass++;
  } catch (e) {
    console.log(`    ✗ Durations: ${e.message.slice(0, 50)}`);
  }

  if (!smokeOn) {
    console.log('    ⊘ Smoke commit disabled (ANGEL_SMOKE_COMMIT=0)');
    smokeNote = 'disabled_by_env';
  } else {
    const minC = await round.minCommitment();
    let gasReserve = ethers.parseEther('0.2');
    try {
      const est = await round.connect(deployer).commit.estimateGas({ value: minC });
      const fee = await ethers.provider.getFeeData();
      const gp = fee.gasPrice ?? fee.maxFeePerGas ?? 500000000000n;
      gasReserve = (est * gp * 130n) / 100n;
    } catch {
      /* fixed reserve */
    }
    const required = minC + gasReserve;
    if (balance < required) {
      console.log(
        `    ⊘ Smoke commit skipped: need ≥ ${ethers.formatEther(required)} TFUEL (min + gas). Set ANGEL_SMOKE_COMMIT=0 to skip.`
      );
      smokeNote = 'skipped_insufficient_balance';
    } else {
      smokeTotal = 5;
      try {
        const tx = await round.connect(deployer).commit({ value: minC });
        const r = await tx.wait();
        console.log(`    ✓ Test commit: ${r.gasUsed} gas`);
        pass++;
        smokeNote = 'ran';
      } catch (e) {
        console.log(`    ✗ Commit: ${e.message.slice(0, 120)}`);
        smokeNote = 'commit_failed';
      }
    }
  }

  try {
    const st = await round.getStats();
    console.log(`    ✓ getStats: ${ethers.formatEther(st[0])} TFUEL, ${st[1]} angels, treasuryWithdrawn=${ethers.formatEther(st[7])}`);
    pass++;
  } catch (e) {
    console.log(`    ✗ getStats: ${e.message.slice(0, 50)}`);
  }

  console.log(`\n    Smoke: ${pass}/${smokeTotal} passed`);

  const explorer =
    network.name === 'theta-testnet'
      ? 'https://testnet-explorer.thetatoken.org'
      : network.name === 'theta-mainnet'
        ? 'https://explorer.thetatoken.org'
        : null;

  const cliffSec = await round.CLIFF_DURATION();
  const vestSec = await round.VESTING_DURATION();

  const report = {
    protocol: 'XFuel Protocol',
    event: 'Angel Round Launch',
    network: network.name,
    timestamp: new Date().toISOString(),
    contract: roundAddr,
    explorerUrl: explorer ? `${explorer}/account/${roundAddr}` : null,
    parameters: {
      phase: PHASE,
      admin: ADMIN,
      hardCapTFUEL: ethers.formatEther(HARD_CAP),
      minCommitmentTFUEL: ethers.formatEther(MIN_COMMIT),
      maxPerWallet: MAX_PW === 0n ? 'none' : ethers.formatEther(MAX_PW),
      priceXFPerTFUEL: `${P_NUM}/${P_DEN}`,
      cliffDays: Math.round(Number(cliffSec) / 86400),
      linearVestingDays: Math.round(Number(vestSec) / 86400),
      refunds: 'none — separate from BelieverRound',
      preTGETreasury: 'withdrawToTreasury(to, amount, memo) — admin only, before TGE',
      tgeNote: 'triggerTGE is per-contract; call separately from BelieverRound.triggerTGE',
      xfAllocationCapXF: ethers.formatEther(XF_CAP),
    },
    smokeTests: { passed: pass, total: smokeTotal, commitSmoke: smokeNote || 'not_run' },
    deploymentGas: deployGas,
    frontendEnv: {
      VITE_ANGEL_ROUND_ADDRESS: roundAddr,
    },
  };

  const rFile = path.join(__dirname, `launch-angel-round-${Date.now()}.json`);
  fs.writeFileSync(rFile, JSON.stringify(report, null, 2));
  console.log(`\n  Report: ${rFile}`);
  console.log('\n  Set in xfuel-app .env:\n    VITE_ANGEL_ROUND_ADDRESS=' + roundAddr);

  return report;
}

main()
  .then(() => {
    setTimeout(() => process.exit(0), 150);
  })
  .catch((e) => {
    console.error('LAUNCH FAILED:', e);
    process.exit(1);
  });
