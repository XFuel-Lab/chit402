import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'
import * as Haptics from 'expo-haptics'

type LST = { key: string; name: string; apy: number }

const TOP4: LST[] = [
  { key: 'stkXPRT', name: 'stkXPRT', apy: 25.4 },
  { key: 'stkTIA', name: 'stkTIA', apy: 38.2 },
  { key: 'pSTAKE BTC', name: 'pSTAKE BTC', apy: 21.1 },
  { key: 'stkATOM', name: 'stkATOM', apy: 18.6 },
]

const ALL_LSTS: LST[] = [
  ...TOP4,
  { key: 'stDYDX', name: 'stDYDX', apy: 16.4 },
  { key: 'stkOSMO', name: 'stkOSMO', apy: 14.2 },
  { key: 'stINJ', name: 'stINJ', apy: 19.9 },
]

const DEMO_TVL_USD = 5920

export function HomeScreen() {
  const [tick, setTick] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string>('stkTIA')
  const [moreOpen, setMoreOpen] = useState(false)

  const pulse = useSharedValue(0)
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [pulse])

  const switchAnim = useSharedValue(1)
  useEffect(() => {
    // Smooth “connected” update animation when switching yield
    switchAnim.value = 0
    switchAnim.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) })
  }, [selectedKey, switchAnim])

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const selected = useMemo(() => ALL_LSTS.find((x) => x.key === selectedKey) ?? TOP4[1]!, [selectedKey])

  const apyText = useMemo(() => {
    const v = selected.apy
    const jitter = (Math.sin((tick % 3600) / 14) + 1) * 0.03
    return `${(v + jitter).toFixed(1)}%`
  }, [selected.apy, tick])

  const earningsToday = useMemo(() => {
    const daily = (DEMO_TVL_USD * (selected.apy / 100)) / 365
    // tiny drift so it “feels live”
    const drift = (Math.sin((tick % 3600) / 13) + 1) * 0.02
    return daily + drift
  }, [selected.apy, tick])

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.22 + pulse.value * 0.28,
    transform: [{ scale: 1 + pulse.value * 0.03 }],
  }))

  const switchStyle = useAnimatedStyle(() => ({
    opacity: switchAnim.value,
    transform: [{ translateY: (1 - switchAnim.value) * 6 }],
  }))

  const onSelect = (key: string) => {
    setSelectedKey(key)
    Haptics.selectionAsync().catch(() => {})
  }

  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
          <View style={{ marginBottom: 18 }}>
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.60)' }}>EdgeFarm</Text>
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.96)' }}>Dashboard</Text>
          </View>

          <NeonCard className="mb-6">
            <View className="flex-row items-center justify-between">
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>LIVE BLENDED APY</Text>
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

            <Animated.View style={[switchStyle, { marginTop: 14 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.78)' }}>
                  You’re currently earning{' '}
                  <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.92)' }}>{apyText}</Text>{' '}
                  on{' '}
                  <Text style={{ ...type.bodyM, color: neon.blue }}>{selected.name}</Text>
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="star" size={16} color={neon.blue} />
                  <NeonPill label="Current" tone="blue" />
                </View>
              </View>

              <Animated.View
                pointerEvents="none"
                style={[
                  glowStyle,
                  {
                    position: 'absolute',
                    left: -8,
                    right: -8,
                    top: 6,
                    height: 78,
                    borderRadius: 24,
                    backgroundColor: 'rgba(168,85,247,0.10)',
                    shadowColor: '#a855f7',
                    shadowOpacity: 1,
                    shadowRadius: 18,
                  },
                ]}
              />
              <Text style={{ ...type.h0, color: 'rgba(255,255,255,0.98)' }}>{apyText}</Text>
              <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.60)' }}>
                (~${earningsToday.toFixed(2)}/day · Auto-staked from Theta farming)
              </Text>
            </Animated.View>
          </NeonCard>

          <NeonCard className="mb-6">
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>EARNINGS TODAY</Text>
            <Text style={{ ...type.h1, marginTop: 10, color: 'rgba(255,255,255,0.96)' }}>${(earningsToday * (tick % 86400) / 86400).toFixed(2)}</Text>
            <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>
              Live estimate · Theta farming auto-stakes into LSTs
            </Text>
          </NeonCard>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <NeonCard>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>STREAK</Text>
                <Text style={{ ...type.h1, marginTop: 10, color: 'rgba(255,255,255,0.96)' }}>12</Text>
                <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>days</Text>
              </NeonCard>
            </View>
            <View style={{ flex: 1 }}>
              <NeonCard>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>RANK</Text>
                <Text style={{ ...type.h1, marginTop: 10, color: 'rgba(255,255,255,0.96)' }}>#184</Text>
                <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>leaderboard</Text>
              </NeonCard>
            </View>
          </View>

          <View style={{ marginTop: 18 }}>
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Change Your Yield</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 4, gap: 10 }}
            >
              {TOP4.map((lst) => {
                const active = lst.key === selectedKey
                return (
                  <YieldBubble
                    key={lst.key}
                    name={lst.name}
                    apy={lst.apy}
                    active={active}
                    onPress={() => onSelect(lst.key)}
                  />
                )
              })}

              <Pressable onPress={() => setMoreOpen(true)} hitSlop={12}>
                <View
                  style={{
                    width: 132,
                    borderRadius: 22,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.12)',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.90)' }}>More →</Text>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.48)' }}>Full list</Text>
                </View>
              </Pressable>
            </ScrollView>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', padding: 18, justifyContent: 'center' }}>
          <NeonCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>All LSTs</Text>
              <Pressable
                onPress={() => setMoreOpen(false)}
                hitSlop={16}
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.80)" />
              </Pressable>
            </View>

            <Text style={{ ...type.caption, marginTop: 8, color: 'rgba(255,255,255,0.55)' }}>
              Tap any LST to switch your yield target.
            </Text>

            <View style={{ marginTop: 14, gap: 10 }}>
              {ALL_LSTS.sort((a, b) => b.apy - a.apy).map((lst) => {
                const active = lst.key === selectedKey
                return (
                  <Pressable
                    key={lst.key}
                    onPress={() => {
                      onSelect(lst.key)
                      setMoreOpen(false)
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: active ? 'rgba(56,189,248,0.30)' : 'rgba(255,255,255,0.10)',
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name={active ? 'star' : 'ellipse'} size={18} color={active ? neon.blue : 'rgba(255,255,255,0.35)'} />
                      <View>
                        <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.92)' }}>{lst.name}</Text>
                        <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(255,255,255,0.52)' }}>
                          {lst.apy.toFixed(1)}% APY
                        </Text>
                      </View>
                    </View>
                    <NeonPill label={`${lst.apy.toFixed(1)}%`} tone={active ? 'blue' : 'purple'} />
                  </Pressable>
                )
              })}
            </View>
          </NeonCard>
        </View>
      </Modal>
    </ScreenBackground>
  )
}

function YieldBubble({
  name,
  apy,
  active,
  onPress,
}: {
  name: string
  apy: number
  active: boolean
  onPress: () => void
}) {
  const glow = useSharedValue(active ? 1 : 0)

  useEffect(() => {
    glow.value = withTiming(active ? 1 : 0, { duration: 220, easing: Easing.out(Easing.quad) })
  }, [active, glow])

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.10 + glow.value * 0.35,
  }))

  return (
    <Pressable onPress={onPress} hitSlop={12}>
      <View style={{ width: 150, borderRadius: 22, overflow: 'hidden' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            glowStyle,
            {
              position: 'absolute',
              inset: -10,
              borderRadius: 26,
              backgroundColor: 'rgba(56,189,248,0.10)',
              shadowColor: neon.blue,
              shadowOpacity: 1,
              shadowRadius: 16,
            },
          ]}
        />

        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: active ? 'rgba(56,189,248,0.30)' : 'rgba(255,255,255,0.12)',
            backgroundColor: 'rgba(255,255,255,0.03)',
            paddingHorizontal: 14,
            paddingVertical: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.92)' }}>{name}</Text>
            {active ? <Ionicons name="star" size={16} color={neon.blue} /> : null}
          </View>
          <Text style={{ ...type.caption, marginTop: 8, color: 'rgba(255,255,255,0.55)' }}>{apy.toFixed(1)}% APY</Text>
        </View>
      </View>
    </Pressable>
  )
}
