/**
 * XFuel Protocol — Hyperlane Initialization Script
 *
 * Orchestrates Hyperlane core deployment to custom chains (Theta Testnet 365,
 * Bittensor Testnet 945) via the Hyperlane CLI.
 *
 * Per Hyperlane docs (docs.hyperlane.xyz/docs/guides/chains/deploy-hyperlane):
 *   - Permissionless deployment to any EVM chain
 *   - `hyperlane core init` generates chain config YAML
 *   - `hyperlane core deploy` deploys Mailbox + ISM + ValidatorAnnounce
 *
 * Whitepaper ref: Section 3.2 (Hyperlane Cross-Chain Proof Relay)
 *
 * Usage:
 *   node scripts/hyperlane-init.cjs                  # Full init + deploy guide
 *   node scripts/hyperlane-init.cjs --check-cli      # Verify CLI installation
 *   node scripts/hyperlane-init.cjs --manifest-only  # Write chain manifest only
 *
 * If Hyperlane CLI is not installed globally, the script will log the install command.
 * After deployment, Mailbox addresses are stored in deploy/legacy/manifests/hyperlane.json
 * (optional cross-chain experiment — settlement home remains Base).
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Chain Configurations ────────────────────────────────────────────────────

const CHAINS = {
  theta_mainnet: {
    name: 'theta_mainnet',
    displayName: 'Theta Mainnet',
    chainId: 361,
    domainId: 361,
    rpc: 'https://eth-rpc-api.thetatoken.org/rpc',
    nativeToken: { name: 'TFUEL', symbol: 'TFUEL', decimals: 18 },
    blockExplorers: [{ name: 'Theta Explorer', url: 'https://explorer.thetatoken.org' }],
    protocol: 'ethereum',
  },
  theta_testnet: {
    name: 'theta_testnet',
    displayName: 'Theta Testnet',
    chainId: 365,
    domainId: 365,
    rpc: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    nativeToken: { name: 'TFUEL', symbol: 'TFUEL', decimals: 18 },
    blockExplorers: [],
    protocol: 'ethereum',
  },
  bittensor_testnet: {
    name: 'bittensor_testnet',
    displayName: 'Bittensor EVM Testnet',
    chainId: 945,
    domainId: 945,
    rpc: 'https://test.chain.opentensor.ai',
    nativeToken: { name: 'TAO', symbol: 'TAO', decimals: 18 },
    blockExplorers: [],
    protocol: 'ethereum',
  },
  bittensor_mainnet: {
    name: 'bittensor_mainnet',
    displayName: 'Bittensor EVM Mainnet',
    chainId: 964,
    domainId: 964,
    rpc: 'https://lite.chain.opentensor.ai',
    nativeToken: { name: 'TAO', symbol: 'TAO', decimals: 18 },
    blockExplorers: [],
    protocol: 'ethereum',
  },
};

const MANIFEST_DIR = path.join(__dirname, '..', 'deploy', 'legacy', 'manifests');
const MANIFEST_FILE = path.join(MANIFEST_DIR, 'hyperlane.json');

// ─── CLI Detection ───────────────────────────────────────────────────────────

function checkHyperlaneCLI() {
  try {
    const version = execSync('hyperlane --version 2>&1', { encoding: 'utf-8' }).trim();
    console.log(`  ✓ Hyperlane CLI detected: ${version}`);
    return true;
  } catch {
    console.log('  ✗ Hyperlane CLI not found.');
    console.log('');
    console.log('  Install with:');
    console.log('    npm install -g @hyperlane-xyz/cli');
    console.log('');
    console.log('  After installing, re-run this script.');
    return false;
  }
}

// ─── Chain Config Generation ─────────────────────────────────────────────────

function generateChainConfigs() {
  const configDir = path.join(__dirname, '..', '.hyperlane');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const chainsConfig = {};
  for (const [key, chain] of Object.entries(CHAINS)) {
    chainsConfig[key] = {
      chainId: chain.chainId,
      domainId: chain.domainId,
      name: chain.name,
      protocol: chain.protocol,
      rpcUrls: [{ http: chain.rpc }],
      nativeToken: chain.nativeToken,
      blockExplorers: chain.blockExplorers,
    };
  }

  const configFile = path.join(configDir, 'chains.yaml');
  const yaml = Object.entries(chainsConfig).map(([key, cfg]) => {
    return [
      `${key}:`,
      `  chainId: ${cfg.chainId}`,
      `  domainId: ${cfg.domainId}`,
      `  name: "${cfg.name}"`,
      `  protocol: "${cfg.protocol}"`,
      `  rpcUrls:`,
      `    - http: "${cfg.rpcUrls[0].http}"`,
      `  nativeToken:`,
      `    name: "${cfg.nativeToken.name}"`,
      `    symbol: "${cfg.nativeToken.symbol}"`,
      `    decimals: ${cfg.nativeToken.decimals}`,
    ].join('\n');
  }).join('\n\n');

  fs.writeFileSync(configFile, yaml);
  console.log(`  ✓ Chain configs written to ${configFile}`);

  return configFile;
}

// ─── RPC Connectivity Check ──────────────────────────────────────────────────

async function checkRPCConnectivity() {
  console.log('');
  console.log('  Checking RPC connectivity...');

  for (const [key, chain] of Object.entries(CHAINS)) {
    try {
      const response = await fetch(chain.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
      });

      const data = await response.json();
      const reportedChainId = parseInt(data.result, 16);

      if (reportedChainId === chain.chainId) {
        console.log(`  ✓ ${chain.displayName} (${chain.chainId}): Connected`);
      } else {
        console.log(`  ⚠ ${chain.displayName}: Chain ID mismatch — expected ${chain.chainId}, got ${reportedChainId}`);
      }
    } catch (err) {
      console.log(`  ✗ ${chain.displayName} (${chain.chainId}): ${err.message}`);
    }
  }
}

// ─── Manifest Management ─────────────────────────────────────────────────────

function loadOrCreateManifest() {
  if (!fs.existsSync(MANIFEST_DIR)) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  }

  if (fs.existsSync(MANIFEST_FILE)) {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  }

  return {
    version: '1.0.0',
    protocol: 'xfuel',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chains: {},
    deployments: [],
  };
}

function saveManifest(manifest) {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  console.log(`  ✓ Manifest saved to ${MANIFEST_FILE}`);
}

function updateManifestWithAddresses(chainKey, addresses) {
  const manifest = loadOrCreateManifest();
  manifest.chains[chainKey] = {
    ...CHAINS[chainKey],
    hyperlane: {
      mailbox: addresses.mailbox || null,
      interchainSecurityModule: addresses.ism || null,
      validatorAnnounce: addresses.validatorAnnounce || null,
      deployedAt: new Date().toISOString(),
    },
  };
  manifest.deployments.push({
    chain: chainKey,
    timestamp: new Date().toISOString(),
    addresses,
  });
  saveManifest(manifest);
}

// ─── Deployment Guide ────────────────────────────────────────────────────────

function printDeploymentGuide() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Hyperlane Deployment Guide — XFuel Phase 1');
  console.log('  Whitepaper ref: Section 3.2, 8.1-8.2');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Step 1: Initialize Hyperlane for custom chains');
  console.log('    $ hyperlane core init');
  console.log('    → Select "custom chain" when prompted');
  console.log('    → Enter chain details for Theta Testnet (365) and Bittensor Testnet (945)');
  console.log('');
  console.log('  Step 2: Deploy Hyperlane core contracts');
  console.log('    $ hyperlane core deploy');
  console.log('    → Deploy to theta_testnet first (recommended before mainnet)');
  console.log('    → Deploy to theta_mainnet for production (requires funded TFUEL wallet)');
  console.log('    → Deploy to bittensor_testnet for TAOCircuit Phase 2');
  console.log('    → You will need funded wallets on each network');
  console.log('');
  console.log('  Step 3: Record deployed addresses');
  console.log('    After deployment, run:');
  console.log('    $ node scripts/hyperlane-init.cjs --record \\');
  console.log('        theta_mainnet <MAILBOX_ADDR> <ISM_ADDR>');
  console.log('    $ node scripts/hyperlane-init.cjs --record \\');
  console.log('        theta_testnet <MAILBOX_ADDR> <ISM_ADDR>');
  console.log('    $ node scripts/hyperlane-init.cjs --record \\');
  console.log('        bittensor_testnet <MAILBOX_ADDR> <ISM_ADDR>');
  console.log('');
  console.log('  Step 4: Set environment variables');
  console.log('    Add to .env.local:');
  console.log('      HYPERLANE_MAILBOX_THETA_MAINNET=<theta mainnet mailbox address>');
  console.log('      HYPERLANE_MAILBOX_THETA=<theta testnet mailbox address>');
  console.log('      HYPERLANE_MAILBOX_BITTENSOR=<bittensor mailbox address>');
  console.log('      DEPLOYER_PRIVATE_KEY=<your private key>');
  console.log('');
  console.log('  E2E Flow (per whitepaper Section 8.4):');
  console.log('    Theta submitTask → Hyperlane dispatch → Bittensor handle()');
  console.log('    → verifyWithStake (dTAO precompile 0x805)');
  console.log('    → Proof relay back via Hyperlane → Settle on Theta');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
}

// ─── CLI Argument Handling ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  XFuel — Hyperlane Init (Phase 1: TAOCircuit E2E)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (args.includes('--check-cli')) {
    checkHyperlaneCLI();
    return;
  }

  if (args.includes('--record') && args.length >= 4) {
    const chainKey = args[args.indexOf('--record') + 1];
    const mailbox = args[args.indexOf('--record') + 2];
    const ism = args[args.indexOf('--record') + 3] || null;

    if (!CHAINS[chainKey]) {
      console.error(`  ✗ Unknown chain: ${chainKey}`);
      console.log(`  Valid chains: ${Object.keys(CHAINS).join(', ')}`);
      process.exit(1);
    }

    console.log(`  Recording Hyperlane addresses for ${chainKey}...`);
    updateManifestWithAddresses(chainKey, { mailbox, ism });
    console.log(`  ✓ Mailbox: ${mailbox}`);
    console.log(`  ✓ ISM:     ${ism || '(not set)'}`);
    return;
  }

  if (args.includes('--manifest-only')) {
    const manifest = loadOrCreateManifest();
    for (const [key, chain] of Object.entries(CHAINS)) {
      if (!manifest.chains[key]) {
        manifest.chains[key] = {
          ...chain,
          hyperlane: { mailbox: null, ism: null, deployedAt: null },
        };
      }
    }
    saveManifest(manifest);
    return;
  }

  // Full init flow
  const hasCLI = checkHyperlaneCLI();
  generateChainConfigs();
  await checkRPCConnectivity();

  // Write initial manifest skeleton
  const manifest = loadOrCreateManifest();
  for (const [key, chain] of Object.entries(CHAINS)) {
    if (!manifest.chains[key]) {
      manifest.chains[key] = {
        ...chain,
        hyperlane: { mailbox: null, ism: null, deployedAt: null },
      };
    }
  }
  saveManifest(manifest);

  printDeploymentGuide();

  if (!hasCLI) {
    console.log('');
    console.log('  ⚠ Hyperlane CLI not installed — run:');
    console.log('    npm install -g @hyperlane-xyz/cli');
    console.log('');
    console.log('  Then re-run this script to proceed with deployment.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
