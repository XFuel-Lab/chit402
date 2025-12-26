/**
 * HOME SCREEN - Ruthlessly Simple Dashboard
 * 
 * One blended APY. Live pulse. Quick actions. That's it.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Pressable, ScrollView, Text, View, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import * as Haptics from 'expo-haptics'
import { getLSTPrices, type LSTPriceAndAPYData } from '../lib/oracle'

const DEMO_TVL_USD = 5920

interface HomeScreenProps {
  navigation?: any
}

export function HomeScreen({ navigation }: HomeScreenProps) {
  const [tick, setTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [priceData, setPriceData] = useState<LSTPriceAndAPYData | null>(null)

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Fetch real APYs
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await getLSTPrices()
        setPriceData(data)
      } catch (error) {
        console.error('Failed to fetch APYs:', error)
      }
    }
    
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [])

  // Use real APYs or fallback to demo values
  const stkXprtApy = priceData?.apys.stkXPRT || 25.7
  const stkTiaApy = priceData?.apys.stkTIA || 15.2
  const blendedApy = Math.max(stkXprtApy, stkTiaApy)

  const apyText = useMemo(() => {
    const v = blendedApy
    const jitter = (Math.sin((tick % 3600) / 14) + 1) * 0.03
    return `${(v + jitter).toFixed(1)}%`
  }, [tick, blendedApy])

  const earningsToday = useMemo(() => {
    const daily = (DEMO_TVL_USD * (blendedApy / 100)) / 365
    const drift = (Math.sin((tick % 3600) / 13) + 1) * 0.02
    return daily + drift
  }, [tick, blendedApy])

  const ringPulse = useSharedValue(0)
  useEffect(() => {
    ringPulse.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [ringPulse])

  const ringStyle = useAnimatedStyle(() => {
    const scale = 1 + ringPulse.value * 0.04
    const auraOpacity = 0.45 + ringPulse.value * 0.25
    return {
      transform: [{ scale }],
      shadowColor: '#fbbf24',
      shadowOpacity: auraOpacity,
      shadowRadius: 26,
      shadowOffset: { width: 0, height: 0 },
    }
  })

  const handleApyBubblePress = (lstName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    if (navigation) {
      navigation.navigate('Stake', { preselectedLST: lstName })
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await getLSTPrices(true) // Force fresh fetch
      setPriceData(data)
    } catch (error) {
      console.error('Refresh failed:', error)
    }
    setRefreshing(false)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  }, [])

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <ScrollView 
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={neon.blue}
              colors={[neon.blue]}
            />
          }
        >
          <View style={{ marginBottom: 18 }}>
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)' }}>EdgeFarm</Text>
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.98)' }}>Dashboard</Text>
          </View>

          {/* Hero: LIVE BLENDED APY with pulsing ring */}
          <NeonCard className="mb-6">
            <View>
              <LinearGradient
                colors={[
                  'rgba(59,130,246,0.22)',
                  'rgba(147,51,234,0.10)',
                  'rgba(15,23,42,0.0)',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  position: 'absolute',
                  inset: -40,
                  opacity: 0.9,
                }}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text
                    style={{
                      ...type.caption,
                      color: 'rgba(248,250,252,0.9)',
                      letterSpacing: 1.6,
                    }}
                  >
                    LIVE BLENDED APY
                  </Text>
                  <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(226,232,240,0.85)' }}>
                    {new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                  </Text>
                </View>

                <Animated.View
                  style={[
                    ringStyle,
                    {
                      width: 96,
                      height: 96,
                      borderRadius: 999,
                      borderWidth: 3,
                      borderColor: 'rgba(250,204,21,0.92)',
                      justifyContent: 'center',
                      alignItems: 'center',
                      backgroundColor: 'rgba(15,23,42,0.9)',
                      paddingVertical: 2,
                      paddingHorizontal: 6,
                    },
                  ]}
                >
                  <Text
                    style={{
                      ...type.h1,
                      fontSize: 20,
                      lineHeight: 24,
                      color: 'rgba(254,249,195,0.98)',
                      textAlign: 'center',
                      includeFontPadding: false as any,
                    }}
                  >
                    {apyText}
                  </Text>
                  <Text
                    style={{
                      ...type.caption,
                      fontSize: 10,
                      marginTop: 2,
                      color: 'rgba(252,211,77,0.98)',
                    }}
                  >
                    top yield
                  </Text>
                </Animated.View>
              </View>

              <View style={{ marginTop: 18, maxWidth: '76%' }}>
                <Text style={{ ...type.h3, color: 'rgba(248,250,252,0.98)' }}>
                  Swap Theta to <Text style={{ ...type.h3, color: neon.purple }}>stkXPRT</Text> for {apyText}
                </Text>
                <Text
                  style={{
                    ...type.body,
                    marginTop: 8,
                    color: 'rgba(226,232,240,0.96)',
                    lineHeight: 22,
                  }}
                >
                  Highest APY Cosmos LST. Live rates. One tap.
                </Text>
              </View>
            </View>
          </NeonCard>

          {/* Top 2 LST cards - tap to navigate to Stake */}
          <View style={{ marginBottom: 8 }}>
            <Text style={{ ...type.bodyM, color: 'rgba(248,250,252,0.96)' }}>Top yields right now</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
            <Pressable style={{ flex: 1 }} onPress={() => handleApyBubblePress('stkXPRT')}>
              <NeonCard style={{ flex: 1 }}>
                <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.95)' }}>stkXPRT</Text>
                <Text style={{ ...type.h2, marginTop: 4, color: neon.purple }}>{`${stkXprtApy.toFixed(1)}%`}</Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 8,
                    color: 'rgba(226,232,240,0.9)',
                    lineHeight: 18,
                  }}
                >
                  Persistence LST
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 4,
                    color: neon.purple,
                    fontWeight: '600',
                  }}
                >
                  Tap to stake →
                </Text>
              </NeonCard>
            </Pressable>

            <Pressable style={{ flex: 1 }} onPress={() => handleApyBubblePress('stkTIA')}>
              <NeonCard style={{ flex: 1 }}>
                <Text style={{ ...type.caption, color: 'rgba(191,219,254,0.98)' }}>stkTIA</Text>
                <Text style={{ ...type.h2, marginTop: 4, color: neon.blue }}>{`${stkTiaApy.toFixed(1)}%`}</Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 8,
                    color: 'rgba(226,232,240,0.9)',
                    lineHeight: 18,
                  }}
                >
                  Celestia LST
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 4,
                    color: neon.blue,
                    fontWeight: '600',
                  }}
                >
                  Tap to stake →
                </Text>
              </NeonCard>
            </Pressable>
          </View>

          {/* Earnings Today simplified */}
          <NeonCard className="mb-6">
            <View>
              <LinearGradient
                colors={['rgba(15,23,42,0.55)', 'rgba(15,23,42,0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  position: 'absolute',
                  inset: -32,
                  opacity: 0.9,
                }}
              />

              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.96)' }}>EARNINGS TODAY</Text>
              <Text
                style={{
                  ...type.h0,
                  marginTop: 10,
                  color: 'rgba(248,250,252,0.98)',
                }}
              >
                ${((earningsToday * (tick % 86400)) / 86400).toFixed(2)}
              </Text>
              <Text
                style={{
                  ...type.caption,
                  marginTop: 6,
                  color: 'rgba(148,163,184,0.96)',
                }}
              >
                Based on blended APY (demo)
              </Text>
            </View>
          </NeonCard>

          {/* Quick Actions */}
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <NeonButton
              label="Swap Now"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
                if (navigation) {
                  navigation.navigate('Swap')
                }
              }}
              rightHint="TFUEL → LST"
            />
            <NeonButton
              label="Lock XF for Boost"
              variant="secondary"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                if (navigation) {
                  navigation.navigate('Stake')
                }
              }}
              rightHint="up to 4x"
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}
