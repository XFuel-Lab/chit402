/**
 * SWAP SCREEN - One-Tap Magic (Tesla-Simple)
 * 
 * Default: Highest APY LST auto-selected
 * Flow: Pick amount → Swap & Compound → Confetti
 * No subpanels. No clutter. Just swap.
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Pressable, Text, View, ScrollView, Linking, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Slider from '@react-native-community/slider'
import ConfettiCannon from 'react-native-confetti-cannon'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { ThetaWalletQRModal } from '../components/ThetaWalletQRModal'
import { neon } from '../theme/neon'
import { connectThetaWallet, createDisconnectedWallet, refreshBalance, getSigner, getRouterAddress, getExplorerUrl } from '../lib/thetaWallet'
import { ethers } from '@thetalabs/theta-js'
import { API_URL } from '../lib/appConfig'
import { NeonPill } from '../components/NeonPill'
import { type } from '../theme/typography'
import * as Haptics from 'expo-haptics'
import { getLSTPrices, type LSTPriceAndAPYData } from '../lib/oracle'

interface LSTOption {
  name: string
  apy: number
}

const LST_OPTIONS: LSTOption[] = [
  { name: 'stkXPRT', apy: 25.7 }, // Default to highest APY
  { name: 'stkATOM', apy: 19.5 },
  { name: 'stkOSMO', apy: 18.1 },
  { name: 'stkTIA', apy: 15.2 },
]

export function SwapScreen() {
  const confettiRef = useRef<any>(null)
  const [wallet, setWallet] = useState(createDisconnectedWallet())
  const [swapPercentage, setSwapPercentage] = useState<number>(100)
  const [selectedLST, setSelectedLST] = useState<LSTOption>(LST_OPTIONS[0]) // Default highest APY
  const [isSwapping, setIsSwapping] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [faucetLoading, setFaucetLoading] = useState(false)
  const [swapStatus, setSwapStatus] = useState<'idle' | 'swapping' | 'success' | 'error'>('idle')
  const [refreshing, setRefreshing] = useState(false)
  const [qrModalVisible, setQrModalVisible] = useState(false)
  const [priceData, setPriceData] = useState<LSTPriceAndAPYData | null>(null)
  const [lstOptions, setLstOptions] = useState<LSTOption[]>(LST_OPTIONS)

  // Fetch real APYs and auto-select highest
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const data = await getLSTPrices()
        setPriceData(data)
        
        // Update with real APYs
        const updatedOptions = LST_OPTIONS.map(lst => {
          const apyKey = lst.name
          const realApy = data.apys[apyKey as keyof typeof data.apys]
          return realApy ? { ...lst, apy: realApy } : lst
        })

        // Sort by APY descending, pick highest
        updatedOptions.sort((a, b) => b.apy - a.apy)
        setLstOptions(updatedOptions)
        setSelectedLST(updatedOptions[0])
      } catch (error) {
        console.error('Failed to fetch prices:', error)
      }
    }
    
    fetchPrices()
    const priceInterval = setInterval(fetchPrices, 60000)
    return () => clearInterval(priceInterval)
  }, [])

  const refreshWalletBalance = useCallback(async () => {
    if (!wallet.isConnected || !wallet.addressFull) return
    try {
      const newBalance = await refreshBalance(wallet.addressFull)
      setWallet((prev) => ({ ...prev, balanceTfuel: newBalance }))
    } catch (error) {
      console.error('Balance refresh failed:', error)
    }
  }, [wallet.isConnected, wallet.addressFull])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refreshWalletBalance()
    setRefreshing(false)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  }, [refreshWalletBalance])

  const connect = async () => {
    try {
      setStatus('Connecting wallet…')
      setQrModalVisible(true)
      const w = await connectThetaWallet()
      setWallet(w)
      setQrModalVisible(false)
      setStatus('Connected ✓')
      setTimeout(() => setStatus(''), 2000)
      
      const interval = setInterval(async () => {
        if (w.addressFull) {
          const newBalance = await refreshBalance(w.addressFull)
          setWallet((prev) => ({ ...prev, balanceTfuel: newBalance }))
        }
      }, 10000)
      
      return () => clearInterval(interval)
    } catch (error: any) {
      setQrModalVisible(false)
      setStatus(`Connection failed: ${error?.message || 'Unknown error'}`)
      setTimeout(() => setStatus(''), 3000)
    }
  }

  const tfuelAmount = useMemo(() => {
    if (!wallet.isConnected) return 0
    return (wallet.balanceTfuel * swapPercentage) / 100
  }, [wallet.balanceTfuel, wallet.isConnected, swapPercentage])

  const estimatedLSTAmount = useMemo(() => {
    if (!priceData || !priceData.prices.TFUEL || tfuelAmount === 0) {
      return 0
    }
    
    try {
      const tfuelPrice = priceData.prices.TFUEL.price
      const lstKey = selectedLST.name
      const lstPrice = priceData.prices[lstKey as keyof typeof priceData.prices]?.price
      
      if (!lstPrice || lstPrice <= 0) {
        return tfuelAmount * 0.95
      }
      
      const usdValue = tfuelAmount * tfuelPrice
      return (usdValue / lstPrice) * 0.95 // 5% fee
    } catch (error) {
      return tfuelAmount * 0.95
    }
  }, [tfuelAmount, priceData, selectedLST])

  const estimatedDailyYield = useMemo(() => {
    return (estimatedLSTAmount * selectedLST.apy) / 100 / 365
  }, [estimatedLSTAmount, selectedLST.apy])

  const swapAndCompound = async () => {
    if (!wallet.isConnected || !wallet.addressFull || tfuelAmount === 0) {
      setStatus('Connect wallet and select amount')
      setSwapStatus('error')
      setTimeout(() => {
        setSwapStatus('idle')
        setStatus('')
      }, 3000)
      return
    }

    // Use simulation for now (backend API)
    try {
      setIsSwapping(true)
      setSwapStatus('swapping')
      setStatus(`Swapping ${tfuelAmount.toFixed(2)} TFUEL → ${selectedLST.name}…`)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})

      const response = await fetch(`${API_URL}/api/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userAddress: wallet.addressFull,
          amount: tfuelAmount,
          targetLST: selectedLST.name,
          userBalance: wallet.balanceTfuel,
        }),
      })

      if (!response.ok) {
        throw new Error('Swap request failed')
      }

      const data = await response.json()

      if (data.success) {
        setTxHash(data.txHash)
        setIsSwapping(false)
        setSwapStatus('success')
        setStatus(`✅ Swapped to ${selectedLST.name} — earning ${selectedLST.apy.toFixed(1)}% APY`)
        
        // 🎉 CONFETTI TIME
        confettiRef.current?.start()
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})

        setTimeout(() => {
          setTxHash(null)
          setSwapStatus('idle')
          setStatus('')
        }, 8000)
        return
      } else {
        throw new Error(data.message || 'Swap failed')
      }
    } catch (error: any) {
      console.error('Swap error:', error)
      setIsSwapping(false)
      setSwapStatus('error')
      
      let errorMessage = error?.message || 'Unexpected error'
      if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance')) {
        errorMessage = 'Insufficient TFUEL balance. Get test TFUEL from faucet.'
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('User denied')) {
        errorMessage = 'Transaction rejected by user'
      } else if (errorMessage.includes('network')) {
        errorMessage = 'Network error. Please check your connection.'
      }
      
      setStatus(`Failed: ${errorMessage}`)
      setTxHash(null)

      setTimeout(() => {
        setSwapStatus('idle')
        setStatus('')
      }, 5000)
    }
  }

  const handleFaucet = async () => {
    if (!wallet.addressFull) {
      setStatus('Connect wallet first')
      setSwapStatus('error')
      setTimeout(() => {
        setSwapStatus('idle')
        setStatus('')
      }, 3000)
      return
    }

    setFaucetLoading(true)
    try {
      const response = await fetch(`https://faucet.testnet.theta.org/request?address=${wallet.addressFull}`)
      if (response.ok) {
        setStatus('Test TFUEL requested! Check your wallet in a few moments.')
        setSwapStatus('success')
        setTimeout(async () => {
          if (wallet.addressFull) {
            const newBalance = await refreshBalance(wallet.addressFull)
            setWallet((prev) => ({ ...prev, balanceTfuel: newBalance }))
          }
        }, 3000)
      } else {
        setStatus('Faucet request failed. Please try again later.')
        setSwapStatus('error')
      }
    } catch (error) {
      console.error('Faucet error:', error)
      setStatus('Failed to request test TFUEL')
      setSwapStatus('error')
    } finally {
      setFaucetLoading(false)
      setTimeout(() => {
        setSwapStatus('idle')
        setStatus('')
      }, 5000)
    }
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        {/* Confetti Cannon for swap success */}
        <ConfettiCannon
          ref={confettiRef}
          count={150}
          origin={{ x: -10, y: 0 }}
          fadeOut={true}
          autoStart={false}
          fallSpeed={2500}
        />

        <ScrollView 
          className="flex-1" 
          showsVerticalScrollIndicator={false}
          refreshControl={
            wallet.isConnected ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={neon.blue}
                colors={[neon.blue]}
              />
            ) : undefined
          }
        >
          <View className="px-5 pt-3">
            <View className="flex-row items-center justify-between">
              <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Swap & Compound</Text>
              <NeonPill label="Gas-free" tone="blue" />
            </View>
            <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.55)' }}>
              One tap to highest APY
            </Text>
          </View>

          <View className="px-5 pt-5">
            {/* Wallet Connection */}
            <NeonCard className="mb-5">
              {!wallet.isConnected ? (
                <View style={{ gap: 12 }}>
                  <NeonButton label="Connect Theta Wallet" onPress={connect} rightHint="secure" />
                </View>
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

            {/* Amount Slider */}
            {wallet.isConnected && (
              <NeonCard className="mb-5">
                <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
                  Swap Amount
                </Text>
                <View className="flex-row items-baseline gap-2 mb-4">
                  <Text style={{ ...type.h1, color: neon.blue }}>
                    {tfuelAmount.toFixed(2)}
                  </Text>
                  <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.65)' }}>TFUEL</Text>
                </View>
                <Slider
                  value={swapPercentage}
                  onValueChange={(val) => {
                    setSwapPercentage(val)
                    Haptics.selectionAsync().catch(() => {})
                  }}
                  minimumValue={1}
                  maximumValue={100}
                  step={1}
                  minimumTrackTintColor={neon.blue}
                  maximumTrackTintColor="rgba(255,255,255,0.15)"
                  thumbTintColor={neon.blue}
                />
                <View className="mt-2 flex-row items-center justify-between">
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>1%</Text>
                  <Text style={{ ...type.bodyM, color: neon.blue, fontWeight: '600' }}>
                    {swapPercentage.toFixed(0)}%
                  </Text>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>100%</Text>
                </View>
              </NeonCard>
            )}

            {/* Target LST - Simple Dropdown */}
            {wallet.isConnected && (
              <NeonCard className="mb-5">
                <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)', marginBottom: 12 }}>
                  Target LST (Highest APY Selected)
                </Text>
                <View style={{ gap: 8 }}>
                  {lstOptions.map((lst) => (
                    <Pressable
                      key={lst.name}
                      onPress={() => {
                        setSelectedLST(lst)
                        Haptics.selectionAsync().catch(() => {})
                      }}
                      style={{
                        borderRadius: 16,
                        padding: 16,
                        borderWidth: 1,
                        borderColor: selectedLST.name === lst.name ? neon.purple : 'rgba(255,255,255,0.15)',
                        backgroundColor: selectedLST.name === lst.name ? 'rgba(168,85,247,0.15)' : 'rgba(0,0,0,0.2)',
                      }}
                    >
                      <View className="flex-row items-center justify-between">
                        <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)' }}>{lst.name}</Text>
                        <Text style={{ ...type.bodyM, color: neon.green, fontWeight: '600' }}>
                          {lst.apy.toFixed(1)}% APY
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </NeonCard>
            )}

            {/* Preview */}
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
              </NeonCard>
            )}

            {/* Status */}
            {status && (
              <View
                className="mb-5 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: 
                    swapStatus === 'success' 
                      ? 'rgba(16,185,129,0.4)' 
                      : swapStatus === 'error'
                      ? 'rgba(239,68,68,0.4)'
                      : 'rgba(56,189,248,0.25)',
                  backgroundColor: 
                    swapStatus === 'success'
                      ? 'rgba(16,185,129,0.1)'
                      : swapStatus === 'error'
                      ? 'rgba(239,68,68,0.1)'
                      : 'rgba(56,189,248,0.08)',
                }}
              >
                <Text style={{ ...type.bodyM, color: neon.text }}>{status}</Text>
                {txHash && (
                  <View className="mt-2">
                    <Pressable
                      onPress={() => {
                        const explorerUrl = getExplorerUrl()
                        if (txHash) {
                          Linking.openURL(`${explorerUrl}/tx/${txHash}`)
                        }
                      }}
                    >
                      <Text style={{ ...type.caption, color: neon.blue, textDecorationLine: 'underline' }}>
                        View on Explorer
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {/* Faucet (if low balance) */}
            {wallet.isConnected && wallet.balanceTfuel < 0.1 && (
              <View className="mb-4">
                <NeonButton
                  label={faucetLoading ? 'Requesting…' : 'Get Test TFUEL'}
                  rightHint="faucet"
                  variant="secondary"
                  onPress={handleFaucet}
                  disabled={faucetLoading}
                />
              </View>
            )}

            {/* Main Swap Button */}
            <View className="gap-3" style={{ paddingBottom: 92 }}>
              <NeonButton
                label={
                  swapStatus === 'swapping' || isSwapping
                    ? 'Swapping…'
                    : swapStatus === 'success'
                    ? '✅ Swap complete!'
                    : '⚡ Swap & Compound'
                }
                onPress={swapAndCompound}
                disabled={!wallet.isConnected || tfuelAmount === 0 || isSwapping || swapStatus === 'swapping'}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Modals */}
      <ThetaWalletQRModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        onConnecting={(uri) => {
          console.log('WalletConnect URI ready:', uri)
        }}
      />
    </ScreenBackground>
  )
}
