/**
 * LST CAROUSEL - Simple ScrollView Version (No Reanimated Issues)
 * 
 * Features:
 * - Horizontal scroll with snap
 * - Glossy cards with live APY glows
 * - AI-powered yield prediction
 * - One-tap selection with haptic feedback
 */

import React, { useState } from 'react'
import { View, Text, Pressable, Dimensions, StyleSheet, ScrollView } from 'react-native'
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
  predictedApy?: number
  userHoldings?: number
}

// ============================================================================
// AI YIELD PREDICTOR
// ============================================================================

interface UserHistoryPattern {
  preferredRiskLevel: 'low' | 'medium' | 'high'
  avgHoldingDuration: number
  preferredNetworks: string[]
  totalInvested: number
}

function predictOptimalLST(
  lstOptions: LSTOption[],
  userPattern: UserHistoryPattern | null
): LSTOption[] {
  if (!userPattern) return lstOptions

  const scoredLSTs = lstOptions.map((lst) => {
    let score = 0

    if (lst.riskLevel === userPattern.preferredRiskLevel) score += 30
    if (userPattern.preferredNetworks.includes(lst.network)) score += 20
    score += lst.apy * 2
    score += Math.log10(lst.tvl + 1) * 5

    return { ...lst, score }
  })

  return scoredLSTs.sort((a, b) => (b as any).score - (a as any).score)
}

// ============================================================================
// LST CARD COMPONENT
// ============================================================================

interface LSTCardProps {
  lst: LSTOption
  onSelect: (lst: LSTOption) => void
  isSelected: boolean
}

function LSTCard({ lst, onSelect, isSelected }: LSTCardProps) {
  const riskColors = {
    low: neon.green,
    medium: neon.amber,
    high: neon.pink,
  }

  return (
    <View style={[styles.cardContainer, { width: CARD_WIDTH, height: CARD_HEIGHT }]}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
          onSelect(lst)
        }}
        style={{ flex: 1 }}
      >
        <View
          style={[
            styles.card,
            {
              borderWidth: isSelected ? 3 : 1,
              borderColor: isSelected ? lst.color : `${lst.color}40`,
            },
          ]}
        >
          <LinearGradient
            colors={[`${lst.color}25`, `${lst.color}08`, 'rgba(0,0,0,0.4)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1, padding: 20, borderRadius: 24 }}
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
                <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
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
        </View>
      </Pressable>
    </View>
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
  const [currentIndex, setCurrentIndex] = useState(0)

  // Apply AI sorting
  const sortedLSTs = React.useMemo(() => {
    return predictOptimalLST(lstOptions, userPattern)
  }, [lstOptions, userPattern])

  const handleSelect = (lst: LSTOption) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
    onSelect(lst)
  }

  const scrollViewRef = React.useRef<ScrollView>(null)

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

      {/* Horizontal ScrollView */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled={false}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + 20}
        snapToAlignment="center"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: (SCREEN_WIDTH - CARD_WIDTH) / 2 }}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / (CARD_WIDTH + 20))
          setCurrentIndex(index)
          Haptics.selectionAsync().catch(() => {})
        }}
      >
        {sortedLSTs.map((lst, index) => (
          <View key={lst.id} style={{ marginHorizontal: 10 }}>
            <LSTCard lst={lst} onSelect={handleSelect} isSelected={selectedLST?.id === lst.id} />
          </View>
        ))}
      </ScrollView>

      {/* Dots Indicator */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          marginTop: 20,
        }}
      >
        {sortedLSTs.map((_, index) => (
          <View
            key={index}
            style={{
              width: index === currentIndex ? 24 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: index === currentIndex ? neon.purple : 'rgba(255,255,255,0.2)',
            }}
          />
        ))}
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
    alignSelf: 'center',
  },
  card: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(20,20,36,0.9)',
  },
})

