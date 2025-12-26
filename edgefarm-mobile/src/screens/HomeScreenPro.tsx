/**
 * HOME SCREEN PRO - CockPit Dashboard (Tesla x Bugatti x Cyberpunk)
 * 
 * Features:
 * - Animated gauge cluster for key metrics
 * - 2-3 glossy buttons max (Overview, Profile, Yield Pump)
 * - Expandable sub-panels for detailed metrics
 * - Biometric unlock indicator
 * - Daily streak tracker
 * - Voice command button
 * - Pull-to-refresh
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { ScrollView, Text, View, RefreshControl, Pressable, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { ScreenBackground } from '../components/ScreenBackground'
import { CockPitDashboard } from '../components/CockPitDashboard'
import { NeonButton } from '../components/NeonButton'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { getLSTPrices, type LSTPriceAndAPYData } from '../lib/oracle'
import {
  autoReconnectOnLaunch,
  getCurrentWallet,
  refreshBalance,
} from '../lib/mockWalletSimple'
import {
  checkBiometricAvailability,
  authenticateWithBiometric,
  loadStreakData,
  dailyCheckIn,
  type BiometricConfig,
  type StreakData,
} from '../lib/luxuryFeatures'
import {
  parseVoiceCommand,
  executeVoiceCommand,
  VoiceCommandListener,
  type VoiceCommandContext,
} from '../lib/voiceCommands'
import { showSuccess, showInfo, connectionToasts } from '../lib/toastNotifications'

interface HomeScreenProProps {
  navigation?: any
}

export function HomeScreenPro({ navigation }: HomeScreenProProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [priceData, setPriceData] = useState<LSTPriceAndAPYData | null>(null)
  const [wallet, setWallet] = useState(getCurrentWallet())
  const [biometric, setBiometric] = useState<BiometricConfig>({ enabled: false, type: 'none' })
  const [streak, setStreak] = useState<StreakData | null>(null)
  const [voiceListening, setVoiceListening] = useState(false)
  const voiceListener = useRef<VoiceCommandListener | null>(null)

  // Auto-reconnect wallet on launch
  useEffect(() => {
    const reconnect = async () => {
      try {
        const reconnected = await autoReconnectOnLaunch()
        if (reconnected) {
          setWallet(reconnected)
          connectionToasts.sessionRestored(reconnected.addressShort!)
        }
      } catch (error) {
        console.warn('Auto-reconnect failed:', error)
      }
    }

    reconnect()
  }, [])

  // Check biometric availability
  useEffect(() => {
    const checkBio = async () => {
      const config = await checkBiometricAvailability()
      setBiometric(config)
    }

    checkBio()
  }, [])

  // Load streak data & auto check-in
  useEffect(() => {
    const loadStreak = async () => {
      const data = await loadStreakData()
      setStreak(data)

      // Auto check-in
      const { newStreak, badgeUnlocked, isNewRecord } = await dailyCheckIn()
      if (badgeUnlocked) {
        setTimeout(() => {
          Alert.alert(
            `🎉 Badge Unlocked!`,
            `${badgeUnlocked.icon} ${badgeUnlocked.name}\n\n${badgeUnlocked.description}\n\n${newStreak}-day streak!`,
            [{ text: 'Awesome!', style: 'default' }]
          )
        }, 1000)
      } else if (isNewRecord) {
        showSuccess(`🔥 New record: ${newStreak}-day streak!`)
      }
    }

    loadStreak()
  }, [])

  // Fetch price data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await getLSTPrices()
        setPriceData(data)
      } catch (error) {
        console.error('Failed to fetch prices:', error)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [])

  // Initialize voice listener
  useEffect(() => {
    voiceListener.current = new VoiceCommandListener({
      onResult: async (result) => {
        const context: VoiceCommandContext = {
          navigation,
          currentBalance: wallet.balanceTfuel,
          currentYield: dailyRevenue,
          currentApy: blendedApy,
          onRefresh: handleRefresh,
          onDisconnect: async () => {
            // Implement disconnect
          },
        }

        await executeVoiceCommand(result, context)
      },
    })

    return () => {
      voiceListener.current?.stop()
    }
  }, [navigation, wallet])

  // Calculate metrics
  const stkXprtApy = priceData?.apys.stkXPRT || 25.7
  const stkTiaApy = priceData?.apys.stkTIA || 15.2
  const blendedApy = Math.max(stkXprtApy, stkTiaApy)

  const totalValue = wallet.balanceTfuel * (priceData?.prices.TFUEL?.price || 0.12)
  const dailyRevenue = (totalValue * (blendedApy / 100)) / 365
  const velocityTrend = 0.15 // Mock: 15% acceleration

  const lstYields = [
    { name: 'stkXPRT', apy: stkXprtApy, amount: 120.5 },
    { name: 'stkTIA', apy: stkTiaApy, amount: 85.2 },
  ]

  // Handlers
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

    try {
      // Refresh price data
      const data = await getLSTPrices(true)
      setPriceData(data)

      // Refresh wallet balance if connected
      if (wallet.isConnected && wallet.addressFull) {
        const { tfuel, theta } = await refreshBalance(wallet.addressFull)
        setWallet({ ...wallet, balanceTfuel: tfuel, balanceTheta: theta })
      }

      showSuccess('Data refreshed')
    } catch (error) {
      console.error('Refresh failed:', error)
    }

    setRefreshing(false)
  }, [wallet])

  const handleBiometricUnlock = async () => {
    if (!biometric.enabled) return

    const success = await authenticateWithBiometric('Unlock XFuel Protocol')
    if (success) {
      showSuccess('Authenticated with biometrics')
    }
  }

  const handleVoiceCommand = () => {
    if (!voiceListening) {
      voiceListener.current?.start()
      setVoiceListening(true)
      showInfo('Voice commands active. Say "show my yields" or "navigate to swap".')
    } else {
      voiceListener.current?.stop()
      setVoiceListening(false)
    }
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={neon.blue}
              colors={[neon.blue]}
            />
          }
        >
          {/* Header */}
          <View style={{ marginBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)' }}>CockPit</Text>
              <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.98)' }}>Dashboard</Text>
            </View>

            {/* Quick Actions */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {/* Voice Command */}
              <Pressable
                onPress={handleVoiceCommand}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: voiceListening ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.1)',
                  borderWidth: 1,
                  borderColor: voiceListening ? neon.purple : 'rgba(255,255,255,0.2)',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Ionicons
                  name={voiceListening ? 'mic' : 'mic-outline'}
                  size={20}
                  color={voiceListening ? neon.purple : 'rgba(255,255,255,0.75)'}
                />
              </Pressable>

              {/* Biometric */}
              {biometric.enabled && (
                <Pressable
                  onPress={handleBiometricUnlock}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: 'rgba(34,197,94,0.15)',
                    borderWidth: 1,
                    borderColor: neon.green,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Ionicons
                    name={biometric.type === 'facial' ? 'scan' : 'finger-print'}
                    size={20}
                    color={neon.green}
                  />
                </Pressable>
              )}
            </View>
          </View>

          {/* Streak Badge */}
          {streak && streak.currentStreak > 0 && (
            <NeonCard className="mb-4">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 28 }}>🔥</Text>
                  <View>
                    <Text style={{ ...type.h3, color: neon.amber }}>{streak.currentStreak}-Day Streak</Text>
                    <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)' }}>
                      Keep going to Mars!
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.45)" />
              </View>
            </NeonCard>
          )}

          {/* CockPit Dashboard */}
          <CockPitDashboard
            tfuelBalance={wallet.balanceTfuel}
            totalValue={totalValue}
            dailyRevenue={dailyRevenue}
            velocityTrend={velocityTrend}
            apyBlended={blendedApy}
            lstYields={lstYields}
            onMetricPress={(metric) => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
              console.log('Metric pressed:', metric)
            }}
          />

          {/* Primary Actions */}
          <View style={{ gap: 12, marginTop: 24 }}>
            <NeonButton
              label="Yield Pump"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
                navigation?.navigate('Swap')
              }}
              rightHint="⚡ Swap Now"
            />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <NeonButton
                label="Overview"
                variant="secondary"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                  navigation?.navigate('Home')
                }}
                style={{ flex: 1 }}
              />
              <NeonButton
                label="Profile"
                variant="secondary"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                  navigation?.navigate('Profile')
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}

