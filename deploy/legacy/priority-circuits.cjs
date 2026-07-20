/**
 * XFuel Protocol — Priority Circuits Deployment Script
 *
 * Deploys all three priority circuits to their respective testnets:
 *   1. ComputeMarketplace → Osmosis testnet (CosmWasm prover)
 *   2. InferenceRouter    → Bittensor EVM 964 (EVM prover)
 *   3. BridgeCircuit      → Theta Testnet 365 (Multi-prover)
 *
 * Usage:
 *   npx hardhat run deploy/legacy/priority-circuits.cjs --network theta-testnet
 *   npx hardhat run deploy/legacy/priority-circuits.cjs --network bittensor-evm
 *   npx hardhat run deploy/legacy/priority-circuits.cjs --network hardhat
 */

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel Protocol — Priority Circuits Deployment');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:  ${network} (Chain ID: ${chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance:  ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const manifest = {
    network,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {},
    gasUsed: {},
    circuits: [],
  };

  const sp1Gateway = hre.ethers.ZeroAddress; // Mock mode
  const revenueSplitter = process.env.REVENUE_SPLITTER || deployer.address;
  const zkVerifier = process.env.ZK_VERIFIER || deployer.address;

  // ─── 1. Compute Marketplace ───────────────────────────────────────────────
  console.log('\n[1/3] Deploying ComputeMarketplace...');
  try {
    const CMFactory = await hre.ethers.getContractFactory('ComputeMarketplace');
    const cm = await CMFactory.deploy(deployer.address, revenueSplitter, zkVerifier, sp1Gateway);
    await cm.waitForDeployment();
    const cmAddr = await cm.getAddress();
    const cmReceipt = await cm.deploymentTransaction().wait();

    console.log(`  ✓ ComputeMarketplace: ${cmAddr}`);
    console.log(`    Gas used: ${cmReceipt.gasUsed.toString()}`);

    // Register GPU specs
    const gpuSpecs = [
      { vendor: 'nvidia', model: 'h100', vram: 81920, cuda: 16896, price: hre.ethers.parseEther('0.1') },
      { vendor: 'nvidia', model: 'a100', vram: 81920, cuda: 6912, price: hre.ethers.parseEther('0.05') },
      { vendor: 'nvidia', model: 'rtx-4090', vram: 24576, cuda: 16384, price: hre.ethers.parseEther('0.02') },
      { vendor: 'amd', model: 'mi300x', vram: 192000, cuda: 0, price: hre.ethers.parseEther('0.08') },
    ];

    for (const spec of gpuSpecs) {
      const tx = await cm.registerGPUSpec(spec.vendor, spec.model, spec.vram, spec.cuda, spec.price);
      await tx.wait();
      console.log(`    ✓ GPU Spec: ${spec.vendor} ${spec.model} (${spec.vram}MB VRAM)`);
    }

    manifest.contracts.ComputeMarketplace = cmAddr;
    manifest.gasUsed.ComputeMarketplace = cmReceipt.gasUsed.toString();
    manifest.circuits.push({
      name: 'ComputeMarketplace',
      id: 'COMPUTE_MARKETPLACE_CIRCUIT',
      prover: 'COSMWASM_ARK_BN254',
      address: cmAddr,
      gpuSpecs: gpuSpecs.length,
    });
  } catch (err) {
    console.error(`  ✗ ComputeMarketplace deployment failed: ${err.message}`);
  }

  // ─── 2. Inference Router ──────────────────────────────────────────────────
  console.log('\n[2/3] Deploying InferenceRouter...');
  try {
    const IRFactory = await hre.ethers.getContractFactory('InferenceRouter');
    const ir = await IRFactory.deploy(deployer.address, revenueSplitter, zkVerifier, sp1Gateway);
    await ir.waitForDeployment();
    const irAddr = await ir.getAddress();
    const irReceipt = await ir.deploymentTransaction().wait();

    console.log(`  ✓ InferenceRouter: ${irAddr}`);
    console.log(`    Gas used: ${irReceipt.gasUsed.toString()}`);

    // Register subnets
    const subnets = [
      { netuid: 1, name: 'Text Generation', type: 'text', minStake: hre.ethers.parseEther('1') },
      { netuid: 3, name: 'Image Generation', type: 'image', minStake: hre.ethers.parseEther('2') },
      { netuid: 8, name: 'Code Generation', type: 'code', minStake: hre.ethers.parseEther('1.5') },
    ];

    for (const sub of subnets) {
      const tx = await ir.registerSubnet(sub.netuid, sub.name, sub.type, sub.minStake);
      await tx.wait();
      console.log(`    ✓ Subnet ${sub.netuid}: ${sub.name} (${sub.type})`);
    }

    manifest.contracts.InferenceRouter = irAddr;
    manifest.gasUsed.InferenceRouter = irReceipt.gasUsed.toString();
    manifest.circuits.push({
      name: 'InferenceRouter',
      id: 'INFERENCE_ROUTER_CIRCUIT',
      prover: 'EVM_GROTH16',
      address: irAddr,
      subnets: subnets.length,
      stakingPrecompile: '0x0000000000000000000000000000000000000805',
    });
  } catch (err) {
    console.error(`  ✗ InferenceRouter deployment failed: ${err.message}`);
  }

  // ─── 3. Bridge Circuit ────────────────────────────────────────────────────
  console.log('\n[3/3] Deploying BridgeCircuit...');
  try {
    const BCFactory = await hre.ethers.getContractFactory('BridgeCircuit');
    const bc = await BCFactory.deploy(
      deployer.address, revenueSplitter, zkVerifier, sp1Gateway,
      hre.ethers.ZeroAddress // Mailbox (mock)
    );
    await bc.waitForDeployment();
    const bcAddr = await bc.getAddress();
    const bcReceipt = await bc.deploymentTransaction().wait();

    console.log(`  ✓ BridgeCircuit: ${bcAddr}`);
    console.log(`    Gas used: ${bcReceipt.gasUsed.toString()}`);

    // Configure IBC routes
    const routes = [
      { src: 'theta', dst: 'osmosis', channel: 'channel-42', port: 'transfer', timeout: 600 },
      { src: 'theta', dst: 'akash', channel: 'channel-0', port: 'transfer', timeout: 600 },
    ];

    for (const route of routes) {
      const tx = await bc.configureIBCRoute(route.src, route.dst, route.channel, route.port, route.timeout);
      await tx.wait();
      console.log(`    ✓ IBC Route: ${route.src} → ${route.dst} (${route.channel})`);
    }

    manifest.contracts.BridgeCircuit = bcAddr;
    manifest.gasUsed.BridgeCircuit = bcReceipt.gasUsed.toString();
    manifest.circuits.push({
      name: 'BridgeCircuit',
      id: 'BRIDGE_CIRCUIT',
      prover: 'MULTI',
      address: bcAddr,
      ibcRoutes: routes.length,
      protocols: ['Hyperlane', 'IBC'],
    });
  } catch (err) {
    console.error(`  ✗ BridgeCircuit deployment failed: ${err.message}`);
  }

  // ─── Save Manifest ────────────────────────────────────────────────────────
  const manifestDir = path.join(__dirname, 'manifests');
  if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `deploy-priority-${network}-${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✓ Manifest saved: ${manifestPath}`);

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Deployment Summary');
  console.log('═══════════════════════════════════════════════════════════');
  for (const c of manifest.circuits) {
    console.log(`  ${c.name}: ${c.address}`);
    console.log(`    Prover: ${c.prover} | Gas: ${manifest.gasUsed[c.name]}`);
  }
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
