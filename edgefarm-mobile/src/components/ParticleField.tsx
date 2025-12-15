import React, { useMemo } from 'react'
import { View, useWindowDimensions } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

type Particle = {
  x: number
  y: number
  size: number
  tint: 'purple' | 'blue' | 'pink'
  phase: number
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function ParticleField({ count = 26 }: { count?: number }) {
  const { width, height } = useWindowDimensions()

  const particles = useMemo(() => {
    const rnd = mulberry32(1337)
    const tints: Particle['tint'][] = ['purple', 'blue', 'pink']
    return Array.from({ length: count }).map((_, i) => {
      const tint = tints[i % tints.length]!
      const size = 2 + Math.floor(rnd() * 3)
      return {
        x: rnd(),
        y: rnd(),
        size,
        tint,
        phase: rnd(),
      }
    })
  }, [count])

  // Slow global drift to make the glow field feel alive but ultra-subtle
  const drift = useSharedValue(0)
  React.useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 28000 }), -1, true)
  }, [drift])

  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {particles.map((p, idx) => (
        <ParticleDot key={idx} p={p} w={width} h={height} drift={drift} />
      ))}
    </View>
  )
}

function ParticleDot({
  p,
  w,
  h,
  drift,
}: {
  p: Particle
  w: number
  h: number
  drift: Animated.SharedValue<number>
}) {
  const glow = useSharedValue(0)
  React.useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: 1800 + Math.floor(p.phase * 1600) }), -1, true)
  }, [glow, p.phase])

  const c =
    p.tint === 'blue'
      ? 'rgba(56, 189, 248, 0.20)'
      : p.tint === 'pink'
        ? 'rgba(251, 113, 133, 0.18)'
        : 'rgba(168, 85, 247, 0.20)'

  const style = useAnimatedStyle(() => {
    const o = 0.12 + glow.value * 0.38
    // Gentle orbital drift with very small amplitude
    const dx = Math.sin((p.phase + drift.value) * Math.PI * 2) * 10
    const dy = Math.cos((p.phase + drift.value) * Math.PI * 2) * 14
    return {
      opacity: o,
      transform: [{ translateX: dx }, { translateY: dy }],
    }
  })

  return (
    <Animated.View
      style={[
        style,
        {
          position: 'absolute',
          left: Math.floor(p.x * Math.max(1, w - 10)),
          top: Math.floor(p.y * Math.max(1, h - 10)),
          width: p.size,
          height: p.size,
          borderRadius: 99,
          backgroundColor: c,
          shadowColor: c,
          shadowOpacity: 1,
          shadowRadius: 10,
        },
      ]}
    />
  )
}
