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
        shadowColor: '#020617',
        shadowOpacity: 0.75,
        shadowRadius: 26,
        shadowOffset: { width: 0, height: 18 },
      }}
    >
      <LinearGradient
        colors={[
          'rgba(148, 27, 255, 0.80)',
          'rgba(56, 189, 248, 0.45)',
          'rgba(15, 23, 42, 0.8)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 1.3, borderRadius: 24 }}
      >
        <BlurView
          intensity={32}
          tint="dark"
          style={{
            borderRadius: 22,
            overflow: 'hidden',
            backgroundColor: 'rgba(2,6,23,0.86)',
          }}
        >
          <View
            style={{
              paddingHorizontal: 18,
              paddingVertical: 16,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: 'rgba(148,163,184,0.35)',
              backgroundColor: 'rgba(15,23,42,0.72)',
            }}
          >
            {children}
          </View>
        </BlurView>
      </LinearGradient>
    </View>
  )
}
