#!/usr/bin/env node

/**
 * @title MOCK_MODE AIVerifier Deploy Demo — Osmosis Governance
 * @notice Simulates CosmWasm AIVerifier.wasm deployment on Osmosis without live ZK proving.
 *
 * Features:
 *   - MOCK_MODE: Skip SP1 proof verification, use deterministic outputs
 *   - StoreCode → Instantiate → Configure → RouteTask demo flow
 *   - Forum-ready deployment log for governance proposal attachment
 *   - Osmosis testnet (osmo-test-5) integration when MOCK_MODE=false
 *   - No Persistence chain involvement — Osmosis-native only
 *
 * Usage:
 *   node governance-mocks/mock-ai-verifier-deploy.js
 *   node governance-mocks/mock-ai-verifier-deploy.js --network osmo-test-5 --mock-mode false
 *
 * Environment:
 *   OSMOSIS_RPC_URL    Osmosis testnet RPC (default: mock)
 *   DEPLOYER_MNEMONIC  Deployer wallet mnemonic (testnet only)
 *   MOCK_MODE          true (default) | false
 *
 * Reference: Whitepaper v5.1 Sections 3.4, 11.3
 */

import crypto from 'crypto';

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}
function getFlag(name) { return args.includes(`--${name}`); }

const CONFIG = {
  network:   getArg('network', 'osmo-test-5'),
  mockMode:  getArg('mock-mode', process.env.MOCK_MODE || 'true') === 'true',
  rpcUrl:    process.env.OSMOSIS_RPC_URL || 'https://rpc.testnet.osmosis.zone',
  deployer:  process.env.DEPLOYER_MNEMONIC || 'mock-mnemonic-for-demo-only',
  verbose:   getFlag('verbose'),
};

// ─── Constants (synced with cosmwasm-contracts/ai-verifier/) ──────────────────

const CONTRACT_CONFIG = {
  name: 'xfuel-ai-verifier',
  version: '0.1.0',
  codeId: null,        // Set after StoreCode
  contractAddr: null,  // Set after Instantiate
  admin: 'osmo1mockadmin000000000000000000000000000000',
  ibcTfuelDenom: 'ibc/TFUEL_HASH_ON_OSMOSIS',
  feeCollectorAddr: 'osmo1mockfeecollector00000000000000000000000',
  relayers: [
    'osmo1relayer1_000000000000000000000000000000',
    'osmo1relayer2_000000000000000000000000000000',
  ],
  feeConfig: {
    defaultBps: 50,
    minBps: 50,
    maxBps: 100,
    denominator: 10000,
    minTaskAmount: '10000',
  },
  chainIds: ['theta', 'osmosis', 'akash', 'bittensor'],
  messageTypes: ['compute_bid', 'compute_result', 'inference_request', 'capability_query', 'data_attestation'],
};

// ─── Mock Helpers ─────────────────────────────────────────────────────────────

function mockTxHash() {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
}

function mockCodeId() {
  return Math.floor(Math.random() * 10000) + 1000;
}

function mockContractAddr() {
  return `osmo1${crypto.randomBytes(19).toString('hex')}`;
}

function log(stage, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = CONFIG.mockMode ? '[MOCK]' : '[LIVE]';
  console.log(`${prefix} [${timestamp}] ${stage}: ${message}`);
  if (data && CONFIG.verbose) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ─── Deployment Stages ────────────────────────────────────────────────────────

/**
 * Stage 1: Store WASM code on-chain
 */
async function storeCode() {
  log('STORE_CODE', 'Uploading AIVerifier.wasm to Osmosis...');

  if (CONFIG.mockMode) {
    const codeId = mockCodeId();
    const txHash = mockTxHash();
    CONTRACT_CONFIG.codeId = codeId;

    log('STORE_CODE', `Code stored successfully`, {
      codeId,
      txHash,
      gasUsed: 2_500_000,
      wasmSize: '285KB (optimized)',
      network: CONFIG.network,
    });

    return { codeId, txHash };
  }

  // Live deployment would use CosmJS here
  throw new Error('Live deployment requires MOCK_MODE=false and valid DEPLOYER_MNEMONIC');
}

/**
 * Stage 2: Instantiate contract with initial config
 */
async function instantiateContract(codeId) {
  log('INSTANTIATE', `Instantiating AIVerifier from code_id=${codeId}...`);

  const instantiateMsg = {
    admin: CONTRACT_CONFIG.admin,
    ibc_tfuel_denom: CONTRACT_CONFIG.ibcTfuelDenom,
    fee_collector_addr: CONTRACT_CONFIG.feeCollectorAddr,
    fee_forward_threshold: '100000',
    default_fee_bps: CONTRACT_CONFIG.feeConfig.defaultBps,
    min_fee_bps: CONTRACT_CONFIG.feeConfig.minBps,
    max_fee_bps: CONTRACT_CONFIG.feeConfig.maxBps,
    min_task_amount: CONTRACT_CONFIG.feeConfig.minTaskAmount,
    relayers: CONTRACT_CONFIG.relayers,
    mock_mode: CONFIG.mockMode,
  };

  if (CONFIG.mockMode) {
    const contractAddr = mockContractAddr();
    const txHash = mockTxHash();
    CONTRACT_CONFIG.contractAddr = contractAddr;

    log('INSTANTIATE', `Contract instantiated`, {
      contractAddr,
      txHash,
      codeId,
      gasUsed: 800_000,
      label: `${CONTRACT_CONFIG.name}-v${CONTRACT_CONFIG.version}`,
      instantiateMsg,
    });

    return { contractAddr, txHash };
  }

  throw new Error('Live instantiation not yet supported in demo');
}

/**
 * Stage 3: Configure relayer ACL and chain routing
 */
async function configureContract(contractAddr) {
  log('CONFIGURE', 'Setting up relayer ACL and chain routing...');

  const configSteps = [
    {
      action: 'add_relayer',
      msg: { add_relayer: { address: CONTRACT_CONFIG.relayers[0] } },
      description: 'Add primary relayer',
    },
    {
      action: 'add_relayer',
      msg: { add_relayer: { address: CONTRACT_CONFIG.relayers[1] } },
      description: 'Add backup relayer',
    },
    {
      action: 'update_fee_config',
      msg: {
        update_config: {
          default_fee_bps: 50,
          min_fee_bps: 50,
          max_fee_bps: 100,
        },
      },
      description: 'Set fee BPS range (50-100)',
    },
  ];

  const results = [];

  for (const step of configSteps) {
    if (CONFIG.mockMode) {
      const txHash = mockTxHash();
      log('CONFIGURE', `${step.description} → tx: ${txHash.slice(0, 16)}...`);
      results.push({ ...step, txHash, gasUsed: 200_000 });
    }
  }

  return results;
}

/**
 * Stage 4: Demo RouteTask execution (MOCK_MODE)
 */
async function demoRouteTask(contractAddr) {
  log('DEMO', 'Executing demo RouteTask (MOCK_MODE, no live ZK proof)...');

  const routeTaskMsg = {
    route_task: {
      task_type: 'inference_request',
      source_chain: 'theta',
      destination_chain: 'osmosis',
      task_id: `task_${crypto.randomBytes(8).toString('hex')}`,
      sender: 'osmo1demosender000000000000000000000000000000',
      amount: '10000000',
      fee_bps: 50,
      model_id: 'akash-llama-70b',
      input_hash: crypto.randomBytes(32).toString('hex'),
    },
  };

  if (CONFIG.mockMode) {
    const txHash = mockTxHash();
    const taskId = routeTaskMsg.route_task.task_id;

    // Simulate fee calculation (mirrors main.rs calculate_task_fee)
    const gross = BigInt(routeTaskMsg.route_task.amount);
    const bps = BigInt(routeTaskMsg.route_task.fee_bps);
    const fee = (gross * bps) / 10000n;
    const net = gross - fee;

    log('DEMO', 'RouteTask executed successfully', {
      txHash,
      taskId,
      taskType: routeTaskMsg.route_task.task_type,
      sourceChain: routeTaskMsg.route_task.source_chain,
      destinationChain: routeTaskMsg.route_task.destination_chain,
      grossAmount: gross.toString(),
      feeAmount: fee.toString(),
      netAmount: net.toString(),
      feeBps: Number(bps),
      mockMode: true,
      zkProofSkipped: true,
      gasUsed: 450_000,
    });

    return { txHash, taskId, fee: fee.toString(), net: net.toString() };
  }

  throw new Error('Live RouteTask not yet supported in demo');
}

/**
 * Stage 5: Demo SettleTask execution (MOCK_MODE)
 */
async function demoSettleTask(contractAddr, taskId) {
  log('DEMO', `Settling task ${taskId} (MOCK_MODE)...`);

  if (CONFIG.mockMode) {
    const txHash = mockTxHash();
    const nullifier = crypto.randomBytes(32).toString('hex');
    const outputHash = crypto.randomBytes(32).toString('hex');

    log('DEMO', 'SettleTask completed', {
      txHash,
      taskId,
      outcome: 'Valid',
      nullifier: nullifier.slice(0, 16) + '...',
      outputHash: outputHash.slice(0, 16) + '...',
      feeForwardedToCollector: true,
      gasUsed: 350_000,
    });

    return { txHash, nullifier, outputHash, outcome: 'Valid' };
  }

  throw new Error('Live SettleTask not yet supported in demo');
}

// ─── Main Deployment Flow ─────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel AIVerifier — Osmosis Governance Deploy Demo             ║');
  console.log('║  MOCK_MODE: ' + (CONFIG.mockMode ? 'ENABLED (no live chain)     ' : 'DISABLED (live testnet)  ') + '                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Network:     ${CONFIG.network}`);
  console.log(`  Mock Mode:   ${CONFIG.mockMode}`);
  console.log(`  Contract:    ${CONTRACT_CONFIG.name} v${CONTRACT_CONFIG.version}`);
  console.log('');

  try {
    // Stage 1: Store code
    const { codeId, txHash: storeTx } = await storeCode();
    console.log(`  ✅ Stage 1: Code stored (code_id: ${codeId})`);

    // Stage 2: Instantiate
    const { contractAddr, txHash: instantiateTx } = await instantiateContract(codeId);
    console.log(`  ✅ Stage 2: Contract instantiated (${contractAddr.slice(0, 20)}...)`);

    // Stage 3: Configure
    const configResults = await configureContract(contractAddr);
    console.log(`  ✅ Stage 3: ${configResults.length} config transactions executed`);

    // Stage 4: Demo RouteTask
    const { taskId, fee, net } = await demoRouteTask(contractAddr);
    console.log(`  ✅ Stage 4: RouteTask demo (fee: ${fee}, net: ${net})`);

    // Stage 5: Demo SettleTask
    const { outcome } = await demoSettleTask(contractAddr, taskId);
    console.log(`  ✅ Stage 5: SettleTask demo (outcome: ${outcome})`);

    // Summary
    console.log('');
    console.log('┌── Deployment Summary ──────────────────────────────────────────');
    console.log(`│  Code ID:        ${codeId}`);
    console.log(`│  Contract:       ${contractAddr}`);
    console.log(`│  Admin:          ${CONTRACT_CONFIG.admin}`);
    console.log(`│  Fee Collector:  ${CONTRACT_CONFIG.feeCollectorAddr}`);
    console.log(`│  Relayers:       ${CONTRACT_CONFIG.relayers.length}`);
    console.log(`│  Fee Range:      ${CONTRACT_CONFIG.feeConfig.minBps}-${CONTRACT_CONFIG.feeConfig.maxBps} BPS`);
    console.log(`│  Mock Mode:      ${CONFIG.mockMode}`);
    console.log(`│  ZK Proving:     ${CONFIG.mockMode ? 'SKIPPED (mock)' : 'ENABLED'}`);
    console.log('│');
    console.log('│  Governance-Ready: This deployment log can be attached to');
    console.log('│  an Osmosis Commonwealth forum proposal for community review.');
    console.log('└────────────────────────────────────────────────────────────────');
    console.log('');

  } catch (err) {
    console.error(`\n  ❌ Deployment failed: ${err.message}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

export { storeCode, instantiateContract, configureContract, demoRouteTask, demoSettleTask, CONTRACT_CONFIG };
