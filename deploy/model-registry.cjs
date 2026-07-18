/**
 * Deploy ModelRegistry to Base (Verified Inference Phase 1 — PoMA; ADR 0002 proof/money home).
 *
 * The on-chain registry of model-authenticity commitments. Providers register a commitment
 * to the exact weights they serve (see docs/POMA_SPEC.md); receipts cite (modelId, version,
 * commitment) so downgrade attacks become detectable.
 *
 * Usage:
 *   npx hardhat run deploy/model-registry.cjs --network base-sepolia
 *   npx hardhat run deploy/model-registry.cjs --network base
 *
 * Env (.env.local):
 *   DEPLOYER_PRIVATE_KEY or PRIVATE_KEY
 *   ADMIN_ADDRESS  (defaults to deployer; should be the protocol Safe on mainnet)
 *
 * After deploy, mirror into services/gateway .env:
 *   MODEL_REGISTRY_ADDRESS=<addr>
 *   MODEL_REGISTRY_CHAIN_ID=84532   # or 8453
 * Register models with deploy/register-model.cjs (or the SDK/MCP helper).
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const rawAdmin = process.env.ADMIN_ADDRESS || deployer.address;
  const admin = /^0x[0-9a-fA-F]{40}$/.test(rawAdmin) ? rawAdmin : deployer.address;
  const chainId = Number(network.config.chainId || 0);

  if (chainId !== 8453 && chainId !== 84532 && network.name !== 'hardhat') {
    console.warn(`⚠ Expected Base (8453) or Base Sepolia (84532); got chainId=${chainId} (${network.name})`);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel — ModelRegistry on Base (PoMA, Phase 1)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:   ${network.name} (chainId: ${chainId || 'auto'})`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Admin:     ${admin}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('───────────────────────────────────────────────────────────');

  console.log('\n[1/1] Deploying ModelRegistry...');
  const Factory = await ethers.getContractFactory('ModelRegistry');
  const registry = await Factory.deploy(admin);
  await registry.waitForDeployment();
  const addr = await registry.getAddress();
  const receipt = await registry.deploymentTransaction()?.wait();
  console.log(`  ✓ ModelRegistry: ${addr}`);
  if (receipt) console.log(`  gas used: ${receipt.gasUsed.toString()}`);

  const manifest = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    contracts: { ModelRegistry: addr },
    note: 'PoMA model-authenticity registry (Verified Inference Phase 1). Proof/money home = Base (ADR 0002).',
  };

  const outDir = path.join(__dirname, 'manifests');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `model-registry-${network.name}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest: ${outFile}`);
  console.log('\nNext:');
  console.log(`  MODEL_REGISTRY_ADDRESS=${addr}`);
  console.log(`  MODEL_REGISTRY_CHAIN_ID=${chainId || '(set manually)'}`);
  console.log('  Compute commitments: services/gateway → node src/model-commitment.js --slug "<slug>" <shards...>');
  console.log('  See docs/POMA_SPEC.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
