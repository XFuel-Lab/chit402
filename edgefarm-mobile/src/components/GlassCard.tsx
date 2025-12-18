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
        shadowColor: '#0b0b1f',
        shadowOpacity: 0.85,
        shadowRadius: 36,
        shadowOffset: { width: 0, height: 24 },
      }}
    >
      <LinearGradient
        colors={['rgba(168, 85, 247, 0.42)', 'rgba(56, 189, 248, 0.26)', 'rgba(15, 23, 42, 0.45)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 1, borderRadius: 24 }}
      >
        <BlurView
          // Enhanced blur for proper glassmorphism effect while keeping wallpaper visible
          intensity={20}
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
              // Enhanced glassmorphism with proper backdrop visibility
              borderColor: 'rgba(191,219,254,0.45)',
              backgroundColor: 'rgba(2,6,23,0.25)',
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
                height: 40,
                opacity: 0.6,
              }}
            />
            {children}
          </View>
        </BlurView>
      </LinearGradient>
    </View>
  )
}
