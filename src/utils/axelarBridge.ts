// Axelar GMP (General Message Passing) bridge integration utilities

import { ethers } from 'ethers'
import { Token, AXELAR_GMP_ADDRESSES, AXELAR_CHAIN_NAMES } from '../config/tokenConfig'

// Axelar Gateway ABI (simplified for GMP)
export const AXELAR_GATEWAY_ABI = [
  'function callContract(string calldata destinationChain, string calldata contractAddress, bytes calldata payload) external',
  'function callContractWithToken(string calldata destinationChain, string calldata contractAddress, bytes calldata payload, string calldata symbol, uint256 amount) external',
  'function validateContractCall(bytes32 commandId, string calldata sourceChain, string calldata sourceAddress, bytes32 payloadHash) external returns (bool)',
  'event ContractCall(address indexed sender, string destinationChain, string destinationContractAddress, bytes32 indexed payloadHash, bytes payload)',
  'event ContractCallWithToken(address indexed sender, string destinationChain, string destinationContractAddress, bytes32 indexed payloadHash, bytes payload, string symbol, uint256 amount)',
]

// Axelar Gas Service ABI (for paying relayer gas)
export const AXELAR_GAS_SERVICE_ABI = [
  'function payNativeGasForContractCall(address sender, string calldata destinationChain, string calldata destinationAddress, bytes calldata payload, address refundAddress) external payable',
  'function payNativeGasForContractCallWithToken(address sender, string calldata destinationChain, string calldata destinationAddress, bytes calldata payload, string calldata symbol, uint256 amount, address refundAddress) external payable',
]

export interface BridgeRoute {
  sourceChain: string
  destinationChain: string
  sourceToken: Token
  destinationToken: Token
  steps: BridgeStep[]
  estimatedTime: number // seconds
  estimatedGas: string // in source chain native token
  bridgeFee: string // in USD
}

export interface BridgeStep {
  type: 'swap' | 'bridge' | 'stake' | 'unstake'
  description: string
  chain: string
  estimatedTime: number // seconds
}

/**
 * Calculate the best route for a cross-chain swap
 */
export function calculateBestRoute(
  fromToken: Token,
  toToken: Token,
  amount: number
): BridgeRoute {
  const steps: BridgeStep[] = []
  let estimatedTime = 0

  // Theta → Cosmos route
  if (fromToken.chain === 'theta' && toToken.chain === 'cosmos') {
    // Step 1: Swap TFUEL/USDC to bridgeable asset if needed
    if (fromToken.symbol !== 'USDC') {
      steps.push({
        type: 'swap',
        description: `Swap ${fromToken.symbol} to USDC on Theta`,
        chain: 'theta',
        estimatedTime: 5,
      })
      estimatedTime += 5
    }

    // Step 2: Bridge via Axelar
    steps.push({
      type: 'bridge',
      description: `Bridge USDC from Theta to ${toToken.chainId} via Axelar`,
      chain: 'axelar',
      estimatedTime: 60, // ~1 minute for Axelar
    })
    estimatedTime += 60

    // Step 3: Stake to LST on destination chain
    steps.push({
      type: 'stake',
      description: `Stake to ${toToken.symbol} on ${toToken.chainId}`,
      chain: toToken.chainId,
      estimatedTime: 10,
    })
    estimatedTime += 10
  }
  
  // Cosmos → Theta route
  else if (fromToken.chain === 'cosmos' && toToken.chain === 'theta') {
    // Step 1: Unstake LST to underlying asset
    if (fromToken.isLST) {
      steps.push({
        type: 'unstake',
        description: `Unstake ${fromToken.symbol} to ${fromToken.underlyingAsset}`,
        chain: fromToken.chainId,
        estimatedTime: 15, // Unstaking can take longer
      })
      estimatedTime += 15
    }

    // Step 2: Bridge via Axelar to Theta
    steps.push({
      type: 'bridge',
      description: `Bridge from ${fromToken.chainId} to Theta via Axelar`,
      chain: 'axelar',
      estimatedTime: 60,
    })
    estimatedTime += 60

    // Step 3: Swap to TFUEL/USDC on Theta if needed
    if (toToken.symbol !== 'USDC') {
      steps.push({
        type: 'swap',
        description: `Swap USDC to ${toToken.symbol} on Theta`,
        chain: 'theta',
        estimatedTime: 5,
      })
      estimatedTime += 5
    }
  }

  return {
    sourceChain: fromToken.chain,
    destinationChain: toToken.chain,
    sourceToken: fromToken,
    destinationToken: toToken,
    steps,
    estimatedTime,
    estimatedGas: '0.1', // TODO: Calculate actual gas estimate
    bridgeFee: '2.00', // TODO: Calculate actual bridge fee from Axelar
  }
}

/**
 * Estimate bridge fees for Axelar GMP
 */
export async function estimateBridgeFee(
  sourceChain: string,
  destinationChain: string,
  payload: string
): Promise<{ gasEstimate: string; bridgeFee: string }> {
  try {
    // TODO: Query Axelar Gas Service API for accurate estimates
    // For now, return conservative estimates
    
    const baseGasFee = 0.05 // Base gas in source chain native token
    const bridgeFee = 1.5 // Base bridge fee in USD
    
    return {
      gasEstimate: baseGasFee.toString(),
      bridgeFee: bridgeFee.toString(),
    }
  } catch (error) {
    console.error('Error estimating bridge fee:', error)
    return {
      gasEstimate: '0.1',
      bridgeFee: '2.0',
    }
  }
}

/**
 * Execute Theta → Cosmos bridge via Axelar GMP
 */
export async function bridgeThetaToCosmos(
  provider: ethers.BrowserProvider,
  amount: string,
  destinationChain: string,
  destinationAddress: string,
  destinationToken: Token
): Promise<string> {
  try {
    const signer = await provider.getSigner()
    const gatewayAddress = AXELAR_GMP_ADDRESSES.theta

    if (!gatewayAddress) {
      throw new Error('Axelar gateway address not configured for Theta')
    }

    const gateway = new ethers.Contract(
      gatewayAddress,
      AXELAR_GATEWAY_ABI,
      signer
    )

    // Encode payload for staking on destination
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'string', 'uint256'],
      [destinationAddress, destinationToken.symbol, ethers.parseUnits(amount, destinationToken.decimals)]
    )

    // Get Axelar chain name
    const axelarDestChain = AXELAR_CHAIN_NAMES[destinationChain] || destinationChain

    // Call Axelar GMP with token transfer
    const tx = await gateway.callContractWithToken(
      axelarDestChain,
      destinationAddress, // Destination contract that will stake
      payload,
      'USDC', // Bridge token symbol
      ethers.parseUnits(amount, 6), // USDC has 6 decimals
      {
        value: ethers.parseEther('0.05'), // Gas payment for relayer
      }
    )

    await tx.wait()
    return tx.hash
  } catch (error) {
    console.error('Theta → Cosmos bridge error:', error)
    throw error
  }
}

/**
 * Execute Cosmos → Theta bridge via Axelar GMP
 */
export async function bridgeCosmosToTheta(
  chainId: string,
  amount: string,
  destinationAddress: string,
  sourceToken: Token
): Promise<string> {
  try {
    // Use Keplr to sign and broadcast Cosmos transaction
    if (!window.keplr) {
      throw new Error('Keplr wallet not installed')
    }

    const offlineSigner = window.getOfflineSigner(chainId)
    const accounts = await offlineSigner.getAccounts()
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No Keplr accounts found')
    }

    const sourceAddress = accounts[0].address

    // Build IBC transfer message to Axelar
    const ibcTransferMsg = {
      typeUrl: '/ibc.applications.transfer.v1.MsgTransfer',
      value: {
        sourcePort: 'transfer',
        sourceChannel: 'channel-0', // TODO: Get correct channel for Axelar
        token: {
          denom: sourceToken.ibcDenom || sourceToken.symbol.toLowerCase(),
          amount: ethers.parseUnits(amount, sourceToken.decimals).toString(),
        },
        sender: sourceAddress,
        receiver: destinationAddress,
        timeoutTimestamp: (Date.now() + 600000) * 1000000, // 10 minutes
        memo: JSON.stringify({
          destinationChain: 'theta',
          destinationAddress,
          type: 'gmp',
        }),
      },
    }

    // Estimate fee
    const fee = {
      amount: [{ denom: sourceToken.ibcDenom || 'uatom', amount: '5000' }],
      gas: '200000',
    }

    // Sign and broadcast
    const result = await window.keplr.signAndBroadcast(
      chainId,
      sourceAddress,
      [ibcTransferMsg],
      fee,
      'Bridge via Axelar to Theta'
    )

    return result.transactionHash
  } catch (error) {
    console.error('Cosmos → Theta bridge error:', error)
    throw error
  }
}

/**
 * Get bridge transaction status
 */
export async function getBridgeStatus(txHash: string, sourceChain: string): Promise<{
  status: 'pending' | 'confirmed' | 'executed' | 'failed'
  confirmations: number
  estimatedCompletion?: number
}> {
  try {
    // TODO: Query Axelar API for transaction status
    // https://api.axelarscan.io/v2/cross-chain/tx/{txHash}
    
    return {
      status: 'pending',
      confirmations: 0,
      estimatedCompletion: Date.now() + 60000, // 1 minute estimate
    }
  } catch (error) {
    console.error('Error fetching bridge status:', error)
    return {
      status: 'pending',
      confirmations: 0,
    }
  }
}

