import React, { useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { type } from '../theme/typography'
import { neon } from '../theme/neon'
import * as Haptics from 'expo-haptics'

interface SubPanelProps {
  visible: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function SubPanel({ visible, onClose, title, children }: SubPanelProps) {
  const translateY = useSharedValue(1000)
  const opacity = useSharedValue(0)
  const backdropOpacity = useSharedValue(0)

  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
      backdropOpacity.value = withTiming(1, { duration: 200 })
      translateY.value = withSpring(0, { damping: 18, stiffness: 200 })
      opacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) })
    } else {
      backdropOpacity.value = withTiming(0, { duration: 150 })
      translateY.value = withTiming(1000, { duration: 300, easing: Easing.in(Easing.quad) })
      opacity.value = withTiming(0, { duration: 200 })
    }
  }, [visible, translateY, opacity, backdropOpacity])

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }))

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }))

  if (!visible && translateY.value === 1000) return null

  return (
    <Animated.View
      className="absolute inset-0 z-50"
      style={backdropStyle}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Pressable className="absolute inset-0" onPress={onClose} />
      <Animated.View
        style={[
          panelStyle,
          {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            overflow: 'hidden',
          },
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(168, 85, 247, 0.95)',
            'rgba(56, 189, 248, 0.75)',
            'rgba(15, 23, 42, 0.98)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 1.5 }}
        >
          <BlurView
            // Keep panels readable but nearly clear so wallpaper still shines through
            intensity={10}
            tint="dark"
            style={{
              backgroundColor: 'rgba(2,6,23,0.40)',
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
            }}
          >
            <View
              style={{
                paddingTop: 12,
                paddingBottom: 32,
                paddingHorizontal: 20,
                borderTopLeftRadius: 30,
                borderTopRightRadius: 30,
                borderWidth: 1,
                borderColor: 'rgba(168,85,247,0.65)',
              }}
            >
              {/* Handle bar */}
              <View className="self-center mb-4" style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' }} />

              <Text
                style={{
                  ...type.h3,
                  color: 'rgba(255,255,255,0.95)',
                  marginBottom: 20,
                  textAlign: 'center',
                }}
              >
                {title}
              </Text>

              {children}
            </View>
          </BlurView>
        </LinearGradient>
      </Animated.View>
    </Animated.View>
  )
}
