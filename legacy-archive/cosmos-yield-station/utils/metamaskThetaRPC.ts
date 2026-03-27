/**
 * MetaMask Theta Network RPC Auto-Switch
 * 
 * Adds Theta Network to MetaMask and switches to it if not already connected.
 * First-principles bypass: 70% of users have MetaMask, works instantly.
 */

import { THETA_MAINNET } from '../config/thetaConfig'

export async function switchToThetaNetwork(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const ethereum = (window as any).ethereum
    
    if (!ethereum || !ethereum.isMetaMask) {
      return {
        success: false,
        error: 'MetaMask not installed',
      }
    }

    const chainIdHex = `0x${THETA_MAINNET.chainId.toString(16)}` // 0x169 for mainnet (361)

    try {
      // Try to switch to Theta Network
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      })

      return { success: true }
    } catch (switchError: any) {
      // Error code 4902: chain not added to MetaMask yet
      if (switchError.code === 4902) {
        try {
          // Add Theta Network to MetaMask
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: chainIdHex,
                chainName: 'Theta Mainnet',
                nativeCurrency: {
                  name: 'TFUEL',
                  symbol: 'TFUEL',
                  decimals: 18,
                },
                rpcUrls: [THETA_MAINNET.rpcUrl],
                blockExplorerUrls: [THETA_MAINNET.explorerUrl],
              },
            ],
          })

          return { success: true }
        } catch (addError: any) {
          console.error('Error adding Theta Network to MetaMask:', addError)
          return {
            success: false,
            error: addError.message || 'Failed to add Theta Network',
          }
        }
      }

      console.error('Error switching to Theta Network:', switchError)
      return {
        success: false,
        error: switchError.message || 'Failed to switch network',
      }
    }
  } catch (error: any) {
    console.error('MetaMask Theta RPC error:', error)
    return {
      success: false,
      error: error.message || 'Unknown error',
    }
  }
}

/**
 * Check if MetaMask is currently connected to Theta Network
 */
export async function isConnectedToTheta(): Promise<boolean> {
  try {
    const ethereum = (window as any).ethereum
    
    if (!ethereum || !ethereum.isMetaMask) {
      return false
    }

    const chainId = await ethereum.request({ method: 'eth_chainId' })
    const chainIdDecimal = parseInt(chainId, 16)
    
    return chainIdDecimal === THETA_MAINNET.chainId
  } catch (error) {
    console.error('Error checking Theta network:', error)
    return false
  }
}

