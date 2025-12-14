import React from 'react'
import { Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { type } from '../theme/typography'

export function NeonPill({
  label,
  tone = 'blue',
}: {
  label: string
  tone?: 'blue' | 'purple' | 'green' | 'pink'
}) {
  const colors: Record<string, [string, string]> = {
    blue: ['rgba(56,189,248,0.22)', 'rgba(56,189,248,0.06)'],
    purple: ['rgba(168,85,247,0.22)', 'rgba(168,85,247,0.06)'],
    green: ['rgba(52,211,153,0.18)', 'rgba(52,211,153,0.05)'],
    pink: ['rgba(251,113,133,0.18)', 'rgba(251,113,133,0.06)'],
  }

  const c = colors[tone] ?? colors.blue

  return (
    <View style={{ borderRadius: 999, overflow: 'hidden' }}>
      <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <View
          style={{
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            paddingHorizontal: 12,
            paddingVertical: 7,
          }}
        >
          <Text style={{ ...type.chip, color: 'rgba(255,255,255,0.92)' }}>{label}</Text>
        </View>
      </LinearGradient>
    </View>
  )
}
