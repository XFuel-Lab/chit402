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
    <View className={className} style={{ borderRadius: 22, overflow: 'hidden' }}>
      <LinearGradient
        colors={['rgba(168, 85, 247, 0.34)', 'rgba(56, 189, 248, 0.18)', 'rgba(251, 113, 133, 0.10)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 1.2 }}
      >
        <BlurView
          intensity={26}
          tint="dark"
          style={{
            borderRadius: 22,
            overflow: 'hidden',
            backgroundColor: 'rgba(10,10,20,0.55)',
          }}
        >
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 14,
              shadowColor: '#000',
              shadowOpacity: 0.35,
              shadowRadius: 16,
            }}
          >
            {children}
          </View>
        </BlurView>
      </LinearGradient>
    </View>
  )
}
