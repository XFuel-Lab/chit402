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
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      {
        version: '0.8.20',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: 1337,
      // Optional: Fork Theta mainnet for hybrid flow simulation
      // Uncomment the forking block below to enable forking
      // forking: {
      //   url: 'https://eth-rpc-api.thetatoken.org/rpc',
      //   enabled: true,
      // },
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
  mocha: {
    timeout: 40000,
  },
}
