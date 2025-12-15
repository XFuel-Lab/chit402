import React from 'react'
import { Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
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

          <View className="mt-5 flex-row items-center gap-4">
            <LinearGradient
              colors={['rgba(56,189,248,0.3)', 'rgba(168,85,247,0.8)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 82,
                height: 82,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 3,
              }}
            >
              <View
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(15,23,42,0.92)',
                  borderWidth: 2,
                  borderColor: 'rgba(148,163,184,0.45)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Lv</Text>
                <Text style={{ ...type.h1, color: 'rgba(248,250,252,0.98)' }}>24</Text>
              </View>
            </LinearGradient>

            <View style={{ flex: 1 }}>
              <Text style={{ ...type.h3, color: 'rgba(248,250,252,0.98)' }}>EdgeFarmer</Text>
              <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(148,163,184,0.95)' }}>
                Mining + tipping since gen-1 testnet. You&apos;re in the top 10% of streak grinders.
              </Text>
            </View>
          </View>

          <NeonCard className="mt-5">
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Your farming stats</Text>

            <View className="mt-4 flex-row gap-3">
              <View
                className="flex-1 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: 'rgba(56,189,248,0.18)',
                  backgroundColor: 'rgba(15,23,42,0.92)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Total farmed</Text>
                <Text style={{ ...type.h1, marginTop: 8, color: 'rgba(248,250,252,0.98)' }}>$12,480</Text>
                <Text style={{ ...type.caption, marginTop: -2, color: 'rgba(148,163,184,0.90)' }}>
                  across all LSTs
                </Text>
              </View>
              <View
                className="flex-1 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: 'rgba(168,85,247,0.18)',
                  backgroundColor: 'rgba(15,23,42,0.92)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Tips sent</Text>
                <Text style={{ ...type.h1, marginTop: 8, color: 'rgba(248,250,252,0.98)' }}>143</Text>
                <Text style={{ ...type.caption, marginTop: -2, color: 'rgba(148,163,184,0.90)' }}>
                  across 27 events
                </Text>
              </View>
            </View>

            <View className="mt-3 flex-row gap-3">
              <View
                className="flex-1 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: 'rgba(251,113,133,0.26)',
                  backgroundColor: 'rgba(15,23,42,0.92)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(248,113,113,0.95)' }}>Lottery entries</Text>
                <Text style={{ ...type.h1, marginTop: 8, color: neon.pink }}>32</Text>
                <Text style={{ ...type.caption, marginTop: -2, color: 'rgba(248,113,113,0.85)' }}>
                  3 wins · 1 mega pot
                </Text>
              </View>
            </View>

            <View className="mt-5">
              <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(148,163,184,0.95)' }}>
                Achievement badges
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <NeonPill label="Day-one farmer" tone="blue" />
                <NeonPill label="10x lottery entries" tone="pink" />
                <NeonPill label="High-roller" tone="purple" />
              </View>
            </View>

            <View className="mt-5 flex-row gap-3">
              <View className="flex-1">
                <NeonButton
                  label="Start farming"
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                  }}
                />
              </View>
              <View className="flex-1">
                <NeonButton
                  label="Create pool"
                  variant="secondary"
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                  }}
                />
              </View>
            </View>

            <View className="mt-3 flex-row gap-3">
              <View className="flex-1">
                <NeonButton
                  label="Invite friends"
                  variant="secondary"
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                  }}
                />
              </View>
              <View className="flex-1">
                <NeonButton
                  label="Share streak"
                  variant="secondary"
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                  }}
                />
              </View>
            </View>
          </NeonCard>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  )
}
