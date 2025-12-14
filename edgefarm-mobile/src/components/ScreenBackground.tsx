import React from 'react'
import { View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { neon } from '../theme/neon'
import { ParticleField } from './ParticleField'
import { ThetaWatermark } from './ThetaWatermark'

export function ScreenBackground({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: neon.bg0 }}>
      <LinearGradient
        colors={['rgba(168, 85, 247, 0.22)', 'rgba(56, 189, 248, 0.10)', 'rgba(5, 5, 10, 1)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      <LinearGradient
        colors={['rgba(251, 113, 133, 0.11)', 'rgba(5, 5, 10, 0)']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      <ParticleField />
      <ThetaWatermark />

      {children}
    </View>
  )
}
