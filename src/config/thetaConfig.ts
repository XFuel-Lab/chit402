// Theta testnet configuration
export const THETA_TESTNET = {
  chainId: 365,
  chainIdHex: '0x16d',
  name: 'Theta Testnet',
  rpcUrl: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
  explorerUrl: 'https://testnet-explorer.thetatoken.org',
  currencySymbol: 'TFUEL',
  faucetUrl: 'https://faucet.testnet.theta.org/request',
}

// Theta mainnet configuration
export const THETA_MAINNET = {
  chainId: 361,
  chainIdHex: '0x169',
  name: 'Theta Mainnet',
  rpcUrl: 'https://eth-rpc-api.thetatoken.org/rpc',
  explorerUrl: 'https://explorer.thetatoken.org',
  currencySymbol: 'TFUEL',
}

// Router contract address - loaded from VITE_ROUTER_ADDRESS environment variable
// This MUST be set for production deployment
export const ROUTER_ADDRESS = import.meta.env.VITE_ROUTER_ADDRESS || ''

// Log router configuration for debugging (production-safe)
if (typeof window !== 'undefined') {
  console.log('🔧 [XFUEL Config] Router address loaded:', ROUTER_ADDRESS || '(not configured)')
  console.log('🔧 [XFUEL Config] Mode:', ROUTER_ADDRESS ? 'REAL' : 'NO ROUTER')
  console.log('🔧 [XFUEL Config] Expected mainnet router: 0x6256D8A728aA102Aa06B6B239ba1247Bd835d816')
  
  // Validate router address format and network
  if (ROUTER_ADDRESS) {
    const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(ROUTER_ADDRESS)
    const isMockAddress = ROUTER_ADDRESS === '0x0000000000000000000000000000000000000001'
    
    if (!isValidAddress) {
      console.error('❌ [XFUEL Config] Invalid router address format!')
    } else if (isMockAddress) {
      console.error('❌ [XFUEL Config] Mock router address detected in production!')
    } else if (ROUTER_ADDRESS === '0x6256D8A728aA102Aa06B6B239ba1247Bd835d816') {
      console.log('✅ [XFUEL Config] Mainnet router correctly configured')
    } else {
      console.warn('⚠️  [XFUEL Config] Router address does not match expected mainnet address')
    }
  }
}

// Tip Pool contract address - will be updated when deployed
export const TIP_POOL_ADDRESS = import.meta.env.VITE_TIP_POOL_ADDRESS || ''

// ERC20 ABI for token approvals
export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
]

// Router ABI - swapAndStake accepts native TFUEL via msg.value
export const ROUTER_ABI = [
  'function swapAndStake(uint256 amount, string calldata targetLST, uint256 minAmountOut) external payable returns (uint256)',
  'function getEffectiveFee() external view returns (uint256)',
  'event SwapAndStake(address indexed user, uint256 tfuelAmount, uint256 stakedAmount, string stakeTarget)',
]

// Tip Pool ABI (for lottery functionality)
export const TIP_POOL_ABI = [
  'function createPool(uint256 duration, address creator) external payable',
  'function tipPool(uint256 poolId) external payable',
  'function endPool(uint256 poolId) external',
  'function drawWinner(uint256 poolId) external returns (address)',
  'function getPoolInfo(uint256 poolId) external view returns (address creator, uint256 totalTips, uint256 startTime, uint256 endTime, address winner, bool ended)',
  'event PoolCreated(uint256 indexed poolId, address indexed creator, uint256 duration)',
  'event TipAdded(uint256 indexed poolId, address indexed tipper, uint256 amount)',
  'event PoolEnded(uint256 indexed poolId, address indexed winner, uint256 prizeAmount, uint256 creatorCut)',
]

// Axelar Gateway ABI for GMP cross-chain calls
export const AXELAR_GATEWAY_ABI = [
  'function callContract(string calldata destinationChain, string calldata contractAddress, bytes calldata payload) external',
  'function callContractWithToken(string calldata destinationChain, string calldata contractAddress, bytes calldata payload, string calldata symbol, uint256 amount) external',
  'event ContractCall(address indexed sender, string destinationChain, string destinationContractAddress, bytes32 indexed payloadHash, bytes payload)',
  'event ContractCallWithToken(address indexed sender, string destinationChain, string destinationContractAddress, bytes32 indexed payloadHash, bytes payload, string symbol, uint256 amount)',
]

// Axelar Gas Service ABI for paying relayer fees
export const AXELAR_GAS_SERVICE_ABI = [
  'function payNativeGasForContractCall(address sender, string calldata destinationChain, string calldata destinationAddress, bytes calldata payload, address refundAddress) external payable',
  'function payNativeGasForContractCallWithToken(address sender, string calldata destinationChain, string calldata destinationAddress, bytes calldata payload, string calldata symbol, uint256 amount, address refundAddress) external payable',
]