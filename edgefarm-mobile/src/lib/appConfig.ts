import Constants from 'expo-constants'

type Extra = {
  lotteryJackpot?: string
  globalLotteryCutBps?: number
  routerAddress?: string
  apiUrl?: string
}

export function getAppExtra(): Required<Pick<Extra, 'lotteryJackpot' | 'globalLotteryCutBps'>> & Extra {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra

  return {
    lotteryJackpot: extra.lotteryJackpot ?? '$50k',
    globalLotteryCutBps: typeof extra.globalLotteryCutBps === 'number' ? extra.globalLotteryCutBps : 1000,
    routerAddress: extra.routerAddress,
    apiUrl: extra.apiUrl || 'http://localhost:3001',
  }
}

export const API_URL = getAppExtra().apiUrl || 'http://localhost:3001'
