import React from 'react'
import { Image, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'
import { NeonButton } from '../components/NeonButton'
import * as Haptics from 'expo-haptics'

type Achievement = {
  id: string
  title: string
  subtitle: string
  tone: 'blue' | 'purple' | 'green' | 'pink'
  unlocked: boolean
}

type NftItem = {
  id: string
  label: string
  source: string
  tag: string
  value: string
}

type Winning = {
  id: string
  event: string
  amount: string
  source: string
}

const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-swap',
    title: 'First Swap',
    subtitle: 'XFUEL → stTFUEL',
    tone: 'blue',
    unlocked: true,
  },
  {
    id: 'lottery-winner',
    title: 'Lottery Winner',
    subtitle: 'Mega Pot · 1.8x',
    tone: 'pink',
    unlocked: true,
  },
  {
    id: '100-day-streak',
    title: '100 Day Streak',
    subtitle: 'No missed epochs',
    tone: 'purple',
    unlocked: true,
  },
  {
    id: 'whale-farmer',
    title: 'Whale Farmer',
    subtitle: '$50k+ volume',
    tone: 'green',
    unlocked: false,
  },
]

const NFT_SHOWCASE: NftItem[] = [
  {
    id: 'nft-1',
    label: 'Tip Pool: Creator Clash',
    source: 'ThetaDrop',
    tag: 'Mythic',
    value: '+3.2k TFUEL',
  },
  {
    id: 'nft-2',
    label: 'Theta Edge Node OG',
    source: 'Genesis Drop',
    tag: 'Legendary',
    value: '+1.1k TFUEL',
  },
  {
    id: 'nft-3',
    label: 'Fan Lottery W #27',
    source: 'Tip Pool Win',
    tag: 'Epic',
    value: '+640 TFUEL',
  },
  {
    id: 'nft-4',
    label: 'Streamer Shards',
    source: 'Creator Loyalty',
    tag: 'Rare',
    value: '+280 TFUEL',
  },
]

const MY_WINNINGS: Winning[] = [
  {
    id: 'w1',
    event: 'Cloud9 vs Dignitas Finals',
    amount: '$8,421 loser pot',
    source: 'Tip Pools lottery (mock)',
  },
  {
    id: 'w2',
    event: 'Creator Clash Tip Pool',
    amount: '$2,140 fan cut',
    source: 'Loser star share (mock)',
  },
  {
    id: 'w3',
    event: 'Fan Lottery W #27',
    amount: '$640 booster',
    source: 'Global lottery (mock)',
  },
]

function AchievementBadge({ title, subtitle, tone, unlocked }: Achievement) {
  const glow = useSharedValue(0)

  React.useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [glow])

  const pulseStyle = useAnimatedStyle(() => {
    const scale = 1 + glow.value * 0.04
    const shadow = 6 + glow.value * 16
    return {
      transform: [{ scale }],
      shadowOpacity: unlocked ? 0.8 : 0.25,
      shadowRadius: unlocked ? shadow : 8,
      opacity: unlocked ? 1 : 0.45,
    }
  })

  const borderColor = unlocked ? 'rgba(168,85,247,0.75)' : 'rgba(148,163,184,0.55)'

  return (
    <Animated.View
      style={[
        {
          marginRight: 12,
          borderRadius: 999,
          shadowColor: unlocked ? neon.pink : 'rgba(15,23,42,1)',
          shadowOffset: { width: 0, height: 0 },
        },
        pulseStyle,
      ]}
    >
      <LinearGradient
        colors={['rgba(15,23,42,0.96)', 'rgba(15,23,42,0.75)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 999, overflow: 'hidden' }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderRadius: 999,
            borderWidth: 1,
            borderColor,
            backgroundColor: unlocked ? 'rgba(24,24,48,0.95)' : 'rgba(15,23,42,0.85)',
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              marginRight: 8,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: unlocked ? 'rgba(251,191,36,0.85)' : 'rgba(148,163,184,0.8)',
              backgroundColor: unlocked ? 'rgba(251,191,36,0.18)' : 'rgba(15,23,42,0.9)',
            }}
          >
            <Text
              style={{
                ...type.caption,
                fontSize: 10,
                color: unlocked ? 'rgba(251,191,36,0.95)' : 'rgba(148,163,184,0.95)',
              }}
            >
              {unlocked ? 'ON' : 'OFF'}
            </Text>
          </View>

          <View>
            <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.94)' }}>{title}</Text>
            <Text style={{ ...type.caption, fontSize: 11, color: 'rgba(148,163,184,0.9)' }}>{subtitle}</Text>
          </View>

          {unlocked ? (
            <View
              style={{
                marginLeft: 12,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: 'rgba(251,191,36,0.75)',
                backgroundColor: 'rgba(15,23,42,0.95)',
              }}
            >
              <Text
                style={{
                  ...type.caption,
                  fontSize: 10,
                  color: 'rgba(251,191,36,0.96)',
                }}
              >
                neon +
              </Text>
            </View>
          ) : null}
        </View>
      </LinearGradient>
    </Animated.View>
  )
}

function LevelOrb() {
  const sweep = useSharedValue(0)

  React.useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 6400, easing: Easing.linear }), -1, false)
  }, [sweep])

  const rimStyle = useAnimatedStyle(() => {
    const rotation = sweep.value * 360
    return {
      transform: [{ rotate: `${rotation}deg` }],
    }
  })

  const innerGlowStyle = useAnimatedStyle(() => {
    const scale = 1 + sweep.value * 0.04
    const opacity = 0.45 + sweep.value * 0.3
    return {
      opacity,
      transform: [{ scale }],
    }
  })

  const progress = 0.72 // 72% to next level

  return (
    <View
      style={{
        width: 110,
        height: 110,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        // ensure glow is never clipped (same fix as home orb)
        overflow: 'visible',
      }}
    >
      <Animated.View
        style={[
          rimStyle,
          {
            position: 'absolute',
            inset: 0,
            alignItems: 'center',
            justifyContent: 'center',
          },
        ]}
      >
        <LinearGradient
          colors={['rgba(168,85,247,0.85)', 'rgba(56,189,248,0.75)', 'rgba(251,113,133,0.65)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 102,
            height: 102,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: 'rgba(248,250,252,0.4)',
            opacity: 0.96,
          }}
        />
      </Animated.View>

      <Animated.View
        style={[
          innerGlowStyle,
          {
            position: 'absolute',
            width: 82,
            height: 82,
            borderRadius: 999,
            backgroundColor: 'rgba(15,23,42,0.95)',
            shadowColor: neon.purple,
            shadowOpacity: 1,
            shadowRadius: 24,
          },
        ]}
      />

      <LinearGradient
        colors={['rgba(79,70,229,0.45)', 'rgba(15,23,42,0.96)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: 78,
          height: 78,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(148,163,184,0.85)',
          paddingVertical: 4,
        }}
      >
        <Text
          style={{
            ...type.caption,
            color: 'rgba(148,163,184,0.95)',
            fontSize: 10,
            marginBottom: 0,
            textAlign: 'center',
          }}
        >
          Farmer Lv
        </Text>
        <Text
          style={{
            ...type.h1,
            fontSize: 20,
            color: 'rgba(248,250,252,0.98)',
            textAlign: 'center',
          }}
        >
          12
        </Text>
        <Text
          style={{
            ...type.caption,
            fontSize: 9,
            marginTop: 0,
            color: 'rgba(56,189,248,0.9)',
            textAlign: 'center',
          }}
        >
          {Math.round(progress * 100)}%
        </Text>
      </LinearGradient>
    </View>
  )
}

export function ProfileScreen() {
  const [isFarming, setIsFarming] = React.useState(false)

  const fanPassLevel = 3
  const fanPassProgress = 0.64 // 64% to next fan tier
  const fanTierLabel = 'Gold Fan'
  const nextTierHint = 'Join 3 more pools & keep a 7-day streak to reach Ultra (mock)'

  const farmingLabel = isFarming ? 'Stop farming' : 'Start farming'
  const farmingHint = isFarming ? 'live · TFUEL streaming' : 'boost APY now'

  return (
    <ScreenBackground grid={false}>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View className="mb-2 flex-row items-center justify-between">
            <View>
              <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.96)' }}>Profile</Text>
              <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(148,163,184,0.9)' }}>
                Tune your EdgeFarm identity, streaks & rewards
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <NeonPill label="EdgeFarm ID #12345" tone="purple" />
              <Text
                style={{
                  ...type.caption,
                  marginTop: 4,
                  color: 'rgba(148,163,184,0.8)',
                }}
              >
                mock · not yet on-chain
              </Text>
            </View>
          </View>

          {/* Top hero: avatar + ENS + level ring */}
          <View className="mt-4 flex-row items-center gap-4">
            <View className="flex-1 flex-row items-center gap-4">
              <LinearGradient
                colors={['rgba(56,189,248,0.55)', 'rgba(168,85,247,0.9)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 999,
                  padding: 3,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: 'rgba(15,23,42,1)',
                    backgroundColor: 'rgba(15,23,42,0.96)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <LinearGradient
                    colors={['rgba(15,23,42,1)', 'rgba(15,23,42,0.7)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0.9,
                    }}
                  />
                  <View
                    style={{
                      width: '120%',
                      height: '120%',
                      opacity: 0.26,
                    }}
                  >
                    <Image
                      source={require('../../assets/icon.png')}
                      style={{
                        width: '100%',
                        height: '100%',
                        tintColor: neon.purple,
                      }}
                      resizeMode="cover"
                    />
                  </View>
                  <Text
                    style={{
                      ...type.h3,
                      fontSize: 16,
                      color: 'rgba(248,250,252,0.98)',
                      position: 'absolute',
                    }}
                  >
                    EF
                  </Text>
                </View>
              </LinearGradient>

              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ ...type.h3, color: 'rgba(248,250,252,0.98)' }}>EdgeFarmer</Text>
                  <View
                    style={{
                      marginLeft: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: 'rgba(56,189,248,0.65)',
                      backgroundColor: 'rgba(15,23,42,0.95)',
                    }}
                  >
                    <Text style={{ ...type.caption, fontSize: 10, color: 'rgba(56,189,248,0.94)' }}>Top 4%</Text>
                  </View>
                </View>
                <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(148,163,184,0.95)' }}>
                  thetaedgefarmer.theta · 0x1234...7890
                </Text>
                <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(148,163,184,0.9)' }}>
                  Grinding since gen-1 testnet · streak 126 days
                </Text>
              </View>
            </View>

            {/* Pin level orb top-right, floating above text */}
            <View
              style={{
                alignItems: 'flex-end',
              }}
            >
              <LevelOrb />
            </View>
          </View>

          {/* Fan Pass card */}
          <NeonCard className="mt-6">
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)' }}>Fan Pass</Text>
            <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(148,163,184,0.9)' }}>
              Level up by tipping stars, joining pools, and hitting streaks
            </Text>

            <View className="mt-4 flex-row items-center gap-4">
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: 'rgba(251,191,36,0.9)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(24,24,48,0.96)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(252,211,77,0.96)' }}>{fanTierLabel}</Text>
                <Text style={{ ...type.h1, fontSize: 24, color: 'rgba(248,250,252,0.98)' }}>{fanPassLevel}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Progress to next tier</Text>
                <View
                  style={{
                    marginTop: 6,
                    height: 10,
                    borderRadius: 999,
                    overflow: 'hidden',
                    backgroundColor: 'rgba(15,23,42,0.95)',
                  }}
                >
                  <View
                    style={{
                      width: `${fanPassProgress * 100}%`,
                      height: '100%',
                      borderRadius: 999,
                      backgroundColor: 'rgba(251,191,36,0.9)',
                    }}
                  />
                </View>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 4,
                    color: 'rgba(250,250,250,0.96)',
                  }}
                >
                  +10% chance multiplier (mock) · unlocks Fan-only drops
                </Text>
              </View>
            </View>

            <View className="mt-4 flex-row gap-3">
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Fan streak</Text>
                <Text style={{ ...type.h1, fontSize: 20, color: 'rgba(248,250,252,0.98)' }}>23 nights</Text>
                <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(248,113,113,0.9)' }}>
                  Cloud9 & Creator Clash pools
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Lottery luck meter</Text>
                <Text style={{ ...type.h1, fontSize: 20, color: neon.green }}>you&apos;re due</Text>
                <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(148,163,184,0.9)' }}>
                  based on last 12 draws (mock)
                </Text>
              </View>
            </View>

            <View style={{ marginTop: 10 }}>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Next tier quest</Text>
              <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(248,250,252,0.92)' }}>{nextTierHint}</Text>
            </View>
          </NeonCard>

          {/* Stats + actions */}
          <NeonCard className="mt-4">
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)' }}>Your EdgeFarm stats</Text>

            {/* 2026-tier stat row: ultra-clean, pill-based metrics */}
            <View className="mt-4 gap-3">
              <View className="flex-row gap-3">
                <View
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: 'rgba(56,189,248,0.45)',
                    backgroundColor: 'rgba(15,23,42,0.55)',
                  }}
                >
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Total TFUEL farmed</Text>
                  <Text style={{ ...type.h1, marginTop: 4, fontSize: 22, color: 'rgba(248,250,252,0.98)' }}>
                    18,420.73
                  </Text>
                  <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(148,163,184,0.9)' }}>all LSTs</Text>
                </View>

                <View
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: 'rgba(168,85,247,0.55)',
                    backgroundColor: 'rgba(15,23,42,0.55)',
                  }}
                >
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Blended APY</Text>
                  <Text style={{ ...type.h1, marginTop: 4, fontSize: 22, color: neon.green }}>18.7%</Text>
                  <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(148,163,184,0.9)' }}>stTFUEL selected</Text>
                </View>
              </View>

              <View className="flex-row gap-3">
                <View
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: 'rgba(168,85,247,0.65)',
                    backgroundColor: 'rgba(22,10,40,0.88)',
                  }}
                >
                  <Text style={{ ...type.caption, color: 'rgba(196,181,253,0.96)' }}>Tips / Lottery</Text>
                  <Text style={{ ...type.h1, marginTop: 4, fontSize: 22, color: 'rgba(248,250,252,0.98)' }}>
                    143 / 32
                  </Text>
                  <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(248,113,113,0.85)' }}>
                    3 wins · 1 mega pot
                  </Text>
                </View>

                <View
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: 'rgba(56,189,248,0.6)',
                    backgroundColor: 'rgba(7,16,29,0.9)',
                  }}
                >
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Streak & rank</Text>
                  <Text style={{ ...type.h1, marginTop: 4, fontSize: 22, color: 'rgba(248,250,252,0.98)' }}>
                    126 days
                  </Text>
                  <Text style={{ ...type.caption, marginTop: 2, color: 'rgba(56,189,248,0.9)' }}>Top 4% of farmers</Text>
                </View>
              </View>
            </View>

            {/* Achievement badges */}
            <View className="mt-6">
              <View className="mb-2 flex-row items-center justify-between">
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Achievement badges</Text>
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.8)' }}>3 neon unlocked</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
              >
                {ACHIEVEMENTS.map((a) => (
                  <AchievementBadge key={a.id} {...a} />
                ))}
              </ScrollView>
            </View>

            {/* Quick actions */}
            <View className="mt-6 gap-3">
              <NeonButton
                label={farmingLabel}
                rightHint={farmingHint}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
                  setIsFarming((prev) => !prev)
                }}
              />

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <NeonButton
                    label="Create tip pool"
                    variant="secondary"
                    rightHint="for your community"
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                    }}
                  />
                </View>
                <View className="flex-1">
                  <NeonButton
                    label="Invite friends"
                    variant="secondary"
                    rightHint="+10% yield boost"
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                    }}
                  />
                </View>
              </View>
            </View>
          </NeonCard>

          {/* NFT showcase */}
          <View className="mt-6">
            <View className="mb-3 flex-row items-center justify-between">
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)' }}>NFT Showcase</Text>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>Tip Pool & ThetaDrop rewards</Text>
            </View>

            <View className="flex-row flex-wrap justify-between">
              {NFT_SHOWCASE.map((nft) => (
                <View
                  key={nft.id}
                  style={{
                    flexBasis: '48%',
                    maxWidth: '48%',
                    marginBottom: 14,
                    borderRadius: 18,
                    overflow: 'hidden',
                    backgroundColor: 'rgba(15,23,42,0.96)',
                    borderWidth: 1,
                    borderColor: 'rgba(148,163,184,0.5)',
                    shadowColor: neon.purple,
                    shadowOpacity: 0.45,
                    shadowRadius: 18,
                    shadowOffset: { width: 0, height: 14 },
                  }}
                >
                  <LinearGradient
                    colors={['rgba(56,189,248,0.55)', 'rgba(168,85,247,0.7)', 'rgba(15,23,42,0.96)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ height: 86, justifyContent: 'flex-end', padding: 8 }}
                  >
                    <View
                      style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: 0.16,
                        transform: [{ rotate: '-12deg' }],
                      }}
                    >
                      <Image
                        source={require('../../assets/icon.png')}
                        style={{
                          width: '120%',
                          height: '120%',
                          tintColor: neon.pink,
                        }}
                        resizeMode="cover"
                      />
                    </View>
                    <View
                      style={{
                        alignSelf: 'flex-start',
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: 'rgba(248,250,252,0.7)',
                        backgroundColor: 'rgba(15,23,42,0.9)',
                      }}
                    >
                      <Text style={{ ...type.caption, fontSize: 10, color: 'rgba(248,250,252,0.96)' }}>
                        {nft.tag}
                      </Text>
                    </View>
                  </LinearGradient>

                  <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        ...type.caption,
                        fontSize: 12,
                        color: 'rgba(248,250,252,0.96)',
                      }}
                    >
                      {nft.label}
                    </Text>
                    <Text
                      style={{
                        ...type.caption,
                        marginTop: 2,
                        color: 'rgba(148,163,184,0.9)',
                      }}
                    >
                      {nft.source}
                    </Text>
                    <Text
                      style={{
                        ...type.caption,
                        marginTop: 4,
                        color: neon.green,
                      }}
                    >
                      {nft.value}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* My Winnings history (mock) + Star Console preview */}
          <NeonCard className="mt-6 mb-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)' }}>My Winnings</Text>
              <NeonPill label="Fan history (mock)" tone="blue" />
            </View>

            <View style={{ gap: 10 }}>
              {MY_WINNINGS.map((w) => (
                <View
                  key={w.id}
                  style={{
                    borderRadius: 14,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: 'rgba(56,189,248,0.35)',
                    backgroundColor: 'rgba(15,23,42,0.80)',
                  }}
                >
                  <Text
                    style={{
                      ...type.bodyM,
                      color: 'rgba(248,250,252,0.96)',
                    }}
                  >
                    {w.event}
                  </Text>
                  <Text
                    style={{
                      ...type.caption,
                      marginTop: 4,
                      color: neon.green,
                    }}
                  >
                    {w.amount}
                  </Text>
                  <Text
                    style={{
                      ...type.caption,
                      marginTop: 2,
                      color: 'rgba(148,163,184,0.9)',
                    }}
                  >
                    {w.source}
                  </Text>
                </View>
              ))}
            </View>

            {/* Star-side console preview (mock) */}
            <View
              style={{
                marginTop: 16,
                borderTopWidth: 1,
                borderColor: 'rgba(30,64,175,0.6)',
                paddingTop: 12,
                gap: 8,
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Star Console preview</Text>
                <NeonPill label="creator mode (mock)" tone="purple" />
              </View>
              <View
                style={{
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(168,85,247,0.65)',
                  backgroundColor: 'rgba(15,23,42,0.90)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>
                  Tonight&apos;s fans tipped <Text style={{ color: neon.green }}>$4,200</Text> — your cut{' '}
                  <Text style={{ color: neon.green }}>$420</Text>.
                </Text>
                <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(148,163,184,0.9)' }}>
                  You donated 50% to fans · +12 new fan NFTs minted (mock).
                </Text>
              </View>
            </View>
          </NeonCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}
