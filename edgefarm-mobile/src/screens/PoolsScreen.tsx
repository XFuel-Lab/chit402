import React, { useMemo, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { ScreenBackground } from '../components/ScreenBackground'
import { TipSuccessOverlay } from '../components/TipSuccessOverlay'
import { neon } from '../theme/neon'

type EventRow = {
  id: string
  title: string
  winnerPot: number
  loserPot: number
  lotteryPot: number
}

export function PoolsScreen() {
  const [successVisible, setSuccessVisible] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const events: EventRow[] = useMemo(
    () => [
      {
        id: 'e1',
        title: 'Cloud9 vs Dignitas Finals',
        winnerPot: 124_800,
        loserPot: 78_300,
        lotteryPot: 22_340,
      },
      {
        id: 'e2',
        title: 'Sentinels vs LOUD Showmatch',
        winnerPot: 64_250,
        loserPot: 41_900,
        lotteryPot: 11_750,
      },
      {
        id: 'e3',
        title: 'T1 vs Gen.G Grand Final',
        winnerPot: 92_110,
        loserPot: 58_420,
        lotteryPot: 15_980,
      },
    ],
    []
  )

  const tip = (side: 'winner' | 'loser', eventTitle: string) => {
    const entered = side === 'loser'
    setSuccessMsg(entered ? `You entered $50k lottery (10% global pot)\nEvent: ${eventTitle}` : `Tip placed on Winner\nEvent: ${eventTitle}`)
    setSuccessVisible(true)
  }

  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <View className="px-4 pt-3">
          <Text className="text-2xl font-bold text-white">Tip Pools</Text>
          <View
            className="mt-3 rounded-2xl border px-4 py-3"
            style={{ borderColor: 'rgba(251, 113, 133, 0.35)', backgroundColor: 'rgba(251, 113, 133, 0.10)' }}
          >
            <Text className="text-sm font-semibold" style={{ color: neon.pink }}>
              10% of every tip feeds the global lottery
            </Text>
            <Text className="mt-1 text-xs" style={{ color: neon.muted }}>
              Tip Loser to enter. Winners still earn the main pot.
            </Text>
          </View>
        </View>

        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 12 }}
          renderItem={({ item }) => (
            <NeonCard>
              <Text className="text-base font-semibold text-white">{item.title}</Text>

              <View className="mt-3 flex-row justify-between">
                <View>
                  <Text className="text-xs" style={{ color: neon.muted }}>
                    Winner pot
                  </Text>
                  <Text className="mt-1 text-lg font-bold" style={{ color: neon.blue }}>
                    ${item.winnerPot.toLocaleString()}
                  </Text>
                </View>
                <View>
                  <Text className="text-xs" style={{ color: neon.muted }}>
                    Loser pot
                  </Text>
                  <Text className="mt-1 text-lg font-bold" style={{ color: neon.purple }}>
                    ${item.loserPot.toLocaleString()}
                  </Text>
                </View>
                <View>
                  <Text className="text-xs" style={{ color: neon.muted }}>
                    10% lottery
                  </Text>
                  <Text className="mt-1 text-lg font-bold" style={{ color: neon.pink }}>
                    ${item.lotteryPot.toLocaleString()}
                  </Text>
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
                  />
                </View>
              </View>

              <Text className="mt-3 text-xs" style={{ color: neon.muted }}>
                After tip: success animation + lottery entry confirmation
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
