import React, { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, Share, Text, TouchableOpacity, View, Alert } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { ScreenBackground } from '../components/ScreenBackground'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'

type ActivePool = {
  id: string
  eventName: string
  endsAtMs: number
  currentPot: number
  tipVelocity: number // tips per minute
  isLoserPool: boolean
  loserPot?: number
  hasNftRaffle?: boolean
  nftName?: string
}

type TipFeedItem = {
  id: string
  fanName: string
  amount: number
  target: string
  timestamp: number
}

export function CreatorScreen() {
  const [tick, setTick] = useState(0)
  const [createVisible, setCreateVisible] = useState(false)
  const [activePools, setActivePools] = useState<ActivePool[]>([
    {
      id: 'p1',
      eventName: 'Cloud9 vs Dignitas Finals',
      endsAtMs: Date.now() + 1000 * 60 * 38,
      currentPot: 124_800,
      tipVelocity: 12.5,
      isLoserPool: false,
      hasNftRaffle: true,
      nftName: 'Signed Cloud9 Jersey',
    },
    {
      id: 'p2',
      eventName: 'Sentinels vs LOUD Showmatch',
      endsAtMs: Date.now() + 1000 * 60 * 12,
      currentPot: 64_250,
      tipVelocity: 8.3,
      isLoserPool: true,
      loserPot: 41_900,
      hasNftRaffle: false,
    },
  ])
  const [tipFeed, setTipFeed] = useState<TipFeedItem[]>([
    { id: 't1', fanName: 'Fan123', amount: 50, target: 'Winner', timestamp: Date.now() - 30000 },
    { id: 't2', fanName: 'whale.tfuel', amount: 320, target: 'Winner', timestamp: Date.now() - 120000 },
    { id: 't3', fanName: 'crypto_fan', amount: 25, target: 'Loser', timestamp: Date.now() - 180000 },
  ])

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Simulate new tips coming in
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        const newTip: TipFeedItem = {
          id: `t-${Date.now()}`,
          fanName: `Fan${Math.floor(Math.random() * 1000)}`,
          amount: [10, 25, 50, 100, 200][Math.floor(Math.random() * 5)],
          target: Math.random() > 0.5 ? 'Winner' : 'Loser',
          timestamp: Date.now(),
        }
        setTipFeed((prev) => [newTip, ...prev].slice(0, 20))
      }
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  const eventEarnings = useMemo(() => {
    return activePools.reduce((sum, pool) => {
      const creatorCut = pool.currentPot * 0.1 // 10% cut
      return sum + creatorCut
    }, 0)
  }, [activePools])

  const allTimeEarnings = 12_450 // Mock all-time earnings

  const handleSharePool = async (pool: ActivePool) => {
    const poolUrl = `https://edgefarm.app/pool/${pool.id}`
    const tweetText = `🔥 My tip pool "${pool.eventName}" is live! Current pot: $${pool.currentPot.toLocaleString()}\n\nJoin the action: ${poolUrl}\n\n#EdgeFarm #TipPools`
    
    try {
      await Share.share({
        message: tweetText,
        title: 'Share Pool',
      })
    } catch (error) {
      // Share dialog was dismissed
    }
  }

  const handleWithdraw = () => {
    Alert.alert('Withdraw Earnings', 'Withdrawal functionality coming soon!', [{ text: 'OK' }])
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 100,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-row items-center justify-between">
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Creator Dashboard</Text>
          </View>

          {activePools.length === 0 ? (
            <View style={{ marginTop: 40, alignItems: 'center' }}>
              <NeonCard>
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
                    Host your first pool
                  </Text>
                  <Text style={{ ...type.bodyM, color: 'rgba(148,163,184,0.9)', textAlign: 'center', marginBottom: 20 }}>
                    Earn 10% cut + lottery hype
                  </Text>
                  <NeonButton label="Create New Pool" onPress={() => setCreateVisible(true)} />
                </View>
              </NeonCard>
            </View>
          ) : (
            <>
              {/* Earnings Card */}
              <NeonCard className="mt-3">
                <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(148,163,184,0.9)' }}>
                  Earnings
                </Text>
                <EarningsAmount amount={eventEarnings} label="Your cut this event" />
                <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.70)' }}>All-time earnings</Text>
                  <Text style={{ ...type.h3, marginTop: 4, color: neon.blue }}>
                    ${allTimeEarnings.toLocaleString()}
                  </Text>
                </View>
              </NeonCard>

              {/* Live Tip Feed */}
              <NeonCard className="mt-3">
                <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(148,163,184,0.9)' }}>
                  Live Tip Feed
                </Text>
                <ScrollView
                  style={{ maxHeight: 200 }}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {tipFeed.map((tip, idx) => (
                    <TipFeedRow key={tip.id} tip={tip} isNew={idx === 0} />
                  ))}
                </ScrollView>
              </NeonCard>

              {/* My Active Pools */}
              <View style={{ marginTop: 18 }}>
                <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(255,255,255,0.70)' }}>
                  My Active Pools
                </Text>
                {activePools.map((pool) => (
                  <PoolCard key={pool.id} pool={pool} tick={tick} onShare={() => handleSharePool(pool)} />
                ))}
              </View>

              {/* Quick Actions */}
              <View style={{ marginTop: 20 }}>
                <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(255,255,255,0.70)' }}>
                  Quick Actions
                </Text>
                <View className="flex-row gap-3">
                  <View style={{ flex: 1 }}>
                    <NeonButton label="Create New Pool" onPress={() => setCreateVisible(true)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <NeonButton
                      label="Withdraw Earnings"
                      variant="secondary"
                      onPress={handleWithdraw}
                    />
                  </View>
                </View>
                {activePools.length > 0 && (
                  <View style={{ marginTop: 10 }}>
                    <NeonButton
                      label={`Share "${activePools[0].eventName}"`}
                      variant="secondary"
                      onPress={() => handleSharePool(activePools[0])}
                    />
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>

        <CreatePoolModal visible={createVisible} onClose={() => setCreateVisible(false)} />
      </SafeAreaView>
    </ScreenBackground>
  )
}

function EarningsAmount({ amount, label }: { amount: number; label: string }) {
  const glow = useSharedValue(0)
  const pulse = useSharedValue(0)

  useEffect(() => {
    glow.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
    pulse.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    )
  }, [glow, pulse])

  const glowStyle = useAnimatedStyle(() => {
    const opacity = 0.6 + glow.value * 0.4
    return {
      textShadowColor: neon.pink,
      textShadowRadius: 20 * opacity,
      textShadowOffset: { width: 0, height: 0 },
    }
  })

  const containerStyle = useAnimatedStyle(() => {
    const scale = 1 + pulse.value * 0.02
    return {
      transform: [{ scale }],
    }
  })

  return (
    <Animated.View style={containerStyle}>
      <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.70)', marginBottom: 4 }}>{label}</Text>
      <Animated.Text style={[{ ...type.h2, color: neon.pink }, glowStyle]}>
        ${amount.toLocaleString()} (10%)
      </Animated.Text>
    </Animated.View>
  )
}

function TipFeedRow({ tip, isNew }: { tip: TipFeedItem; isNew: boolean }) {
  const pulse = useSharedValue(isNew ? 1 : 0)
  const glow = useSharedValue(isNew ? 1 : 0)

  useEffect(() => {
    if (isNew) {
      pulse.value = withTiming(0, { duration: 2000, easing: Easing.out(Easing.quad) })
      glow.value = withTiming(0, { duration: 2500, easing: Easing.out(Easing.quad) })
    }
  }, [isNew, pulse, glow])

  const pulseStyle = useAnimatedStyle(() => {
    if (!isNew) return {}
    const glowOpacity = 0.3 + glow.value * 0.4
    return {
      opacity: 0.7 + pulse.value * 0.3,
      transform: [{ scale: 1 + pulse.value * 0.08 }],
      backgroundColor: `rgba(${tip.target === 'Winner' ? '56,189,248' : '244,114,182'}, ${glowOpacity * 0.15})`,
      borderWidth: 1,
      borderColor: `rgba(${tip.target === 'Winner' ? '56,189,248' : '244,114,182'}, ${0.3 + glow.value * 0.5})`,
    }
  })

  const dotGlowStyle = useAnimatedStyle(() => {
    if (!isNew) return {}
    return {
      shadowColor: tip.target === 'Winner' ? neon.blue : neon.pink,
      shadowOpacity: 0.8 + glow.value * 0.2,
      shadowRadius: 8 + glow.value * 4,
    }
  })

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 8,
          paddingHorizontal: 8,
          borderRadius: 12,
          marginBottom: 6,
        },
        pulseStyle,
      ]}
    >
      <Animated.View
        style={[
          {
            width: 8,
            height: 8,
            borderRadius: 999,
            marginRight: 10,
            backgroundColor: tip.target === 'Winner' ? neon.blue : neon.pink,
          },
          dotGlowStyle,
        ]}
      />
      <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)', flex: 1 }}>
        <Text style={{ color: neon.blue, fontWeight: '600' }}>{tip.fanName}</Text> tipped ${tip.amount} to{' '}
        <Text style={{ color: tip.target === 'Winner' ? neon.blue : neon.pink }}>{tip.target}</Text>
      </Text>
    </Animated.View>
  )
}

function PoolCard({
  pool,
  tick,
  onShare,
}: {
  pool: ActivePool
  tick: number
  onShare: () => void
}) {
  const remaining = Math.max(0, pool.endsAtMs - Date.now())
  const mm = Math.floor(remaining / 60000)
  const ss = Math.floor((remaining % 60000) / 1000)
  const countdown = `${mm}:${ss.toString().padStart(2, '0')}`

  return (
    <NeonCard className="mt-2">
      <View className="flex-row items-start justify-between">
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)' }}>{pool.eventName}</Text>
          <View style={{ marginTop: 8, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>Countdown</Text>
              <Text style={{ ...type.bodyM, color: neon.blue }}>{countdown}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>Current pot</Text>
              <Text style={{ ...type.bodyM, color: neon.purple }}>
                ${pool.currentPot.toLocaleString()}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>Tip velocity</Text>
              <Text style={{ ...type.bodyM, color: neon.pink }}>
                {pool.tipVelocity.toFixed(1)}/min
              </Text>
            </View>
          </View>
        </View>
      </View>

      {pool.hasNftRaffle && pool.nftName && (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: 'rgba(168,85,247,0.7)',
            backgroundColor: 'rgba(168,85,247,0.15)',
          }}
        >
          <Text style={{ ...type.caption, color: neon.purple, marginBottom: 4, fontWeight: '600' }}>
            ✨ NFT Raffle Active
          </Text>
          <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)' }}>
            Your pool has NFT raffle — promote for bigger tips
          </Text>
          <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(248,250,252,0.85)' }}>
            Fans who tip $100+ automatically enter raffle for {pool.nftName}
          </Text>
        </View>
      )}

      {pool.isLoserPool && pool.loserPot && (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(244,114,182,0.5)',
            backgroundColor: 'rgba(24,16,59,0.4)',
          }}
        >
          <Text style={{ ...type.caption, color: neon.pink, marginBottom: 4 }}>Lottery Status</Text>
          <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.90)' }}>
            Your loser tips fed ${pool.loserPot.toLocaleString()} pot
          </Text>
        </View>
      )}

      <View style={{ marginTop: 12 }}>
        <NeonButton label="Share Pool" variant="secondary" onPress={onShare} />
      </View>
    </NeonCard>
  )
}

// Reuse CreatePoolModal from PoolsScreen
function CreatePoolModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [preset, setPreset] = useState<'degen' | 'fair' | 'whale'>('degen')
  const [loserCut, setLoserCut] = useState(35)
  const [starDonateCut, setStarDonateCut] = useState(25)
  const [globalCut, setGlobalCut] = useState(10)

  useEffect(() => {
    if (preset === 'degen') {
      setLoserCut(45)
      setStarDonateCut(15)
      setGlobalCut(5)
    } else if (preset === 'fair') {
      setLoserCut(30)
      setStarDonateCut(25)
      setGlobalCut(10)
    } else {
      // whale
      setLoserCut(18)
      setStarDonateCut(10)
      setGlobalCut(7)
    }
  }, [preset])

  const notional = 10_000
  const loserPotPreview = Math.round((notional * loserCut) / 100)
  const starPotPreview = Math.round((notional * (100 - loserCut - globalCut)) / 100)
  const globalPreview = Math.round((notional * globalCut) / 100)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(5,5,15,0.85)',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 26,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            backgroundColor: '#020617',
            borderTopWidth: 1,
            borderColor: 'rgba(148,163,184,0.35)',
          }}
        >
          <Text style={{ ...type.h3, color: 'rgba(248,250,252,0.96)' }}>Design a fan game</Text>
          <Text style={{ ...type.caption, marginTop: 8, color: 'rgba(148,163,184,0.95)' }}>
            Pick a vibe, then tune how much goes to loser lottery, star pot, and protocol.
          </Text>

          {/* Preset chips */}
          <View style={{ marginTop: 16 }}>
            <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Pool preset</Text>
            <View className="mt-2 flex-row gap-2">
              {[
                { id: 'degen', label: 'DeGen Roulette', desc: 'max chaos · huge loser pot' },
                { id: 'fair', label: 'Fair Play', desc: 'fans & star balanced' },
                { id: 'whale', label: 'Whale Lounge', desc: 'star-forward, softer lottery' },
              ].map((p) => {
                const active = preset === p.id
                return (
                  <TouchableOpacity
                    key={p.id}
                    activeOpacity={0.9}
                    onPress={() => setPreset(p.id as typeof preset)}
                    style={{
                      flex: 1,
                      borderRadius: 16,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: active
                        ? 'rgba(168,85,247,0.9)'
                        : 'rgba(148,163,184,0.7)',
                      backgroundColor: active
                        ? 'rgba(30,64,175,0.95)'
                        : 'rgba(15,23,42,0.95)',
                    }}
                  >
                    <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>{p.label}</Text>
                    <Text
                      style={{
                        ...type.caption,
                        marginTop: 2,
                        color: 'rgba(148,163,184,0.9)',
                      }}
                    >
                      {p.desc}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Cuts row */}
          <View style={{ marginTop: 16 }}>
            <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Pool weighting</Text>
            <View className="mt-3 flex-row gap-3">
              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(244,114,182,0.8)',
                  backgroundColor: 'rgba(24,16,59,0.95)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>Loser lottery</Text>
                <Text
                  style={{
                    ...type.h3,
                    marginTop: 4,
                    color: neon.pink,
                  }}
                >
                  {loserCut}%
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 2,
                    color: 'rgba(248,250,252,0.76)',
                  }}
                >
                  loser-side tips → fan jackpot
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(56,189,248,0.8)',
                  backgroundColor: 'rgba(7,16,29,0.95)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>Star win pot</Text>
                <Text
                  style={{
                    ...type.h3,
                    marginTop: 4,
                    color: neon.blue,
                  }}
                >
                  {100 - loserCut - globalCut}%
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 2,
                    color: 'rgba(148,163,184,0.9)',
                  }}
                >
                  base star share if they win
                </Text>
              </View>
            </View>

            <View className="mt-3 flex-row gap-3">
              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(251,191,36,0.8)',
                  backgroundColor: 'rgba(24,24,48,0.95)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>Star donates</Text>
                <Text
                  style={{
                    ...type.h3,
                    marginTop: 4,
                    color: 'rgba(251,191,36,0.98)',
                  }}
                >
                  {starDonateCut}%
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 2,
                    color: 'rgba(148,163,184,0.9)',
                  }}
                >
                  of their win pot to fans / causes
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(148,163,184,0.8)',
                  backgroundColor: 'rgba(15,23,42,0.95)',
                }}
              >
                <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>Global cut</Text>
                <Text
                  style={{
                    ...type.h3,
                    marginTop: 4,
                    color: 'rgba(148,163,184,0.98)',
                  }}
                >
                  {globalCut}%
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    marginTop: 2,
                    color: 'rgba(148,163,184,0.9)',
                  }}
                >
                  protocol / infra / treasury
                </Text>
              </View>
            </View>
          </View>

          {/* Notional preview */}
          <View style={{ marginTop: 16 }}>
            <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>
              If this pool sees 10,000 TFUEL in tips (mock)
            </Text>
            <View
              style={{
                marginTop: 8,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: 'rgba(56,189,248,0.6)',
                backgroundColor: 'rgba(7,16,29,0.95)',
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text style={{ ...type.caption, color: neon.pink }}>
                Fan lottery jackpot ≈ {loserPotPreview.toLocaleString()} TFUEL
              </Text>
              <Text style={{ ...type.caption, marginTop: 4, color: neon.blue }}>
                Star win pot ≈ {starPotPreview.toLocaleString()} TFUEL
              </Text>
              <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(148,163,184,0.95)' }}>
                Global / protocol ≈ {globalPreview.toLocaleString()} TFUEL
              </Text>
            </View>
          </View>

          <View style={{ marginTop: 18, flexDirection: 'row', columnGap: 10 }}>
            <View style={{ flex: 1 }}>
              <NeonButton label="Save template (mock)" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <NeonButton label="Close" variant="secondary" onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

