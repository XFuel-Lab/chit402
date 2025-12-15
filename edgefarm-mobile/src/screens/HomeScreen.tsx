import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
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
import { ApyOrb } from '../components/ApyOrb'

const LSTS = [
  {
    id: 'stkXPRT',
    label: 'stkXPRT',
    apy: 46.2,
    accent: neon.purple,
    accentSoft: 'rgba(168, 85, 247, 0.35)',
    subtitle: 'Cosmos LST · boosted vaults',
  },
  {
    id: 'stkTIA',
    label: 'stkTIA',
    apy: 42.8,
    accent: neon.blue,
    accentSoft: 'rgba(56, 189, 248, 0.35)',
    subtitle: 'TIA restaked · auto-compounding',
  },
  {
    id: 'pSTAKE_BTC',
    label: 'pSTAKE BTC',
    apy: 39.4,
    accent: neon.amber,
    accentSoft: 'rgba(251, 191, 36, 0.40)',
    subtitle: 'BTC yield · cross-chain secured',
  },
  {
    id: 'tstETH',
    label: 'tstETH',
    apy: 37.9,
    accent: neon.green,
    accentSoft: 'rgba(52, 211, 153, 0.40)',
    subtitle: 'ETH LST · Theta-aligned',
  },
]

export function HomeScreen() {
  const [tick, setTick] = useState(0)
  const [selectedLSTId, setSelectedLSTId] = useState<string>(LSTS[0]?.id)

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

  const selectedLST = useMemo(
    () => LSTS.find((l) => l.id === selectedLSTId) ?? LSTS[0],
    [selectedLSTId]
  )

  const topLST = useMemo(
    () => LSTS.reduce((max, curr) => (curr.apy > max.apy ? curr : max), LSTS[0]),
    []
  )

  const baseApy = selectedLST.apy

  const apyText = useMemo(() => {
    const v = baseApy
    const jitter = (Math.sin((tick % 3600) / 14) + 1) * 0.03
    return `${(v + jitter).toFixed(1)}%`
  }, [tick])

  const earningsToday = useMemo(() => {
    // Dopamine-focused mock that “ticks” slightly over time
    const base = 2.47
    const drift = (Math.sin((tick % 3600) / 11) + 1) * 0.03
    return base + drift
  }, [tick])

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.22 + pulse.value * 0.28,
    transform: [{ scale: 1 + pulse.value * 0.03 }],
  }))

  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
          <View style={{ marginBottom: 18 }}>
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.60)' }}>EdgeFarm</Text>
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.96)' }}>Dashboard</Text>
          </View>

          <NeonCard className="mb-6">
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.70)' }}>LIVE BLENDED APY</Text>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>
                    {new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                  </Text>
                </View>
                <Text
                  style={{
                    ...type.bodyM,
                    marginTop: 10,
                    color: 'rgba(255,255,255,0.82)',
                  }}
                >
                  You&apos;re earning {apyText} on{' '}
                  <Text style={{ color: selectedLST.accent }}>{selectedLST.label}</Text>
                </Text>
                <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.55)' }}>
                  Blended, simulated yields · ticks in real time (demo)
                </Text>
              </View>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setSelectedLSTId(topLST.id)}
                style={{ width: 130, alignItems: 'flex-end' }}
              >
                <Animated.View
                  pointerEvents="none"
                  style={[
                    glowStyle,
                    {
                      position: 'absolute',
                      right: -12,
                      top: -6,
                      width: 120,
                      height: 120,
                      borderRadius: 60,
                      backgroundColor: 'rgba(30,64,175,0.55)',
                      shadowColor: '#a855f7',
                      shadowOpacity: 1,
                      shadowRadius: 32,
                    },
                  ]}
                />
                <ApyOrb apyText={`${topLST.apy.toFixed(1)}%`} label="top yield" />
              </TouchableOpacity>
            </View>
          </NeonCard>

          {/* Move LST carousel directly under live APY card */}
          <View style={{ marginBottom: 22 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.70)' }}>
                Top LST yields right now
              </Text>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>More →</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 4, columnGap: 16 }}
            >
              {LSTS.map((lst) => {
                const isSelected = lst.id === selectedLSTId
                return (
                  <TouchableOpacity
                    key={lst.id}
                    activeOpacity={0.9}
                    onPress={() => setSelectedLSTId(lst.id)}
                  >
                    <View
                      style={{
                        width: 190,
                        borderRadius: 999,
                        overflow: 'hidden',
                        shadowColor: isSelected ? lst.accent : 'rgba(15,23,42,1)',
                        shadowOpacity: isSelected ? 0.9 : 0.55,
                        shadowRadius: isSelected ? 26 : 16,
                        shadowOffset: { width: 0, height: 16 },
                      }}
                    >
                      <LinearGradient
                        colors={
                          isSelected
                            ? [lst.accentSoft, 'rgba(15,23,42,0.65)']
                            : ['rgba(15,23,42,0.40)', 'rgba(15,23,42,0.55)']
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{
                          borderRadius: 999,
                          padding: 1,
                        }}
                      >
                        <View
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 18,
                            paddingVertical: 14,
                            borderWidth: 1,
                            borderColor: isSelected ? lst.accentSoft : 'rgba(148,163,184,0.30)',
                            // Extremely light tint so wallpaper shows through; rely on bright lettering for contrast
                            backgroundColor: 'rgba(15,23,42,0.16)',
                          }}
                        >
                          <Text
                            style={{
                              ...type.chip,
                              color: 'rgba(248,250,252,0.98)',
                            }}
                          >
                            {lst.label}
                          </Text>
                          <Text
                            style={{
                              ...type.bodyM,
                              marginTop: 6,
                              color: lst.accent,
                            }}
                          >
                            ~{lst.apy.toFixed(1)}% APY
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{
                              ...type.caption,
                              marginTop: 6,
                              color: 'rgba(148,163,184,0.95)',
                            }}
                          >
                            {lst.subtitle}
                          </Text>
                        </View>
                      </LinearGradient>
                    </View>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>

          <NeonCard className="mb-6">
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>EARNINGS TODAY</Text>
            <Text style={{ ...type.h1, marginTop: 10, color: 'rgba(255,255,255,0.96)' }}>${earningsToday.toFixed(2)}</Text>
            <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>
              Approx. based on blended APY (mock)
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

          <View style={{ marginTop: 22 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.70)' }}>
                Top LST yields right now
              </Text>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>More →</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 4, columnGap: 16 }}
            >
              {LSTS.map((lst) => {
                const isSelected = lst.id === selectedLSTId
                return (
                  <TouchableOpacity
                    key={lst.id}
                    activeOpacity={0.9}
                    onPress={() => setSelectedLSTId(lst.id)}
                  >
                    <View
                      style={{
                        width: 190,
                        borderRadius: 999,
                        overflow: 'hidden',
                        shadowColor: isSelected ? lst.accent : 'rgba(15,23,42,1)',
                        shadowOpacity: isSelected ? 0.9 : 0.55,
                        shadowRadius: isSelected ? 26 : 16,
                        shadowOffset: { width: 0, height: 16 },
                      }}
                    >
                      <LinearGradient
                        colors={
                          isSelected
                            ? [lst.accentSoft, 'rgba(15,23,42,0.65)']
                            : ['rgba(15,23,42,0.40)', 'rgba(15,23,42,0.55)']
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{
                          borderRadius: 999,
                          padding: 1,
                        }}
                      >
                        <View
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 18,
                            paddingVertical: 14,
                            borderWidth: 1,
                            borderColor: isSelected ? lst.accentSoft : 'rgba(148,163,184,0.30)',
                            // Extremely light tint so wallpaper shows through; rely on bright lettering for contrast
                            backgroundColor: 'rgba(15,23,42,0.16)',
                          }}
                        >
                          <Text
                            style={{
                              ...type.chip,
                              color: 'rgba(248,250,252,0.98)',
                            }}
                          >
                            {lst.label}
                          </Text>
                          <Text
                            style={{
                              ...type.bodyM,
                              marginTop: 6,
                              color: lst.accent,
                            }}
                          >
                            ~{lst.apy.toFixed(1)}% APY
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{
                              ...type.caption,
                              marginTop: 6,
                              color: 'rgba(148,163,184,0.95)',
                            }}
                          >
                            {lst.subtitle}
                          </Text>
                        </View>
                      </LinearGradient>
                    </View>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}
