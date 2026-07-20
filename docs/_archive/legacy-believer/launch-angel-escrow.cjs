/**
 * XFuel Protocol — Angel Escrow launch script.
 *
 * Immutable native-TFUEL escrow for the Angel round with 3 ring-fenced buckets:
 *   0 = AUDIT
 *   1 = SUBCHAIN
 *   2 = DEVOPS
 *
 * Usage:
 *   npx hardhat run believer/launch-angel-escrow.cjs --network theta-mainnet
 *
 * Env (.env.local):
 *   MULTISIG_ADDRESS              Safe treasury destination for excess refunds / releases
 *   MM_ADDRESS                    First signer EOA (fallback if ANGELESCROW_SIGNERS unset)
 *   RABBY_ADDRESS                 Second signer EOA (fallback if ANGELESCROW_SIGNERS unset)
 *   ANGELESCROW_SIGNERS           Comma-separated signer EOAs
 *   ANGELESCROW_THRESHOLD         Approval threshold (default 2)
 *   ANGELESCROW_TREASURY          Treasury address (defaults to MULTISIG_ADDRESS)
 *   ANGELESCROW_AUDIT_CAP         Human TFUEL string (default 98000)
 *   ANGELESCROW_SUBCHAIN_CAP      Human TFUEL string (default 30000)
 *   ANGELESCROW_DEVOPS_CAP        Human TFUEL string (default 12000)
 *   EXISTING_ANGELESCROW_MANIFEST JSON file with contracts.AngelEscrow to skip deploy
 *   ANGELESCROW_SMOKE_DEPOSIT     Human TFUEL string deposit smoke amount (default 0.01, set 0 to skip)
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

const AUDIT_BUCKET = 0;
const SUBCHAIN_BUCKET = 1;
const DEVOPS_BUCKET = 2;

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║  XFuel Protocol — Angel Escrow Launch                   ║');
  console.log('  ╠══════════════════════════════════════════════════════════╣');
  console.log(`  ║  Network:   ${network.name.padEnd(44)}║`);
  console.log(`  ║  Deployer:  ${deployer.address.padEnd(44)}║`);
  console.log(`  ║  Balance:   ${ethers.formatEther(balance).slice(0, 18).padEnd(44)}║`);
  console.log('  ╚══════════════════════════════════════════════════════════╝');

  function resolveAddr(key, fallback = null) {
    const value = process.env[key];
    if (!value) return fallback;
    try {
      return ethers.getAddress(value);
    } catch {
      return fallback;
    }
  }

  function parseHumanTFUEL(key, fallback) {
    const value = process.env[key];
    return ethers.parseEther(value && value.trim() ? value.trim() : fallback);
  }

  function parseSmokeDeposit() {
    const raw = process.env.ANGELESCROW_SMOKE_DEPOSIT;
    if (raw === undefined) return ethers.parseEther('0.01');
    const trimmed = String(raw).trim();
    if (trimmed === '' || trimmed === '0') return 0n;
    return ethers.parseEther(trimmed);
  }

  function resolveSigners() {
    const explicit = process.env.ANGELESCROW_SIGNERS;
    const fallback = [process.env.MM_ADDRESS, process.env.RABBY_ADDRESS].filter(Boolean);
    const values = explicit ? explicit.split(',') : fallback;
    const normalized = [];
    const seen = new Set();

    for (const value of values) {
      const trimmed = String(value || '').trim();
      if (!trimmed) continue;
      const addr = ethers.getAddress(trimmed);
      const lower = addr.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        normalized.push(addr);
      }
    }

    if (normalized.length === 0) {
      throw new Error('No AngelEscrow signers configured. Set ANGELESCROW_SIGNERS or MM_ADDRESS/RABBY_ADDRESS.');
    }

    return normalized;
  }

  const MULTISIG = resolveAddr('MULTISIG_ADDRESS');
  if (!MULTISIG) {
    throw new Error('MULTISIG_ADDRESS must be set in .env.local for AngelEscrow treasury routing.');
  }

  const SIGNERS = resolveSigners();
  const THRESHOLD = process.env.ANGELESCROW_THRESHOLD ? BigInt(process.env.ANGELESCROW_THRESHOLD) : 2n;
  const TREASURY = resolveAddr('ANGELESCROW_TREASURY', MULTISIG);
  const BUCKET_CAPS = [
    parseHumanTFUEL('ANGELESCROW_AUDIT_CAP', '98000'),
    parseHumanTFUEL('ANGELESCROW_SUBCHAIN_CAP', '30000'),
    parseHumanTFUEL('ANGELESCROW_DEVOPS_CAP', '12000'),
  ];
  const SMOKE_DEPOSIT = parseSmokeDeposit();

  if (THRESHOLD === 0n || THRESHOLD > BigInt(SIGNERS.length)) {
    throw new Error(`ANGELESCROW_THRESHOLD must be between 1 and signer count (${SIGNERS.length}); got ${THRESHOLD}`);
  }

  console.log('\n  ═ Phase 1: Deployment ═════════════════════════════');

  let escrow = null;
  let escrowAddr = null;
  let deployGas = 0;

  const manifestPath = process.env.EXISTING_ANGELESCROW_MANIFEST;
  if (manifestPath && fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (manifest.contracts && manifest.contracts.AngelEscrow) {
      escrowAddr = manifest.contracts.AngelEscrow;
      escrow = await ethers.getContractAt('AngelEscrow', escrowAddr);
      deployGas = manifest.gasUsed?.AngelEscrow || 0;
      console.log(`    ✓ Existing AngelEscrow: ${escrowAddr}`);
    }
  }

  if (!escrow) {
    console.log('    Deploying AngelEscrow...');
    const F = await ethers.getContractFactory('AngelEscrow');
    escrow = await F.deploy(SIGNERS, THRESHOLD, TREASURY, BUCKET_CAPS);
    await escrow.waitForDeployment();
    escrowAddr = await escrow.getAddress();
    const receipt = await escrow.deploymentTransaction().wait();
    deployGas = Number(receipt.gasUsed);
    console.log(`    ✓ Deployed: ${escrowAddr} (${deployGas} gas)`);
  }

  console.log('\n  ═ Phase 2: Configuration ═════════════════════════');
  console.log(`    Treasury:    ${TREASURY}`);
  console.log(`    Threshold:   ${THRESHOLD}-of-${SIGNERS.length}`);
  console.log(`    Signers:     ${SIGNERS.join(', ')}`);
  console.log(`    Audit cap:   ${ethers.formatEther(BUCKET_CAPS[AUDIT_BUCKET])} TFUEL`);
  console.log(`    Subchain:    ${ethers.formatEther(BUCKET_CAPS[SUBCHAIN_BUCKET])} TFUEL`);
  console.log(`    DevOps cap:  ${ethers.formatEther(BUCKET_CAPS[DEVOPS_BUCKET])} TFUEL`);

  console.log('\n  ═ Phase 3: Smoke ════════════════════════════════');
  let pass = 0;
  let smokeTotal = 7;
  let smokeDepositNote = 'not_run';

  try {
    const version = await escrow.VERSION();
    console.log(`    ✓ Version: ${version}`);
    pass++;
  } catch (e) {
    console.log(`    ✗ VERSION: ${e.message.slice(0, 60)}`);
  }

  try {
    const thresholdOnChain = await escrow.threshold();
    console.log(`    ✓ Threshold: ${thresholdOnChain}`);
    pass++;
  } catch (e) {
    console.log(`    ✗ threshold: ${e.message.slice(0, 60)}`);
  }

  try {
    const treasuryOnChain = await escrow.treasury();
    console.log(`    ✓ Treasury: ${treasuryOnChain}`);
    pass++;
  } catch (e) {
    console.log(`    ✗ treasury: ${e.message.slice(0, 60)}`);
  }

  try {
    const signerCount = await escrow.signerCount();
    console.log(`    ✓ Signer count: ${signerCount}`);
    pass++;
  } catch (e) {
    console.log(`    ✗ signerCount: ${e.message.slice(0, 60)}`);
  }

  try {
    const outstanding = await escrow.outstandingObligations();
    console.log(`    ✓ Outstanding obligations: ${ethers.formatEther(outstanding)} TFUEL`);
    pass++;
  } catch (e) {
    console.log(`    ✗ outstandingObligations: ${e.message.slice(0, 60)}`);
  }

  try {
    const auditCap = await escrow.bucketCaps(AUDIT_BUCKET);
    const subchainCap = await escrow.bucketCaps(SUBCHAIN_BUCKET);
    const devopsCap = await escrow.bucketCaps(DEVOPS_BUCKET);
    console.log(
      `    ✓ Bucket caps: [${ethers.formatEther(auditCap)}, ${ethers.formatEther(subchainCap)}, ${ethers.formatEther(devopsCap)}] TFUEL`
    );
    pass++;
  } catch (e) {
    console.log(`    ✗ bucketCaps: ${e.message.slice(0, 60)}`);
  }

  if (SMOKE_DEPOSIT === 0n) {
    smokeTotal = 6;
    smokeDepositNote = 'disabled_by_env';
    console.log('    ⊘ Smoke deposit disabled (ANGELESCROW_SMOKE_DEPOSIT=0)');
  } else {
    const deployerBal = await ethers.provider.getBalance(deployer.address);
    const required = SMOKE_DEPOSIT + ethers.parseEther('0.02');
    if (deployerBal < required) {
      smokeDepositNote = 'skipped_insufficient_balance';
      console.log(
        `    ⊘ Smoke deposit skipped: need ≥ ${ethers.formatEther(required)} TFUEL (deposit + gas buffer).`
      );
    } else {
      try {
        const tx = await deployer.sendTransaction({ to: escrowAddr, value: SMOKE_DEPOSIT });
        const receipt = await tx.wait();
        const totalRaised = await escrow.totalRaised();
        console.log(`    ✓ Deposit smoke: ${ethers.formatEther(SMOKE_DEPOSIT)} TFUEL (${receipt.gasUsed} gas)`);
        console.log(`    ✓ totalRaised: ${ethers.formatEther(totalRaised)} TFUEL`);
        pass++;
        smokeDepositNote = 'ran';
      } catch (e) {
        smokeDepositNote = 'deposit_failed';
        console.log(`    ✗ Deposit smoke: ${e.message.slice(0, 100)}`);
      }
    }
  }

  console.log(`\n    Smoke: ${pass}/${smokeTotal} passed`);

  console.log('\n  ═ Phase 4: Launch Report ═════════════════════════');

  const explorer =
    network.name === 'theta-testnet'
      ? 'https://testnet-explorer.thetatoken.org'
      : network.name === 'theta-mainnet'
        ? 'https://explorer.thetatoken.org'
        : null;

  const report = {
    protocol: 'XFuel Protocol',
    event: 'Angel Escrow Launch',
    network: network.name,
    timestamp: new Date().toISOString(),
    contract: escrowAddr,
    explorerUrl: explorer ? `${explorer}/account/${escrowAddr}` : null,
    parameters: {
      version: '1.0.0',
      treasury: TREASURY,
      threshold: THRESHOLD.toString(),
      signerCount: SIGNERS.length,
      signers: SIGNERS,
      bucketCapsTFUEL: {
        audit: ethers.formatEther(BUCKET_CAPS[AUDIT_BUCKET]),
        subchain: ethers.formatEther(BUCKET_CAPS[SUBCHAIN_BUCKET]),
        devops: ethers.formatEther(BUCKET_CAPS[DEVOPS_BUCKET]),
      },
      totalCapTFUEL: ethers.formatEther(BUCKET_CAPS[AUDIT_BUCKET] + BUCKET_CAPS[SUBCHAIN_BUCKET] + BUCKET_CAPS[DEVOPS_BUCKET]),
      notes: 'Native TFUEL only. Bucket releases may be sent to treasury via releaseFromBucket(bucket, treasury, amount).',
    },
    smokeTests: {
      passed: pass,
      total: smokeTotal,
      depositSmoke: smokeDepositNote,
    },
    deploymentGas: deployGas,
  };

  const reportFile = path.join(__dirname, `launch-angel-escrow-${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`    Report: ${reportFile}`);
  console.log(JSON.stringify(report, null, 2));

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
