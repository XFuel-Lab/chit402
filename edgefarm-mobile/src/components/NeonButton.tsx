import React, { useEffect } from 'react'
import { Pressable, Text, View, ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { type } from '../theme/typography'

type Props = {
  label: string
  onPress?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  rightHint?: string
  style?: ViewStyle
}

export function NeonButton({ label, onPress, disabled, variant = 'primary', rightHint, style }: Props) {
  const pulse = useSharedValue(0)
  const press = useSharedValue(0)

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [pulse])

  const glowStyle = useAnimatedStyle(() => {
    const o = variant === 'secondary' ? 0.18 : 0.28 + pulse.value * 0.22
    return {
      opacity: disabled ? 0.12 : o,
      transform: [{ scale: 1 + press.value * 0.02 }],
    }
  })

  const colors: Record<string, [string, string, string]> = {
    primary: ['rgba(168,85,247,0.98)', 'rgba(56,189,248,0.92)', 'rgba(251,113,133,0.25)'],
    secondary: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)'],
    danger: ['rgba(251,113,133,0.85)', 'rgba(168,85,247,0.55)', 'rgba(56,189,248,0.22)'],
  }

  const c = colors[variant] ?? colors.primary

  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (disabled) return
        if (variant !== 'secondary') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        onPress?.()
      }}
      onPressIn={() => {
        press.value = withTiming(1, { duration: 90 })
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: 140 })
      }}
      style={[{ borderRadius: 18 }, style]}
    >
      <View style={{ borderRadius: 18, overflow: 'hidden' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            glowStyle,
            {
              position: 'absolute',
              inset: -10,
              borderRadius: 22,
              backgroundColor: 'rgba(168,85,247,0.22)',
              shadowColor: '#a855f7',
              shadowOpacity: 1,
              shadowRadius: 18,
            },
          ]}
        />

        <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View
            style={{
              minHeight: 52,
              paddingHorizontal: 16,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.10)',
              backgroundColor: variant === 'secondary' ? 'rgba(0,0,0,0.12)' : 'transparent',
            }}
          >
            <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)' }}>{label}</Text>
              {rightHint ? (
                <Text style={{ ...type.caption, marginLeft: 10, color: 'rgba(255,255,255,0.72)' }}>{rightHint}</Text>
              ) : null}
            </View>
          </View>
        </LinearGradient>
      </View>
    </Pressable>
  )
}
