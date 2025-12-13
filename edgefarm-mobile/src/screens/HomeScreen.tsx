import React, { useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'

const YIELDS = ['stkXPRT', 'stkATOM', 'pSTAKE BTC'] as const

export function HomeScreen() {
  const [yieldIdx, setYieldIdx] = useState(1)

  const selectedYield = YIELDS[yieldIdx] ?? 'stkATOM'

  const apyText = useMemo(() => {
    // Mock blended APY by selection
    const apys: Record<string, number> = { stkXPRT: 39.6, stkATOM: 42.8, 'pSTAKE BTC': 27.4 }
    const v = apys[selectedYield] ?? 42.8
    return `${v.toFixed(1)}% Blended APY`
  }, [selectedYield])

  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
          <View className="mb-4 flex-row items-center justify-between">
            <View>
              <Text className="text-xs uppercase tracking-widest" style={{ color: neon.muted }}>
                EdgeFarm
              </Text>
              <Text className="text-2xl font-bold text-white">Home Dashboard</Text>
            </View>
            <View className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(52, 211, 153, 0.35)', backgroundColor: 'rgba(52, 211, 153, 0.10)' }}>
              <Text className="text-xs font-semibold" style={{ color: neon.green }}>
                Carbon+ badge
              </Text>
            </View>
          </View>

          <NeonCard className="mb-4">
            <Text className="text-xs uppercase tracking-widest" style={{ color: neon.muted }}>
              Live yield
            </Text>
            <Text className="mt-2 text-4xl font-extrabold text-white">{apyText}</Text>

            <View className="mt-4 flex-row items-center justify-between">
              <View className="rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(56, 189, 248, 0.28)', backgroundColor: 'rgba(56, 189, 248, 0.08)' }}>
                <Text className="text-xs font-semibold" style={{ color: neon.blue }}>
                  Running while charging
                </Text>
              </View>
              <View className="rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(168, 85, 247, 0.28)', backgroundColor: 'rgba(168, 85, 247, 0.08)' }}>
                <Text className="text-xs font-semibold" style={{ color: neon.purple }}>
                  Battery-safe mode
                </Text>
              </View>
            </View>
          </NeonCard>

          <NeonCard className="mb-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-semibold text-white">Yield selector</Text>
              <View className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(168, 85, 247, 0.30)' }}>
                <Text className="text-xs font-semibold" style={{ color: neon.purple }}>
                  {selectedYield}
                </Text>
              </View>
            </View>

            <View className="mt-4">
              <Slider
                value={yieldIdx}
                minimumValue={0}
                maximumValue={YIELDS.length - 1}
                step={1}
                minimumTrackTintColor={neon.purple}
                maximumTrackTintColor={'rgba(255,255,255,0.15)'}
                thumbTintColor={neon.blue}
                onValueChange={(v) => setYieldIdx(Math.round(v))}
              />

              <View className="mt-3 flex-row justify-between">
                {YIELDS.map((y) => (
                  <Text key={y} className="text-xs" style={{ color: y === selectedYield ? neon.blue : neon.muted }}>
                    {y}
                  </Text>
                ))}
              </View>
            </View>
          </NeonCard>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <NeonCard>
                <Text className="text-xs uppercase tracking-widest" style={{ color: neon.muted }}>
                  Streak
                </Text>
                <Text className="mt-2 text-2xl font-bold text-white">12 days</Text>
                <Text className="mt-1 text-xs" style={{ color: neon.muted }}>
                  Keep farming to boost rank
                </Text>
              </NeonCard>
            </View>
            <View className="flex-1">
              <NeonCard>
                <Text className="text-xs uppercase tracking-widest" style={{ color: neon.muted }}>
                  Leaderboard
                </Text>
                <Text className="mt-2 text-2xl font-bold text-white">#184</Text>
                <Text className="mt-1 text-xs" style={{ color: neon.muted }}>
                  Top 3% this week
                </Text>
              </NeonCard>
            </View>
          </View>

          <NeonCard className="mt-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-semibold text-white">Carbon offset</Text>
              <View className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(52, 211, 153, 0.35)', backgroundColor: 'rgba(52, 211, 153, 0.10)' }}>
                <Text className="text-xs font-semibold" style={{ color: neon.green }}>
                  Net-positive
                </Text>
              </View>
            </View>
            <Text className="mt-2 text-sm" style={{ color: neon.muted }}>
              Your farming session auto-buys offsets using a tiny share of rewards.
            </Text>
          </NeonCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}
