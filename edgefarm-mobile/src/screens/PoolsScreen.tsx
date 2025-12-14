import React, { useEffect, useMemo, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { ScreenBackground } from '../components/ScreenBackground'
import { TipSuccessOverlay } from '../components/TipSuccessOverlay'
import { getAppExtra } from '../lib/appConfig'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'

type EventRow = {
  id: string
  title: string
  winnerPot: number
  loserPot: number
  lotteryPot: number
  endsAtMs: number
}

export function PoolsScreen() {
  const [successVisible, setSuccessVisible] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const { lotteryJackpot, globalLotteryCutBps } = getAppExtra()
  const globalLotteryPct = (globalLotteryCutBps / 100).toFixed(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const events: EventRow[] = useMemo(
    () => [
      {
        id: 'e1',
        title: 'Cloud9 vs Dignitas Finals',
        winnerPot: 124_800,
        loserPot: 78_300,
        lotteryPot: 22_340,
        endsAtMs: Date.now() + 1000 * 60 * 38,
      },
      {
        id: 'e2',
        title: 'Sentinels vs LOUD Showmatch',
        winnerPot: 64_250,
        loserPot: 41_900,
        lotteryPot: 11_750,
        endsAtMs: Date.now() + 1000 * 60 * 12,
      },
      {
        id: 'e3',
        title: 'T1 vs Gen.G Grand Final',
        winnerPot: 92_110,
        loserPot: 58_420,
        lotteryPot: 15_980,
        endsAtMs: Date.now() + 1000 * 60 * 22,
      },
    ],
    []
  )

  const tip = (side: 'winner' | 'loser', eventTitle: string) => {
    const entered = side === 'loser'
    setSuccessMsg(
      entered
        ? `You entered ${lotteryJackpot} lottery (${globalLotteryPct}% global pot)\nEvent: ${eventTitle}`
        : `Tip placed on Winner\nEvent: ${eventTitle}`
    )
    setSuccessVisible(true)
  }

  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <View className="px-4 pt-3">
          <View className="flex-row items-center justify-between">
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Tip Pools</Text>
            <NeonPill label={`Jackpot ${lotteryJackpot}`} tone="pink" />
          </View>
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
        </View>

        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 12 }}
          renderItem={({ item }) => (
            <NeonCard>
              <View className="flex-row items-start justify-between">
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)' }}>{item.title}</Text>
                  <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.52)' }}>
                    Live event · viral tipping · instant settlement
                  </Text>
                </View>

                <CountdownPill endsAtMs={item.endsAtMs} tick={tick} />
              </View>

              <View style={{ marginTop: 14 }}>
                <PotRow label="Winner pot" value={item.winnerPot} tone="blue" />
                <View style={{ height: 10 }} />
                <PotRow label="Loser pot" value={item.loserPot} tone="purple" />
                <View style={{ height: 10 }} />
                <PotRow label={`${globalLotteryPct}% Lottery pot`} value={item.lotteryPot} tone="pink" />
              </View>

              <View style={{ marginTop: 14 }}>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>Momentum gauge</Text>
                <View style={{ marginTop: 10 }}>
                  <WinnerLoserGauge winner={item.winnerPot} loser={item.loserPot} />
                </View>
              </View>

              <View className="mt-4 flex-row gap-3">
                <View className="flex-1">
                  <NeonButton label="Tip Winner" onPress={() => tip('winner', item.title)} />
                </View>
                <View className="flex-1">
                  <NeonButton
                    label="Tip Loser (enter lottery)"
                    variant="secondary"
                    onPress={() => tip('loser', item.title)}
                    rightHint={`${globalLotteryPct}% → lottery`}
                  />
                </View>
              </View>

              <Text style={{ ...type.caption, marginTop: 12, color: 'rgba(255,255,255,0.46)' }}>
                Tip Loser = lottery ticket. Tip Winner = pure pot exposure.
              </Text>
            </NeonCard>
          )}
        />

        <TipSuccessOverlay
          visible={successVisible}
          message={successMsg}
          onClose={() => setSuccessVisible(false)}
        />
      </SafeAreaView>
    </ScreenBackground>
  )
}

function PotRow({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'purple' | 'pink' }) {
  const c =
    tone === 'blue' ? neon.blue : tone === 'pink' ? neon.pink : neon.purple
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.70)' }}>{label}</Text>
      <Text style={{ ...type.bodyM, color: c }}>${value.toLocaleString()}</Text>
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
  const remaining = Math.max(0, endsAtMs - Date.now())
  const mm = Math.floor(remaining / 60000)
  const ss = Math.floor((remaining % 60000) / 1000)
  const text = `${mm}:${ss.toString().padStart(2, '0')}`
  return <NeonPill label={`Lottery in ${text}`} tone="blue" />
}
