require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

require('@nomicfoundation/hardhat-toolbox')
require('@nomicfoundation/hardhat-ethers')
require('@openzeppelin/hardhat-upgrades')

// hardhat-tracer: enables `npx hardhat test --trace` for ZK proof debugging
// Install: npm install --save-dev hardhat-tracer
try { require('hardhat-tracer') } catch (_) { /* optional — install when needed */ }

// ============================================================
// HARDHAT 3 MIGRATION TRACKING
// Blocked by two upstream issues (as of 2026-03-08):
//   1. @openzeppelin/hardhat-upgrades has no HH3 support yet.
//      Track: https://github.com/OpenZeppelin/openzeppelin-upgrades/issues/1191
//   2. hardhat-gas-reporter has no HH3 release yet.
//      Track: https://github.com/NomicFoundation/hardhat/discussions/5626
// Additional migration requirements when unblocked:
//   - Node.js 22.10+ (current engines: >=20.0.0 in package.json)
//   - Config rewrite: CJS → ESM defineConfig()
//   - ~60 test files: hre.network.connect() pattern
//   - extendEnvironment removed — replace Theta RPC patch below with HH3 hooks
//   - solidity-coverage replaced by built-in --coverage flag
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
