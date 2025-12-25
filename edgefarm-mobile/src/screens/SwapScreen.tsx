import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Pressable, Text, TextInput, View, ScrollView, Linking, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Slider from '@react-native-community/slider'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { NeonButton } from '../components/NeonButton'
import { ThetaWalletQRModal } from '../components/ThetaWalletQRModal'
import { EarlyBelieversModal } from '../components/EarlyBelieversModal'
import { neon } from '../theme/neon'
import { connectThetaWallet, createDisconnectedWallet, refreshBalance, getSigner, getRouterAddress, getExplorerUrl, type WalletInfo } from '../lib/thetaWallet'
import { ethers } from '@thetalabs/theta-js'
import { API_URL } from '../lib/appConfig'
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

interface SwapTransaction {
  id: string
  txHash: string
  amount: number
  outputAmount: number
  targetLST: string
  timestamp: number
  simulated: boolean
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
  const [txHash, setTxHash] = useState<string | null>(null)
  const [faucetLoading, setFaucetLoading] = useState(false)
  const [swapStatus, setSwapStatus] = useState<'idle' | 'swapping' | 'success' | 'error'>('idle')
  const [refreshing, setRefreshing] = useState(false)
  const [swapHistory, setSwapHistory] = useState<SwapTransaction[]>([])
  const [forceSimulation, setForceSimulation] = useState(false)
  const [simulationMode, setSimulationMode] = useState(false)
  const [qrModalVisible, setQrModalVisible] = useState(false)
  const [believersModalVisible, setBelieversModalVisible] = useState(false)

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
      
      // Set up periodic balance refresh
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

  // Check if we should use simulation mode
  useEffect(() => {
    const minRequired = tfuelAmount + 0.01
    setSimulationMode(wallet.balanceTfuel < minRequired || forceSimulation)
  }, [wallet.balanceTfuel, tfuelAmount, forceSimulation])

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
    if (!wallet.isConnected || !wallet.addressFull || tfuelAmount === 0) {
      setStatus('Connect wallet and select amount')
      setSwapStatus('error')
      setTimeout(() => {
        setSwapStatus('idle')
        setStatus('')
      }, 3000)
      return
    }

    // Check if we should use simulation mode (backend API)
    const minRequired = tfuelAmount + 0.01 // Buffer for gas
    const useSimulation = forceSimulation || wallet.balanceTfuel < minRequired

    if (useSimulation) {
      // Use backend API for simulation
      try {
        setIsSwapping(true)
        setSwapStatus('swapping')
        setStatus(`Simulating swap: ${tfuelAmount.toFixed(2)} TFUEL → ${selectedLST.name}…`)

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
          throw new Error('Simulation request failed')
        }

        const data = await response.json()

        if (data.success) {
          setTxHash(data.txHash)
          
          // Add to transaction history
          const newTx: SwapTransaction = {
            id: `tx-${Date.now()}`,
            txHash: data.txHash,
            amount: tfuelAmount,
            outputAmount: data.outputAmount,
            targetLST: selectedLST.name,
            timestamp: Date.now(),
            simulated: true,
          }
          setSwapHistory(prev => [newTx, ...prev])

          setIsSwapping(false)
          setSwapStatus('success')
          setStatus('')
          setSuccessMsg(`✅ Staked into ${selectedLST.name} — earning ${selectedLST.apy.toFixed(1)}% APY (Simulated)`)
          setSuccessVisible(true)
          setSelectedPercentage(100)
          setCustomPercentage(100)

          setTimeout(() => {
            setTxHash(null)
            setSwapStatus('idle')
          }, 8000)
          return
        } else {
          throw new Error(data.message || 'Simulation failed')
        }
      } catch (error: any) {
        console.error('Simulation error:', error)
        setIsSwapping(false)
        setSwapStatus('error')
        setStatus(`Simulation failed: ${error.message || 'Unknown error'}`)
        setTimeout(() => {
          setSwapStatus('idle')
          setStatus('')
        }, 5000)
        return
      }
    }

    const routerAddress = getRouterAddress()
    if (!routerAddress) {
      setStatus('Router contract address not configured')
      setSwapStatus('error')
      setTimeout(() => {
        setSwapStatus('idle')
        setStatus('')
      }, 3000)
      return
    }

    // Router ABI for swapAndStake
    const ROUTER_ABI = [
      'function swapAndStake(uint256 amount, string calldata targetLST) external payable returns (uint256)',
      'event SwapAndStake(address indexed user, uint256 tfuelAmount, uint256 stakedAmount, string stakeTarget)',
    ]

    try {
      setIsSwapping(true)
      setSwapStatus('swapping')
      setStatus(`Swapping ${tfuelAmount.toFixed(2)} TFUEL → ${selectedLST.name}…`)

      const signer = await getSigner()
      if (!signer) {
        throw new Error('Failed to get wallet signer')
      }

      const amountWei = ethers.utils.parseEther(tfuelAmount.toString())
      const routerContract = new ethers.Contract(routerAddress, ROUTER_ABI, signer)

      // Call swapAndStake with native TFUEL (msg.value)
      // TFUEL is native token, so no approval needed
      const tx = await routerContract.swapAndStake(amountWei, selectedLST.name, {
        value: amountWei,
        gasLimit: 500000,
      })

      setTxHash(tx.hash)
      setStatus(`Transaction sent! Waiting for confirmation…`)

      // Wait for confirmation
      const receipt = await tx.wait()

      // Add to transaction history (real transaction)
      const outputAmount = tfuelAmount * 0.95 // 5% fee
      const newTx: SwapTransaction = {
        id: `tx-${Date.now()}`,
        txHash: tx.hash,
        amount: tfuelAmount,
        outputAmount: outputAmount,
        targetLST: selectedLST.name,
        timestamp: Date.now(),
        simulated: false,
      }
      setSwapHistory(prev => [newTx, ...prev])

      // Success!
      setIsSwapping(false)
      setSwapStatus('success')
      setStatus('')
      setSuccessMsg(`✅ Staked into ${selectedLST.name} — earning ${selectedLST.apy.toFixed(1)}% APY`)
      setSuccessVisible(true)
      setSelectedPercentage(100)
      setCustomPercentage(100)

      // Refresh balance after transaction
      setTimeout(async () => {
        if (wallet.addressFull) {
          const newBalance = await refreshBalance(wallet.addressFull)
          setWallet((prev) => ({ ...prev, balanceTfuel: newBalance }))
        }
      }, 2000)

      // Clear tx hash after showing success
      setTimeout(() => {
        setTxHash(null)
        setSwapStatus('idle')
      }, 8000)
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
        // Refresh balance after a delay
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
                <View style={{ gap: 12 }}>
                  <NeonButton label="Connect Theta Wallet" onPress={connect} rightHint="secure" />
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(148,163,184,0.2)',
                      paddingTop: 12,
                    }}
                  >
                    <NeonButton
                      label="Join Early Believers"
                      variant="secondary"
                      rightHint="special round"
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                        setBelieversModalVisible(true)
                      }}
                    />
                  </View>
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
                  
                  {/* Early Believers Button for Connected Users */}
                  <View
                    style={{
                      marginTop: 12,
                      borderTopWidth: 1,
                      borderTopColor: 'rgba(148,163,184,0.2)',
                      paddingTop: 12,
                    }}
                  >
                    <NeonButton
                      label="Join Early Believers"
                      variant="secondary"
                      rightHint="rXF + bonuses"
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                        setBelieversModalVisible(true)
                      }}
                    />
                  </View>
                </View>
              )}
            </NeonCard>

            {/* Simulation Mode Banner */}
            {simulationMode && (
              <View
                style={{
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(251,191,36,0.4)',
                  backgroundColor: 'rgba(251,191,36,0.1)',
                  padding: 12,
                  marginBottom: 20,
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <Text style={{ color: '#fbbf24' }}>⚠️</Text>
                    <Text style={{ ...type.bodyM, color: '#fde68a', fontWeight: '600' }}>
                      Simulation Mode – Real swaps pending testnet TFUEL
                    </Text>
                  </View>
                  {forceSimulation && (
                    <Pressable onPress={() => setForceSimulation(false)}>
                      <Text style={{ ...type.caption, color: '#fbbf24', textDecorationLine: 'underline' }}>
                        Disable
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}

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
                        View on Theta Explorer: {txHash.substring(0, 10)}…{txHash.substring(txHash.length - 8)}
                      </Text>
                    </Pressable>
                    <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
                      {txHash}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* Get Test TFUEL button - show when balance is low */}
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

            {/* Also show faucet button if swap fails due to low balance */}
            {wallet.isConnected && swapStatus === 'error' && status.includes('Insufficient') && (
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

            {/* Transaction History */}
            {swapHistory.length > 0 && (
              <View className="mb-4">
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
                  Recent Swaps
                </Text>
                <ScrollView className="max-h-64">
                  {swapHistory.slice(0, 10).map((tx) => (
                    <View
                      key={tx.id}
                      style={{
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: 'rgba(168,85,247,0.2)',
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        padding: 12,
                        marginBottom: 8,
                      }}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1">
                          <View className="flex-row items-center gap-2">
                            <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)', fontWeight: '600' }}>
                              {tx.amount.toFixed(2)} TFUEL → {tx.outputAmount.toFixed(2)} {tx.targetLST}
                            </Text>
                            {tx.simulated && (
                              <View
                                style={{
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor: 'rgba(251,191,36,0.6)',
                                  backgroundColor: 'rgba(251,191,36,0.1)',
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                }}
                              >
                                <Text style={{ ...type.caption, color: '#fbbf24', fontWeight: '600', fontSize: 10 }}>
                                  Simulated
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.5)' }}>
                            {new Date(tx.timestamp).toLocaleString()}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            const explorerUrl = getExplorerUrl()
                            Linking.openURL(`${explorerUrl}/tx/${tx.txHash}`)
                          }}
                        >
                          <Text style={{ ...type.caption, color: neon.blue, textDecorationLine: 'underline' }}>
                            View
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Single Swap & Stake Button */}
            <View className="gap-3" style={{ paddingBottom: 92 }}>
              <NeonButton
                label={
                  swapStatus === 'swapping' || isSwapping
                    ? 'Swapping…'
                    : swapStatus === 'success'
                    ? 'Swap complete'
                    : 'Swap & Stake'
                }
                onPress={swapAndStake}
                disabled={!wallet.isConnected || tfuelAmount === 0 || isSwapping || swapStatus === 'swapping'}
                rightHint={
                  swapStatus === 'swapping' || isSwapping
                    ? undefined
                    : swapStatus === 'success'
                    ? undefined
                    : '2 steps'
                }
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
        onClose={() => {
          setSuccessVisible(false)
          setTxHash(null)
        }}
        finalityTime={finalityText}
        txHash={txHash}
        explorerUrl={txHash ? `${getExplorerUrl()}/tx/${txHash}` : undefined}
      />

      {/* Theta Wallet QR Modal */}
      <ThetaWalletQRModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        onConnecting={(uri) => {
          console.log('WalletConnect URI ready:', uri)
        }}
      />

      {/* Early Believers Modal */}
      <EarlyBelieversModal
        visible={believersModalVisible}
        onClose={() => setBelieversModalVisible(false)}
        walletAddress={wallet.addressFull}
        walletBalance={wallet.balanceTfuel}
        onConnect={connect}
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