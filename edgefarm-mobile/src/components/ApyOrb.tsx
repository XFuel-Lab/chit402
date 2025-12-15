import React from 'react'
import { View, Text } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { useUiMode } from '../lib/uiMode'

type Props = {
  apyText: string
  label?: string
}

export function ApyOrb({ apyText, label }: Props) {
  const { rareVariant } = useUiMode()

  const sweep = useSharedValue(0)
  React.useEffect(() => {
    sweep.value = withRepeat(
      withTiming(1, { duration: 9200, easing: Easing.linear }),
      -1,
      false
    )
  }, [sweep])

  const ringStyle = useAnimatedStyle(() => {
    const rotation = sweep.value * 360
    return {
      transform: [{ rotate: `${rotation}deg` }],
    }
  })

  const innerGlowStyle = useAnimatedStyle(() => {
    const scale = 1 + sweep.value * 0.02
    const opacity = 0.32 + sweep.value * 0.18
    return {
      opacity,
      transform: [{ scale }],
    }
  })

  const rare = rareVariant

  const rimColors = rare
    ? ['rgba(251,191,36,0.25)', 'rgba(251,113,133,0.55)', 'rgba(129,140,248,0.45)']
    : ['rgba(168,85,247,0.65)', 'rgba(56,189,248,0.55)', 'rgba(15,118,110,0.35)']

  const coreColors = rare
    ? ['rgba(251,191,36,0.16)', 'rgba(15,23,42,0.92)']
    : ['rgba(79,70,229,0.28)', 'rgba(15,23,42,0.96)']

  return (
    <View
      style={{
        alignSelf: 'center',
        marginTop: 4,
      }}
    >
      <View
        style={{
          width: 132,
          height: 132,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={[
            ringStyle,
            {
              position: 'absolute',
              inset: 0,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <LinearGradient
            colors={rimColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 130,
              height: 130,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(248,250,252,0.22)',
              opacity: 0.95,
            }}
          />
        </Animated.View>

        <Animated.View
          style={[
            innerGlowStyle,
            {
              position: 'absolute',
              width: 104,
              height: 104,
              borderRadius: 999,
              backgroundColor: 'rgba(15,23,42,0.85)',
              shadowColor: rare ? neon.amber : neon.purple,
              shadowOpacity: 0.9,
              shadowRadius: 32,
            },
          ]}
        />

        <LinearGradient
          colors={coreColors}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{
            width: 96,
            height: 96,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: rare ? 'rgba(251,191,36,0.50)' : 'rgba(148,163,184,0.65)',
          }}
        >
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            style={{
              ...type.h2,
              fontSize: 22,
              textAlign: 'center',
              color: 'rgba(248,250,252,0.98)',
            }}
          >
            {apyText}
          </Text>
          <Text
            style={{
              ...type.caption,
              marginTop: 2,
              textAlign: 'center',
              color: rare ? 'rgba(251,191,36,0.95)' : 'rgba(148,163,184,0.95)',
            }}
          >
            {label ?? 'blended APY'}
          </Text>
        </LinearGradient>
      </View>
    </View>
  )
}


