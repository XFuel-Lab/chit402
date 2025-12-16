import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Slider from '@react-native-community/slider'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { neon } from '../theme/neon'
import { connectThetaWalletMock, createDisconnectedWallet } from '../lib/mockWallet'
import { NeonPill } from '../components/NeonPill'
import { type } from '../theme/typography'
import * as Haptics from 'expo-haptics'
import { TipSuccessOverlay } from '../components/TipSuccessOverlay'
import { SubPanel } from '../components/SubPanel'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'

interface LSTOption {
  name: string
  apy: number
}

const LST_OPTIONS: LSTOption[] = [
  { name: 'stkTIA', apy: 38.2 },
  { name: 'stkATOM', apy: 32.5 },
  { name: 'stkXPRT', apy: 28.7 },
  { name: 'pSTAKE BTC', apy: 25.4 },
  { name: 'stkOSMO', apy: 22.1 },
]

export function SwapScreen() {
  const [wallet, setWallet] = useState(createDisconnectedWallet())
  const [selectedPercentage, setSelectedPercentage] = useState<number>(100)
  const [customPercentage, setCustomPercentage] = useState<number>(100)
  const [selectedLST, setSelectedLST] = useState<LSTOption>(LST_OPTIONS[0])
  const [balancePanelVisible, setBalancePanelVisible] = useState(false)
  const [lstPanelVisible, setLstPanelVisible] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)
  const [finalityMs, setFinalityMs] = useState(3200)
  const [status, setStatus] = useState<string>('')
  const [successVisible, setSuccessVisible] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

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

  const finalityText = useMemo(() => `${(finalityMs / 1000).toFixed(1)}s`, [finalityMs])

  const connect = async () => {
    const w = await connectThetaWalletMock()
    setWallet(w)
    setStatus('Connected (mock)')
    setTimeout(() => setStatus(''), 1200)
  }

  const tfuelAmount = useMemo(() => {
    if (!wallet.isConnected) return 0
    const currentPct = selectedPercentage === -1 ? customPercentage : selectedPercentage
    return (wallet.balanceTfuel * currentPct) / 100
  }, [wallet.balanceTfuel, wallet.isConnected, selectedPercentage, customPercentage])

  const estimatedLSTAmount = useMemo(() => {
    // Mock calculation: 1 TFUEL = 0.95 LST (5% fee)
    return tfuelAmount * 0.95
  }, [tfuelAmount])

  const estimatedDailyYield = useMemo(() => {
    return (estimatedLSTAmount * selectedLST.apy) / 100 / 365
  }, [estimatedLSTAmount, selectedLST.apy])

  const currentPercentage = useMemo(() => {
    return selectedPercentage === -1 ? customPercentage : selectedPercentage
  }, [selectedPercentage, customPercentage])

  const handlePercentageSelect = (pct: number | 'custom') => {
    Haptics.selectionAsync().catch(() => {})
    if (pct === 'custom') {
      setSelectedPercentage(-1)
      setCustomPercentage(100)
    } else {
      setSelectedPercentage(pct)
    }
    setBalancePanelVisible(false)
  }

  const handleLSTSelect = (lst: LSTOption) => {
    Haptics.selectionAsync().catch(() => {})
    setSelectedLST(lst)
    setLstPanelVisible(false)
  }

  const approve = async () => {
    if (!wallet.isConnected || tfuelAmount === 0) {
      setStatus('Connect wallet first')
      return
    }
    setStatus('Approving TFUEL…')
    setTimeout(() => setStatus('Approval successful ✓'), 900)
    setTimeout(() => setStatus(''), 2100)
  }

  const swapAndStake = async () => {
    if (!wallet.isConnected || tfuelAmount === 0) {
      setStatus('Connect wallet and select amount')
      return
    }
    setIsSwapping(true)
    setStatus(`Swapping ${tfuelAmount.toFixed(2)} TFUEL → ${selectedLST.name}…`)
    
    setTimeout(() => {
      setIsSwapping(false)
      setStatus('')
      setSuccessMsg(`Swap complete: ${tfuelAmount.toFixed(2)} TFUEL → ${estimatedLSTAmount.toFixed(2)} ${selectedLST.name}`)
      setSuccessVisible(true)
      setSelectedPercentage(100)
      setCustomPercentage(100)
    }, 2000)
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
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
                    <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>Connected</Text>
                    <Text style={{ ...type.caption, color: neon.green }}>{wallet.addressShort}</Text>
                  </View>
                  <View className="mt-2 flex-row items-baseline gap-2">
                    <Text style={{ ...type.h1, color: 'rgba(255,255,255,0.95)' }}>
                      {wallet.balanceTfuel.toLocaleString()}
                    </Text>
                    <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.55)' }}>TFUEL</Text>
                  </View>
                </View>
              )}
            </NeonCard>

            {/* Balance Bubble */}
            <Pressable
              onPress={() => {
                if (!wallet.isConnected) return
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                setBalancePanelVisible(true)
              }}
              disabled={!wallet.isConnected}
              className="mb-5"
            >
              <BalanceBubble
                percentage={currentPercentage}
                disabled={!wallet.isConnected}
                active={balancePanelVisible}
              />
            </Pressable>

            {/* LST Bubble */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                setLstPanelVisible(true)
              }}
              className="mb-5"
            >
              <LSTBubble lst={selectedLST} active={lstPanelVisible} />
            </Pressable>

            {/* Live Preview */}
            {wallet.isConnected && tfuelAmount > 0 && (
              <NeonCard className="mb-5">
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>
                  You'll receive
                </Text>
                <View className="flex-row items-baseline gap-2">
                  <Text style={{ ...type.h2, color: neon.blue }}>
                    ~{estimatedLSTAmount.toFixed(2)}
                  </Text>
                  <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)' }}>
                    {selectedLST.name}
                  </Text>
                </View>
                <Text style={{ ...type.body, marginTop: 6, color: neon.green }}>
                  ~${estimatedDailyYield.toFixed(2)}/day yield
                </Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <NeonPill label={`Finality ${finalityText}`} tone="green" />
                  <NeonPill label="Paid by treasury" tone="purple" />
                </View>
              </NeonCard>
            )}

            {status ? (
              <View
                className="mb-5 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: 'rgba(56,189,248,0.25)',
                  backgroundColor: 'rgba(56,189,248,0.08)',
                }}
              >
                <Text style={{ ...type.bodyM, color: neon.text }}>{status}</Text>
              </View>
            ) : null}

            {/* Single Swap & Stake Button */}
            <View className="gap-3" style={{ paddingBottom: 92 }}>
              <NeonButton
                label={isSwapping ? 'Swapping...' : 'Swap & Stake'}
                onPress={swapAndStake}
                disabled={!wallet.isConnected || tfuelAmount === 0 || isSwapping}
                rightHint={isSwapping ? undefined : '2 steps'}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Balance Selection SubPanel */}
      <SubPanel
        visible={balancePanelVisible}
        onClose={() => setBalancePanelVisible(false)}
        title="Select Amount"
      >
        <View style={{ gap: 12 }}>
          {[25, 50, 75, 100].map((pct) => (
            <Pressable
              key={pct}
              onPress={() => handlePercentageSelect(pct)}
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                backgroundColor: selectedPercentage === pct ? 'rgba(56,189,248,0.20)' : 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor:
                  selectedPercentage === pct ? 'rgba(56,189,248,0.60)' : 'rgba(255,255,255,0.10)',
              }}
            >
              <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
                <Text
                  style={{
                    ...type.h3,
                    color: selectedPercentage === pct ? neon.blue : 'rgba(255,255,255,0.95)',
                    textAlign: 'center',
                  }}
                >
                  {pct}%
                </Text>
                {wallet.isConnected && (
                  <Text
                    style={{
                      ...type.caption,
                      marginTop: 4,
                      color: 'rgba(255,255,255,0.55)',
                      textAlign: 'center',
                    }}
                  >
                    {(wallet.balanceTfuel * pct) / 100} TFUEL
                  </Text>
                )}
              </View>
            </Pressable>
          ))}

          {/* Custom Slider */}
          <View
            style={{
              borderRadius: 16,
              padding: 20,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor:
                selectedPercentage === -1 ? 'rgba(56,189,248,0.60)' : 'rgba(255,255,255,0.10)',
            }}
          >
            <Text
              style={{
                ...type.bodyM,
                color: selectedPercentage === -1 ? neon.blue : 'rgba(255,255,255,0.95)',
                marginBottom: 12,
                textAlign: 'center',
              }}
            >
              Custom: {customPercentage.toFixed(0)}%
            </Text>
            <Slider
              value={customPercentage}
              onValueChange={(val) => {
                setCustomPercentage(val)
                setSelectedPercentage(-1)
              }}
              minimumValue={1}
              maximumValue={100}
              step={1}
              minimumTrackTintColor={neon.blue}
              maximumTrackTintColor="rgba(255,255,255,0.15)"
              thumbTintColor={neon.blue}
            />
            {wallet.isConnected && (
              <Text
                style={{
                  ...type.caption,
                  marginTop: 8,
                  color: 'rgba(255,255,255,0.55)',
                  textAlign: 'center',
                }}
              >
                {(wallet.balanceTfuel * customPercentage) / 100} TFUEL
              </Text>
            )}
          </View>
        </View>
      </SubPanel>

      {/* LST Selection SubPanel */}
      <SubPanel visible={lstPanelVisible} onClose={() => setLstPanelVisible(false)} title="Select LST">
        <View style={{ gap: 12 }}>
          {LST_OPTIONS.map((lst) => (
            <Pressable
              key={lst.name}
              onPress={() => handleLSTSelect(lst)}
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                backgroundColor:
                  selectedLST.name === lst.name ? 'rgba(56,189,248,0.20)' : 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor:
                  selectedLST.name === lst.name ? 'rgba(56,189,248,0.60)' : 'rgba(255,255,255,0.10)',
              }}
            >
              <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
                <View className="flex-row items-center justify-between">
                  <Text
                    style={{
                      ...type.h3,
                      color: selectedLST.name === lst.name ? neon.blue : 'rgba(255,255,255,0.95)',
                    }}
                  >
                    {lst.name}
                  </Text>
                  <Text
                    style={{
                      ...type.bodyM,
                      color: neon.green,
                      fontWeight: '600',
                    }}
                  >
                    {lst.apy.toFixed(1)}% APY
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              // Handle "More" button - could navigate to full list
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
              setLstPanelVisible(false)
            }}
            style={{
              borderRadius: 16,
              padding: 16,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.10)',
            }}
          >
            <Text
              style={{
                ...type.bodyM,
                color: 'rgba(255,255,255,0.72)',
                textAlign: 'center',
              }}
            >
              More options →
            </Text>
          </Pressable>
        </View>
      </SubPanel>

      <TipSuccessOverlay
        visible={successVisible}
        message={successMsg}
        onClose={() => setSuccessVisible(false)}
        finalityTime={finalityText}
      />
    </ScreenBackground>
  )
}

// Balance Bubble Component
function BalanceBubble({
  percentage,
  disabled,
  active,
}: {
  percentage: number
  disabled: boolean
  active: boolean
}) {
  const glow = useSharedValue(0)

  useEffect(() => {
    if (active) {
      glow.value = withRepeat(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      )
    } else {
      glow.value = withTiming(0, { duration: 300 })
    }
  }, [active, glow])

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.6,
    shadowOpacity: 0.8 + glow.value * 0.2,
  }))

  return (
    <View style={{ borderRadius: 999, overflow: 'visible' }}>
      <Animated.View
        style={[
          glowStyle,
          {
            position: 'absolute',
            inset: -12,
            borderRadius: 999,
            backgroundColor: neon.blue,
            shadowColor: neon.blue,
            shadowRadius: 28,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={
          disabled
            ? ['rgba(148,163,184,0.35)', 'rgba(148,163,184,0.20)']
            : ['rgba(56,189,248,0.75)', 'rgba(168,85,247,0.65)']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 1, borderRadius: 999 }}
      >
        <BlurView
          intensity={8}
          tint="dark"
          style={{
            borderRadius: 999,
            // Crystal clear blur only – no tint
            backgroundColor: 'transparent',
          }}
        >
          <View
            style={{
              paddingHorizontal: 32,
              paddingVertical: 24,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(56,189,248,0.50)',
              alignItems: 'center',
              minWidth: 200,
            }}
          >
            <Text
              style={{
                ...type.h1,
                color: disabled ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.95)',
              }}
            >
              {percentage.toFixed(0)}%
            </Text>
            <Text
              style={{
                ...type.body,
                marginTop: 6,
                color: disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.65)',
              }}
            >
              of Balance
            </Text>
            {!disabled && (
              <Text
                style={{
                  ...type.caption,
                  marginTop: 8,
                  color: neon.blue,
                }}
              >
                Tap to change
              </Text>
            )}
          </View>
        </BlurView>
      </LinearGradient>
    </View>
  )
}

// LST Bubble Component
function LSTBubble({ lst, active }: { lst: LSTOption; active: boolean }) {
  const glow = useSharedValue(0)

  useEffect(() => {
    if (active) {
      glow.value = withRepeat(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      )
    } else {
      glow.value = withTiming(0, { duration: 300 })
    }
  }, [active, glow])

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.6,
    shadowOpacity: 0.8 + glow.value * 0.2,
  }))

  return (
    <View style={{ borderRadius: 999, overflow: 'visible' }}>
      <Animated.View
        style={[
          glowStyle,
          {
            position: 'absolute',
            inset: -12,
            borderRadius: 999,
            backgroundColor: neon.purple,
            shadowColor: neon.purple,
            shadowRadius: 28,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(56,189,248,0.75)', 'rgba(168,85,247,0.65)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 1, borderRadius: 999 }}
      >
        <BlurView
          intensity={8}
          tint="dark"
          style={{
            borderRadius: 999,
            // Let XFUEL wallpaper show strongly behind LST bubble – pure blur
            backgroundColor: 'transparent',
          }}
        >
          <View
            style={{
              paddingHorizontal: 32,
              paddingVertical: 24,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(168,85,247,0.50)',
              alignItems: 'center',
              minWidth: 220,
            }}
          >
            <Text
              style={{
                ...type.h2,
                color: 'rgba(255,255,255,0.95)',
              }}
            >
              {lst.name}
            </Text>
            <View className="flex-row items-center gap-2 mt-2">
              <Text
                style={{
                  ...type.bodyM,
                  color: neon.green,
                  fontWeight: '600',
                }}
              >
                {lst.apy.toFixed(1)}% APY
              </Text>
            </View>
            <Text
              style={{
                ...type.caption,
                marginTop: 8,
                color: neon.purple,
              }}
            >
              Tap to change
            </Text>
          </View>
        </BlurView>
      </LinearGradient>
    </View>
  )
}