require('@nomicfoundation/hardhat-toolbox')
require('@nomicfoundation/hardhat-ethers')
require('@openzeppelin/hardhat-upgrades')
require('solidity-coverage')

// Load .env.local first (for secrets), then .env (for public config)
require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.22',
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
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
      // Use ledgerAccounts for hardware wallet support or
      // accounts will be set programmatically in deployment scripts via keystore
    },
    'theta-mainnet': {
      url: 'https://eth-rpc-api.thetatoken.org/rpc',
      chainId: 361,
      // Accounts set programmatically in deployment scripts via keystore
      gasPrice: 4000000000000, // 4000 Gwei (minimum required by Theta mainnet)
      timeout: 120000,
      httpHeaders: {},
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  // Include core-layer and circuit contracts in compilation.
  // Hardhat will discover Solidity files in these paths for overrides.
  // Run: npx hardhat compile
  // Tests (Priority):
  //   npx hardhat test circuits/tao-evm/test/TAOCircuit.test.cjs
  //   npx hardhat test circuits/a2a/test/A2ACircuit.test.cjs
  //   npx hardhat test circuits/theta-gpu/test/ThetaGPUCircuit.test.cjs
  // Tests (Expansion):
  //   npx hardhat test circuits/zkml/test/ZKMLCircuit.test.cjs
  //   npx hardhat test circuits/akash/test/AkashCircuit.test.cjs
  //   npx hardhat test circuits/autonomous-vaults/test/AutonomousVaults.test.cjs
  //   npx hardhat test circuits/agent-robotics/test/AgentRobotics.test.cjs
  // Tests (Integration):
  //   npx hardhat test test/integration/MultiCircuit.integration.test.cjs
  overrides: {
    'core-layer/contracts/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    'circuits/tao-evm/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    'circuits/a2a/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    'circuits/theta-gpu/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    'circuits/zkml/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    'circuits/akash/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    'circuits/autonomous-vaults/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    'circuits/agent-robotics/**': {
      version: '0.8.22',
      settings: {
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
  },
  mocha: {
    timeout: 40000,
  },
}
