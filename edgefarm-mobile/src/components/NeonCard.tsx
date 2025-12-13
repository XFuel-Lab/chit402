import React from 'react'
import { View } from 'react-native'
import { neon } from '../theme/neon'

export function NeonCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <View
      className={
        `rounded-2xl border px-4 py-4 ${className ?? ''}`
      }
      style={{ backgroundColor: neon.card, borderColor: neon.cardBorder }}
    >
      {children}
    </View>
  )
}
