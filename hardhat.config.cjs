require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

require('@nomicfoundation/hardhat-toolbox')
require('@nomicfoundation/hardhat-ethers')
require('@openzeppelin/hardhat-upgrades')

// Exclude test/_archive from bare `npx hardhat test` discovery (CI uses hardhat-test-*.cjs).
const { subtask } = require('hardhat/config')
const { TASK_TEST_GET_TEST_FILES } = require('hardhat/builtin-tasks/task-names')
subtask(TASK_TEST_GET_TEST_FILES).setAction(async (args, hre, runSuper) => {
  const files = await runSuper(args)
  return files.filter((f) => !f.replace(/\\/g, '/').includes('/_archive/'))
})

// hardhat-tracer: enables `npx hardhat test --trace` for ZK proof debugging
// Install: npm install --save-dev hardhat-tracer
try { require('hardhat-tracer') } catch (_) { /* optional — install when needed */ }

// ============================================================
// HARDHAT 3 MIGRATION TRACKING
// Re-checked 2026-08-10. One of the two original blockers has lifted:
//   1. RESOLVED — @openzeppelin/hardhat-upgrades v4 supports HH3. It also
//      *requires* it: v4 imports hardhat/types/hre, so it cannot be taken
//      before the migration. Pinned to ^3.9.1 until then (dependabot #74).
//   2. STILL BLOCKED — hardhat-gas-reporter's latest (2.3.0) declares
//      peerDependencies { hardhat: ^2.16.0 }; no HH3 release exists.
//      Track: https://github.com/NomicFoundation/hardhat/discussions/5626
// Additional migration requirements when unblocked:
//   - Node.js 22.10+ (current engines: >=20.0.0 in package.json)
//   - Config rewrite: CJS → ESM defineConfig()
//   - ~60 test files: hre.network.connect() pattern
//   - extendEnvironment removed — replace Theta RPC patch below with HH3 hooks
//   - solidity-coverage replaced by built-in --coverage flag
//   - chai 6 is ESM-only and 69 .cjs test files require('chai'), so chai
//     stays on 4.x until the same CJS → ESM pass (dependabot #59).
//
// OpenZeppelin is on 5.6.x (dependabot #74). This was previously pinned to
// ~5.4.0 because 8 unreferenced contracts under contracts/legacy/ imported
// ReentrancyGuardUpgradeable, which 5.6 removes. Those contracts were deleted
// rather than rewritten, so the constraint no longer exists.
// ============================================================

// Theta RPC compatibility: strip the block tag from eth_estimateGas calls.
// Theta's RPC only accepts 1 argument but ethers v6 sends [tx, "latest"].
// NOTE: This uses extendEnvironment which is removed in Hardhat 3 — needs hooks replacement.
// Intercepts both hre.network.provider.request AND hre.network.provider.send
// because @nomicfoundation/hardhat-ethers@3 uses the .send() path directly.
const { extendEnvironment } = require('hardhat/config')
extendEnvironment((hre) => {
  const origRequest = hre.network.provider.request.bind(hre.network.provider)
  hre.network.provider.request = async (args) => {
    if (args.method === 'eth_estimateGas' && args.params && args.params.length > 1) {
      return origRequest({ method: args.method, params: [args.params[0]] })
    }
    return origRequest(args)
  }

  const origSend = hre.network.provider.send.bind(hre.network.provider)
  hre.network.provider.send = async (method, params) => {
    if (method === 'eth_estimateGas' && params && params.length > 1) {
      return origSend(method, [params[0]])
    }
    return origSend(method, params)
  }
})

const pk = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
if (pk) {
  console.log(`PRIVATE_KEY loaded: ${pk.slice(0, 6)}...`)
}

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.24',
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.8.22',
        settings: {
          // Always on: core contracts (e.g. ZKVerifierZkGPT) hit "stack too deep" without IR.
          // HARDHAT_FAST no longer disables this — compile cost is acceptable for CI/local.
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      // 0.8.20 retained for legacy and non-audit circuit contracts
      {
        version: '0.8.20',
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    'theta-testnet': {
      url: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
      chainId: 365,
      accounts: pk ? [pk] : [],
      gas: 8000000,
      gasPrice: 4000000000000,
      timeout: 120000,
    },
    'theta-mainnet': {
      url: 'https://eth-rpc-api.thetatoken.org/rpc',
      chainId: 361,
      accounts: pk ? [pk] : [],
      gas: 8000000,
      gasPrice: 4000000000000,
      timeout: 120000,
    },
    'bittensor-testnet': {
      url: process.env.BITTENSOR_TESTNET_RPC || 'https://test.chain.opentensor.ai',
      chainId: 945,
      timeout: 120000,
    },
    'bittensor-evm': {
      url: process.env.BITTENSOR_RPC || 'https://lite.chain.opentensor.ai',
      chainId: 964,
      timeout: 120000,
    },
    // Base — money + proof home (ADR 0002)
    'base-sepolia': {
      url: process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL || 'https://sepolia.base.org',
      chainId: 84532,
      accounts: pk ? [pk] : [],
      timeout: 120000,
    },
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      chainId: 8453,
      accounts: pk ? [pk] : [],
      timeout: 120000,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
  mocha: {
    timeout: 40000,
  },
}
