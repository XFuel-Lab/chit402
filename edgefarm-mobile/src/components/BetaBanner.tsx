import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, Animated, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'

interface BetaBannerProps {
  network: 'mainnet' | 'testnet'
}

export default function BetaBanner({ network }: BetaBannerProps) {
  const [isVisible, setIsVisible] = useState(true)
  const fadeAnim = React.useRef(new Animated.Value(0)).current
  const pulseAnim = React.useRef(new Animated.Value(1)).current

  useEffect(() => {
    // Only show on mainnet
    if (network === 'mainnet') {
      // Haptic feedback on mount
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
      
      // Fade in animation
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start()

      // Pulse animation for warning icon
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start()
    }
  }, [network])

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setIsVisible(false))
  }

  // Only show on mainnet
  if (network !== 'mainnet' || !isVisible) {
    return null
  }

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        paddingTop: Platform.OS === 'ios' ? 44 : 0, // Safe area for iOS
        zIndex: 9999,
      }}
    >
      <LinearGradient
        colors={['#dc2626', '#ea580c', '#f97316']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 5,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {/* Warning Icon with Pulse */}
          <Animated.View
            style={{
              transform: [{ scale: pulseAnim }],
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: 20,
              width: 32,
              height: 32,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="warning" size={20} color="#fff" />
          </Animated.View>

          {/* Text Content */}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <Text
                style={{
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                🚨 Live Mainnet Testing
              </Text>
            </View>
            <Text
              style={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: 11,
                fontWeight: '500',
              }}
            >
              Swap at Your Own Risk
            </Text>
            <Text
              style={{
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: 10,
                marginTop: 2,
              }}
            >
              Max: 1K TFUEL/swap • 5K TFUEL/user • Unaudited
            </Text>
          </View>

          {/* Dismiss Button */}
          <Pressable
            onPress={handleDismiss}
            style={({ pressed }) => ({
              backgroundColor: pressed ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.15)',
              borderRadius: 20,
              width: 32,
              height: 32,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Ionicons name="close" size={18} color="#fff" />
          </Pressable>
        </View>
      </LinearGradient>
    </Animated.View>
  )
}

