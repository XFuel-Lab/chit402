import React, { useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native'
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createVisible, setCreateVisible] = useState(false)

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

  useEffect(() => {
    if (!selectedId && events.length > 0) {
      setSelectedId(events[0].id)
    }
  }, [events, selectedId])

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) ?? events[0],
    [events, selectedId]
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

          <View style={{ marginTop: 18 }}>
            <Text style={{ ...type.caption, marginBottom: 8, color: 'rgba(255,255,255,0.70)' }}>
              Popular pools right now
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ columnGap: 10, paddingVertical: 4 }}
            >
              {events.map((e) => {
                const selected = e.id === selectedEvent?.id
                const tone: 'blue' | 'purple' | 'pink' =
                  e.id === 'e1' ? 'blue' : e.id === 'e2' ? 'purple' : 'pink'
                return (
                  <TouchableOpacity
                    key={e.id}
                    activeOpacity={0.9}
                    onPress={() => setSelectedId(e.id)}
                  >
                    <NeonPill
                      label={e.title.replace('Grand Final', 'GF')}
                      tone={tone}
                    />
                    {selected && (
                      <Text
                        style={{
                          ...type.caption,
                          marginTop: 4,
                          textAlign: 'center',
                          color: 'rgba(248,250,252,0.80)',
                        }}
                      >
                        details ↓
                      </Text>
                    )}
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
                    <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.52)' }}>
                      Slide-up pool details · viral tipping · instant settlement
                    </Text>
                  </View>

                  <CountdownPill endsAtMs={selectedEvent.endsAtMs} tick={tick} />
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
                  />
                </View>

                <View style={{ marginTop: 14 }}>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.58)' }}>Momentum gauge</Text>
                  <View style={{ marginTop: 10 }}>
                    <WinnerLoserGauge
                      winner={selectedEvent.winnerPot}
                      loser={selectedEvent.loserPot}
                    />
                  </View>
                </View>

                <View className="mt-4 flex-row gap-3">
                  <View className="flex-1">
                    <NeonButton
                      label="Tip Winner"
                      onPress={() => tip('winner', selectedEvent.title)}
                    />
                  </View>
                  <View className="flex-1">
                    <NeonButton
                      label="Tip Loser (enter lottery)"
                      variant="secondary"
                      onPress={() => tip('loser', selectedEvent.title)}
                      rightHint={`${globalLotteryPct}% → lottery`}
                    />
                  </View>
                </View>

                <Text style={{ ...type.caption, marginTop: 12, color: 'rgba(255,255,255,0.46)' }}>
                  Tip Loser = lottery ticket. Tip Winner = pure pot exposure.
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

        <CreatePoolModal
          visible={createVisible}
          onClose={() => setCreateVisible(false)}
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

function CreatePoolModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
          <Text style={{ ...type.h3, color: 'rgba(248,250,252,0.96)' }}>Create pool (preview)</Text>
          <Text style={{ ...type.caption, marginTop: 8, color: 'rgba(148,163,184,0.95)' }}>
            Soon you&apos;ll be able to spin up custom events, set winner / loser cuts, and route tips to
            on-chain contracts.
          </Text>

          <View style={{ marginTop: 16 }}>
            <View
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: 'rgba(148,163,184,0.45)',
                paddingHorizontal: 14,
                paddingVertical: 10,
                marginBottom: 10,
              }}
            >
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Event name</Text>
              <Text style={{ ...type.bodyM, marginTop: 4, color: 'rgba(248,250,252,0.92)' }}>
                e.g. &quot;Worlds Finals Game 5&quot;
              </Text>
            </View>
            <View
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: 'rgba(148,163,184,0.45)',
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.95)' }}>Loser lottery cut</Text>
              <Text style={{ ...type.bodyM, marginTop: 4, color: neon.pink }}>10% · global compatible</Text>
            </View>
          </View>

          <View style={{ marginTop: 18 }}>
            <NeonButton label="Close" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  )
}
