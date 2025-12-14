import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'

const YIELDS = ['stkXPRT', 'stkATOM', 'pSTAKE BTC'] as const

export function HomeScreen() {
  const [yieldIdx, setYieldIdx] = useState(1)
  const [tick, setTick] = useState(0)

  const pulse = useSharedValue(0)
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [pulse])

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const selectedYield = YIELDS[yieldIdx] ?? 'stkATOM'

  const apyText = useMemo(() => {
    // Mock blended APY by selection
    const apys: Record<string, number> = { stkXPRT: 39.6, stkATOM: 42.8, 'pSTAKE BTC': 27.4 }
    const v = apys[selectedYield] ?? 42.8
    const jitter = (Math.sin((tick % 3600) / 14) + 1) * 0.03
    return `${(v + jitter).toFixed(1)}%`
  }, [selectedYield, tick])

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.22 + pulse.value * 0.28,
    transform: [{ scale: 1 + pulse.value * 0.03 }],
  }))

  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 34 }}>
          <View className="mb-6 flex-row items-center justify-between">
            <View>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.60)' }}>
                EdgeFarm
              </Text>
              <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.96)' }}>Home Dashboard</Text>
            </View>
            <NeonPill label="Carbon+ badge" tone="green" />
          </View>

          <NeonCard className="mb-5">
            <View className="flex-row items-center justify-between">
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>LIVE APY</Text>
              <View className="flex-row items-center gap-2">
                <Animated.View
                  style={[
                    glowStyle,
                    {
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      backgroundColor: neon.blue,
                      shadowColor: neon.blue,
                      shadowOpacity: 1,
                      shadowRadius: 10,
                    },
                  ]}
                />
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>
                  {new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                </Text>
              </View>
            </View>

            <View style={{ marginTop: 12 }}>
              <Animated.View
                pointerEvents="none"
                style={[
                  glowStyle,
                  {
                    position: 'absolute',
                    left: -8,
                    right: -8,
                    top: 6,
                    height: 66,
                    borderRadius: 24,
                    backgroundColor: 'rgba(168,85,247,0.10)',
                    shadowColor: '#a855f7',
                    shadowOpacity: 1,
                    shadowRadius: 18,
                  },
                ]}
              />
              <Text style={{ ...type.h0, color: 'rgba(255,255,255,0.98)' }}>{apyText}</Text>
              <Text style={{ ...type.bodyM, marginTop: 2, color: 'rgba(255,255,255,0.70)' }}>
                Blended APY · {selectedYield}
              </Text>
            </View>

            <View className="mt-5 flex-row flex-wrap gap-2">
              <NeonPill label="Running while charging" tone="blue" />
              <NeonPill label="Battery-safe farming" tone="purple" />
              <NeonPill label="Auto-stake enabled" tone="pink" />
            </View>
          </NeonCard>

          <NeonCard className="mb-5">
            <View className="flex-row items-center justify-between">
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Yield selector</Text>
              <NeonPill label={selectedYield} tone="purple" />
            </View>

            <View className="mt-5">
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

              <View className="mt-4 flex-row justify-between">
                {YIELDS.map((y) => (
                  <Text
                    key={y}
                    style={{
                      ...type.caption,
                      color: y === selectedYield ? 'rgba(56,189,248,0.95)' : 'rgba(255,255,255,0.45)',
                    }}
                  >
                    {y}
                  </Text>
                ))}
              </View>
            </View>
          </NeonCard>

          <View className="flex-row gap-12">
            <View className="flex-1">
              <NeonCard>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>
                  Streak
                </Text>
                <Text style={{ ...type.h1, marginTop: 10, color: 'rgba(255,255,255,0.96)' }}>12</Text>
                <Text style={{ ...type.bodyM, marginTop: -2, color: 'rgba(255,255,255,0.72)' }}>days</Text>
                <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>
                  Keep farming to boost rank
                </Text>
              </NeonCard>
            </View>
            <View className="flex-1">
              <NeonCard>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>
                  Leaderboard
                </Text>
                <Text style={{ ...type.h1, marginTop: 10, color: 'rgba(255,255,255,0.96)' }}>#184</Text>
                <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>
                  Top 3% this week
                </Text>
              </NeonCard>
            </View>
          </View>

          <NeonCard className="mt-6">
            <View className="flex-row items-center justify-between">
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Carbon offset</Text>
              <NeonPill label="Net-positive" tone="green" />
            </View>
            <Text style={{ ...type.body, marginTop: 10, color: 'rgba(255,255,255,0.60)' }}>
              Your farming session auto-buys offsets using a tiny share of rewards.
            </Text>
          </NeonCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}
