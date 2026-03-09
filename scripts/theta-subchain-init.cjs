/**
 * XFuel Protocol — Theta Subchain Initialization
 *
 * Registers a single shared XFuel subchain on Theta Metachain.
 * Architecture: one subchain, multiple circuits (ThetaInferenceCircuit,
 * A2ACircuit, ThetaGPUCircuit, DataHubs), branch-ready for future splits.
 *
 * Uses direct ethers.js calls to ChainRegistrarOnMainchain — no npm SDK.
 * Source: https://github.com/thetatoken/theta-metachain-guide
 *
 * ── PRIVATENET vs TESTNET/MAINNET: KEY DIFFERENCE ──
 *
 * PRIVATENET uses MockWrappedTheta — a pre-deployed mock ERC-20 at a known
 * address in the privatenet snapshot. You mint tokens freely for testing.
 * No real THETA needs to be wrapped. This is the correct way to test locally.
 *
 * TESTNET/MAINNET requires real wTHETA tokens (wrap via Theta Web Wallet).
 *
 * Privatenet also ships with a pre-deployed ChainRegistrarOnMainchain at a
 * different address than testnet/mainnet. Both addresses are defined below.
 *
 * ── Prerequisites by Network ──
 *
 * PRIVATENET:
 *   1. Build and start theta, theta-eth-rpc-adaptor, and thetasubchain binaries:
 *      git clone https://github.com/thetatoken/theta-protocol-ledger
 *      git clone https://github.com/thetatoken/theta-eth-rpc-adaptor
 *      git clone https://github.com/thetatoken/theta-protocol-subchain
 *      Follow setup at: docs/1-privatenet/manual-flow/1-setup.md
 *   2. Start main chain validator and ETH RPC adaptor (localhost:18888/rpc)
 *   3. Run deployGovToken.js from theta-metachain-guide sdk/js (or use this
 *      script's --step govtoken to deploy via ethers.js)
 *   4. Run mintMockWrappedTheta.js OR use --step mintmock in this script
 *   5. Run subchain_generate_genesis (Go binary) to create snapshot + genesis hash
 *      Format: subchain_generate_genesis -mainchainID=privatenet \
 *                -subchainID=tsub<SUBCHAIN_ID> -initValidatorSet=./validators.json \
 *                -admin=<ADMIN_ADDR> -fallbackReceiver=<ADMIN_ADDR> -genesis=./snapshot
 *      SUBCHAIN_ID_STR format: "tsub360777" where 360777 is the EVM chainID
 *
 * TESTNET:
 *   1. Wrap THETA → wTHETA via Theta Web Wallet
 *   2. Deploy governance token on Theta Testnet (chain 365)
 *   3. Run subchain_generate_genesis with -mainchainID=testnet
 *   4. Register chainID on chainlist.org (recommended before mainnet)
 *
 * MAINNET:
 *   Same as testnet but -mainchainID=mainnet and chainID registered on chainlist.org
 *
 * ── Genesis Snapshot ──
 *
 *   IMPORTANT: The genesis snapshot is a Go binary operation, not JavaScript.
 *   This script cannot generate it. Run subchain_generate_genesis before
 *   calling --step register, then set THETA_GENESIS_HASH from its output:
 *
 *   Example output line to capture:
 *   "Genesis block hash: 0x9fbd08fc250bdf051e5a031457ce8225..."
 *
 *   Also note: genesis output includes auto-deployed Token Bank contract
 *   addresses on the subchain (TFuelTokenBank, TNT20TokenBank, etc.) —
 *   save these for cross-chain asset transfer setup.
 *
 * ── Usage ──
 *
 *   node scripts/theta-subchain-init.cjs --network privatenet --dry-run
 *   node scripts/theta-subchain-init.cjs --network privatenet --step mintmock
 *   node scripts/theta-subchain-init.cjs --network privatenet --step govtoken
 *   node scripts/theta-subchain-init.cjs --network privatenet --step register
 *   node scripts/theta-subchain-init.cjs --network privatenet --step collateral
 *   node scripts/theta-subchain-init.cjs --network privatenet --step stake
 *   node scripts/theta-subchain-init.cjs --network privatenet   (all steps)
 *   node scripts/theta-subchain-init.cjs --network testnet
 *   node scripts/theta-subchain-init.cjs --network mainnet
 *
 * ── Collateral Requirements (per Theta Metachain docs) ──
 *
 *   Subchain registration:  10,000 wTHETA  (MockWrappedTheta on privatenet)
 *   Per validator:           1,000 wTHETA + 20,000 TFUEL
 *   3 validators total:      3,000 wTHETA + 60,000 TFUEL
 *   ──────────────────────────────────────────────────────────────────
 *   TOTAL (testnet/mainnet): 13,000 real wTHETA + 60,000 TFUEL minimum
 *   TOTAL (privatenet):      mint freely via MockWrappedTheta; TFUEL from node
 *
 * ── Dynasty Timing ──
 *
 *   Privatenet:  ~400 main-chain blocks  (~40 min, configurable shorter)
 *   Testnet:    ~10,000 main-chain blocks (~16-17 hours at ~6s/block)
 *   Mainnet:    ~10,000 main-chain blocks (~16-17 hours at ~6s/block)
 *   Stake deposits only take effect at the NEXT dynasty boundary.
 *   Wait 100 subchain blocks after genesis before testing cross-chain transfers.
 *
 * ── Required Environment Variables (.env.local) ──
 *
 *   DEPLOYER_PRIVATE_KEY          Deployer wallet (operator)
 *   THETA_GOV_TOKEN_ADDRESS       XFuel subchain governance TNT-20 address
 *   THETA_GENESIS_HASH            Genesis hash from subchain_generate_genesis output
 *   THETA_VALIDATOR_1_ADDRESS     First validator wallet address
 *   THETA_VALIDATOR_2_ADDRESS     Second validator wallet address
 *   THETA_VALIDATOR_3_ADDRESS     Third validator wallet address
 *   THETA_VALIDATOR_STAKE_AMOUNT  Governance tokens to stake per validator (default: 100000 * 1e18)
 *
 *   Testnet/Mainnet only:
 *   THETA_WTHETA_TOKEN            Real wTHETA TNT-20 contract address
 *
 *   Privatenet only (optional — defaults to known privatenet snapshot addresses):
 *   THETA_MOCK_WTHETA_TOKEN       Override if using custom privatenet snapshot
 *   THETA_MOCK_MINT_AMOUNT        Amount to mint in wei (default: 50000 * 1e18)
 */

'use strict';

const { ethers } = require('hardhat');
const fs   = require('fs');
const path = require('path');

// ─── Network Configurations ──────────────────────────────────────────────────

const NETWORKS = {
  privatenet: {
    name:           'Theta Privatenet',
    chainId:        366,             // local privatenet main chain ID (not on chainlist)
    subchainId:     360777,          // default privatenet example subchain EVM chainID
    subchainIdStr:  'tsub360777',    // format: "tsub" + subchainId integer
    rpc:            'http://localhost:18888/rpc',   // main chain ETH RPC adaptor port
    subchainRpc:    'http://localhost:19888/rpc',   // subchain ETH RPC adaptor port
    dynasty:        400,             // short dynasty for fast testing (~40 min)
    mockWTheta:     true,            // use MockWrappedTheta (no real THETA needed)
    note:           'Start theta + theta-eth-rpc-adaptor + thetasubchain locally first',
  },
  testnet: {
    name:           'Theta Testnet',
    chainId:        365,
    subchainId:     365001,          // XFuel testnet subchain — reserve on chainlist.org
    subchainIdStr:  'tsub365001',
    rpc:            'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    explorer:       'https://testnet-explorer.thetatoken.org',
    dynasty:        10000,           // ~16-17 hours at 6s/block
    mockWTheta:     false,
    note:           'Validators active after next dynasty (~10K main-chain blocks)',
  },
  mainnet: {
    name:           'Theta Mainnet',
    chainId:        361,
    subchainId:     361001,          // XFuel mainnet subchain — must be on chainlist.org
    subchainIdStr:  'tsub361001',
    rpc:            'https://eth-rpc-api.thetatoken.org/rpc',
    explorer:       'https://explorer.thetatoken.org',
    dynasty:        10000,
    mockWTheta:     false,
  },
};

// ─── Theta Metachain Contract Addresses (Theta Labs deployed, immutable) ─────
// Source: https://github.com/thetatoken/theta-metachain-guide
//
// PRIVATENET addresses come from the pre-generated main chain snapshot.
// They are fixed for anyone using the official privatenet setup guide.
//
// TESTNET/MAINNET addresses — verify against the latest Theta Metachain guide
// before deployment. The addresses below are from the official guide.

const METACHAIN_CONTRACTS = {
  // Privatenet: addresses from the main chain snapshot
  // Source: docs/1-privatenet/manual-flow/2-register-and-staking.md
  privatenet: {
    ChainRegistrarOnMainchain: '0x08425D9Df219f93d5763c3e85204cb5B4cE33aAa',
    MockWrappedTheta:          '0x7d73424a8256C0b2BA245e5d5a3De8820E45F390',
    // Token banks (auto-deployed by subchain_generate_genesis — addresses vary)
    // Run genesis and read output to get actual addresses for your snapshot.
    TFuelTokenBank:    '0xA10A3B175F0f2641Cf41912b887F77D8ef34FAe8',
    TNT20TokenBank:    '0x6E05f58eEddA592f34DD9105b1827f252c509De0',
    TNT721TokenBank:   '0x79EaFd0B5eC8D3f945E6BB2817ed90b046c0d0Af',
    TNT1155TokenBank:  '0x2Ce636d6240f8955d085a896e12429f8B3c7db26',
    // Mock TNT tokens (for cross-chain transfer testing)
    MockTNT20:   '0x4fb87c52Bb6D194f78cd4896E3e574028fedBAB9',
    MockTNT721:  '0xEd8d61f42dC1E56aE992D333A4992C3796b22A74',
    MockTNT1155: '0x47eb28D8139A188C5686EedE1E9D8EDE3Afdd543',
  },
  // Testnet/Mainnet: real ChainRegistrar — no MockWrappedTheta
  // Source: https://github.com/thetatoken/theta-metachain-guide (verify before use)
  testnet: {
    ChainRegistrarOnMainchain: '0x5a1E00884B21E73520a255D1CB89f4d6A9B4a3a7',
  },
  mainnet: {
    ChainRegistrarOnMainchain: '0x5a1E00884B21E73520a255D1CB89f4d6A9B4a3a7',
  },
};

// ─── ABI Fragments (only what we need) ───────────────────────────────────────

const CHAIN_REGISTRAR_ABI = [
  // Register the subchain (Step 3)
  'function registerSubchain(uint256 chainID, address govTokenAddr, uint256 wThetaAmount, bytes32 genesisHash) external',

  // Deposit wTHETA collateral per validator (Step 4a)
  'function depositCollateral(uint256 chainID, address validatorAddr, uint256 wThetaAmount) external',

  // Deposit governance token stake per validator (Step 4b)
  'function depositStake(uint256 chainID, address validatorAddr, uint256 amount) external',

  // Post-launch validator management
  'function withdrawStake(uint256 chainID, address validatorAddr, uint256 amount) external',
  'function withdrawCollateral(uint256 chainID, address validatorAddr, uint256 wThetaAmount) external',

  // View — may revert on older versions; caught with try/catch
  'function isSubchainRegistered(uint256 chainID) external view returns (bool)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function transfer(address to, uint256 amount) external returns (bool)',
];

// MockWrappedTheta (privatenet only) — lets you freely mint test collateral
// Source: theta-metachain-guide sdk/js/mintMockWrappedTheta.js
const MOCK_WTHETA_ABI = [
  ...ERC20_ABI,
  'function mint(address to, uint256 amount) external',
];

// Subchain Governance Token (reference implementation)
// Source: theta-metachain-guide demos/subchain-governance-token/contracts/SubchainGovernanceToken.sol
const GOV_TOKEN_ABI = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function balanceOf(address account) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function stakerRewardPerBlock() external view returns (uint256)',
  'function mintStakerReward(address staker, uint256 reward) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// ─── Collateral Constants ────────────────────────────────────────────────────

const COLLATERAL = {
  REGISTRATION_WTHETA:  ethers.parseEther('10000'),  // 10,000 wTHETA per subchain
  PER_VALIDATOR_WTHETA: ethers.parseEther('1000'),   // 1,000 wTHETA per validator
  PER_VALIDATOR_TFUEL:  ethers.parseEther('20000'),  // 20,000 TFUEL per validator
  VALIDATOR_COUNT:      3,
  // Privatenet: mint 50,000 MockWrappedTheta (13,000 needed; buffer for testing)
  // Source: mintMockWrappedTheta.js example uses 50000 * 1e18
  MOCK_MINT_AMOUNT:     ethers.parseEther('50000'),
};

// Circuits deployed on this shared subchain
const SUBCHAIN_CIRCUITS = [
  'ThetaInferenceCircuit',
  'A2ACircuit',
  'ThetaGPUCircuit',
  'DataHubs',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(`  ${msg}`); }
function logStep(n, msg) { console.log(`\n══ Step ${n}: ${msg} ══`); }
function logWarn(msg) { console.warn(`  ⚠  ${msg}`); }
function logOk(msg)   { console.log(`  ✓  ${msg}`); }
function logInfo(msg) { console.log(`  ·  ${msg}`); }

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}\n  Add it to .env.local`);
  return val;
}

function loadManifest(manifestPath) {
  if (fs.existsSync(manifestPath)) {
    try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* ignore */ }
  }
  return {};
}

function saveManifest(manifestPath, data) {
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2));
  logOk(`Manifest saved to ${path.relative(process.cwd(), manifestPath)}`);
}

// ─── Step Functions ───────────────────────────────────────────────────────────

/**
 * Step 1: Validate environment and display preflight summary.
 */
async function preflight(deployer, netCfg, isDry) {
  logStep(1, 'Preflight Checks');

  const balance = await ethers.provider.getBalance(deployer.address);
  logInfo(`Network:    ${netCfg.name} (chain ${netCfg.chainId})`);
  logInfo(`Subchain:   ${netCfg.subchainId} (${netCfg.subchainIdStr})`);
  logInfo(`Deployer:   ${deployer.address}`);
  logInfo(`TFUEL bal:  ${ethers.formatEther(balance)} TFUEL`);
  if (isDry) logWarn('DRY RUN — no transactions will be submitted');

  if (netCfg.mockWTheta) {
    logInfo('');
    logInfo('Collateral: MockWrappedTheta (privatenet mode — no real THETA required)');
    logInfo(`  MockWrappedTheta: ${METACHAIN_CONTRACTS.privatenet.MockWrappedTheta}`);
    logInfo(`  ChainRegistrar:   ${METACHAIN_CONTRACTS.privatenet.ChainRegistrarOnMainchain}`);
    logInfo(`  Mint amount:      ${ethers.formatEther(COLLATERAL.MOCK_MINT_AMOUNT)} MockWTHETA`);
  } else {
    const minTFUEL = COLLATERAL.PER_VALIDATOR_TFUEL * BigInt(COLLATERAL.VALIDATOR_COUNT);
    if (balance < minTFUEL) {
      throw new Error(
        `Insufficient TFUEL: have ${ethers.formatEther(balance)}, need ${ethers.formatEther(minTFUEL)} minimum.\n` +
        `  (Plus gas costs — ensure at least ${ethers.formatEther(minTFUEL + ethers.parseEther('1000'))} total)`
      );
    }
    logOk(`TFUEL balance sufficient`);
  }

  logInfo('');
  logInfo('Collateral summary:');
  logInfo(`  Registration:     10,000 ${netCfg.mockWTheta ? 'MockWTHETA' : 'wTHETA'}`);
  logInfo(`  ${COLLATERAL.VALIDATOR_COUNT} validators × 1,000: ${COLLATERAL.VALIDATOR_COUNT * 1000} ${netCfg.mockWTheta ? 'MockWTHETA' : 'wTHETA'}`);
  logInfo(`  ${COLLATERAL.VALIDATOR_COUNT} validators × 20,000 TFUEL: ${COLLATERAL.VALIDATOR_COUNT * 20000} TFUEL`);
  logInfo(`  Total: ${10000 + COLLATERAL.VALIDATOR_COUNT * 1000} ${netCfg.mockWTheta ? 'MockWTHETA' : 'wTHETA'} + ${COLLATERAL.VALIDATOR_COUNT * 20000} TFUEL`);
  logInfo('');
  logInfo('Circuits on this subchain:');
  for (const c of SUBCHAIN_CIRCUITS) logInfo(`  - ${c}`);
  logInfo('');
  logWarn('Dynasty timing: validator stake takes effect at NEXT dynasty boundary.');
  if (!netCfg.mockWTheta) {
    logWarn(`  ~${netCfg.dynasty.toLocaleString()} main-chain blocks (~${Math.round(netCfg.dynasty * 6 / 3600)}h on ${netCfg.name}).`);
    logWarn('  Allow this time between --step stake and expecting validators to be active.');
  } else {
    logInfo('  Privatenet dynasty: ~400 blocks (fast testing mode).');
    logInfo('  Wait for main chain to produce blocks before running steps.');
    logInfo('  IMPORTANT: Wait 100 subchain blocks before testing cross-chain transfers.');
  }
}

/**
 * Step 2 (privatenet only): Mint MockWrappedTheta tokens for testing collateral.
 * Equivalent to running: node mintMockWrappedTheta.js privatenet <address> 50000000000000000000000
 * Source: theta-metachain-guide sdk/js/mintMockWrappedTheta.js
 */
async function mintMockWTheta(deployer, isDry) {
  logStep(2, 'Mint MockWrappedTheta (privatenet only)');

  const mockAddr = process.env.THETA_MOCK_WTHETA_TOKEN || METACHAIN_CONTRACTS.privatenet.MockWrappedTheta;
  const mintAmount = process.env.THETA_MOCK_MINT_AMOUNT
    ? BigInt(process.env.THETA_MOCK_MINT_AMOUNT)
    : COLLATERAL.MOCK_MINT_AMOUNT;

  logInfo(`MockWrappedTheta: ${mockAddr}`);
  logInfo(`Mint to:          ${deployer.address}`);
  logInfo(`Mint amount:      ${ethers.formatEther(mintAmount)} MockWTHETA`);
  logWarn('This only works on privatenet — the mock token allows free minting.');

  if (isDry) { logInfo('[DRY] Would call MockWrappedTheta.mint(deployer, amount)'); return mockAddr; }

  const mockWTheta = new ethers.Contract(mockAddr, MOCK_WTHETA_ABI, deployer);
  const before = await mockWTheta.balanceOf(deployer.address);
  logInfo(`Balance before: ${ethers.formatEther(before)} MockWTHETA`);

  const tx = await mockWTheta.mint(deployer.address, mintAmount);
  logInfo(`mint tx: ${tx.hash}`);
  await tx.wait();

  const after = await mockWTheta.balanceOf(deployer.address);
  logOk(`Balance after: ${ethers.formatEther(after)} MockWTHETA`);

  return mockAddr;
}

/**
 * Step 3: Approve wTHETA (or MockWrappedTheta on privatenet) for ChainRegistrar.
 * Approves enough for registration + all validator collateral in one call.
 */
async function approveWTheta(deployer, netKey, netCfg, isDry) {
  logStep(3, 'Approve wTHETA for ChainRegistrar');

  const contracts = METACHAIN_CONTRACTS[netKey];
  const registrarAddr = contracts.ChainRegistrarOnMainchain;

  let wThetaAddr;
  if (netCfg.mockWTheta) {
    wThetaAddr = process.env.THETA_MOCK_WTHETA_TOKEN || contracts.MockWrappedTheta;
    logInfo('Using MockWrappedTheta (privatenet)');
  } else {
    wThetaAddr = requireEnv('THETA_WTHETA_TOKEN');
    logInfo('Using real wTHETA (testnet/mainnet)');
  }

  const totalWTheta = COLLATERAL.REGISTRATION_WTHETA +
    (COLLATERAL.PER_VALIDATOR_WTHETA * BigInt(COLLATERAL.VALIDATOR_COUNT));

  logInfo(`wTHETA token:   ${wThetaAddr}`);
  logInfo(`ChainRegistrar: ${registrarAddr}`);
  logInfo(`Approving:      ${ethers.formatEther(totalWTheta)} ${netCfg.mockWTheta ? 'MockWTHETA' : 'wTHETA'}`);

  if (isDry) { logInfo('[DRY] Would call wTHETA.approve(registrar, totalWTheta)'); return { registrarAddr, wThetaAddr }; }

  const wTheta = new ethers.Contract(wThetaAddr, ERC20_ABI, deployer);
  const balance = await wTheta.balanceOf(deployer.address);
  logInfo(`Current balance: ${ethers.formatEther(balance)} ${netCfg.mockWTheta ? 'MockWTHETA' : 'wTHETA'}`);

  if (balance < totalWTheta) {
    if (netCfg.mockWTheta) {
      throw new Error(
        `Insufficient MockWrappedTheta balance: ${ethers.formatEther(balance)}.\n` +
        `  Run --step mintmock first to mint MockWrappedTheta.`
      );
    } else {
      throw new Error(
        `Insufficient wTHETA balance: have ${ethers.formatEther(balance)}, need ${ethers.formatEther(totalWTheta)}.\n` +
        `  Wrap THETA → wTHETA via Theta Web Wallet first.`
      );
    }
  }

  const currentAllowance = await wTheta.allowance(deployer.address, registrarAddr);
  if (currentAllowance >= totalWTheta) {
    logOk(`Already approved (${ethers.formatEther(currentAllowance)} ${netCfg.mockWTheta ? 'MockWTHETA' : 'wTHETA'})`);
  } else {
    const tx = await wTheta.approve(registrarAddr, totalWTheta);
    logInfo(`approve tx: ${tx.hash}`);
    await tx.wait();
    logOk(`Approved: ${ethers.formatEther(totalWTheta)}`);
  }

  return { registrarAddr, wThetaAddr };
}

/**
 * Step 4: Register the subchain via ChainRegistrarOnMainchain.registerSubchain().
 * Per the guide: provide govTokenAddr, wTHETA registration amount, and genesis hash.
 */
async function registerSubchain(deployer, netCfg, registrarAddr, isDry) {
  logStep(4, 'Register Subchain');

  const govTokenAddr  = requireEnv('THETA_GOV_TOKEN_ADDRESS');
  const genesisHash   = requireEnv('THETA_GENESIS_HASH');

  if (!genesisHash.startsWith('0x') || genesisHash.length !== 66) {
    throw new Error(
      `THETA_GENESIS_HASH must be a 32-byte hex string (0x + 64 chars).\n` +
      `  Run subchain_generate_genesis to produce it:\n` +
      `  subchain_generate_genesis -mainchainID=${netCfg.mockWTheta ? 'privatenet' : (netCfg.chainId === 365 ? 'testnet' : 'mainnet')} \\` + '\n' +
      `    -subchainID=${netCfg.subchainIdStr} -initValidatorSet=./validators.json \\` + '\n' +
      `    -admin=<ADMIN_ADDR> -fallbackReceiver=<ADMIN_ADDR> -genesis=./snapshot`
    );
  }

  logInfo(`Subchain ID:     ${netCfg.subchainId} (${netCfg.subchainIdStr})`);
  logInfo(`Gov token:       ${govTokenAddr}`);
  logInfo(`Genesis hash:    ${genesisHash}`);
  logInfo(`wTHETA deposit:  ${ethers.formatEther(COLLATERAL.REGISTRATION_WTHETA)} (registration collateral)`);

  if (isDry) { logInfo('[DRY] Would call ChainRegistrar.registerSubchain(...)'); return; }

  const registrar = new ethers.Contract(registrarAddr, CHAIN_REGISTRAR_ABI, deployer);

  try {
    const already = await registrar.isSubchainRegistered(netCfg.subchainId);
    if (already) { logOk(`Subchain ${netCfg.subchainId} already registered — skipping`); return; }
  } catch { /* isSubchainRegistered may not exist on all versions */ }

  const tx = await registrar.registerSubchain(
    netCfg.subchainId,
    govTokenAddr,
    COLLATERAL.REGISTRATION_WTHETA,
    genesisHash,
  );
  logInfo(`registerSubchain tx: ${tx.hash}`);
  await tx.wait();
  logOk(`Subchain ${netCfg.subchainId} registered`);
}

/**
 * Step 5a: Deposit wTHETA collateral per validator.
 * Source: theta-metachain-guide sdk/js/depositStake.js (wTHETA collateral portion)
 */
async function depositValidatorCollateral(deployer, netCfg, registrarAddr, validators, isDry) {
  logStep('5a', 'Deposit Validator wTHETA Collateral');

  const registrar = new ethers.Contract(registrarAddr, CHAIN_REGISTRAR_ABI, deployer);

  for (const [i, validator] of validators.entries()) {
    logInfo(`Validator ${i + 1}: ${validator}`);
    logInfo(`  Depositing ${ethers.formatEther(COLLATERAL.PER_VALIDATOR_WTHETA)} wTHETA`);

    if (isDry) { logInfo('[DRY] Would call depositCollateral(chainId, validator, 1000 wTHETA)'); continue; }

    const tx = await registrar.depositCollateral(
      netCfg.subchainId,
      validator,
      COLLATERAL.PER_VALIDATOR_WTHETA,
    );
    logInfo(`  depositCollateral tx: ${tx.hash}`);
    await tx.wait();
    logOk(`  Validator ${i + 1} collateral deposited`);
  }
}

/**
 * Step 5b: Approve and deposit governance token stake per validator.
 * Source: theta-metachain-guide sdk/js/depositStake.js (gov token stake portion)
 *
 * Per Theta docs: stake amount in the guide example is 100,000 gov tokens per validator.
 * The default InitStake in INIT_VALIDATOR_SET.json is 100000000000000000000000 (1e5 * 1e18).
 * THETA_VALIDATOR_STAKE_AMOUNT should match the stake in your genesis validator set.
 *
 * Only deposit to validators included in the genesis snapshot during dynasty 1.
 * The ValidatorSet for the NEXT dynasty must match INIT_VALIDATOR_SET.json.
 */
async function depositValidatorStake(deployer, netCfg, registrarAddr, validators, isDry) {
  logStep('5b', 'Deposit Validator Governance Token Stake');

  const govTokenAddr   = requireEnv('THETA_GOV_TOKEN_ADDRESS');
  // Default matches theta-metachain-guide example: 100,000 gov tokens per validator
  const stakeAmountRaw = process.env.THETA_VALIDATOR_STAKE_AMOUNT || ethers.parseEther('100000').toString();
  const stakeAmount    = BigInt(stakeAmountRaw);
  const totalStake     = stakeAmount * BigInt(validators.length);

  logInfo(`Gov token:          ${govTokenAddr}`);
  logInfo(`Stake/validator:    ${ethers.formatEther(stakeAmount)} gov tokens`);
  logInfo(`Total stake:        ${ethers.formatEther(totalStake)} gov tokens`);
  logWarn('Stake must match the amount specified in your genesis INIT_VALIDATOR_SET.json.');
  logWarn('Only deposit to validators that are in the genesis snapshot.');

  if (!isDry) {
    // Approve ChainRegistrar to transfer gov tokens on our behalf
    const govToken = new ethers.Contract(govTokenAddr, GOV_TOKEN_ABI, deployer);
    const currentAllowance = await govToken.allowance(deployer.address, registrarAddr);
    if (currentAllowance < totalStake) {
      const approveTx = await govToken.approve(registrarAddr, totalStake);
      logInfo(`approve gov token tx: ${approveTx.hash}`);
      await approveTx.wait();
      logOk(`Gov token approved to ChainRegistrar`);
    } else {
      logOk(`Gov token already approved (${ethers.formatEther(currentAllowance)})`);
    }
  }

  const registrar = new ethers.Contract(registrarAddr, CHAIN_REGISTRAR_ABI, deployer);

  for (const [i, validator] of validators.entries()) {
    logInfo(`Validator ${i + 1}: ${validator}`);

    if (isDry) { logInfo(`[DRY] Would call depositStake(${netCfg.subchainId}, ${validator}, ${ethers.formatEther(stakeAmount)})`); continue; }

    const tx = await registrar.depositStake(
      netCfg.subchainId,
      validator,
      stakeAmount,
    );
    logInfo(`  depositStake tx: ${tx.hash}`);
    await tx.wait();
    logOk(`  Validator ${i + 1} stake deposited`);
  }

  if (!isDry) {
    logInfo('');
    logInfo('After staking, verify ValidatorSet for next dynasty matches your genesis set.');
    logInfo('Expected output: "After staking, ValidatorSet for the next dynasty 1:"');
    logInfo('If not matching, the subchain will not start correctly.');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const netArg  = getArg('--network') || 'privatenet';
  const stepArg = getArg('--step');
  // Steps: 'mintmock' | 'govtoken' | 'register' | 'collateral' | 'stake' | undefined (all)
  const isDry   = hasFlag('--dry-run');

  const netKey = netArg;
  const netCfg = NETWORKS[netKey];
  if (!netCfg) {
    throw new Error(`Unknown network "${netKey}". Use: privatenet | testnet | mainnet`);
  }

  if (stepArg === 'mintmock' && !netCfg.mockWTheta) {
    throw new Error('--step mintmock is only available for --network privatenet');
  }

  const manifestPath = path.join(__dirname, '..', 'deploy', 'manifests', `subchain-${netKey}.json`);
  const manifest     = loadManifest(manifestPath);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Protocol — Theta Subchain Initialization              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Network:   ${netCfg.name.padEnd(48)}║`);
  console.log(`║  Chain ID:  ${String(netCfg.chainId).padEnd(48)}║`);
  console.log(`║  Subchain:  ${String(netCfg.subchainId).padEnd(48)}║`);
  console.log(`║  Step:      ${(stepArg || 'all').padEnd(48)}║`);
  console.log(`║  Mode:      ${(isDry ? 'DRY RUN (no txs)' : 'LIVE').padEnd(48)}║`);
  console.log(`║  Collateral:${(netCfg.mockWTheta ? 'MockWrappedTheta (privatenet)' : 'real wTHETA').padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const [deployer] = await ethers.getSigners();

  // Load validators from env
  const validators = [
    process.env.THETA_VALIDATOR_1_ADDRESS,
    process.env.THETA_VALIDATOR_2_ADDRESS,
    process.env.THETA_VALIDATOR_3_ADDRESS,
  ].filter(Boolean);

  if (validators.length === 0) {
    logWarn('No validator addresses set. Set THETA_VALIDATOR_1/2/3_ADDRESS in .env.local');
    logWarn('Continuing with preflight only...');
  }

  await preflight(deployer, netCfg, isDry);

  const contracts   = METACHAIN_CONTRACTS[netKey];
  const registrarAddr = contracts.ChainRegistrarOnMainchain;

  const runAll        = !stepArg;
  const runMintMock   = netCfg.mockWTheta && (runAll || stepArg === 'mintmock');
  const runApprove    = runAll || stepArg === 'register' || stepArg === 'collateral';
  const runRegister   = runAll || stepArg === 'register';
  const runCollateral = runAll || stepArg === 'collateral';
  const runStake      = runAll || stepArg === 'stake';

  // Step 2 (privatenet): Mint MockWrappedTheta
  if (runMintMock) {
    await mintMockWTheta(deployer, isDry);
  }

  // Step 3: Approve wTHETA / MockWrappedTheta for ChainRegistrar
  if (runApprove) {
    await approveWTheta(deployer, netKey, netCfg, isDry);
  }

  // Step 4: Register subchain
  if (runRegister) {
    await registerSubchain(deployer, netCfg, registrarAddr, isDry);
  }

  // Step 5a: Deposit validator wTHETA collateral
  if (runCollateral && validators.length > 0) {
    await depositValidatorCollateral(deployer, netCfg, registrarAddr, validators, isDry);
  }

  // Step 5b: Deposit validator governance token stake
  if (runStake && validators.length > 0) {
    await depositValidatorStake(deployer, netCfg, registrarAddr, validators, isDry);
  }

  // ── Save manifest ──
  const result = {
    network:         netCfg.name,
    chainId:         netCfg.chainId,
    subchainId:      netCfg.subchainId,
    subchainIdStr:   netCfg.subchainIdStr,
    mainchainRpc:    netCfg.rpc,
    subchainRpc:     netCfg.subchainRpc || null,
    completedAt:     new Date().toISOString(),
    isDryRun:        isDry,
    circuits:        SUBCHAIN_CIRCUITS,
    validators,
    useMockWTheta:   netCfg.mockWTheta,
    collateralRequirements: {
      registration_wTHETA:    '10000',
      per_validator_wTHETA:   '1000',
      per_validator_TFUEL:    '20000',
      validators:             COLLATERAL.VALIDATOR_COUNT,
      total_wTHETA:           String(10000 + COLLATERAL.VALIDATOR_COUNT * 1000),
      total_TFUEL:            String(COLLATERAL.VALIDATOR_COUNT * 20000),
      note: netCfg.mockWTheta
        ? 'Privatenet: uses MockWrappedTheta (mint freely, no real THETA required)'
        : 'Testnet/Mainnet: requires real wTHETA (wrap via Theta Web Wallet)',
    },
    dynastyInfo: {
      blocksPerDynasty:   netCfg.dynasty,
      approxHours:        Math.round(netCfg.dynasty * 6 / 3600),
      note:               'Stake deposits take effect at next dynasty boundary',
      crossChainNote:     'Wait 100 subchain blocks before testing cross-chain transfers',
    },
    metachainContracts: {
      ChainRegistrarOnMainchain: contracts.ChainRegistrarOnMainchain,
      ...(netCfg.mockWTheta ? {
        MockWrappedTheta: contracts.MockWrappedTheta,
        TFuelTokenBank:   contracts.TFuelTokenBank,
        TNT20TokenBank:   contracts.TNT20TokenBank,
        TNT721TokenBank:  contracts.TNT721TokenBank,
        TNT1155TokenBank: contracts.TNT1155TokenBank,
        MockTNT20:        contracts.MockTNT20,
        MockTNT721:       contracts.MockTNT721,
        MockTNT1155:      contracts.MockTNT1155,
      } : {}),
    },
    stepsCompleted: {
      mintmock:   runMintMock,
      approve:    runApprove,
      register:   runRegister,
      collateral: runCollateral,
      stake:      runStake,
    },
    ...manifest,
  };

  saveManifest(manifestPath, result);

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  logOk('Subchain initialization complete.');
  console.log('');
  logInfo('Next steps:');
  if (netCfg.mockWTheta && !runMintMock) {
    logInfo('  0. If not done: run --step mintmock to mint MockWrappedTheta');
  }
  if (!runStake || validators.length === 0) {
    logInfo('  1. Set THETA_VALIDATOR_1/2/3_ADDRESS and run --step stake');
  }
  logInfo(`  2. Start subchain ETH RPC adaptor FIRST:`);
  logInfo(`     theta-eth-rpc-adaptor start --config=../subchain/ethrpc`);
  logInfo(`  3. Start subchain validator:`);
  logInfo(`     thetasubchain start --config=../subchain/validator --password=<pw>`);
  logInfo(`  4. Wait for next dynasty boundary (~${netCfg.dynasty} main-chain blocks)`);
  logInfo(`  5. Wait 100 subchain blocks before testing cross-chain transfers`);
  logInfo(`  6. Verify ValidatorSet matches genesis INIT_VALIDATOR_SET.json`);
  logInfo(`  7. Deploy XFuel circuits to subchain (${netCfg.subchainRpc || 'subchain RPC'}):`);
  for (const c of SUBCHAIN_CIRCUITS) logInfo(`     - ${c}`);
  logInfo(`  8. Update src/config/thetaConfig.ts with subchain RPC endpoint`);
  logInfo(`  9. Test cross-chain asset transfers (TFuel, TNT20, TNT721)`);
  console.log('══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('\n✗ Fatal error:', err.message || err);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
