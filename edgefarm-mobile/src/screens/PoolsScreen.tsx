import React, { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native'
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
import { TipSuccessOverlay } from '../components/TipSuccessOverlay'
import { LotteryWinExplosion } from '../components/LotteryWinExplosion'
import { getAppExtra } from '../lib/appConfig'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'

type EventRow = {
  id: string
  title: string
  starA: string
  starB: string
  winnerPot: number
  loserPot: number
  lotteryPot: number
  endsAtMs: number
  hasNftRaffle?: boolean
  nftName?: string
}

type ActivityItem = {
  id: string
  label: string
  tone: 'blue' | 'purple' | 'pink'
}

type Ticket = {
  id: string
  eventId: string
}

export function PoolsScreen() {
  const [successVisible, setSuccessVisible] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const { lotteryJackpot, globalLotteryCutBps } = getAppExtra()
  const globalLotteryPct = (globalLotteryCutBps / 100).toFixed(0)
  const [tick, setTick] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resolvedEventIds, setResolvedEventIds] = useState<string[]>([])
  const [createVisible, setCreateVisible] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [isSpinning, setIsSpinning] = useState(false)
  const [starDonatePct, setStarDonatePct] = useState(25)
  const [starNftBountyOn, setStarNftBountyOn] = useState(true)
  const [selectedSide, setSelectedSide] = useState<'star' | 'lottery'>('star')
  const [tipAmount, setTipAmount] = useState<number>(10)
  const [lotteryWinVisible, setLotteryWinVisible] = useState(false)
  const [lotteryWinAmount, setLotteryWinAmount] = useState(0)
  const [lotteryWinNft, setLotteryWinNft] = useState<{ id: string; name: string; rarity: 'Mythic' | 'Legendary' | 'Epic' | 'Rare' } | undefined>(undefined)
  const [raffleEntryGlow, setRaffleEntryGlow] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Seed arena feed with a few mock live events
  useEffect(() => {
    setActivity([
      {
        id: 'a1',
        label: 'whale.tfuel tipped $320 on Winner in Cloud9 vs Dignitas',
        tone: 'blue',
      },
      {
        id: 'a2',
        label: 'star.dignitas donated 20% of winner pot to fan lottery',
        tone: 'pink',
      },
      {
        id: 'a3',
        label: '3 NFTs dropped to loser-side fans (mock)',
        tone: 'purple',
      },
    ])
  }, [])

  const events: EventRow[] = useMemo(
    () => [
      {
        id: 'e1',
        title: 'Cloud9 vs Dignitas Finals',
        starA: 'Cloud9',
        starB: 'Dignitas',
        winnerPot: 124_800,
        loserPot: 78_300,
        lotteryPot: 22_340,
        endsAtMs: Date.now() + 1000 * 60 * 38,
        hasNftRaffle: true,
        nftName: 'Signed Cloud9 Jersey',
      },
      {
        id: 'e2',
        title: 'Sentinels vs LOUD Showmatch',
        starA: 'Sentinels',
        starB: 'LOUD',
        winnerPot: 64_250,
        loserPot: 41_900,
        lotteryPot: 11_750,
        endsAtMs: Date.now() + 1000 * 60 * 12,
        hasNftRaffle: false,
      },
      {
        id: 'e3',
        title: 'T1 vs Gen.G Grand Final',
        starA: 'T1',
        starB: 'Gen.G',
        winnerPot: 92_110,
        loserPot: 58_420,
        lotteryPot: 15_980,
        endsAtMs: Date.now() + 1000 * 60 * 22,
        hasNftRaffle: true,
        nftName: 'T1 Champions Trophy',
      },
    ],
    []
  )

  useEffect(() => {
    if (!selectedId && events.length > 0) {
      setSelectedId(events[0].id)
    }
  }, [events, selectedId])

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) ?? events[0],
    [events, selectedId]
  )

  const selectedEventTickets = useMemo(
    () => tickets.filter((t) => t.eventId === selectedEvent?.id),
    [tickets, selectedEvent?.id]
  )

  // When a pool timer hits zero, fire a mock lottery result once per event
  useEffect(() => {
    events.forEach((e) => {
      if (resolvedEventIds.includes(e.id)) return
      const remaining = e.endsAtMs - Date.now()
      if (remaining > 0) return

      const fanWins = Math.random() < 0.5
      if (fanWins) {
        const fanPrize = Math.round(e.loserPot * 0.35)
        // Use cinematic lottery win explosion for big wins
        setLotteryWinAmount(fanPrize)
        if (e.hasNftRaffle && e.nftName) {
          setLotteryWinNft({
            id: `nft-${e.id}`,
            name: e.nftName,
            rarity: 'Legendary',
          })
        } else {
          setLotteryWinNft(undefined)
        }
        setLotteryWinVisible(true)
      } else {
        const starCut = Math.round(e.loserPot * 0.1)
        setSuccessMsg(
          `Your fans tipped $${e.loserPot.toLocaleString()} — your cut $${starCut.toLocaleString()}.`
        )
        setSuccessVisible(true)
      }
      setResolvedEventIds((prev) => [...prev, e.id])
    })
  }, [tick, events, resolvedEventIds])

  const tip = (side: 'winner' | 'loser', eventTitle: string) => {
    const entered = side === 'loser'
    const activeEvent = selectedEvent
    const ticketId = `#${(tickets.length + 1).toString().padStart(4, '0')}`
    const isNftRaffleEntry = tipAmount >= 100 && activeEvent?.hasNftRaffle

    if (isSpinning) return
    setIsSpinning(true)

    // Show raffle entry glow for $100+ tips on NFT raffle pools
    if (isNftRaffleEntry) {
      setRaffleEntryGlow(true)
      setTimeout(() => setRaffleEntryGlow(false), 2000)
    }

    // Update arena feed
    setActivity((prev) => {
      const label = entered
        ? isNftRaffleEntry
          ? `You tipped $${tipAmount} on Star ${activeEvent?.starB} — entered NFT raffle for ${activeEvent?.nftName}!`
          : `You tipped Star ${activeEvent?.starB} on loser side – ticket ${ticketId} minted`
        : `You tipped Star ${activeEvent?.starA} – winner pot boosted`
      const next: ActivityItem = {
        id: `a-${Date.now()}`,
        label,
        tone: entered ? 'purple' : 'blue',
      }
      // keep feed tight and fast
      return [next, ...prev].slice(0, 8)
    })

    // Mint a mock ticket on loser tips
    if (entered && activeEvent) {
      setTickets((prev) => [
        ...prev,
        {
          id: ticketId,
          eventId: activeEvent.id,
        },
      ])
    }

    const spinLabel = entered
      ? isNftRaffleEntry
        ? `You're entered! NFT raffle ticket for ${activeEvent?.nftName} minted.`
        : `Spinning loser-side lottery for ${eventTitle}…`
      : `Slotting your Star tip into ${eventTitle} winner pot…`

    setSuccessMsg(spinLabel)
    setSuccessVisible(true)

    // After a short "spin", reveal the final outcome copy
    setTimeout(() => {
      setSuccessMsg(
        entered
          ? isNftRaffleEntry
            ? `You're entered in the NFT raffle for ${activeEvent?.nftName}!\nTip $${tipAmount} TFUEL on Star ${activeEvent?.starB} loser side.\nPlus you entered ${lotteryJackpot} lottery (${globalLotteryPct}% global pot).`
            : `Ticket minted for ${eventTitle}\nYou tipped ${tipAmount} TFUEL on Star ${activeEvent?.starB} loser side.\nYou entered ${lotteryJackpot} lottery (${globalLotteryPct}% global pot).`
          : `Tip placed on Star ${activeEvent?.starA}\nYou tipped ${tipAmount} TFUEL into the winner pot for ${eventTitle}.`
      )
      setIsSpinning(false)
    }, 900)
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 28,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-row items-center justify-between">
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Tip Pools</Text>
            <NeonPill label={`Jackpot ${lotteryJackpot}`} tone="pink" />
          </View>

          {/* Live arena feed ticker */}
          {activity.length > 0 && (
            <NeonCard className="mt-3">
              <Text style={{ ...type.caption, marginBottom: 4, color: 'rgba(148,163,184,0.9)' }}>
                Live fan arena
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 2 }}
              >
                {activity.map((a) => (
                  <View
                    key={a.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      marginRight: 8,
                      borderWidth: 1,
                      borderColor:
                        a.tone === 'blue'
                          ? 'rgba(56,189,248,0.6)'
                          : a.tone === 'pink'
                          ? 'rgba(244,114,182,0.7)'
                          : 'rgba(168,85,247,0.7)',
                      backgroundColor: 'rgba(15,23,42,0.90)',
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        marginRight: 6,
                        backgroundColor:
                          a.tone === 'blue'
                            ? 'rgba(34,211,238,1)'
                            : a.tone === 'pink'
                            ? 'rgba(244,114,182,1)'
                            : 'rgba(192,132,252,1)',
                      }}
                    />
                    <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>{a.label}</Text>
                  </View>
                ))}
              </ScrollView>
            </NeonCard>
          )}

          <View
            className="mt-3 rounded-2xl border px-4 py-3"
            style={{ borderColor: 'rgba(251, 113, 133, 0.35)', backgroundColor: 'rgba(251, 113, 133, 0.10)' }}
          >
            <Text style={{ ...type.bodyM, color: neon.pink }}>
              {globalLotteryPct}% of every tip feeds the global lottery
            </Text>
            <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.58)' }}>
              Tip Loser to enter the global draw. Tip Winner for pure pot exposure.
            </Text>
          </View>

          {/* For You row */}
          <View style={{ marginTop: 18 }}>
            <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(255,255,255,0.70)' }}>
              For you
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ columnGap: 10, paddingVertical: 4 }}
            >
              {events.map((e) => {
                const selected = e.id === selectedEvent?.id
                return (
                  <TouchableOpacity
                    key={e.id}
                    activeOpacity={0.9}
                    onPress={() => setSelectedId(e.id)}
                  >
                    <NeonPill
                      label={`${e.starA} vs ${e.starB}`}
                      tone="purple"
                    />
                    <Text
                      style={{
                        ...type.caption,
                        marginTop: 4,
                        textAlign: 'center',
                        color: selected ? 'rgba(248,250,252,0.95)' : 'rgba(148,163,184,0.9)',
                      }}
                    >
                      <CountdownLabel endsAtMs={e.endsAtMs} tick={tick} />
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>

          {/* On fire row */}
          <View style={{ marginTop: 14 }}>
            <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(255,255,255,0.70)' }}>
              On fire
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ columnGap: 10, paddingVertical: 4 }}
            >
              {events.map((e) => {
                const selected = e.id === selectedEvent?.id
                return (
                  <TouchableOpacity
                    key={`hot-${e.id}`}
                    activeOpacity={0.9}
                    onPress={() => setSelectedId(e.id)}
                  >
                    <View>
                      <NeonPill
                        label={`${e.title.replace('Grand Final', 'GF')}`}
                        tone="pink"
                      />
                      {/* tiny heat bar */}
                      <View
                        style={{
                          marginTop: 4,
                          height: 3,
                          borderRadius: 999,
                          backgroundColor: 'rgba(15,23,42,0.8)',
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            width: '72%',
                            height: '100%',
                            backgroundColor: 'rgba(244,114,182,0.9)',
                          }}
                        />
                      </View>
                      <Text
                        style={{
                          ...type.caption,
                          marginTop: 2,
                          textAlign: 'center',
                          color: selected ? 'rgba(248,250,252,0.95)' : 'rgba(148,163,184,0.9)',
                        }}
                      >
                        Fan heat · 72 (mock)
                      </Text>
                    </View>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>

          {/* Custom fan games row */}
          <View style={{ marginTop: 14 }}>
            <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(255,255,255,0.70)' }}>
              Custom fan games
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ columnGap: 10, paddingVertical: 4 }}
            >
              {events.map((e, idx) => {
                const selected = e.id === selectedEvent?.id
                const label =
                  idx === 0 ? 'DeGen Roulette' : idx === 1 ? 'Fair Play Arena' : 'Whale Lounge'
                return (
                  <TouchableOpacity
                    key={`fan-${e.id}`}
                    activeOpacity={0.9}
                    onPress={() => setSelectedId(e.id)}
                  >
                    <NeonPill label={label} tone="blue" />
                    <Text
                      style={{
                        ...type.caption,
                        marginTop: 4,
                        textAlign: 'center',
                        color: selected ? 'rgba(248,250,252,0.95)' : 'rgba(148,163,184,0.9)',
                      }}
                    >
                      Linked to {e.starA} vs {e.starB}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>

          {selectedEvent && (
            <View style={{ marginTop: 18 }}>
              <NeonCard>
                <View className="flex-row items-start justify-between">
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)' }}>{selectedEvent.title}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                      <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.52)' }}>
                        {selectedEvent.starA} vs {selectedEvent.starB} · live fan arena
                      </Text>
                      <View
                        style={{
                          marginLeft: 8,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: 'rgba(251,191,36,0.85)',
                          backgroundColor: 'rgba(24,24,48,0.96)',
                        }}
                      >
                        <Text
                          style={{
                            ...type.caption,
                            fontSize: 10,
                            color: 'rgba(251,191,36,0.96)',
                          }}
                        >
                          Star Heat 87
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <CountdownRing endsAtMs={selectedEvent.endsAtMs} tick={tick}>
                      <CountdownPill endsAtMs={selectedEvent.endsAtMs} tick={tick} />
                    </CountdownRing>
                  </View>
                </View>

                {/* Side selection chips */}
                <View style={{ marginTop: 14 }}>
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>
                    Choose your move
                  </Text>
                  <View className="mt-2 flex-row gap-2">
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setSelectedSide('star')}
                      style={{
                        flex: 1,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderWidth: 1,
                        borderColor:
                          selectedSide === 'star'
                            ? 'rgba(56,189,248,0.9)'
                            : 'rgba(148,163,184,0.65)',
                        backgroundColor:
                          selectedSide === 'star'
                            ? 'rgba(15,23,42,0.95)'
                            : 'rgba(15,23,42,0.85)',
                      }}
                    >
                      <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>
                        Tip Star {selectedEvent.starA}
                      </Text>
                      <Text
                        style={{
                          ...type.caption,
                          marginTop: 2,
                          color: 'rgba(148,163,184,0.9)',
                        }}
                      >
                        Winner pot side
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setSelectedSide('lottery')}
                      style={{
                        flex: 1,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderWidth: 1,
                        borderColor:
                          selectedSide === 'lottery'
                            ? 'rgba(244,114,182,0.9)'
                            : 'rgba(148,163,184,0.65)',
                        backgroundColor:
                          selectedSide === 'lottery'
                            ? 'rgba(24,16,59,0.95)'
                            : 'rgba(15,23,42,0.85)',
                      }}
                    >
                      <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>
                        Tip Star {selectedEvent.starB}
                      </Text>
                      <Text
                        style={{
                          ...type.caption,
                          marginTop: 2,
                          color: 'rgba(248,113,113,0.9)',
                        }}
                      >
                        Loser pot → fan lottery
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ marginTop: 14 }}>
                  <PotRow label="Winner pot" value={selectedEvent.winnerPot} tone="blue" />
                  <View style={{ height: 10 }} />
                  <PotRow label="Loser pot" value={selectedEvent.loserPot} tone="purple" />
                  <View style={{ height: 10 }} />
                  <PotRow
                    label={`${globalLotteryPct}% Lottery pot`}
                    value={selectedEvent.lotteryPot}
                    tone="pink"
                    pulse
                  />
                </View>

                {/* NFT Raffle Banner */}
                {selectedEvent.hasNftRaffle && selectedEvent.nftName && (
                  <RaffleEntryBanner
                    nftName={selectedEvent.nftName}
                    tipAmount={tipAmount}
                    showGlow={raffleEntryGlow}
                  />
                )}

                <View style={{ marginTop: 14 }}>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>Momentum gauge</Text>
                  <View style={{ marginTop: 10 }}>
                    <WinnerLoserGauge
                      winner={selectedEvent.winnerPot}
                      loser={selectedEvent.loserPot}
                    />
                  </View>
                </View>

                {/* Amount chips */}
                <View style={{ marginTop: 14 }}>
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>
                    How spicy is this tip?
                  </Text>
                  <View className="mt-2 flex-row gap-2 flex-wrap">
                    {[5, 10, 25, 50, 100].map((amt) => {
                      const active = tipAmount === amt
                      const isNftEntry = amt >= 100 && selectedEvent?.hasNftRaffle
                      return (
                        <TouchableOpacity
                          key={amt}
                          activeOpacity={0.9}
                          onPress={() => setTipAmount(amt)}
                          style={{
                            flex: amt === 100 ? 1 : undefined,
                            minWidth: amt === 100 ? '100%' : undefined,
                            borderRadius: 999,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            marginBottom: amt === 100 ? 0 : 0,
                            borderWidth: 1,
                            borderColor: active
                              ? isNftEntry
                                ? 'rgba(168,85,247,0.95)'
                                : 'rgba(168,85,247,0.9)'
                              : isNftEntry
                              ? 'rgba(168,85,247,0.6)'
                              : 'rgba(148,163,184,0.6)',
                            backgroundColor: active
                              ? isNftEntry
                                ? 'rgba(168,85,247,0.25)'
                                : 'rgba(30,64,175,0.95)'
                              : isNftEntry
                              ? 'rgba(168,85,247,0.15)'
                              : 'rgba(15,23,42,0.9)',
                          }}
                        >
                          <Text
                            style={{
                              ...type.caption,
                              textAlign: 'center',
                              color: isNftEntry ? 'rgba(248,250,252,0.98)' : 'rgba(248,250,252,0.98)',
                              fontWeight: isNftEntry ? '600' : 'normal',
                            }}
                          >
                            {amt} TFUEL {isNftEntry ? '✨' : ''}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  <Text
                    style={{
                      ...type.caption,
                      marginTop: 4,
                      color: 'rgba(148,163,184,0.9)',
                    }}
                  >
                    One tap · {tipAmount} TFUEL · no gas UX (mock)
                  </Text>
                </View>

                {/* Ticket + odds visualization */}
                <View style={{ marginTop: 14 }}>
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>
                    Your fan lottery tickets (mock)
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingVertical: 6, paddingRight: 4 }}
                    style={{ marginTop: 6 }}
                  >
                    {selectedEventTickets.length === 0 ? (
                      <View
                        style={{
                          borderRadius: 999,
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderWidth: 1,
                          borderColor: 'rgba(148,163,184,0.55)',
                          backgroundColor: 'rgba(15,23,42,0.9)',
                        }}
                      >
                        <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>
                          Tip Loser to mint your first ticket
                        </Text>
                      </View>
                    ) : (
                      selectedEventTickets.map((t) => (
                        <View
                          key={t.id}
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            marginRight: 8,
                            borderWidth: 1,
                            borderColor: 'rgba(244,114,182,0.75)',
                            backgroundColor: 'rgba(30,64,175,0.9)',
                          }}
                        >
                          <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.96)' }}>{t.id}</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                  {selectedEventTickets.length > 0 && (
                    <Text
                      style={{
                        ...type.caption,
                        marginTop: 2,
                        color: 'rgba(56,189,248,0.9)',
                      }}
                    >
                      You · {selectedEventTickets.length} tickets · ~1.2% odds (mock)
                    </Text>
                  )}
                </View>

                <View className="mt-4 flex-row gap-3">
                  <View className="flex-1">
                    <NeonButton
                      label={isSpinning ? 'Spinning…' : `Tip Star ${selectedEvent.starA}`}
                      onPress={() => tip('winner', selectedEvent.title)}
                      disabled={isSpinning}
                    />
                  </View>
                  <View className="flex-1">
                    <NeonButton
                      label={
                        isSpinning
                          ? 'Spinning…'
                          : `Tip Star ${selectedEvent.starB} (fan lottery if they lose)`
                      }
                      variant="secondary"
                      onPress={() => tip('loser', selectedEvent.title)}
                      rightHint={`${globalLotteryPct}% → lottery`}
                      disabled={isSpinning}
                    />
                  </View>
                </View>

                {/* Engage Fans strip (fan + star preview) */}
                <View style={{ marginTop: 10 }}>
                  <Text style={{ ...type.caption, marginBottom: 4, color: 'rgba(148,163,184,0.95)' }}>
                    Engage this star&apos;s fans
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <EngageChip label={`Star donates ${starDonatePct}% pot to lottery`} tone="pink" />
                    {starNftBountyOn && <EngageChip label="3x NFT bounty if pot hits $20k" tone="purple" />}
                    <EngageChip label="Auto-join next Cloud9 pool" tone="blue" />
                  </View>
                  <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(148,163,184,0.85)' }}>
                    Creator preview (mock) — adjust on Star Console to change fan-facing promises.
                  </Text>
                </View>

                <Text style={{ ...type.caption, marginTop: 10, color: 'rgba(255,255,255,0.46)' }}>
                  Tip Loser = lottery ticket. Tip Winner = pure pot exposure. Star incentives and NFTs are mocked for
                  now.
                </Text>
              </NeonCard>
            </View>
          )}

          <View style={{ marginTop: 20, alignItems: 'flex-end' }}>
            <NeonButton
              label="Create Pool"
              variant="secondary"
              onPress={() => setCreateVisible(true)}
            />
          </View>
        </ScrollView>

        <TipSuccessOverlay
          visible={successVisible}
          message={successMsg}
          onClose={() => setSuccessVisible(false)}
        />

        <LotteryWinExplosion
          visible={lotteryWinVisible}
          winAmount={lotteryWinAmount}
          nft={lotteryWinNft}
          onClose={() => setLotteryWinVisible(false)}
          apy={38}
        />

        <CreatePoolModal
          visible={createVisible}
          onClose={() => setCreateVisible(false)}
        />
      </SafeAreaView>
    </ScreenBackground>
  )
}

function RaffleEntryBanner({
  nftName,
  tipAmount,
  showGlow,
}: {
  nftName: string
  tipAmount: number
  showGlow: boolean
}) {
  const glow = useSharedValue(0)

  useEffect(() => {
    if (showGlow) {
      glow.value = withRepeat(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
        2,
        true
      )
    } else {
      glow.value = 0
    }
  }, [showGlow, glow])

  const glowStyle = useAnimatedStyle(() => {
    const opacity = showGlow ? 0.6 + glow.value * 0.4 : 0
    return {
      shadowColor: neon.purple,
      shadowOpacity: opacity,
      shadowRadius: 20 + glow.value * 16,
      shadowOffset: { width: 0, height: 0 },
      borderColor: showGlow
        ? `rgba(168,85,247,${0.8 + glow.value * 0.2})`
        : 'rgba(168,85,247,0.6)',
    }
  })

  const isEligible = tipAmount >= 100

  return (
    <Animated.View
      style={[
        {
          marginTop: 14,
          borderRadius: 16,
          padding: 14,
          borderWidth: 2,
          backgroundColor: isEligible ? 'rgba(168,85,247,0.15)' : 'rgba(15,23,42,0.85)',
        },
        glowStyle,
      ]}
    >
      {isEligible ? (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ ...type.bodyM, color: neon.purple, fontWeight: '600' }}>
              ✨ You're entered!
            </Text>
          </View>
          <Text style={{ ...type.caption, color: 'rgba(248,250,252,0.95)' }}>
            Tip ${tipAmount}+ to enter raffle for {nftName}
          </Text>
        </View>
      ) : (
        <Text style={{ ...type.bodyM, color: neon.purple }}>
          Tip $100+ to enter raffle for {nftName}
        </Text>
      )}
    </Animated.View>
  )
}

function PotRow({
  label,
  value,
  tone,
  pulse,
}: {
  label: string
  value: number
  tone: 'blue' | 'purple' | 'pink'
  pulse?: boolean
}) {
  const c = tone === 'blue' ? neon.blue : tone === 'pink' ? neon.pink : neon.purple

  const glow = useSharedValue(0)
  useEffect(() => {
    if (!pulse) return
    glow.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [pulse, glow])

  const amountStyle = useAnimatedStyle(() => {
    if (!pulse) return {}
    const scale = 1 + glow.value * 0.06
    const opacity = 0.4 + glow.value * 0.5
    return {
      transform: [{ scale }],
      textShadowColor: c,
      textShadowRadius: 14 * opacity,
      textShadowOffset: { width: 0, height: 0 },
    }
  })

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.70)' }}>{label}</Text>
      <Animated.Text style={[{ ...type.bodyM, color: c }, amountStyle]}>
        ${value.toLocaleString()}
      </Animated.Text>
    </View>
  )
}

function WinnerLoserGauge({ winner, loser }: { winner: number; loser: number }) {
  const total = Math.max(1, winner + loser)
  const w = winner / total
  const l = loser / total
  return (
    <View style={{ flexDirection: 'row', height: 12, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' }}>
      <View style={{ flex: w, backgroundColor: 'rgba(56,189,248,0.70)' }} />
      <View style={{ flex: l, backgroundColor: 'rgba(168,85,247,0.70)' }} />
    </View>
  )
}

function CountdownPill({ endsAtMs, tick }: { endsAtMs: number; tick: number }) {
  void tick
  const text = getCountdownText(endsAtMs)
  return <NeonPill label={`Lottery in ${text}`} tone="blue" />
}

function CountdownRing({
  endsAtMs,
  tick,
  children,
}: {
  endsAtMs: number
  tick: number
  children: React.ReactNode
}) {
  void tick
  const remaining = Math.max(0, endsAtMs - Date.now())
  const total = 45 * 60 * 1000 // assume max 45 min for visual only
  const pct = 1 - remaining / total

  const progress = useSharedValue(pct)

  useEffect(() => {
    const next = 1 - remaining / total
    progress.value = withTiming(Math.min(1, Math.max(0, next)), { duration: 400, easing: Easing.out(Easing.quad) })
  }, [remaining, total, progress])

  const ringStyle = useAnimatedStyle(() => {
    const scale = 1 + progress.value * 0.12
    const opacity = 0.4 + progress.value * 0.4
    return {
      opacity,
      transform: [{ scale }],
    }
  })

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 76,
            height: 76,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: 'rgba(56,189,248,0.65)',
            backgroundColor: 'rgba(15,23,42,0.85)',
          },
          ringStyle,
        ]}
      />
      {children}
    </View>
  )
}

function CountdownLabel({ endsAtMs, tick }: { endsAtMs: number; tick: number }) {
  void tick
  const text = getCountdownText(endsAtMs)
  return <>{text}</>
}

function getCountdownText(endsAtMs: number) {
  const remaining = Math.max(0, endsAtMs - Date.now())
  const mm = Math.floor(remaining / 60000)
  const ss = Math.floor((remaining % 60000) / 1000)
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

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

function EngageChip({ label, tone }: { label: string; tone: 'blue' | 'purple' | 'pink' }) {
  const borderColor =
    tone === 'blue'
      ? 'rgba(56,189,248,0.7)'
      : tone === 'pink'
      ? 'rgba(244,114,182,0.8)'
      : 'rgba(192,132,252,0.85)'
  const bgColor =
    tone === 'blue'
      ? 'rgba(15,23,42,0.95)'
      : tone === 'pink'
      ? 'rgba(76,29,149,0.9)'
      : 'rgba(15,23,42,0.9)'

  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor,
        backgroundColor: bgColor,
      }}
    >
      <Text style={{ ...type.caption, fontSize: 11, color: 'rgba(248,250,252,0.96)' }}>{label}</Text>
    </View>
  )
}
