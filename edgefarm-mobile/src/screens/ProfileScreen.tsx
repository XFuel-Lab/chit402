import React from 'react'
import { Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'

export function ProfileScreen() {
  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <View className="p-4">
          <Text className="text-2xl font-bold text-white">Profile</Text>
          <Text className="mt-1 text-sm" style={{ color: neon.muted }}>
            Wallet, preferences, and streak details
          </Text>

          <NeonCard className="mt-4">
            <Text className="text-base font-semibold text-white">EdgeFarm ID</Text>
            <Text className="mt-2 text-sm" style={{ color: neon.muted }}>
              Coming next: real Theta wallet connection + on-chain XP, streak proofs, and referrals.
            </Text>

            <View className="mt-4 flex-row items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'rgba(168,85,247,0.22)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <Text className="text-sm text-white">Notifications</Text>
              <Text className="text-sm font-semibold" style={{ color: neon.blue }}>
                Enabled
              </Text>
            </View>

            <View className="mt-3 flex-row items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'rgba(168,85,247,0.22)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <Text className="text-sm text-white">Battery-safe farming</Text>
              <Text className="text-sm font-semibold" style={{ color: neon.green }}>
                On
              </Text>
            </View>
          </NeonCard>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  )
}
