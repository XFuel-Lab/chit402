import React from 'react'
import { View } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'

export function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <View
      className={className}
      style={{
        borderRadius: 24,
        overflow: 'visible',
        // Strong floating elevation / holographic glow
        shadowColor: '#a855f7',
        shadowOpacity: 0.55,
        shadowRadius: 32,
        shadowOffset: { width: 0, height: 22 },
      }}
    >
      <LinearGradient
        colors={[
          'rgba(168, 85, 247, 0.90)',
          'rgba(56, 189, 248, 0.60)',
          'rgba(15, 23, 42, 0.95)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 1.3, borderRadius: 24 }}
      >
        <BlurView
          intensity={52}
          tint="dark"
          style={{
            borderRadius: 22,
            overflow: 'hidden',
            // High-translucency glass so XFUEL wallpaper is clearly visible
            backgroundColor: 'rgba(2,6,23,0.55)',
          }}
        >
          <View
            style={{
              paddingHorizontal: 18,
              paddingVertical: 16,
              borderRadius: 22,
              borderWidth: 1,
              // Soft neon border + inner shadow
              borderColor: 'rgba(168,85,247,0.55)',
              backgroundColor: 'rgba(15,23,42,0.65)',
              shadowColor: 'rgba(15,23,42,1)',
              shadowOpacity: 0.9,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            {/* Glossy highlight strip */}
            <LinearGradient
              colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.02)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 42,
                opacity: 0.85,
              }}
            />
            {children}
          </View>
        </BlurView>
      </LinearGradient>
    </View>
  )
}
