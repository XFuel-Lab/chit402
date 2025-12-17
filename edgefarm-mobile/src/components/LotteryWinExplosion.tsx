import React, { useEffect } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import ConfettiCannon from 'react-native-confetti-cannon'
import * as Haptics from 'expo-haptics'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import { type } from '../theme/typography'
import { neon } from '../theme/neon'

type NFT = {
  id: string
  name: string
  rarity: 'Mythic' | 'Legendary' | 'Epic' | 'Rare'
}

type LotteryWinExplosionProps = {
  visible: boolean
  winAmount: number
  nft?: NFT
  onClose: () => void
  apy?: number
}

export function LotteryWinExplosion({
  visible,
  winAmount,
  nft,
  onClose,
  apy = 38,
}: LotteryWinExplosionProps) {
  const opacity = useSharedValue(0)
  const scale = useSharedValue(0.85)
  const glow = useSharedValue(0)
  const nftGlow = useSharedValue(0)
  const sparkle = useSharedValue(0)

  useEffect(() => {
    if (!visible) {
      opacity.value = 0
      scale.value = 0.85
      glow.value = 0
      nftGlow.value = 0
      sparkle.value = 0
      return
    }

    // Multiple haptic patterns for celebration
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 300)
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}), 600)

    opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) })
    scale.value = withSpring(1, { damping: 10, stiffness: 120 })
    glow.value = withDelay(200, withRepeat(withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.quad) }), -1, true))
    nftGlow.value = withDelay(800, withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, true))
    sparkle.value = withDelay(400, withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true))
  }, [visible, opacity, scale, glow, nftGlow, sparkle])

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const cardStyle = useAnimatedStyle(() => ({ 
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }))
  const glowStyle = useAnimatedStyle(() => {
    const intensity = 0.4 + glow.value * 0.6
    return {
      shadowColor: neon.pink,
      shadowOpacity: intensity,
      shadowRadius: 32 + glow.value * 24,
      shadowOffset: { width: 0, height: 0 },
    }
  })
  const nftGlowStyle = useAnimatedStyle(() => {
    const intensity = 0.5 + nftGlow.value * 0.5
    return {
      shadowColor: neon.purple,
      shadowOpacity: intensity,
      shadowRadius: 28 + nftGlow.value * 20,
      shadowOffset: { width: 0, height: 0 },
      transform: [{ scale: 1 + nftGlow.value * 0.05 }],
    }
  })
  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + sparkle.value * 0.7,
  }))

  if (!visible) return null

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        className="absolute inset-0 items-center justify-center"
        style={[backdropStyle, { backgroundColor: 'rgba(0,0,0,0.92)' }]}
      >
        {/* Multiple confetti cannons for epic explosion */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <ConfettiCannon count={100} origin={{ x: 50, y: 0 }} fadeOut={true} fallSpeed={2000} colors={[neon.pink, neon.blue, neon.purple, neon.green, '#fbbf24']} />
          <ConfettiCannon count={80} origin={{ x: 200, y: 0 }} fadeOut={true} fallSpeed={2200} colors={[neon.blue, neon.purple, neon.pink]} />
          <ConfettiCannon count={90} origin={{ x: 350, y: 0 }} fadeOut={true} fallSpeed={2100} colors={[neon.purple, neon.green, neon.blue]} />
        </View>

        <Pressable className="absolute inset-0" onPress={onClose} />

        <Animated.View
          style={[
            cardStyle,
            {
              width: '92%',
              borderRadius: 24,
              paddingHorizontal: 24,
              paddingVertical: 32,
              backgroundColor: 'rgba(15,23,42,0.96)',
              borderWidth: 2,
              borderColor: 'rgba(244,114,182,0.6)',
            },
            glowStyle,
          ]}
        >
          <View className="items-center">
            {/* Main win message */}
            <Animated.Text
              style={[
                {
                  ...type.h1,
                  fontSize: 32,
                  color: neon.pink,
                  textAlign: 'center',
                  textShadowColor: neon.pink,
                  textShadowRadius: 20,
                  textShadowOffset: { width: 0, height: 0 },
                },
                sparkleStyle,
              ]}
            >
              🎉 YOU WON! 🎉
            </Animated.Text>

            <Text
              style={{
                ...type.h2,
                marginTop: 16,
                color: 'rgba(255,255,255,0.96)',
                textAlign: 'center',
              }}
            >
              The ${winAmount.toLocaleString()} Loser Lottery!
            </Text>

            {/* NFT Showcase if won */}
            {nft && (
              <Animated.View
                style={[
                  {
                    marginTop: 24,
                    width: '100%',
                    borderRadius: 20,
                    overflow: 'hidden',
                    borderWidth: 2,
                    borderColor: 'rgba(168,85,247,0.8)',
                  },
                  nftGlowStyle,
                ]}
              >
                <LinearGradient
                  colors={['rgba(168,85,247,0.85)', 'rgba(56,189,248,0.75)', 'rgba(244,114,182,0.65)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 20, alignItems: 'center' }}
                >
                  <Text
                    style={{
                      ...type.caption,
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.9)',
                      marginBottom: 8,
                    }}
                  >
                    NFT RAFFLE PRIZE
                  </Text>
                  <View
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: 16,
                      backgroundColor: 'rgba(15,23,42,0.9)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: 'rgba(255,255,255,0.4)',
                      marginBottom: 12,
                    }}
                  >
                    <Text style={{ ...type.h1, fontSize: 48 }}>🏆</Text>
                  </View>
                  <Text
                    style={{
                      ...type.h3,
                      color: 'rgba(255,255,255,0.98)',
                      textAlign: 'center',
                    }}
                  >
                    {nft.name}
                  </Text>
                  <View
                    style={{
                      marginTop: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 4,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: 'rgba(251,191,36,0.8)',
                      backgroundColor: 'rgba(24,24,48,0.9)',
                    }}
                  >
                    <Text
                      style={{
                        ...type.caption,
                        fontSize: 11,
                        color: 'rgba(251,191,36,0.96)',
                      }}
                    >
                      {nft.rarity}
                    </Text>
                  </View>
                </LinearGradient>
              </Animated.View>
            )}

            {/* Auto-stake message */}
            <View
              style={{
                marginTop: 24,
                width: '100%',
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: 'rgba(52,211,153,0.6)',
                backgroundColor: 'rgba(6,78,59,0.4)',
              }}
            >
              <Text
                style={{
                  ...type.bodyM,
                  color: 'rgba(255,255,255,0.95)',
                  textAlign: 'center',
                  marginBottom: 4,
                }}
              >
                💰 Prize auto-staked to stTFUEL vault (mock)
              </Text>
              <Text
                style={{
                  ...type.h3,
                  color: neon.green,
                  textAlign: 'center',
                }}
              >
                Now earning {apy}% APY
              </Text>
            </View>

            {/* Close button */}
            <Pressable
              onPress={onClose}
              style={{
                marginTop: 24,
                paddingHorizontal: 32,
                paddingVertical: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: 'rgba(244,114,182,0.8)',
                backgroundColor: 'rgba(244,114,182,0.2)',
              }}
            >
              <Text
                style={{
                  ...type.bodyM,
                  color: 'rgba(255,255,255,0.98)',
                  fontWeight: '600',
                }}
              >
                Claim & Continue
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

