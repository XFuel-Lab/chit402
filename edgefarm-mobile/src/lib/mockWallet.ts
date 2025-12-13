export type WalletInfo = {
  isConnected: boolean
  addressShort: string | null
  addressFull: string | null
  balanceTfuel: number
}

export function createDisconnectedWallet(): WalletInfo {
  return {
    isConnected: false,
    addressShort: null,
    addressFull: null,
    balanceTfuel: 1234.56,
  }
}

export async function connectThetaWalletMock(): Promise<WalletInfo> {
  // NOTE: Real mobile wallet integration (WalletConnect / deep links) would go here.
  // We include Theta packages in deps for future wiring.
  const full = '0x1234567890123456789012345678901234567890'
  return {
    isConnected: true,
    addressFull: full,
    addressShort: `${full.slice(0, 6)}...${full.slice(-4)}`,
    balanceTfuel: 1234.56,
  }
}
