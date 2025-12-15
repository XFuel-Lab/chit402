import React from 'react'
import { Image, View, useWindowDimensions } from 'react-native'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'

// From src/components → ../ (src) → ../assets
const XFUEL_LOGO = require('../../assets/icon.png')

export function ThetaWatermark() {
  // Acts as a subtle, repeated XFUEL “X” + gas pump wallpaper
  const { width, height } = useWindowDimensions()

  const tileSize = Math.min(width, height) / 5

  const columns = 4
  const rows = 7

  const tiles: Array<{
    top: number
    left: number
    size: number
    opacity: number
  }> = []

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const offsetX = (x + (y % 2 === 0 ? 0.15 : -0.15)) * (width / columns)
      const offsetY = y * (height / rows)
      tiles.push({
        top: offsetY - tileSize * 0.2,
        left: offsetX - tileSize * 0.2,
        size: tileSize * (0.9 + (x + y) * 0.03),
        opacity: 0.14 + ((x + y) % 3) * 0.02,
      })
    }
  }

  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {tiles.map((t, idx) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={idx}
          style={{
            position: 'absolute',
            top: t.top,
            left: t.left,
          }}
        >
          <Image
            source={XFUEL_LOGO}
            style={{
              width: t.size,
              height: t.size,
              opacity: t.opacity,
              tintColor: neon.purple,
              transform: [{ rotate: '-18deg' }],
            }}
            resizeMode="contain"
          />
        </View>
      ))}

      {/* Centered brand mark with soft glow */}
      <View
        style={{
          position: 'absolute',
          top: '22%',
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: 220,
            height: 220,
            borderRadius: 999,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(10,10,25,0.32)',
            borderWidth: 1,
            borderColor: 'rgba(168,85,247,0.35)',
          }}
        >
          <Image
            source={XFUEL_LOGO}
            style={{
              width: 180,
              height: 180,
              opacity: 0.14,
              tintColor: neon.purple,
            }}
            resizeMode="contain"
          />
        </View>
        <View
          style={{
            marginTop: 8,
            paddingHorizontal: 16,
            paddingVertical: 4,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: 'rgba(168,85,247,0.45)',
            backgroundColor: 'rgba(10,10,30,0.55)',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Image
              source={XFUEL_LOGO}
              style={{ width: 18, height: 18, tintColor: neon.purple, opacity: 0.9 }}
              resizeMode="contain"
            />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: 'rgba(250,250,255,0.85)',
                  marginRight: 2,
                }}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Image
                  source={XFUEL_LOGO}
                  style={{ width: 16, height: 16, tintColor: neon.purple }}
                  resizeMode="contain"
                />
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Image
                      source={XFUEL_LOGO}
                      style={{ width: 14, height: 14, tintColor: neon.pink, marginRight: 4 }}
                      resizeMode="contain"
                    />
                    <Image
                      source={XFUEL_LOGO}
                      style={{ width: 14, height: 14, tintColor: neon.blue, opacity: 0.9 }}
                      resizeMode="contain"
                    />
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
