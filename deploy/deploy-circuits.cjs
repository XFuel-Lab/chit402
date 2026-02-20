/**
 * XFuel Protocol — Circuit Deployment Script
 *
 * Deploys all 10 circuits and grants CIRCUIT_ROLE on CoreRevenueSplitter.
 *
 * Usage:
 *   npx hardhat run deploy/deploy-circuits.cjs --network theta-testnet
 *   npx hardhat run deploy/deploy-circuits.cjs --network theta-mainnet
 *   npx hardhat run deploy/deploy-circuits.cjs --network hardhat
 *
 * Required environment variables (.env.local):
 *   DEPLOYER_PRIVATE_KEY       — Private key of the deployer account
 *   ADMIN_ADDRESS              — Admin address for role grants (defaults to deployer)
 *   REVENUE_SPLITTER_ADDRESS   — Address of deployed CoreRevenueSplitter
 *   ZK_VERIFIER_ADDRESS        — Address of deployed ZKVerifierSP1 (or 0x0 for mock)
 *
 * Optional (TAOCircuit-specific):
 *   HYPERLANE_MAILBOX_ADDRESS  — Hyperlane Mailbox contract
 *   CHAINLINK_ORACLE_ADDRESS   — Chainlink price feed
 */
const { ethers, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const splitterAddr = process.env.REVENUE_SPLITTER_ADDRESS || ethers.ZeroAddress;
  const zkAddr = process.env.ZK_VERIFIER_ADDRESS || ethers.ZeroAddress;
  const mailbox = process.env.HYPERLANE_MAILBOX_ADDRESS || ethers.ZeroAddress;
  const oracle = process.env.CHAINLINK_ORACLE_ADDRESS || ethers.ZeroAddress;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  XFuel Protocol — Circuit Deployment');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Network:          ${network.name}`);
  console.log(`  Deployer:         ${deployer.address}`);
  console.log(`  RevenueSplitter:  ${splitterAddr}`);
  console.log(`  ZKVerifier:       ${zkAddr}`);
  console.log('───────────────────────────────────────────────────────────');

  const deployed = {};
  const circuits = [
    { name: 'TAOCircuit',        args: [admin, splitterAddr, zkAddr, mailbox, oracle] },
    { name: 'A2ACircuit',        args: [admin, splitterAddr, zkAddr] },
    { name: 'ThetaGPUCircuit',   args: [admin, splitterAddr, zkAddr] },
    { name: 'ZKMLCircuit',       args: [admin, splitterAddr, zkAddr] },
    { name: 'AkashCircuit',      args: [admin, splitterAddr, zkAddr] },
    { name: 'AutonomousVaults',  args: [admin, splitterAddr, zkAddr] },
    { name: 'AgentRobotics',     args: [admin, splitterAddr, zkAddr] },
    { name: 'DataHubs',          args: [admin, splitterAddr, zkAddr] },
    { name: 'YieldCircuit',      args: [admin, splitterAddr, zkAddr] },
    { name: 'NearAgents',        args: [admin, splitterAddr, zkAddr] },
  ];

  for (let idx = 0; idx < circuits.length; idx++) {
    const c = circuits[idx];
    console.log(`\n[${idx + 1}/${circuits.length}] Deploying ${c.name}...`);
    const F = await ethers.getContractFactory(c.name);
    const contract = await F.deploy(...c.args);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    deployed[c.name] = addr;
    console.log(`  ✓ ${c.name}: ${addr}`);
  }

  // Grant CIRCUIT_ROLE on RevenueSplitter
  if (splitterAddr !== ethers.ZeroAddress) {
    console.log('\n───────────────────────────────────────────────────────────');
    console.log('  Granting CIRCUIT_ROLE on CoreRevenueSplitter...');
    const splitter = await ethers.getContractAt('CoreRevenueSplitter', splitterAddr);
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    for (const [name, addr] of Object.entries(deployed)) {
      await splitter.grantRole(CIRCUIT_ROLE, addr);
      console.log(`  ✓ ${name} granted CIRCUIT_ROLE`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Circuit Deployment Complete');
  console.log('═══════════════════════════════════════════════════════════');
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`  ${name.padEnd(20)} ${addr}`);
  }
  console.log('═══════════════════════════════════════════════════════════');

  return deployed;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
