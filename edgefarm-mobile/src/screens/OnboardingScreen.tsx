/**
 * ONBOARDING SCREEN - 15s Flow (2 Slides Max)
 * 
 * Slide 1: Swap Theta → Cosmos LSTs in one tap
 * Slide 2: Connect MetaMask Mobile or Theta Wallet
 * 
 * No bullshit about tip pools or lottery. Just: Swap. Stake. Win.
 */

import React, { useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { GlassCard } from '../components/GlassCard'
import { NeonButton } from '../components/NeonButton'
import { NeonPill } from '../components/NeonPill'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'

type Slide = {
  key: string
  eyebrow: string
  title: string
  body: string
  badge: string
}

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions()
  const listRef = useRef<FlatList<Slide>>(null)
  const [index, setIndex] = useState(0)

  const slides: Slide[] = useMemo(
    () => [
      {
        key: 's1',
        eyebrow: 'ONE-TAP SWAPS',
        title: 'Theta → Cosmos LSTs',
        body: 'Swap TFUEL to the highest-APY Cosmos liquid staking tokens. No gas fees. Faster than Uniswap.',
        badge: 'Gas-free',
      },
      {
        key: 's2',
        eyebrow: 'CONNECT WALLET',
        title: 'MetaMask or Theta',
        body: 'Deep link MetaMask Mobile or scan QR with Theta Wallet. 10-second setup. Your keys, your crypto.',
        badge: 'Secure',
      },
    ],
    []
  )

  const goNext = () => {
    if (index >= slides.length - 1) {
      onDone()
      return
    }
    const next = index + 1
    setIndex(next)
    listRef.current?.scrollToIndex({ index: next, animated: true })
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 18, paddingTop: 12, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <NeonPill label="EdgeFarm" tone="purple" />
            <Pressable onPress={onDone} hitSlop={16}>
              <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.70)' }}>Skip</Text>
            </Pressable>
          </View>

          <FlatList
            ref={listRef}
            data={slides}
            keyExtractor={(s) => s.key}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width))
              setIndex(i)
            }}
            renderItem={({ item }) => (
              <View style={{ width, paddingRight: 18, paddingTop: 26 }}>
                <GlassCard>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>{item.eyebrow}</Text>
                  <Text style={{ ...type.h1, marginTop: 10, color: 'rgba(255,255,255,0.95)' }}>{item.title}</Text>
                  <Text style={{ ...type.body, marginTop: 10, color: 'rgba(255,255,255,0.72)', lineHeight: 22 }}>
                    {item.body}
                  </Text>

                  <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <NeonPill label={item.badge} tone={item.key === 's1' ? 'blue' : 'green'} />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {slides.map((_, i) => (
                        <Dot key={i} active={i === index} />
                      ))}
                    </View>
                  </View>

                  <View style={{ marginTop: 18 }}>
                    <NeonButton
                      label={index === slides.length - 1 ? 'Enter EdgeFarm' : 'Next'}
                      onPress={goNext}
                      rightHint={index === slides.length - 1 ? undefined : `${index + 1}/${slides.length}`}
                    />
                  </View>

                  <Text style={{ ...type.caption, marginTop: 12, color: 'rgba(255,255,255,0.45)' }}>
                    Smooth, fast, addictive. Like the Tesla app.
                  </Text>
                </GlassCard>
              </View>
            )}
          />

          <Animated.View style={[useAnimatedStyle(() => ({ opacity: 0.9 })), { paddingBottom: 18 }]}>
            <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.40)', textAlign: 'center' }}>
              Tap "Next" then connect to start swapping
            </Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  )
}

function Dot({ active }: { active: boolean }) {
  return (
    <View
      style={{
        width: active ? 20 : 8,
        height: 8,
        borderRadius: 99,
        backgroundColor: active ? 'rgba(56,189,248,0.85)' : 'rgba(255,255,255,0.18)',
        shadowColor: neon.blue,
        shadowOpacity: active ? 1 : 0,
        shadowRadius: 12,
      }}
    />
  )
}
