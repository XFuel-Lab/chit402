import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import ConfettiCannon from 'react-native-confetti-cannon'
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonPill } from '../components/NeonPill'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'

export function MiningScreen() {
  // Mock “device + node” status
  const [charging, setCharging] = useState(true)
  const [bandwidth, setBandwidth] = useState(true)
  const [autoStake, setAutoStake] = useState(true)
  const [tempC, setTempC] = useState(37.2)

  useEffect(() => {
    const t = setInterval(() => {
      // Gentle temp drift for realism
      setTempC((v) => {
        const drift = (Math.sin(Date.now() / 9000) * 0.6)
        return Math.max(28, Math.min(49, 36.8 + drift))
      })
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const tempSafe = tempC < 40
  const allGreen = charging && bandwidth && autoStake && tempSafe

  const bannerPulse = useSharedValue(0)
  useEffect(() => {
    bannerPulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [bannerPulse])

  const bannerGlow = useAnimatedStyle(() => {
    const o = allGreen ? interpolate(bannerPulse.value, [0, 1], [0.22, 0.55]) : 0
    return {
      opacity: o,
      transform: [{ scale: allGreen ? 1 + bannerPulse.value * 0.01 : 1 }],
    }
  })

  const portfolio = useMemo(
    () => ({
      tfuelFarmed: 1842.7,
      uptimePct: 99.4,
      nodesConnected: 3,
      estDailyTfuel: 12.8,
    }),
    []
  )

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
          <View style={{ marginBottom: 18 }}>
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.60)' }}>EdgeFarm</Text>
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.96)' }}>Theta Mining</Text>
            <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.48)' }}>
              Premium device meters + mining portfolio
            </Text>
          </View>

          <NeonCard className="mb-6">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Status</Text>
              <NeonPill label={allGreen ? 'All systems green' : 'Attention'} tone={allGreen ? 'green' : 'pink'} />
            </View>

            <View style={{ marginTop: 14 }}>
              {allGreen ? (
                <View>
                  <View style={{ borderRadius: 20, overflow: 'hidden' }}>
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        bannerGlow,
                        {
                          position: 'absolute',
                          inset: -10,
                          borderRadius: 22,
                          backgroundColor: 'rgba(52,211,153,0.18)',
                          shadowColor: neon.green,
                          shadowOpacity: 1,
                          shadowRadius: 18,
                        },
                      ]}
                    />
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: 'rgba(52,211,153,0.28)',
                        backgroundColor: 'rgba(52,211,153,0.10)',
                        paddingVertical: 14,
                        paddingHorizontal: 14,
                        borderRadius: 20,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', letterSpacing: 1.2 }}>
                        FULL MINING ACTIVE
                      </Text>
                      <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.62)' }}>
                        You’re in the green zone — keep it there.
                      </Text>
                    </View>
                  </View>

                  <View style={{ height: 180 }}>
                    <ConfettiCannon count={70} origin={{ x: 12, y: 0 }} fadeOut={true} fallSpeed={2500} />
                  </View>
                </View>
              ) : null}

              <View style={{ marginTop: allGreen ? -100 : 0, gap: 12 }}>
                <MeterRow
                  title="Charging Status"
                  value={charging ? 'Charging' : 'Not charging'}
                  ok={charging}
                  icon="battery-charging"
                />

                <MeterRow
                  title="Temperature Safe"
                  value={`${tempC.toFixed(1)}°C (safe < 40°C)`}
                  ok={tempSafe}
                  icon="thermometer"
                />

                <MeterRow
                  title="Bandwidth Active"
                  value={bandwidth ? 'Active' : 'Inactive'}
                  ok={bandwidth}
                  icon="wifi"
                />

                <MeterRow
                  title="Auto-Stake Enabled"
                  value={autoStake ? 'Enabled' : 'Disabled'}
                  ok={autoStake}
                  icon="shield-checkmark"
                />

                {/* Demo toggles (tap status pills) */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                  <NeonPill label="Toggle charging" tone={charging ? 'green' : 'pink'} />
                  <NeonPill label="Toggle bandwidth" tone={bandwidth ? 'green' : 'pink'} />
                  <NeonPill label="Toggle auto-stake" tone={autoStake ? 'green' : 'pink'} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  <Text
                    onPress={() => setCharging((v) => !v)}
                    style={{ ...type.caption, color: 'rgba(255,255,255,0.45)' }}
                  >
                    Tap here to toggle charging ·
                  </Text>
                  <Text
                    onPress={() => setBandwidth((v) => !v)}
                    style={{ ...type.caption, color: 'rgba(255,255,255,0.45)' }}
                  >
                    bandwidth ·
                  </Text>
                  <Text
                    onPress={() => setAutoStake((v) => !v)}
                    style={{ ...type.caption, color: 'rgba(255,255,255,0.45)' }}
                  >
                    auto-stake
                  </Text>
                </View>
              </View>
            </View>
          </NeonCard>

          <NeonCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Mining portfolio</Text>
              <NeonPill label="Live" tone="blue" />
            </View>

            <View style={{ marginTop: 14, gap: 12 }}>
              <PortfolioRow label="Total TFUEL farmed" value={`${portfolio.tfuelFarmed.toLocaleString()} TFUEL`} tone="blue" />
              <PortfolioRow label="Uptime" value={`${portfolio.uptimePct.toFixed(1)}%`} tone="green" />
              <PortfolioRow label="Nodes connected" value={`${portfolio.nodesConnected}`} tone="purple" />
              <PortfolioRow label="Estimated daily TFUEL" value={`~${portfolio.estDailyTfuel.toFixed(1)} TFUEL`} tone="pink" />
            </View>

            <Text style={{ ...type.caption, marginTop: 12, color: 'rgba(255,255,255,0.45)' }}>
              This is mock data for now — wire it to Theta edge node telemetry next.
            </Text>
          </NeonCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}

function MeterRow({
  title,
  value,
  ok,
  icon,
}: {
  title: string
  value: string
  ok: boolean
  icon: keyof typeof Ionicons.glyphMap
}) {
  const pulse = useSharedValue(0)
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [pulse])

  const glow = useAnimatedStyle(() => {
    const base = ok ? 0.18 : 0.10
    const add = ok ? pulse.value * 0.18 : pulse.value * 0.06
    return { opacity: base + add }
  })

  const c = ok ? neon.green : neon.pink

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 12 }}>
        <View style={{ width: 46, height: 46, borderRadius: 18, overflow: 'hidden' }}>
          <Animated.View
            pointerEvents="none"
            style={[
              glow,
              {
                position: 'absolute',
                inset: -10,
                borderRadius: 22,
                backgroundColor: ok ? 'rgba(52,211,153,0.18)' : 'rgba(251,113,133,0.18)',
                shadowColor: c,
                shadowOpacity: 1,
                shadowRadius: 16,
              },
            ]}
          />
          <View
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: ok ? 'rgba(52,211,153,0.25)' : 'rgba(251,113,133,0.25)',
              backgroundColor: 'rgba(255,255,255,0.03)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={20} color={ok ? neon.green : neon.pink} />
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.92)' }}>{title}</Text>
          <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.55)' }}>{value}</Text>
        </View>
      </View>

      <NeonPill label={ok ? 'GREEN' : 'RED'} tone={ok ? 'green' : 'pink'} />
    </View>
  )
}

function PortfolioRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'blue' | 'green' | 'purple' | 'pink'
}) {
  const color = tone === 'green' ? neon.green : tone === 'pink' ? neon.pink : tone === 'purple' ? neon.purple : neon.blue
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.70)' }}>{label}</Text>
      <Text style={{ ...type.bodyM, color }}>{value}</Text>
    </View>
  )
}
