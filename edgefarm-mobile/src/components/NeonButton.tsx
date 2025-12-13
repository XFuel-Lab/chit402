import React from 'react'
import { Pressable, Text, ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

type Props = {
  label: string
  onPress?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  style?: ViewStyle
}

export function NeonButton({ label, onPress, disabled, variant = 'primary', style }: Props) {
  const colors: [string, string] =
    variant === 'primary'
      ? ['rgba(168, 85, 247, 0.95)', 'rgba(56, 189, 248, 0.85)']
      : ['rgba(168, 85, 247, 0.22)', 'rgba(56, 189, 248, 0.12)']

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className={
        `overflow-hidden rounded-xl border ${disabled ? 'opacity-50' : 'opacity-100'}`
      }
      style={[
        { borderColor: 'rgba(168, 85, 247, 0.30)' },
        style,
      ]}
    >
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <Text className="py-3 text-center text-[15px] font-semibold text-white">{label}</Text>
      </LinearGradient>
    </Pressable>
  )
}
