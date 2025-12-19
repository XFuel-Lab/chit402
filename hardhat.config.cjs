require('@nomicfoundation/hardhat-toolbox')
require('@nomicfoundation/hardhat-ethers')
require('@openzeppelin/hardhat-upgrades')
require('solidity-coverage')
require('dotenv').config()

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.22',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    'theta-testnet': {
      url: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
      chainId: 365,
      accounts: process.env.THETA_TESTNET_PRIVATE_KEY ? [process.env.THETA_TESTNET_PRIVATE_KEY] : [],
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
