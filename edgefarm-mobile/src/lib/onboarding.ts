import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'edgefarm.onboardingSeen.v1'

export async function getHasSeenOnboarding(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY)
    return v === '1'
  } catch {
    return false
  }
}

export async function setHasSeenOnboarding(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1')
  } catch {
    // ignore
  }
}
