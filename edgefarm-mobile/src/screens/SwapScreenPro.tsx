/**
 * SWAP SCREEN PRO - One-Tap Magic with LST Carousel
 * 
 * Features:
 * - Infinite LST carousel with AI recommendations
 * - Smooth wallet connection with Smart Connect
 * - One-tap swap with confetti celebration
 * - Toast notifications for all states
 * - Haptic feedback perfection
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Text, View, ScrollView, Linking, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Slider from '@react-native-community/slider'
import ConfettiCannon from 'react-native-confetti-cannon'
import Toast from 'react-native-toast-message'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { NeonPill } from '../components/NeonPill'
import { LSTCarousel, type LSTOption } from '../components/LSTCarouselSimple'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import * as Haptics from 'expo-haptics'
import { getLSTPrices, type LSTPriceAndAPYData } from '../lib/oracle'
import {
  connectSmart,
  connectWalletConnect,
  getCurrentWallet,
  refreshBalance,
  disconnect,
  getExplorerUrl,
  type WalletInfo,
} from '../lib/mockWalletSimple'
import {
  showSuccess,
  showError,
  showInfo,
  connectionToasts,
  swapToasts,
} from '../lib/toastNotifications'
import { hapticHypercarRev, hapticPress } from '../lib/luxuryFeatures'
import { API_URL } from '../lib/appConfig'

export function SwapScreenPro() {
  const confettiRef = useRef<any>(null)
  const [wallet, setWallet] = useState<WalletInfo>(getCurrentWallet())
  const [swapPercentage, setSwapPercentage] = useState<number>(100)
  const [selectedLST, setSelectedLST] = useState<LSTOption | null>(null)
  const [isSwapping, setIsSwapping] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [priceData, setPriceData] = useState<LSTPriceAndAPYData | null>(null)

  // LST Options
  const lstOptions: LSTOption[] = useMemo(() => {
    const baseOptions = [
      {
        id: 'stkxprt',
        name: 'stkXPRT',
        fullName: 'Staked XPRT',
        apy: priceData?.apys.stkXPRT || 25.7,
        tvl: 45000000,
        network: 'Persistence',
        icon: '🔮',
        color: neon.purple,
        riskLevel: 'low' as const,
      },
      {
        id: 'stkatom',
        name: 'stkATOM',
        fullName: 'Staked ATOM',
        apy: priceData?.apys.stkATOM || 19.5,
        tvl: 120000000,
        network: 'Cosmos Hub',
        icon: '⚛️',
        color: neon.blue,
        riskLevel: 'low' as const,
      },
      {
        id: 'stktia',
        name: 'stkTIA',
        fullName: 'Staked TIA',
        apy: priceData?.apys.stkTIA || 15.2,
        tvl: 35000000,
        network: 'Celestia',
        icon: '🌟',
        color: '#00BFFF',
        riskLevel: 'medium' as const,
      },
      {
        id: 'stkosmo',
        name: 'stkOSMO',
        fullName: 'Staked OSMO',
        apy: priceData?.apys.stkOSMO || 18.1,
        tvl: 28000000,
        network: 'Osmosis',
        icon: '🧪',
        color: neon.pink,
        riskLevel: 'medium' as const,
      },
    ]

    // Sort by APY (highest first)
    return baseOptions.sort((a, b) => b.apy - a.apy)
  }, [priceData])

  // Fetch price data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await getLSTPrices()
        setPriceData(data)

        // Auto-select highest APY if none selected
        if (!selectedLST && lstOptions.length > 0) {
          setSelectedLST(lstOptions[0])
        }
      } catch (error) {
        console.error('Failed to fetch prices:', error)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [])

  // Auto-select highest APY when options update
  useEffect(() => {
    if (lstOptions.length > 0 && !selectedLST) {
      setSelectedLST(lstOptions[0])
    }
  }, [lstOptions])

  // Calculations
  const tfuelAmount = useMemo(() => {
    if (!wallet.isConnected) return 0
    return (wallet.balanceTfuel * swapPercentage) / 100
  }, [wallet.balanceTfuel, wallet.isConnected, swapPercentage])

  const estimatedLSTAmount = useMemo(() => {
    if (!priceData || !priceData.prices.TFUEL || tfuelAmount === 0 || !selectedLST) {
      return 0
    }

    try {
      const tfuelPrice = priceData.prices.TFUEL.price
      const lstPrice = priceData.prices[selectedLST.name as keyof typeof priceData.prices]?.price

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
    if (!selectedLST) return 0
    return (estimatedLSTAmount * selectedLST.apy) / 100 / 365
  }, [estimatedLSTAmount, selectedLST])

  // Handlers
  const handleConnect = async () => {
    try {
      connectionToasts.connecting()
      
      // Try Smart Connect first (uses AI + session persistence)
      const connectedWallet = await connectSmart()
      setWallet(connectedWallet)
      connectionToasts.connected(connectedWallet.addressShort!)
    } catch (error: any) {
      console.error('Connection error:', error)
      connectionToasts.error(error?.message || 'Connection failed')
    }
  }

  const handleRefresh = useCallback(async () => {
    if (!wallet.isConnected || !wallet.addressFull) return

    setRefreshing(true)
    hapticPress()

    try {
      const { tfuel, theta } = await refreshBalance(wallet.addressFull)
      setWallet({ ...wallet, balanceTfuel: tfuel, balanceTheta: theta })
      showSuccess('Balance refreshed')
    } catch (error) {
      console.error('Refresh failed:', error)
    }

    setRefreshing(false)
  }, [wallet])

  const handleSwap = async () => {
    if (!wallet.isConnected || !wallet.addressFull || tfuelAmount === 0 || !selectedLST) {
      showError('Please connect wallet and select amount')
      return
    }

    try {
      setIsSwapping(true)
      swapToasts.initiated(tfuelAmount, selectedLST.name)

      // Hypercar rev haptic sequence
      await hapticHypercarRev()

      // Call swap API
      const response = await fetch(`${API_URL}/api/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        
        // 🎉 CONFETTI CELEBRATION
        confettiRef.current?.start()
        swapToasts.success(selectedLST.name, selectedLST.apy)

        setTimeout(() => {
          setTxHash(null)
        }, 8000)

        // Refresh balance
        setTimeout(() => {
          handleRefresh()
        }, 3000)
      } else {
        throw new Error(data.message || 'Swap failed')
      }
    } catch (error: any) {
      console.error('Swap error:', error)
      setIsSwapping(false)

      let errorMessage = error?.message || 'Unexpected error'
      if (errorMessage.includes('insufficient')) {
        swapToasts.insufficientFunds()
      } else {
        swapToasts.error(errorMessage)
      }

      setTxHash(null)
    }
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView style={{ flex: 1 }}>
        {/* Confetti */}
        <ConfettiCannon
          ref={confettiRef}
          count={200}
          origin={{ x: -10, y: 0 }}
          fadeOut={true}
          autoStart={false}
          fallSpeed={2500}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            wallet.isConnected ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={neon.blue}
                colors={[neon.blue]}
              />
            ) : undefined
          }
        >
          <View style={{ padding: 20, paddingBottom: 110 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Swap & Compound</Text>
                <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.55)' }}>
                  One tap to highest APY
                </Text>
              </View>
              <NeonPill label="Gas-free" tone="blue" />
            </View>

            {/* Wallet Connection */}
            <NeonCard className="mt-5 mb-5">
              {!wallet.isConnected ? (
                <View style={{ gap: 12 }}>
                  <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.85)' }}>
                    Connect your Theta Wallet to start swapping
                  </Text>
                  <NeonButton label="🔌 Smart Connect" onPress={handleConnect} rightHint="AI-powered" />
                </View>
              ) : (
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>Connected</Text>
                    <Text style={{ ...type.caption, color: neon.green }}>{wallet.addressShort}</Text>
                  </View>
                  <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
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
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
                  <Text style={{ ...type.h1, color: neon.blue }}>{tfuelAmount.toFixed(2)}</Text>
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
                <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>1%</Text>
                  <Text style={{ ...type.bodyM, color: neon.blue, fontWeight: '600' }}>
                    {swapPercentage.toFixed(0)}%
                  </Text>
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>100%</Text>
                </View>
              </NeonCard>
            )}

            {/* LST Carousel */}
            {wallet.isConnected && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)', marginBottom: 12, paddingHorizontal: 4 }}>
                  Select Target LST
                </Text>
                <LSTCarousel
                  lstOptions={lstOptions}
                  selectedLST={selectedLST}
                  onSelect={(lst) => {
                    setSelectedLST(lst)
                    showInfo(`Selected ${lst.name} at ${lst.apy.toFixed(1)}% APY`)
                  }}
                />
              </View>
            )}

            {/* Preview */}
            {wallet.isConnected && tfuelAmount > 0 && selectedLST && (
              <NeonCard className="mb-5">
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>
                  You'll receive
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text style={{ ...type.h2, color: selectedLST.color }}>
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

            {/* Swap Button */}
            <View style={{ gap: 12, marginTop: 12 }}>
              <NeonButton
                label={isSwapping ? '⚡ Swapping...' : '⚡ Swap & Compound'}
                onPress={handleSwap}
                disabled={!wallet.isConnected || tfuelAmount === 0 || isSwapping || !selectedLST}
                rightHint={selectedLST ? `→ ${selectedLST.name}` : undefined}
              />
            </View>

            {/* Explorer Link */}
            {txHash && (
              <View style={{ marginTop: 16, alignItems: 'center' }}>
                <Text
                  style={{ ...type.caption, color: neon.blue, textDecorationLine: 'underline' }}
                  onPress={() => {
                    const explorerUrl = getExplorerUrl()
                    Linking.openURL(`${explorerUrl}/tx/${txHash}`)
                  }}
                >
                  View transaction on explorer →
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Toast Container */}
      <Toast />
    </ScreenBackground>
  )
}

