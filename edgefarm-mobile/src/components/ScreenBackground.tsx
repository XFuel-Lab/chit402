import React from 'react'
import { View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ParticleField } from './ParticleField'
import { ThetaWatermark } from './ThetaWatermark'

function GridOverlay() {
  // Ultra-soft holographic grid to give a HUD / cyberpunk feel without clutter
  const lines = 9
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.05,
      }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <View
          key={`h-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${(i + 1) * (100 / (lines + 1))}%`,
            height: 1,
            backgroundColor: i % 2 === 0 ? 'rgba(129, 140, 248, 0.45)' : 'rgba(168, 85, 247, 0.35)',
          }}
        />
      ))}
      {Array.from({ length: lines }).map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <View
          key={`v-${i}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(i + 1) * (100 / (lines + 1))}%`,
            width: 1,
            backgroundColor: i % 2 === 0 ? 'rgba(79, 70, 229, 0.30)' : 'rgba(56, 189, 248, 0.22)',
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
    <View style={{ flex: 1, backgroundColor: '#020014' }}>
      {/* Deep space base layer */}
      <LinearGradient
        colors={['#020012', '#050015', '#020010']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Nebula swirls */}
      <LinearGradient
        colors={[
          'rgba(148, 27, 255, 0.55)',
          'rgba(56, 189, 248, 0.05)',
          'rgba(10, 10, 30, 1)',
        ]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ position: 'absolute', inset: 0 }}
      />
      <LinearGradient
        colors={['rgba(250, 249, 255, 0.06)', 'transparent']}
        start={{ x: 0.2, y: 1 }}
        end={{ x: 0.8, y: 0 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      {grid ? <GridOverlay /> : null}
      <ParticleField />
      <ThetaWatermark />

      {children}
    </View>
  )
}


