/**
 * Deploy ZKVerifierSP1 to Base (money + proof home — ADR 0002).
 *
 * Does NOT deploy CoreRevenueSplitter (deprecated fee path). Fees land at
 * X402_PAY_TO / Splits on Base separately.
 *
 * Usage:
 *   npx hardhat run deploy/base-verifier.cjs --network base-sepolia
 *   npx hardhat run deploy/base-verifier.cjs --network base
 *
 * Env (.env.local):
 *   DEPLOYER_PRIVATE_KEY or PRIVATE_KEY
 *   ADMIN_ADDRESS          (defaults to deployer)
 *   SP1_GATEWAY_ADDRESS    (optional Succinct gateway; default address(0))
 *
 * After deploy, set gateway:
 *   ZK_VERIFIER_ADDRESS=<addr>
 *   VERIFIER_CHAIN_ID=84532   # or 8453
 * and record under deploy/manifests/
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const rawAdmin = process.env.ADMIN_ADDRESS || deployer.address;
  // Ignore non-EVM ADMIN_ADDRESS leftovers (e.g. Cosmos bech32 in .env.local).
  const admin = /^0x[0-9a-fA-F]{40}$/.test(rawAdmin) ? rawAdmin : deployer.address;
  const rawGw = process.env.SP1_GATEWAY_ADDRESS || ethers.ZeroAddress;
  const sp1Gateway = /^0x[0-9a-fA-F]{40}$/.test(rawGw) ? rawGw : ethers.ZeroAddress;
  const chainId = Number(network.config.chainId || 0);

  if (chainId !== 8453 && chainId !== 84532 && network.name !== 'hardhat') {
    console.warn(`⚠ Expected Base (8453) or Base Sepolia (84532); got chainId=${chainId} (${network.name})`);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel — ZKVerifierSP1 on Base (ADR 0002)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:   ${network.name} (chainId: ${chainId || 'auto'})`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Admin:     ${admin}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('───────────────────────────────────────────────────────────');

  console.log('\n[1/1] Deploying ZKVerifierSP1...');
  const VerifierF = await ethers.getContractFactory('ZKVerifierSP1');
  const verifier = await VerifierF.deploy(admin, sp1Gateway);
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  const receipt = await verifier.deploymentTransaction()?.wait();
  console.log(`  ✓ ZKVerifierSP1: ${verifierAddr}`);
  if (receipt) console.log(`  gas used: ${receipt.gasUsed.toString()}`);

  const manifest = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    contracts: { ZKVerifierSP1: verifierAddr },
    note: 'Go-forward proof home on Base. Theta testnet verifier addresses are archive-only.',
  };

  const outDir = path.join(__dirname, 'manifests');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `base-verifier-${network.name}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest: ${outFile}`);
  console.log('\nNext:');
  console.log(`  ZK_VERIFIER_ADDRESS=${verifierAddr}`);
  console.log(`  VERIFIER_CHAIN_ID=${chainId || '(set manually)'}`);
  console.log('  Mirror into services/gateway .env — see docs/BASE_CUTOVER.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
