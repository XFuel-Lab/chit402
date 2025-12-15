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
          'rgba(168, 85, 247, 0.55)',
          'rgba(56, 189, 248, 0.38)',
          'rgba(15, 23, 42, 0.60)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 1, borderRadius: 24 }}
      >
        <BlurView
          // Keep blur very light so wallpaper stays crystal sharp (sub‑10% vibe)
          intensity={8}
          tint="dark"
          style={{
            borderRadius: 22,
            overflow: 'hidden',
            backgroundColor: 'transparent',
          }}
        >
          <View
            style={{
              paddingHorizontal: 18,
              paddingVertical: 16,
              borderRadius: 22,
              borderWidth: 1,
              // Soft neon border, content floating directly on blurred wallpaper
              borderColor: 'rgba(168,85,247,0.36)',
              backgroundColor: 'transparent',
              shadowColor: 'rgba(15,23,42,1)',
              shadowOpacity: 0.6,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 },
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
