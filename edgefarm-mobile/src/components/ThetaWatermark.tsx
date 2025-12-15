import React from 'react'
import { Text, View } from 'react-native'
import { type } from '../theme/typography'

export function ThetaWatermark() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
      <View style={{ position: 'absolute', right: -22, top: 28, transform: [{ rotate: '18deg' }] }}>
        <Text
          style={{
            ...type.h0,
            fontSize: 84,
            color: 'rgba(56, 189, 248, 0.06)',
          }}
        >
          Θ
        </Text>
        <Text
          style={{
            ...type.h2,
            marginTop: -12,
            color: 'rgba(168, 85, 247, 0.08)',
            letterSpacing: 4,
          }}
        >
          THETA
        </Text>
      </View>
    </View>
  )
}
