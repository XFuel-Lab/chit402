import React from 'react'
import { View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { neon } from '../theme/neon'

export function ScreenBackground({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-1" style={{ backgroundColor: neon.bg0 }}>
      <LinearGradient
        colors={[
          'rgba(168, 85, 247, 0.22)',
          'rgba(56, 189, 248, 0.12)',
          'rgba(5, 5, 10, 1)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {/* Subtle neon haze */}
      <LinearGradient
        colors={['rgba(251, 113, 133, 0.10)', 'rgba(5, 5, 10, 0)']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {children}
    </View>
  )
}
