import React, { useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

export function TipSuccessOverlay({
  visible,
  message,
  onClose,
}: {
  visible: boolean
  message: string
  onClose: () => void
}) {
  const opacity = useSharedValue(0)
  const scale = useSharedValue(0.9)
  const glow = useSharedValue(0)

  useEffect(() => {
    if (!visible) {
      opacity.value = 0
      scale.value = 0.9
      glow.value = 0
      return
    }

    opacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) })
    scale.value = withSpring(1, { damping: 12, stiffness: 140 })
    glow.value = withDelay(120, withTiming(1, { duration: 420 }))

    const t = setTimeout(onClose, 1600)
    return () => clearTimeout(t)
  }, [visible, onClose, opacity, scale, glow])

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }))

  if (!visible) return null

  return (
    <Animated.View
      className="absolute inset-0 items-center justify-center"
      style={[backdropStyle, { backgroundColor: 'rgba(0,0,0,0.72)' }]}
    >
      <Pressable className="absolute inset-0" onPress={onClose} />

      <Animated.View
        className="w-[88%] rounded-2xl border px-5 py-5"
        style={[
          cardStyle,
          { backgroundColor: 'rgba(20,20,36,0.92)', borderColor: 'rgba(56, 189, 248, 0.35)' },
        ]}
      >
        <View className="items-center">
          <View className="h-14 w-14 items-center justify-center rounded-2xl border" style={{ borderColor: 'rgba(168,85,247,0.45)' }}>
            <Text className="text-3xl text-white">✓</Text>
          </View>

          <Animated.View
            className="mt-4 h-[2px] w-full rounded-full"
            style={[
              glowStyle,
              {
                backgroundColor: 'rgba(168,85,247,0.9)',
                shadowColor: '#a855f7',
                shadowOpacity: 0.9,
                shadowRadius: 18,
              },
            ]}
          />

          <Text className="mt-4 text-center text-base font-semibold text-white">Success</Text>
          <Text className="mt-1 text-center text-sm text-gray-300">{message}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  )
}
