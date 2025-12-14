import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'
import { NeonButton } from '../components/NeonButton'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'

type LST = {
  key: string
  name: string
  apy: number
  icon: keyof typeof Ionicons.glyphMap
}

const DEMO_TVL_USD = 5920

const LSTS: LST[] = [
  { key: 'stkTIA', name: 'stkTIA', apy: 38.2, icon: 'planet' },
  { key: 'stkXPRT', name: 'stkXPRT', apy: 25.4, icon: 'flash' },
  { key: 'pSTAKE BTC', name: 'pSTAKE BTC', apy: 21.1, icon: 'logo-bitcoin' },
  // More (mock) LSTs
  { key: 'stkATOM', name: 'stkATOM', apy: 18.6, icon: 'nuclear' },
  { key: 'stDYDX', name: 'stDYDX', apy: 16.4, icon: 'stats-chart' },
  { key: 'stkOSMO', name: 'stkOSMO', apy: 14.2, icon: 'infinite' },
]

export function HomeScreen() {
  const top3 = useMemo(() => [...LSTS].sort((a, b) => b.apy - a.apy).slice(0, 3), [])
  const [allocationPct, setAllocationPct] = useState(60)
  const [matchedIdx, setMatchedIdx] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
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

  // Map slider range (0–100) to nearest top-3 card region and snap anchor.
  const anchors = useMemo(() => [16, 60, 92] as const, [])

  const nearestTopIdx = useCallback(
    (v: number) => {
      const d0 = Math.abs(v - anchors[0])
      const d1 = Math.abs(v - anchors[1])
      const d2 = Math.abs(v - anchors[2])
      if (d0 <= d1 && d0 <= d2) return 0
      if (d1 <= d2) return 1
      return 2
    },
    [anchors]
  )

  const matched = top3[matchedIdx] ?? top3[0]!

  const apyText = useMemo(() => {
    const v = matched.apy
    const jitter = (Math.sin((tick % 3600) / 14) + 1) * 0.03
    return `${(v + jitter).toFixed(1)}%`
  }, [matched.apy, tick])

  const earningsPerDay = useMemo(() => {
    const daily = (DEMO_TVL_USD * (allocationPct / 100) * (matched.apy / 100)) / 365
    return daily
  }, [allocationPct, matched.apy])

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
                Blended APY · {matched.name}
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
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Smart allocation</Text>
              <NeonPill label={`${allocationPct}%`} tone="blue" />
            </View>

            <View style={{ marginTop: 12 }}>
              <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.75)' }}>
                At {allocationPct}% → ~${earningsPerDay.toFixed(2)}/day earnings
              </Text>
              <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>
                Auto-highlights the closest top LST and snaps on release.
              </Text>
            </View>

            <View className="mt-4">
              <Slider
                value={allocationPct}
                minimumValue={0}
                maximumValue={100}
                step={1}
                minimumTrackTintColor={neon.purple}
                maximumTrackTintColor={'rgba(255,255,255,0.15)'}
                thumbTintColor={neon.blue}
                onValueChange={(v) => {
                  const next = Math.round(v)
                  setAllocationPct(next)
                  setMatchedIdx(nearestTopIdx(next))
                }}
                onSlidingComplete={(v) => {
                  const next = Math.round(v)
                  const idx = nearestTopIdx(next)
                  setMatchedIdx(idx)
                  const snapped = anchors[idx] ?? next
                  setAllocationPct(snapped)
                  Haptics.selectionAsync().catch(() => {})
                }}
              />

              <View className="mt-4 flex-row items-center justify-between">
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.45)' }}>0%</Text>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>Allocation</Text>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.45)' }}>100%</Text>
              </View>

              <View style={{ marginTop: 14 }}>
                {top3.map((lst, idx) => (
                  <TopLSTCard
                    key={lst.key}
                    lst={lst}
                    matched={idx === matchedIdx}
                    onSelect={() => {
                      setMatchedIdx(idx)
                      setAllocationPct(anchors[idx] ?? allocationPct)
                      Haptics.selectionAsync().catch(() => {})
                    }}
                  />
                ))}
              </View>

              <View style={{ marginTop: 14 }}>
                <NeonButton
                  label="More LSTs"
                  variant="secondary"
                  onPress={() => setModalOpen(true)}
                  rightHint={`${LSTS.length}`}
                />
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

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', padding: 18, justifyContent: 'center' }}>
          <NeonCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>All LSTs</Text>
              <Pressable
                onPress={() => setModalOpen(false)}
                hitSlop={16}
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.80)" />
              </Pressable>
            </View>

            <Text style={{ ...type.caption, marginTop: 8, color: 'rgba(255,255,255,0.55)' }}>
              Top 3 below the slider are ranked by APY. This list is mock data for now.
            </Text>

            <View style={{ marginTop: 14, gap: 10 }}>
              {LSTS.map((lst) => (
                <View
                  key={lst.key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.10)',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(56,189,248,0.10)',
                        borderWidth: 1,
                        borderColor: 'rgba(56,189,248,0.18)',
                      }}
                    >
                      <Ionicons name={lst.icon} size={18} color={neon.blue} />
                    </View>
                    <View>
                      <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.92)' }}>{lst.name}</Text>
                      <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(255,255,255,0.52)' }}>
                        {lst.apy.toFixed(1)}% APY
                      </Text>
                    </View>
                  </View>
                  <NeonPill label={`${lst.apy.toFixed(1)}%`} tone="purple" />
                </View>
              ))}
            </View>
          </NeonCard>
        </View>
      </Modal>
    </ScreenBackground>
  )
}

function TopLSTCard({
  lst,
  matched,
  onSelect,
}: {
  lst: LST
  matched: boolean
  onSelect: () => void
}) {
  const active = useSharedValue(matched ? 1 : 0)
  const pulse = useSharedValue(0)

  useEffect(() => {
    active.value = withTiming(matched ? 1 : 0, { duration: 220 })
    if (matched) {
      pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true)
    } else {
      pulse.value = 0
    }
  }, [matched, active, pulse])

  const glow = useAnimatedStyle(() => {
    const o = interpolate(pulse.value, [0, 1], [0.15, 0.40])
    return {
      opacity: interpolate(active.value, [0, 1], [0, o]),
      transform: [{ scale: 1 + active.value * 0.01 }],
    }
  })

  const card = useAnimatedStyle(() => ({
    transform: [{ translateY: withSpring(matched ? 0 : 0, { damping: 14, stiffness: 160 }) }],
  }))

  return (
    <Animated.View style={[card, { marginTop: 10 }]}>
      <View style={{ borderRadius: 22, overflow: 'hidden' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            glow,
            {
              position: 'absolute',
              inset: -10,
              borderRadius: 26,
              backgroundColor: 'rgba(56,189,248,0.10)',
              shadowColor: neon.blue,
              shadowOpacity: 1,
              shadowRadius: 18,
            },
          ]}
        />

        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: matched ? 'rgba(56,189,248,0.32)' : 'rgba(255,255,255,0.10)',
            backgroundColor: 'rgba(255,255,255,0.03)',
            padding: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(168,85,247,0.12)',
                  borderWidth: 1,
                  borderColor: matched ? 'rgba(56,189,248,0.26)' : 'rgba(168,85,247,0.18)',
                }}
              >
                <Ionicons name={lst.icon} size={22} color={matched ? neon.blue : 'rgba(255,255,255,0.82)'} />
              </View>
              <View>
                <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>{lst.name}</Text>
                <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.52)' }}>
                  Top LST by APY
                </Text>
              </View>
            </View>

            <NeonPill label={`${lst.apy.toFixed(1)}% APY`} tone={matched ? 'blue' : 'purple'} />
          </View>

          <View style={{ marginTop: 12 }}>
            <NeonButton
              label={matched ? 'Selected' : 'Select'}
              onPress={onSelect}
              variant={matched ? 'primary' : 'secondary'}
              rightHint={matched ? 'matched' : undefined}
            />
          </View>
        </View>
      </View>
    </Animated.View>
  )
}
