import React from 'react'
import { Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'
import { NeonButton } from '../components/NeonButton'
import * as Haptics from 'expo-haptics'

export function ProfileScreen() {
  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <View className="p-5">
          <View className="flex-row items-center justify-between">
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Profile</Text>
            <NeonPill label="EdgeFarm ID" tone="purple" />
          </View>
          <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.55)' }}>
            Wallet · preferences · streak · referrals
          </Text>

          <NeonCard className="mt-5">
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Your stats</Text>

            <View className="mt-4 flex-row gap-3">
              <View className="flex-1 rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(56,189,248,0.18)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>Streak</Text>
                <Text style={{ ...type.h1, marginTop: 8, color: 'rgba(255,255,255,0.96)' }}>12</Text>
                <Text style={{ ...type.caption, marginTop: -2, color: 'rgba(255,255,255,0.50)' }}>days</Text>
              </View>
              <View className="flex-1 rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(168,85,247,0.18)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>Rank</Text>
                <Text style={{ ...type.h1, marginTop: 8, color: 'rgba(255,255,255,0.96)' }}>#184</Text>
                <Text style={{ ...type.caption, marginTop: -2, color: 'rgba(255,255,255,0.50)' }}>weekly</Text>
              </View>
            </View>

            <View className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(251,113,133,0.18)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.92)' }}>Referral link</Text>
              <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.55)' }}>
                Coming next: share-to-earn boosts + lottery multipliers.
              </Text>
            </View>

            <View className="mt-4 flex-row items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'rgba(168,85,247,0.22)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <Text className="text-sm text-white">Notifications</Text>
              <Text style={{ ...type.bodyM, color: neon.blue }}>
                Enabled
              </Text>
            </View>

            <View className="mt-3 flex-row items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'rgba(168,85,247,0.22)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <Text className="text-sm text-white">Battery-safe farming</Text>
              <Text style={{ ...type.bodyM, color: neon.green }}>
                On
              </Text>
            </View>

            <View style={{ marginTop: 16 }}>
              <NeonButton
                label="Share streak (coming soon)"
                variant="secondary"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {})
                }}
              />
            </View>
          </NeonCard>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  )
}
