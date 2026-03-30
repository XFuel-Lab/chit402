/**
 * Deploy CommunityEngagementDistributor (Merkle claims, lifetime XF cap).
 *
 *   npx hardhat run believer/deploy-engagement-distributor.cjs --network theta-mainnet
 *
 * Env:
 *   ADMIN_ADDRESS           — multisig (defaults to same Safe as believer launch)
 *   XF_TOKEN_ADDRESS        — deployed XF ERC20 (required for mainnet)
 *   ENGAGEMENT_MAX_LIFETIME_XF — human amount, default 150000000 (15% of 1B)
 */
const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

const DEFAULT_MULTISIG = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';

async function main() {
  const [deployer] = await ethers.getSigners();
  let admin = process.env.ADMIN_ADDRESS;
  try {
    if (admin) admin = ethers.getAddress(admin);
  } catch {
    admin = DEFAULT_MULTISIG;
  }
  if (!admin) admin = DEFAULT_MULTISIG;

  const xfToken = process.env.XF_TOKEN_ADDRESS;
  if (!xfToken && (network.name === 'theta-mainnet' || network.name === 'mainnet')) {
    throw new Error('Set XF_TOKEN_ADDRESS for this network');
  }

  const maxHuman = process.env.ENGAGEMENT_MAX_LIFETIME_XF || '150000000';
  const maxLifetimeXF = ethers.parseEther(maxHuman);

  let tokenAddr = xfToken;
  if (!tokenAddr) {
    const Mock = await ethers.getContractFactory('MockERC20');
    const m = await Mock.deploy('XF', 'XF', 18);
    await m.waitForDeployment();
    tokenAddr = await m.getAddress();
    await m.mint(deployer.address, maxLifetimeXF);
    console.log('  (test) MockERC20 XF:', tokenAddr);
  }

  const F = await ethers.getContractFactory('CommunityEngagementDistributor');
  const d = await F.deploy(admin, tokenAddr, maxLifetimeXF);
  await d.waitForDeployment();
  const addr = await d.getAddress();
  const receipt = await d.deploymentTransaction().wait();

  const report = {
    contract: 'CommunityEngagementDistributor',
    address: addr,
    network: network.name,
    admin,
    xfToken: tokenAddr,
    maxLifetimeXF: maxHuman,
    gasUsed: Number(receipt.gasUsed),
    timestamp: new Date().toISOString(),
  };

  const out = path.join(__dirname, `deploy-engagement-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('\n  ✓ CommunityEngagementDistributor:', addr);
  console.log('    Report:', out);
  console.log('    Next: treasury fund() + publishSeason(merkleRoot) per docs/COMMUNITY_ENGAGEMENT_REWARDS.md\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
