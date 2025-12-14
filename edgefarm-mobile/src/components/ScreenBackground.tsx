import React from 'react'
import { View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { neon } from '../theme/neon'
import { ParticleField } from './ParticleField'
import { ThetaWatermark } from './ThetaWatermark'

function GridOverlay() {
  // Lightweight “HUD grid” (kept subtle to avoid visual noise)
  const lines = 9
  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, opacity: 0.10 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <View
          key={`h-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${(i + 1) * (100 / (lines + 1))}%`,
            height: 1,
            backgroundColor: i % 2 === 0 ? 'rgba(56,189,248,0.22)' : 'rgba(168,85,247,0.18)',
          }}
        />
      ))}
      {Array.from({ length: lines }).map((_, i) => (
        <View
          key={`v-${i}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(i + 1) * (100 / (lines + 1))}%`,
            width: 1,
            backgroundColor: i % 2 === 0 ? 'rgba(168,85,247,0.18)' : 'rgba(56,189,248,0.22)',
          }}
        />
      ))}
    </View>
  )
}

export function ScreenBackground({
  children,
  grid = true,
}: {
  children: React.ReactNode
  grid?: boolean
}) {
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

      {grid ? <GridOverlay /> : null}
      <ParticleField />
      <ThetaWatermark />

      {children}
    </View>
  )
}
