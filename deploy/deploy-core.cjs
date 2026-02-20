/**
 * XFuel Protocol — Core Layer Deployment Script
 *
 * Deploys CoreRevenueSplitter + ZKVerifierSP1 + SP1ProofHooks + veXFGovernance.
 *
 * Usage:
 *   npx hardhat run deploy/deploy-core.cjs --network theta-testnet
 *   npx hardhat run deploy/deploy-core.cjs --network theta-mainnet
 *   npx hardhat run deploy/deploy-core.cjs --network hardhat       # local test
 *
 * Required environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY  — Private key of the deployer account
 *   ADMIN_ADDRESS         — Admin address for role grants (defaults to deployer)
 *   BBB_ADDRESS           — Buyback-Burn recipient
 *   LP_ADDRESS            — Liquidity Provision recipient
 *   STAKER_ADDRESS        — Staker Rewards recipient
 *   TREASURY_ADDRESS      — Protocol Treasury recipient
 *   STAKE_POOL_ADDRESS    — Staking Pool address
 */
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const bbb = process.env.BBB_ADDRESS || deployer.address;
  const lp = process.env.LP_ADDRESS || deployer.address;
  const staker = process.env.STAKER_ADDRESS || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const stakePool = process.env.STAKE_POOL_ADDRESS || deployer.address;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel Protocol — Core Layer Deployment');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:   ${network.name} (chainId: ${network.config.chainId || 'auto'})`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Admin:     ${admin}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('───────────────────────────────────────────────────────────');

  // 1. CoreRevenueSplitter
  console.log('\n[1/4] Deploying CoreRevenueSplitter...');
  const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
  const splitter = await SplitterF.deploy(admin, bbb, lp, staker, treasury, stakePool);
  await splitter.waitForDeployment();
  const splitterAddr = await splitter.getAddress();
  console.log(`  ✓ CoreRevenueSplitter: ${splitterAddr}`);

  // 2. ZKVerifierSP1
  const sp1Gateway = process.env.SP1_GATEWAY_ADDRESS || ethers.ZeroAddress;
  console.log('\n[2/3] Deploying ZKVerifierSP1...');
  const VerifierF = await ethers.getContractFactory('ZKVerifierSP1');
  const verifier = await VerifierF.deploy(admin, sp1Gateway);
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log(`  ✓ ZKVerifierSP1: ${verifierAddr}`);

  // Note: SP1ProofHooks is a library — it is linked at compile time, not deployed separately.

  // 3. veXFGovernance
  const xfToken = process.env.XF_TOKEN_ADDRESS || ethers.ZeroAddress;
  console.log('\n[3/3] Deploying veXFGovernance...');
  if (xfToken === ethers.ZeroAddress) {
    console.log('  ⚠ XF_TOKEN_ADDRESS not set — skipping veXFGovernance (requires token)');
  }
  let govAddr = ethers.ZeroAddress;
  if (xfToken !== ethers.ZeroAddress) {
    const GovF = await ethers.getContractFactory('veXFGovernance');
    const gov = await GovF.deploy(admin, xfToken);
    await gov.waitForDeployment();
    govAddr = await gov.getAddress();
    console.log(`  ✓ veXFGovernance: ${govAddr}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Core Layer Deployment Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  CoreRevenueSplitter: ${splitterAddr}`);
  console.log(`  ZKVerifierSP1:       ${verifierAddr}`);
  console.log(`  veXFGovernance:      ${govAddr}`);
  console.log('═══════════════════════════════════════════════════════════');

  return { splitterAddr, verifierAddr, govAddr };
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
