/**
 * Deploy ProviderStaking to Base (Verified Inference Phase 4 — T3b economics, moat #3).
 *
 * Providers stake USDC; the spot-check orchestrator (SLASHER_ROLE) slashes on a failed check.
 * Backs the `zk-spotcheck` tier's economic deterrence. See docs/VERIFIED_INFERENCE_TIERS.md.
 *
 * Usage:
 *   STAKE_TOKEN_ADDRESS=0xUSDC npx hardhat run deploy/provider-staking.cjs --network base-sepolia
 *
 * Env (.env.local):
 *   DEPLOYER_PRIVATE_KEY or PRIVATE_KEY
 *   ADMIN_ADDRESS            (defaults to deployer; should be the protocol Safe on mainnet)
 *   STAKE_TOKEN_ADDRESS      (required — the ERC-20 staked, e.g. USDC on Base)
 *   STAKING_TREASURY         (defaults to admin — where slashed funds go)
 *   STAKING_MIN_STAKE        (raw token units; default 0 → set later via setParams)
 *   STAKING_UNBONDING_SECS   (default 604800 = 7 days)
 *   STAKING_SLASHER_ADDRESS  (optional; granted SLASHER_ROLE for the spot-check orchestrator)
 *
 * After deploy, mirror into services/gateway .env:
 *   PROVIDER_STAKING_ADDRESS=<addr>
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = isAddr(process.env.ADMIN_ADDRESS) ? process.env.ADMIN_ADDRESS : deployer.address;
  const stakeToken = process.env.STAKE_TOKEN_ADDRESS;
  if (!isAddr(stakeToken)) throw new Error('STAKE_TOKEN_ADDRESS is required (ERC-20, e.g. USDC on Base)');
  const treasury = isAddr(process.env.STAKING_TREASURY) ? process.env.STAKING_TREASURY : admin;
  const minStake = BigInt(process.env.STAKING_MIN_STAKE || '0');
  const unbonding = Number(process.env.STAKING_UNBONDING_SECS || 604800);
  const chainId = Number(network.config.chainId || 0);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel — ProviderStaking (Verified Inference Phase 4)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:    ${network.name} (chainId: ${chainId || 'auto'})`);
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Admin:      ${admin}`);
  console.log(`  StakeToken: ${stakeToken}`);
  console.log(`  Treasury:   ${treasury}`);
  console.log(`  MinStake:   ${minStake.toString()}`);
  console.log(`  Unbonding:  ${unbonding}s`);
  console.log('───────────────────────────────────────────────────────────');

  const Factory = await ethers.getContractFactory('ProviderStaking');
  const staking = await Factory.deploy(admin, stakeToken, treasury, minStake, unbonding);
  await staking.waitForDeployment();
  const addr = await staking.getAddress();
  console.log(`  ✓ ProviderStaking: ${addr}`);

  const slasher = process.env.STAKING_SLASHER_ADDRESS;
  if (isAddr(slasher)) {
    const role = await staking.SLASHER_ROLE();
    const tx = await staking.grantRole(role, slasher);
    await tx.wait();
    console.log(`  ✓ granted SLASHER_ROLE → ${slasher}`);
  }

  const manifest = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    contracts: { ProviderStaking: addr },
    stakeToken,
    treasury,
    minStake: minStake.toString(),
    unbondingPeriod: unbonding,
    note: 'Verified Inference Phase 4 (T3b) staking/slashing. Proof/money home = Base (ADR 0002).',
  };
  const outDir = path.join(__dirname, 'manifests');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `provider-staking-${network.name}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest: ${outFile}`);
  console.log('\nNext:');
  console.log(`  PROVIDER_STAKING_ADDRESS=${addr}`);
  console.log('  See docs/VERIFIED_INFERENCE_TIERS.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
