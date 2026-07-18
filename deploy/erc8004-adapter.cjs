/**
 * Deploy XFuelValidationAdapter to Base (Verified Inference Phase 3 — ERC-8004, moat #2).
 *
 * XFuel's on-chain identity as an ERC-8004 validator. Agents name this adapter as the
 * `validatorAddress` in their validationRequest; XFuel (SUBMITTER_ROLE) posts verdicts derived
 * from PBR receipts. See docs/ERC8004_INTEGRATION.md.
 *
 * Usage:
 *   ERC8004_VALIDATION_REGISTRY=0x… npx hardhat run deploy/erc8004-adapter.cjs --network base-sepolia
 *
 * Env (.env.local):
 *   DEPLOYER_PRIVATE_KEY or PRIVATE_KEY
 *   ADMIN_ADDRESS                 (defaults to deployer; should be the protocol Safe on mainnet)
 *   ERC8004_VALIDATION_REGISTRY   (may be empty — set later via setRegistry)
 *   ERC8004_SUBMITTER_ADDRESS     (optional; granted SUBMITTER_ROLE for the gateway relayer)
 *
 * After deploy, mirror into services/gateway .env:
 *   XFUEL_VALIDATION_ADAPTER=<addr>
 *   ERC8004_VALIDATION_REGISTRY=<registry>
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const rawAdmin = process.env.ADMIN_ADDRESS || deployer.address;
  const admin = /^0x[0-9a-fA-F]{40}$/.test(rawAdmin) ? rawAdmin : deployer.address;
  const registry = process.env.ERC8004_VALIDATION_REGISTRY || ethers.ZeroAddress;
  const chainId = Number(network.config.chainId || 0);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel — XFuelValidationAdapter (ERC-8004, Phase 3)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:   ${network.name} (chainId: ${chainId || 'auto'})`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Admin:     ${admin}`);
  console.log(`  Registry:  ${registry === ethers.ZeroAddress ? '(unset — set later via setRegistry)' : registry}`);
  console.log('───────────────────────────────────────────────────────────');

  const Factory = await ethers.getContractFactory('XFuelValidationAdapter');
  const adapter = await Factory.deploy(admin, registry);
  await adapter.waitForDeployment();
  const addr = await adapter.getAddress();
  console.log(`  ✓ XFuelValidationAdapter: ${addr}`);

  const submitter = process.env.ERC8004_SUBMITTER_ADDRESS;
  if (submitter && /^0x[0-9a-fA-F]{40}$/.test(submitter)) {
    const role = await adapter.SUBMITTER_ROLE();
    const tx = await adapter.grantRole(role, submitter);
    await tx.wait();
    console.log(`  ✓ granted SUBMITTER_ROLE → ${submitter}`);
  }

  const manifest = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    contracts: { XFuelValidationAdapter: addr },
    erc8004Registry: registry,
    note: 'ERC-8004 validator adapter (Verified Inference Phase 3). Proof/money home = Base (ADR 0002).',
  };
  const outDir = path.join(__dirname, 'manifests');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `erc8004-adapter-${network.name}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest: ${outFile}`);
  console.log('\nNext:');
  console.log(`  XFUEL_VALIDATION_ADAPTER=${addr}`);
  console.log(`  ERC8004_VALIDATION_REGISTRY=${registry === ethers.ZeroAddress ? '(set + call setRegistry)' : registry}`);
  console.log('  See docs/ERC8004_INTEGRATION.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
