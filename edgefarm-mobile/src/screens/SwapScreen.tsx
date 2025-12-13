import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { neon } from '../theme/neon'
import { connectThetaWalletMock, createDisconnectedWallet } from '../lib/mockWallet'

const LSTS = ['stkXPRT', 'stkATOM', 'pSTAKE BTC'] as const

export function SwapScreen() {
  const [wallet, setWallet] = useState(createDisconnectedWallet())
  const [tfuelAmount, setTfuelAmount] = useState('')
  const [selectedLST, setSelectedLST] = useState<(typeof LSTS)[number]>('stkATOM')

  const [finalityMs, setFinalityMs] = useState(3200)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    const t = setInterval(() => {
      setFinalityMs((v) => {
        const next = v - 100
        if (next <= 0) return 2800 + Math.floor(Math.random() * 900)
        return next
      })
    }, 100)
    return () => clearInterval(t)
  }, [])

  const finalityText = useMemo(() => `${(finalityMs / 1000).toFixed(1)} s`, [finalityMs])

  const connect = async () => {
    const w = await connectThetaWalletMock()
    setWallet(w)
    setStatus('Connected (mock)')
    setTimeout(() => setStatus(''), 1200)
  }

  const setPresetPct = (pct: 25 | 50 | 100) => {
    if (!wallet.isConnected) return
    const amount = (wallet.balanceTfuel * pct) / 100
    setTfuelAmount(amount.toFixed(2))
  }

  const onMax = () => {
    if (!wallet.isConnected) return
    setTfuelAmount(wallet.balanceTfuel.toFixed(2))
  }

  const approve = async () => {
    if (!wallet.isConnected || !tfuelAmount) {
      setStatus('Connect wallet and enter amount')
      return
    }
    setStatus('Approving TFUEL…')
    setTimeout(() => setStatus('Approval successful ✓'), 900)
    setTimeout(() => setStatus(''), 2100)
  }

  const swapAndStake = async () => {
    if (!wallet.isConnected || !tfuelAmount) {
      setStatus('Connect wallet and enter amount')
      return
    }
    setStatus(`Swapping ${tfuelAmount} TFUEL → ${selectedLST}… (demo)`)
    setTimeout(() => {
      setStatus(`Done! You now hold yield-bearing ${selectedLST}`)
      setTfuelAmount('')
    }, 1200)
    setTimeout(() => setStatus(''), 4200)
  }

  return (
    <ScreenBackground>
      <SafeAreaView className="flex-1">
        <View className="px-4 pt-3">
          <Text className="text-2xl font-bold text-white">Swap & Stake</Text>
          <Text className="mt-1 text-sm" style={{ color: neon.muted }}>
            Mobile-optimized XFUEL swap UI
          </Text>
        </View>

        <View className="p-4">
          <NeonCard className="mb-4">
            {!wallet.isConnected ? (
              <NeonButton label="Connect Theta Wallet" onPress={connect} />
            ) : (
              <View>
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs" style={{ color: neon.muted }}>
                    Connected
                  </Text>
                  <Text className="text-xs font-semibold" style={{ color: neon.green }}>
                    {wallet.addressShort}
                  </Text>
                </View>
                <View className="mt-2 flex-row items-baseline gap-2">
                  <Text className="text-2xl font-bold text-white">{wallet.balanceTfuel.toLocaleString()}</Text>
                  <Text className="text-sm" style={{ color: neon.muted }}>
                    TFUEL
                  </Text>
                </View>
              </View>
            )}
          </NeonCard>

          <NeonCard className="mb-4">
            <Text className="text-sm font-semibold text-white">TFUEL input</Text>

            <View className="mt-3 flex-row gap-2">
              <View
                className="flex-1 rounded-xl border px-3 py-3"
                style={{ borderColor: 'rgba(168,85,247,0.28)', backgroundColor: 'rgba(255,255,255,0.04)' }}
              >
                <TextInput
                  value={tfuelAmount}
                  onChangeText={setTfuelAmount}
                  editable={wallet.isConnected}
                  placeholder="0.00"
                  placeholderTextColor={'rgba(255,255,255,0.35)'}
                  keyboardType="decimal-pad"
                  className="text-base font-semibold text-white"
                />
              </View>

              <Pressable
                onPress={onMax}
                disabled={!wallet.isConnected}
                className="rounded-xl border px-4 py-3"
                style={{ borderColor: 'rgba(56,189,248,0.30)', backgroundColor: 'rgba(56,189,248,0.10)' }}
              >
                <Text className="text-sm font-semibold" style={{ color: neon.blue }}>
                  MAX
                </Text>
              </Pressable>
            </View>

            <View className="mt-3 flex-row gap-2">
              {[25, 50, 100].map((pct) => (
                <Pressable
                  key={pct}
                  onPress={() => setPresetPct(pct as 25 | 50 | 100)}
                  disabled={!wallet.isConnected}
                  className="flex-1 rounded-xl border px-3 py-3"
                  style={{ borderColor: 'rgba(168,85,247,0.22)', backgroundColor: 'rgba(168,85,247,0.08)' }}
                >
                  <Text className="text-center text-sm font-semibold" style={{ color: neon.purple }}>
                    {pct}%
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text className="mt-4 text-xs uppercase tracking-widest" style={{ color: neon.muted }}>
              Chosen LST
            </Text>
            <View className="mt-2 flex-row gap-2">
              {LSTS.map((lst) => {
                const active = lst === selectedLST
                return (
                  <Pressable
                    key={lst}
                    onPress={() => setSelectedLST(lst)}
                    className="flex-1 rounded-xl border px-3 py-3"
                    style={{
                      borderColor: active ? 'rgba(56,189,248,0.55)' : 'rgba(168,85,247,0.22)',
                      backgroundColor: active ? 'rgba(56,189,248,0.10)' : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <Text className="text-center text-xs font-semibold" style={{ color: active ? neon.blue : neon.muted }}>
                      {lst}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View className="mt-4 flex-row items-center justify-between">
              <Text className="text-xs" style={{ color: neon.muted }}>
                Live finality countdown
              </Text>
              <Text className="text-xs font-semibold" style={{ color: neon.green }}>
                {finalityText}
              </Text>
            </View>

            <View className="mt-2 flex-row items-center justify-between">
              <View
                className="rounded-full border px-3 py-1"
                style={{ borderColor: 'rgba(56,189,248,0.35)', backgroundColor: 'rgba(56,189,248,0.08)' }}
              >
                <Text className="text-xs font-semibold" style={{ color: neon.blue }}>
                  Gas-free
                </Text>
              </View>
              <Text className="text-xs" style={{ color: neon.muted }}>
                paid by treasury
              </Text>
            </View>
          </NeonCard>

          {status ? (
            <View className="mb-4 rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(56,189,248,0.25)', backgroundColor: 'rgba(56,189,248,0.08)' }}>
              <Text className="text-sm" style={{ color: neon.text }}>
                {status}
              </Text>
            </View>
          ) : null}

          <View className="gap-3">
            <NeonButton label="Approve TFUEL" onPress={approve} disabled={!wallet.isConnected || !tfuelAmount} />
            <NeonButton label="Swap & Stake" onPress={swapAndStake} disabled={!wallet.isConnected || !tfuelAmount} />
          </View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  )
}
