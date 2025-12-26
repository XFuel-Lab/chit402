/**
 * STAKE SCREEN - veXF Locking (Tesla-Simple)
 * 
 * Purpose: Lock XF → get veXF boost (voting power + fee share)
 * UX: One slider, instant preview, one button. That's it.
 */

import React, { useState, useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Slider from '@react-native-community/slider'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { NeonPill } from '../components/NeonPill'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import * as Haptics from 'expo-haptics'

// Lock durations: 1 week to 4 years
const MIN_WEEKS = 1
const MAX_WEEKS = 208 // 4 years
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Boost calculation: linear from 1x (1 week) to 4x (4 years)
function calculateBoost(weeks: number): number {
  return 1 + ((weeks - MIN_WEEKS) / (MAX_WEEKS - MIN_WEEKS)) * 3
}

function weeksToLabel(weeks: number): string {
  if (weeks < 4) return `${weeks}w`
  if (weeks < 52) return `${Math.round(weeks / 4)}mo`
  return `${(weeks / 52).toFixed(1)}yr`
}

export function StakeScreen() {
  const [lockWeeks, setLockWeeks] = useState(52) // Default 1 year
  const [isStaking, setIsStaking] = useState(false)
  const [xfBalance] = useState(250) // Mock balance

  const boost = useMemo(() => calculateBoost(lockWeeks), [lockWeeks])
  const veXF = useMemo(() => xfBalance * boost, [xfBalance, boost])
  const unlockDate = useMemo(() => {
    const date = new Date(Date.now() + lockWeeks * WEEK_MS)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }, [lockWeeks])

  const ringPulse = useSharedValue(0)
  React.useEffect(() => {
    ringPulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [ringPulse])

  const ringStyle = useAnimatedStyle(() => {
    const scale = 1 + ringPulse.value * 0.03
    return {
      transform: [{ scale }],
      shadowColor: neon.purple,
      shadowOpacity: 0.6 + ringPulse.value * 0.3,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 0 },
    }
  })

  const handleStake = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    setIsStaking(true)
    
    // Mock staking transaction
    setTimeout(() => {
      setIsStaking(false)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      // TODO: Show success overlay with confetti
    }, 2000)
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={{ marginBottom: 18 }}>
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)' }}>EdgeFarm</Text>
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.98)' }}>Stake & Boost</Text>
          </View>

          {/* Balance Card */}
          <NeonCard className="mb-6">
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>YOUR BALANCE</Text>
            <View className="mt-2 flex-row items-baseline gap-2">
              <Text style={{ ...type.h1, color: 'rgba(255,255,255,0.95)' }}>{xfBalance}</Text>
              <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.55)' }}>XF</Text>
            </View>
            <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.45)' }}>
              Available to lock
            </Text>
          </NeonCard>

          {/* Lock Duration Slider */}
          <NeonCard className="mb-6">
            <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
              Lock Duration
            </Text>
            
            <View style={{ alignItems: 'center', marginVertical: 20 }}>
              <Animated.View
                style={[
                  ringStyle,
                  {
                    width: 120,
                    height: 120,
                    borderRadius: 999,
                    borderWidth: 3,
                    borderColor: neon.purple,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'rgba(15,23,42,0.9)',
                  },
                ]}
              >
                <Text style={{ ...type.h1, fontSize: 28, color: neon.purple }}>
                  {boost.toFixed(2)}x
                </Text>
                <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.65)' }}>
                  boost
                </Text>
              </Animated.View>
            </View>

            <Slider
              value={lockWeeks}
              onValueChange={(val) => {
                setLockWeeks(Math.round(val))
                Haptics.selectionAsync().catch(() => {})
              }}
              minimumValue={MIN_WEEKS}
              maximumValue={MAX_WEEKS}
              step={1}
              minimumTrackTintColor={neon.purple}
              maximumTrackTintColor="rgba(255,255,255,0.15)"
              thumbTintColor={neon.purple}
            />

            <View className="mt-2 flex-row items-center justify-between">
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>1 week</Text>
              <Text style={{ ...type.bodyM, color: neon.purple, fontWeight: '600' }}>
                {weeksToLabel(lockWeeks)}
              </Text>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>4 years</Text>
            </View>
          </NeonCard>

          {/* Preview Card */}
          <NeonCard className="mb-6">
            <View className="flex-row items-center justify-between mb-3">
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>Boost Preview</Text>
              <NeonPill label="Live" tone="purple" />
            </View>

            <View style={{ 
              borderRadius: 16,
              borderWidth: 1,
              borderColor: 'rgba(168,85,247,0.3)',
              backgroundColor: 'rgba(168,85,247,0.08)',
              padding: 16,
              marginBottom: 12
            }}>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)', marginBottom: 8 }}>
                You lock
              </Text>
              <View className="flex-row items-baseline gap-2">
                <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>{xfBalance}</Text>
                <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.65)' }}>XF</Text>
              </View>
            </View>

            <View style={{ alignItems: 'center', marginVertical: 8 }}>
              <Text style={{ fontSize: 24, color: neon.purple }}>↓</Text>
            </View>

            <View style={{ 
              borderRadius: 16,
              borderWidth: 2,
              borderColor: neon.purple,
              backgroundColor: 'rgba(168,85,247,0.15)',
              padding: 16
            }}>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)', marginBottom: 8 }}>
                You receive
              </Text>
              <View className="flex-row items-baseline gap-2">
                <Text style={{ ...type.h1, color: neon.purple }}>{veXF.toFixed(0)}</Text>
                <Text style={{ ...type.bodyM, color: neon.purple }}>veXF</Text>
              </View>
              <Text style={{ ...type.caption, marginTop: 8, color: 'rgba(255,255,255,0.75)' }}>
                🔓 Unlocks: {unlockDate}
              </Text>
            </View>

            <View className="mt-4 flex-row flex-wrap gap-2">
              <NeonPill label="Voting power" tone="purple" />
              <NeonPill label="Fee share boost" tone="blue" />
              <NeonPill label="Early governance" tone="green" />
            </View>
          </NeonCard>

          {/* Explainer */}
          <NeonCard className="mb-6">
            <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)', marginBottom: 8 }}>
              What is veXF?
            </Text>
            <Text style={{ ...type.body, color: 'rgba(255,255,255,0.72)', lineHeight: 22 }}>
              Vote-escrowed XF. Lock your XF for longer → get more veXF → higher governance weight and protocol fee share.
            </Text>
            <Text style={{ ...type.body, marginTop: 8, color: 'rgba(255,255,255,0.72)', lineHeight: 22 }}>
              Your XF stays safe in the contract. You can't withdraw early, but you keep earning.
            </Text>
          </NeonCard>

          {/* Action Button */}
          <View style={{ paddingBottom: 20 }}>
            <NeonButton
              label={isStaking ? 'Locking…' : '🔒 Lock & Boost'}
              onPress={handleStake}
              disabled={isStaking || xfBalance === 0}
              rightHint={isStaking ? undefined : `${weeksToLabel(lockWeeks)}`}
            />
          </View>

          {/* Footer disclaimer */}
          <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 18 }}>
            Mock data. Real veXF staking coming soon. Locks are non-reversible—choose your duration carefully.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}

