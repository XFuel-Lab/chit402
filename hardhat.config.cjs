require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

require('@nomicfoundation/hardhat-toolbox')
require('@nomicfoundation/hardhat-ethers')
require('@openzeppelin/hardhat-upgrades')

// Theta RPC compatibility: strip the block tag from eth_estimateGas calls.
// Theta's RPC only accepts 1 argument but ethers v6 sends [tx, "latest"].
const { extendEnvironment } = require('hardhat/config')
extendEnvironment((hre) => {
  const orig = hre.network.provider.request.bind(hre.network.provider)
  hre.network.provider.request = async (args) => {
    if (args.method === 'eth_estimateGas' && args.params && args.params.length > 1) {
      return orig({ method: args.method, params: [args.params[0]] })
    }
    return orig(args)
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
        version: '0.8.22',
        settings: {
          viaIR: !process.env.HARDHAT_FAST,
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
          viaIR: !process.env.HARDHAT_FAST,
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
