import Constants from 'expo-constants'

type Extra = {
  routerAddress?: string
  apiUrl?: string
  thetaMainnetRpc?: string
  thetaMainnetChainId?: number
  thetaExplorerUrl?: string
}

export function getAppExtra(): Extra {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra

  return {
    routerAddress: extra.routerAddress,
    apiUrl: extra.apiUrl || 'https://api.xfuel.app',
    thetaMainnetRpc: extra.thetaMainnetRpc || 'https://eth-rpc-api.thetatoken.org/rpc',
    thetaMainnetChainId: extra.thetaMainnetChainId || 361,
    thetaExplorerUrl: extra.thetaExplorerUrl || 'https://explorer.thetatoken.org',
  }
}

export const API_URL = getAppExtra().apiUrl || 'https://api.xfuel.app'
export const THETA_MAINNET_RPC = getAppExtra().thetaMainnetRpc || 'https://eth-rpc-api.thetatoken.org/rpc'
export const THETA_MAINNET_CHAIN_ID = getAppExtra().thetaMainnetChainId || 361
export const THETA_EXPLORER_URL = getAppExtra().thetaExplorerUrl || 'https://explorer.thetatoken.org'
