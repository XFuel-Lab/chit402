import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { neon } from '../theme/neon'
import { connectThetaWalletMock, createDisconnectedWallet } from '../lib/mockWallet'
import { NeonPill } from '../components/NeonPill'
import { type } from '../theme/typography'
import * as Haptics from 'expo-haptics'

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
        <View className="px-5 pt-3">
          <View className="flex-row items-center justify-between">
            <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Swap & Stake</Text>
            <NeonPill label="Gas-free" tone="blue" />
          </View>
          <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.55)' }}>
            Mobile-optimized XFUEL swap flow
          </Text>
        </View>

        <View className="px-5 pt-5">
          <NeonCard className="mb-5">
            {!wallet.isConnected ? (
              <NeonButton label="Connect Theta Wallet" onPress={connect} rightHint="secure" />
            ) : (
              <View>
                <View className="flex-row items-center justify-between">
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>
                    Connected
                  </Text>
                  <Text style={{ ...type.caption, color: neon.green }}>
                    {wallet.addressShort}
                  </Text>
                </View>
                <View className="mt-2 flex-row items-baseline gap-2">
                  <Text style={{ ...type.h1, color: 'rgba(255,255,255,0.95)' }}>{wallet.balanceTfuel.toLocaleString()}</Text>
                  <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.55)' }}>
                    TFUEL
                  </Text>
                </View>
              </View>
            )}
          </NeonCard>

          <NeonCard className="mb-5">
            <View className="flex-row items-center justify-between">
              <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>TFUEL input</Text>
              <NeonPill label={`Finality ${finalityText}`} tone="green" />
            </View>

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
                  style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}
                />
                <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.45)' }}>TFUEL</Text>
              </View>

              <Pressable
                onPress={onMax}
                disabled={!wallet.isConnected}
                className="rounded-xl border px-4 py-3"
                style={{ borderColor: 'rgba(56,189,248,0.30)', backgroundColor: 'rgba(56,189,248,0.10)' }}
              >
                <Text style={{ ...type.bodyM, color: neon.blue }}>MAX</Text>
                <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.55)' }}>balance</Text>
              </Pressable>
            </View>

            <View className="mt-3 flex-row gap-2">
              {[25, 50, 100].map((pct) => (
                <Pressable
                  key={pct}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {})
                    setPresetPct(pct as 25 | 50 | 100)
                  }}
                  disabled={!wallet.isConnected}
                  className="flex-1 rounded-xl border px-3 py-3"
                  style={{ borderColor: 'rgba(168,85,247,0.22)', backgroundColor: 'rgba(168,85,247,0.08)' }}
                >
                  <Text style={{ ...type.bodyM, textAlign: 'center', color: 'rgba(255,255,255,0.88)' }}>{pct}%</Text>
                  <Text style={{ ...type.caption, marginTop: 4, textAlign: 'center', color: 'rgba(255,255,255,0.45)' }}>
                    preset
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={{ ...type.caption, marginTop: 16, color: 'rgba(255,255,255,0.55)' }}>CHOSEN LST</Text>
            <View className="mt-2 flex-row gap-2">
              {LSTS.map((lst) => {
                const active = lst === selectedLST
                return (
                  <Pressable
                    key={lst}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                      setSelectedLST(lst)
                    }}
                    className="flex-1 rounded-xl border px-3 py-3"
                    style={{
                      borderColor: active ? 'rgba(56,189,248,0.55)' : 'rgba(168,85,247,0.22)',
                      backgroundColor: active ? 'rgba(56,189,248,0.10)' : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <Text style={{ ...type.bodyM, textAlign: 'center', color: active ? neon.blue : 'rgba(255,255,255,0.60)' }}>{lst}</Text>
                    <Text style={{ ...type.caption, marginTop: 4, textAlign: 'center', color: 'rgba(255,255,255,0.45)' }}>
                      tap to select
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View className="mt-4 flex-row flex-wrap gap-2">
              <NeonPill label="Paid by treasury" tone="purple" />
              <NeonPill label="Instant settlement" tone="blue" />
            </View>
          </NeonCard>

          {status ? (
            <View className="mb-5 rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(56,189,248,0.25)', backgroundColor: 'rgba(56,189,248,0.08)' }}>
              <Text style={{ ...type.bodyM, color: neon.text }}>
                {status}
              </Text>
            </View>
          ) : null}

          <View className="gap-3" style={{ paddingBottom: 92 }}>
            <NeonButton
              label="Approve TFUEL"
              onPress={approve}
              disabled={!wallet.isConnected || !tfuelAmount}
              rightHint="1/2"
            />
            <NeonButton
              label={`Swap & Stake → ${selectedLST}`}
              onPress={swapAndStake}
              disabled={!wallet.isConnected || !tfuelAmount}
              rightHint="2/2"
            />
          </View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  )
}
