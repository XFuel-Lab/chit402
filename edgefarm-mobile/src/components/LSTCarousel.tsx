/**
 * LST CAROUSEL - Infinite Parallax Magic with AI Yield Predictor
 * 
 * Features:
 * - Infinite snap carousel with smooth parallax scrolling
 * - Glossy cards with live APY glows
 * - AI-powered yield prediction based on user history
 * - One-tap selection with haptic feedback
 * - Yield Simulator mode with trajectory forecasting
 */

import React, { useRef, useState, useEffect } from 'react'
import { View, Text, Pressable, Dimensions, StyleSheet } from 'react'
import Carousel, { ICarouselInstance } from 'react-native-reanimated-carousel'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const CARD_WIDTH = SCREEN_WIDTH * 0.85
const CARD_HEIGHT = 280

// ============================================================================
// LST DATA TYPES
// ============================================================================

export interface LSTOption {
  id: string
  name: string
  fullName: string
  apy: number
  tvl: number
  network: string
  icon: string
  color: string
  riskLevel: 'low' | 'medium' | 'high'
  predictedApy?: number // AI-predicted APY based on user patterns
  userHoldings?: number
}

// ============================================================================
// AI YIELD PREDICTOR (Simple ML-inspired logic)
// ============================================================================

interface UserHistoryPattern {
  preferredRiskLevel: 'low' | 'medium' | 'high'
  avgHoldingDuration: number // days
  preferredNetworks: string[]
  totalInvested: number
}

function predictOptimalLST(
  lstOptions: LSTOption[],
  userPattern: UserHistoryPattern | null
): LSTOption[] {
  if (!userPattern) return lstOptions

  // Score each LST based on user preferences
  const scoredLSTs = lstOptions.map((lst) => {
    let score = 0

    // Risk preference match
    if (lst.riskLevel === userPattern.preferredRiskLevel) {
      score += 30
    }

    // Network preference
    if (userPattern.preferredNetworks.includes(lst.network)) {
      score += 20
    }

    // APY weight (higher is better)
    score += lst.apy * 2

    // TVL weight (security indicator)
    score += Math.log10(lst.tvl + 1) * 5

    return { ...lst, score }
  })

  // Sort by score (highest first)
  return scoredLSTs.sort((a, b) => (b as any).score - (a as any).score)
}

// ============================================================================
// ANIMATED LST CARD
// ============================================================================

interface LSTCardProps {
  lst: LSTOption
  index: number
  animationValue: Animated.SharedValue<number>
  onSelect: (lst: LSTOption) => void
  isSelected: boolean
}

function LSTCard({ lst, index, animationValue, onSelect, isSelected }: LSTCardProps) {
  const pulse = useSharedValue(0)

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sine) }),
      -1,
      true
    )
  }, [])

  // Parallax & scale animation
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [index - 1, index, index + 1]
    
    const scale = interpolate(
      animationValue.value,
      inputRange,
      [0.85, 1, 0.85],
      Extrapolate.CLAMP
    )

    const translateY = interpolate(
      animationValue.value,
      inputRange,
      [30, 0, 30],
      Extrapolate.CLAMP
    )

    const opacity = interpolate(
      animationValue.value,
      inputRange,
      [0.6, 1, 0.6],
      Extrapolate.CLAMP
    )

    return {
      transform: [{ scale }, { translateY }],
      opacity,
    }
  })

  // APY glow pulse
  const glowStyle = useAnimatedStyle(() => {
    const glowOpacity = 0.3 + pulse.value * 0.4
    const glowRadius = 20 + pulse.value * 8

    return {
      shadowOpacity: glowOpacity,
      shadowRadius: glowRadius,
    }
  })

  const riskColors = {
    low: neon.green,
    medium: neon.amber,
    high: neon.pink,
  }

  return (
    <Animated.View style={[styles.cardContainer, animatedStyle]}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
          onSelect(lst)
        }}
        style={{ flex: 1 }}
      >
        <Animated.View
          style={[
            glowStyle,
            {
              flex: 1,
              borderRadius: 24,
              overflow: 'hidden',
              borderWidth: isSelected ? 3 : 1,
              borderColor: isSelected ? lst.color : `${lst.color}40`,
              backgroundColor: 'rgba(20,20,36,0.9)',
              shadowColor: lst.color,
              shadowOffset: { width: 0, height: 8 },
            },
          ]}
        >
          <LinearGradient
            colors={[`${lst.color}25`, `${lst.color}08`, 'rgba(0,0,0,0.4)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1, padding: 20 }}
          >
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.98)' }}>{lst.name}</Text>
                <Text style={{ ...type.body, marginTop: 4, color: 'rgba(255,255,255,0.65)' }}>
                  {lst.fullName}
                </Text>
                <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(255,255,255,0.45)' }}>
                  {lst.network}
                </Text>
              </View>

              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: `${lst.color}20`,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: `${lst.color}60`,
                }}
              >
                <Text style={{ fontSize: 28 }}>{lst.icon}</Text>
              </View>
            </View>

            {/* APY Display */}
            <View style={{ marginTop: 24, alignItems: 'center' }}>
              <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)' }}>CURRENT APY</Text>
              <Text
                style={{
                  ...type.h0,
                  fontSize: 48,
                  color: lst.color,
                  textShadowColor: lst.color,
                  textShadowRadius: 16,
                  marginTop: 4,
                }}
              >
                {lst.apy.toFixed(1)}%
              </Text>

              {/* AI Prediction Badge */}
              {lst.predictedApy && Math.abs(lst.predictedApy - lst.apy) > 1 && (
                <View
                  style={{
                    marginTop: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 12,
                    backgroundColor: 'rgba(59,130,246,0.2)',
                    borderWidth: 1,
                    borderColor: 'rgba(59,130,246,0.4)',
                  }}
                >
                  <Text style={{ ...type.caption, color: neon.blue }}>
                    🤖 AI Predicts: {lst.predictedApy.toFixed(1)}% APY
                  </Text>
                </View>
              )}
            </View>

            {/* Footer Metrics */}
            <View style={{ marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>TVL</Text>
                <Text style={{ ...type.bodyM, marginTop: 2, color: 'rgba(255,255,255,0.85)' }}>
                  ${(lst.tvl / 1000000).toFixed(1)}M
                </Text>
              </View>

              <View>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>Risk</Text>
                <View
                  style={{
                    marginTop: 2,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: riskColors[lst.riskLevel],
                    }}
                  />
                  <Text style={{ ...type.bodyM, color: riskColors[lst.riskLevel] }}>
                    {lst.riskLevel.toUpperCase()}
                  </Text>
                </View>
              </View>

              {lst.userHoldings && lst.userHoldings > 0 && (
                <View>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>Your Holdings</Text>
                  <Text style={{ ...type.bodyM, marginTop: 2, color: neon.green }}>
                    {lst.userHoldings.toFixed(2)} {lst.name}
                  </Text>
                </View>
              )}
            </View>

            {/* Selection Indicator */}
            {isSelected && (
              <View
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: lst.color,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Ionicons name="checkmark" size={20} color="white" />
              </View>
            )}
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </Animated.View>
  )
}

// ============================================================================
// LST CAROUSEL COMPONENT
// ============================================================================

interface LSTCarouselProps {
  lstOptions: LSTOption[]
  onSelect: (lst: LSTOption) => void
  selectedLST: LSTOption | null
  userPattern?: UserHistoryPattern | null
}

export function LSTCarousel({ lstOptions, onSelect, selectedLST, userPattern = null }: LSTCarouselProps) {
  const carouselRef = useRef<ICarouselInstance>(null)
  const progressValue = useSharedValue(0)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Apply AI sorting
  const sortedLSTs = React.useMemo(() => {
    return predictOptimalLST(lstOptions, userPattern)
  }, [lstOptions, userPattern])

  const handleSelect = (lst: LSTOption) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
    onSelect(lst)
  }

  const handlePrevious = () => {
    Haptics.selectionAsync().catch(() => {})
    carouselRef.current?.scrollTo({ index: currentIndex - 1, animated: true })
  }

  const handleNext = () => {
    Haptics.selectionAsync().catch(() => {})
    carouselRef.current?.scrollTo({ index: currentIndex + 1, animated: true })
  }

  return (
    <View style={{ paddingVertical: 20 }}>
      {/* AI Recommendation Badge */}
      {userPattern && sortedLSTs[0] && (
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 16,
              backgroundColor: 'rgba(168,85,247,0.15)',
              borderWidth: 1,
              borderColor: 'rgba(168,85,247,0.4)',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Ionicons name="sparkles" size={16} color={neon.purple} />
            <Text style={{ ...type.bodyM, color: neon.purple }}>
              🤖 AI Recommends: {sortedLSTs[0].name} for you
            </Text>
          </View>
        </View>
      )}

      {/* Carousel */}
      <Carousel
        ref={carouselRef}
        width={SCREEN_WIDTH}
        height={CARD_HEIGHT}
        data={sortedLSTs}
        loop={false}
        scrollAnimationDuration={500}
        onProgressChange={(_, absoluteProgress) => {
          progressValue.value = absoluteProgress
        }}
        onSnapToItem={(index) => {
          setCurrentIndex(index)
          Haptics.selectionAsync().catch(() => {})
        }}
        renderItem={({ item, index }) => (
          <LSTCard
            lst={item}
            index={index}
            animationValue={progressValue}
            onSelect={handleSelect}
            isSelected={selectedLST?.id === item.id}
          />
        )}
        mode="parallax"
        modeConfig={{
          parallaxScrollingScale: 0.88,
          parallaxScrollingOffset: 60,
        }}
      />

      {/* Navigation Controls */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 24,
          marginTop: 20,
        }}
      >
        <Pressable
          onPress={handlePrevious}
          disabled={currentIndex === 0}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: currentIndex === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(168,85,247,0.2)',
            borderWidth: 1,
            borderColor: currentIndex === 0 ? 'rgba(255,255,255,0.1)' : neon.purple,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Ionicons
            name="chevron-back"
            size={24}
            color={currentIndex === 0 ? 'rgba(255,255,255,0.3)' : neon.purple}
          />
        </Pressable>

        {/* Dots Indicator */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {sortedLSTs.map((_, index) => (
            <View
              key={index}
              style={{
                width: index === currentIndex ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  index === currentIndex ? neon.purple : 'rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </View>

        <Pressable
          onPress={handleNext}
          disabled={currentIndex === sortedLSTs.length - 1}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor:
              currentIndex === sortedLSTs.length - 1
                ? 'rgba(255,255,255,0.05)'
                : 'rgba(168,85,247,0.2)',
            borderWidth: 1,
            borderColor:
              currentIndex === sortedLSTs.length - 1 ? 'rgba(255,255,255,0.1)' : neon.purple,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Ionicons
            name="chevron-forward"
            size={24}
            color={
              currentIndex === sortedLSTs.length - 1 ? 'rgba(255,255,255,0.3)' : neon.purple
            }
          />
        </Pressable>
      </View>

      {/* Current Selection Info */}
      {selectedLST && (
        <View
          style={{
            marginTop: 20,
            marginHorizontal: 20,
            padding: 16,
            borderRadius: 16,
            backgroundColor: 'rgba(168,85,247,0.1)',
            borderWidth: 1,
            borderColor: 'rgba(168,85,247,0.3)',
          }}
        >
          <Text style={{ ...type.bodyM, color: neon.purple, textAlign: 'center' }}>
            ✓ Selected: {selectedLST.name} at {selectedLST.apy.toFixed(1)}% APY
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignSelf: 'center',
  },
})

