import React, { useState, useEffect } from 'react'
import { Modal, View, Text, TextInput, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { ethers } from '@thetalabs/theta-js'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { NeonButton } from './NeonButton'
import { THETA_EXPLORER_URL } from '../lib/appConfig'

type Props = {
  visible: boolean
  onClose: () => void
  walletAddress: string | null
  walletBalance: number
  onConnect: () => Promise<void>
}

type PaymentMethod = 'TFUEL' | 'USDC'
type Tier = 'Standard' | 'Plus10' | 'Plus25'

// Hard cap configuration
const HARD_CAP_USD = 750000
const MINIMUM_CONTRIBUTION_USD = 100
const RXF_PER_USD = 5555.56

// Placeholder for multisig address (replace with actual)
const MULTISIG_ADDRESS = '0x0000000000000000000000000000000000000000' // TODO: Update with real address

/**
 * Early Believers Modal for Mobile
 * Features:
 * - TFUEL/USDC contribution
 * - Tier bonuses (+10% @ $50k, +25% @ $100k)
 * - Real-time rXF calculation
 * - Transaction handling
 */
export function EarlyBelieversModal({
  visible,
  onClose,
  walletAddress,
  walletBalance,
  onConnect,
}: Props) {
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('TFUEL')
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [tfuelPrice, setTfuelPrice] = useState<number>(0.05) // Fallback price
  const [totalRaised, setTotalRaised] = useState<number>(0)

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setAmount('')
      setStatus('idle')
      setStatusMessage('')
      setTxHash(null)
      setIsProcessing(false)
    }
  }, [visible])

  // Calculate USD value
  const numericAmount = parseFloat(amount) || 0
  const usdValue = paymentMethod === 'TFUEL' ? numericAmount * tfuelPrice : numericAmount

  // Calculate tier and rXF
  const getTier = (): Tier => {
    if (usdValue >= 100000) return 'Plus25'
    if (usdValue >= 50000) return 'Plus10'
    return 'Standard'
  }

  const tier = getTier()
  const tierBonus = tier === 'Plus25' ? 0.25 : tier === 'Plus10' ? 0.1 : 0
  const baseRXF = usdValue * RXF_PER_USD
  const bonusRXF = baseRXF * tierBonus
  const totalRXF = baseRXF + bonusRXF

  const progressPercentage = Math.min((totalRaised / HARD_CAP_USD) * 100, 100)
  const isCapReached = totalRaised >= HARD_CAP_USD
  const remainingCap = Math.max(0, HARD_CAP_USD - totalRaised)

  const handleContribute = async () => {
    if (!walletAddress) {
      await onConnect()
      return
    }

    // Validations
    if (isCapReached) {
      setStatus('error')
      setStatusMessage('Early Believers Round is complete.')
      return
    }

    if (!amount || numericAmount <= 0) {
      setStatus('error')
      setStatusMessage('Please enter a valid amount')
      return
    }

    if (usdValue < MINIMUM_CONTRIBUTION_USD) {
      setStatus('error')
      setStatusMessage(`Minimum contribution is $${MINIMUM_CONTRIBUTION_USD} USD`)
      return
    }

    if (totalRaised + usdValue > HARD_CAP_USD) {
      setStatus('error')
      setStatusMessage(`This would exceed the cap. Max: $${remainingCap.toFixed(2)} USD`)
      return
    }

    if (paymentMethod === 'TFUEL' && walletBalance < numericAmount + 0.01) {
      setStatus('error')
      setStatusMessage('Insufficient TFUEL balance (need extra for gas)')
      return
    }

    setIsProcessing(true)
    setStatus('idle')
    setStatusMessage('Preparing transaction...')

    try {
      // Placeholder for actual transaction logic
      // In production, integrate with Theta Wallet provider
      
      setStatus('error')
      setStatusMessage('Transaction not yet implemented. This is a preview build.')
      
      // Mock success for testing
      // setStatus('success')
      // setStatusMessage('Contribution received! You will receive rXF at TGE.')
      // setTxHash('0x1234567890abcdef...')

    } catch (error: any) {
      console.error('Contribution error:', error)
      setStatus('error')
      setStatusMessage(error?.message || 'Transaction failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    onClose()
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.95)',
        }}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: 60,
            paddingBottom: 40,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Close Button */}
          <Pressable
            onPress={handleClose}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              zIndex: 10,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(15,23,42,0.9)',
              borderWidth: 1,
              borderColor: 'rgba(148,163,184,0.5)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: 'white', fontSize: 20 }}>×</Text>
          </Pressable>

          <View
            style={{
              borderRadius: 24,
              borderWidth: 2,
              borderColor: 'rgba(56,189,248,0.6)',
              overflow: 'hidden',
              shadowColor: neon.blue,
              shadowOpacity: 0.8,
              shadowRadius: 32,
              shadowOffset: { width: 0, height: 0 },
            }}
          >
            <BlurView
              intensity={18}
              tint="dark"
              style={{
                backgroundColor: 'rgba(15,23,42,0.92)',
              }}
            >
              <LinearGradient
                colors={[
                  'rgba(56,189,248,0.25)',
                  'rgba(168,85,247,0.20)',
                  'rgba(236,72,153,0.18)',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 20 }}
              >
                {/* Header */}
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Text
                    style={{
                      fontSize: 32,
                      marginBottom: 12,
                    }}
                  >
                    🚀
                  </Text>
                  <Text
                    style={{
                      ...type.h2,
                      color: 'rgba(255,255,255,0.95)',
                      textAlign: 'center',
                      marginBottom: 8,
                    }}
                  >
                    Early Believers Round
                  </Text>
                  <Text
                    style={{
                      ...type.body,
                      color: 'rgba(148,163,184,0.9)',
                      textAlign: 'center',
                    }}
                  >
                    Contribute to receive rXF with tier bonuses
                  </Text>
                </View>

                {/* Progress Bar */}
                {!isCapReached && (
                  <View
                    style={{
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: 'rgba(56,189,248,0.3)',
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      padding: 12,
                      marginBottom: 20,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>
                        ROUND PROGRESS
                      </Text>
                      <Text style={{ ...type.caption, color: neon.blue, fontWeight: '600' }}>
                        {progressPercentage.toFixed(1)}%
                      </Text>
                    </View>
                    <View
                      style={{
                        height: 8,
                        borderRadius: 999,
                        backgroundColor: 'rgba(15,23,42,0.8)',
                        overflow: 'hidden',
                      }}
                    >
                      <View
                        style={{
                          width: `${progressPercentage}%`,
                          height: '100%',
                          borderRadius: 999,
                          backgroundColor: neon.blue,
                        }}
                      />
                    </View>
                    <Text
                      style={{
                        ...type.caption,
                        marginTop: 6,
                        color: 'rgba(255,255,255,0.7)',
                        textAlign: 'center',
                      }}
                    >
                      ${totalRaised.toLocaleString()} / ${HARD_CAP_USD.toLocaleString()} USD
                    </Text>
                  </View>
                )}

                {/* Wallet Connection */}
                {!walletAddress ? (
                  <View style={{ marginBottom: 20 }}>
                    <NeonButton
                      label="Connect Theta Wallet"
                      onPress={onConnect}
                    />
                  </View>
                ) : (
                  <>
                    {/* Connected Wallet */}
                    <View
                      style={{
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: 'rgba(56,189,248,0.3)',
                        backgroundColor: 'rgba(0,0,0,0.3)',
                        padding: 12,
                        marginBottom: 16,
                      }}
                    >
                      <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.8)' }}>
                        CONNECTED
                      </Text>
                      <Text style={{ ...type.bodyM, color: neon.blue, fontFamily: 'monospace' }}>
                        {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
                      </Text>
                      <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(255,255,255,0.7)' }}>
                        Balance: {walletBalance.toFixed(4)} TFUEL
                      </Text>
                    </View>

                    {/* Amount Input */}
                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)', marginBottom: 8 }}>
                        CONTRIBUTION AMOUNT
                      </Text>
                      <TextInput
                        value={amount}
                        onChangeText={setAmount}
                        placeholder="0.00"
                        placeholderTextColor="rgba(148,163,184,0.5)"
                        keyboardType="decimal-pad"
                        style={{
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: 'rgba(56,189,248,0.4)',
                          backgroundColor: 'rgba(0,0,0,0.4)',
                          padding: 14,
                          ...type.h3,
                          color: 'white',
                          fontFamily: 'monospace',
                        }}
                      />
                      {paymentMethod === 'TFUEL' && numericAmount > 0 && (
                        <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(56,189,248,0.9)' }}>
                          ≈ ${(numericAmount * tfuelPrice).toFixed(2)} USD
                        </Text>
                      )}
                      {numericAmount > 0 && usdValue < MINIMUM_CONTRIBUTION_USD && (
                        <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(251,191,36,0.95)' }}>
                          ⚠ Minimum: ${MINIMUM_CONTRIBUTION_USD} USD
                        </Text>
                      )}
                    </View>

                    {/* Payment Method Toggle */}
                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)', marginBottom: 8 }}>
                        PAYMENT METHOD
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <Pressable
                          onPress={() => setPaymentMethod('TFUEL')}
                          style={{
                            flex: 1,
                            borderRadius: 12,
                            borderWidth: 2,
                            borderColor: paymentMethod === 'TFUEL' ? neon.blue : 'rgba(148,163,184,0.3)',
                            backgroundColor: paymentMethod === 'TFUEL' ? 'rgba(56,189,248,0.15)' : 'rgba(0,0,0,0.3)',
                            padding: 12,
                            alignItems: 'center',
                          }}
                        >
                          <Text
                            style={{
                              ...type.bodyM,
                              color: paymentMethod === 'TFUEL' ? neon.blue : 'rgba(255,255,255,0.7)',
                              fontWeight: '600',
                            }}
                          >
                            TFUEL
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setPaymentMethod('USDC')}
                          style={{
                            flex: 1,
                            borderRadius: 12,
                            borderWidth: 2,
                            borderColor: paymentMethod === 'USDC' ? neon.blue : 'rgba(148,163,184,0.3)',
                            backgroundColor: paymentMethod === 'USDC' ? 'rgba(56,189,248,0.15)' : 'rgba(0,0,0,0.3)',
                            padding: 12,
                            alignItems: 'center',
                          }}
                        >
                          <Text
                            style={{
                              ...type.bodyM,
                              color: paymentMethod === 'USDC' ? neon.blue : 'rgba(255,255,255,0.7)',
                              fontWeight: '600',
                            }}
                          >
                            USDC
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Tier Display */}
                    {numericAmount > 0 && (
                      <View
                        style={{
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: 'rgba(168,85,247,0.5)',
                          backgroundColor: 'rgba(168,85,247,0.12)',
                          padding: 16,
                          marginBottom: 16,
                        }}
                      >
                        <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)', marginBottom: 12 }}>
                          YOU RECEIVE
                        </Text>
                        <Text
                          style={{
                            ...type.h1,
                            fontSize: 32,
                            color: neon.blue,
                            marginBottom: 8,
                            textShadowColor: neon.blue,
                            textShadowRadius: 20,
                            textShadowOffset: { width: 0, height: 0 },
                          }}
                        >
                          ~{totalRXF.toLocaleString(undefined, { maximumFractionDigits: 0 })} rXF
                        </Text>
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            marginTop: 8,
                            paddingTop: 8,
                            borderTopWidth: 1,
                            borderTopColor: 'rgba(148,163,184,0.2)',
                          }}
                        >
                          <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>
                            Tier:
                          </Text>
                          <Text
                            style={{
                              ...type.caption,
                              color:
                                tier === 'Plus25'
                                  ? neon.pink
                                  : tier === 'Plus10'
                                  ? neon.blue
                                  : 'rgba(255,255,255,0.9)',
                              fontWeight: '600',
                            }}
                          >
                            {tier === 'Plus25' ? '+25% Bonus' : tier === 'Plus10' ? '+10% Bonus' : 'Standard'}
                          </Text>
                        </View>
                        {tierBonus > 0 && (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                            <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>
                              Bonus:
                            </Text>
                            <Text style={{ ...type.caption, color: neon.green, fontWeight: '600' }}>
                              +{bonusRXF.toLocaleString(undefined, { maximumFractionDigits: 0 })} rXF
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Status Message */}
                    {statusMessage && (
                      <View
                        style={{
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor:
                            status === 'success'
                              ? 'rgba(16,185,129,0.5)'
                              : status === 'error'
                              ? 'rgba(239,68,68,0.5)'
                              : 'rgba(56,189,248,0.4)',
                          backgroundColor:
                            status === 'success'
                              ? 'rgba(16,185,129,0.12)'
                              : status === 'error'
                              ? 'rgba(239,68,68,0.12)'
                              : 'rgba(56,189,248,0.12)',
                          padding: 12,
                          marginBottom: 16,
                        }}
                      >
                        <Text
                          style={{
                            ...type.body,
                            color:
                              status === 'success'
                                ? neon.green
                                : status === 'error'
                                ? 'rgba(239,68,68,0.95)'
                                : neon.blue,
                          }}
                        >
                          {statusMessage}
                        </Text>
                        {txHash && (
                          <Text
                            style={{
                              ...type.caption,
                              marginTop: 6,
                              color: neon.blue,
                              fontFamily: 'monospace',
                            }}
                          >
                            {txHash.substring(0, 10)}...{txHash.substring(txHash.length - 8)}
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Action Buttons */}
                    {status !== 'success' && !isCapReached && (
                      <View style={{ gap: 12 }}>
                        <NeonButton
                          label={isProcessing ? 'Processing...' : 'Contribute Now'}
                          onPress={handleContribute}
                          disabled={isProcessing || !amount || numericAmount <= 0 || usdValue < MINIMUM_CONTRIBUTION_USD}
                        />
                        <NeonButton
                          label="Cancel"
                          variant="secondary"
                          onPress={handleClose}
                          disabled={isProcessing}
                        />
                      </View>
                    )}

                    {/* Disclaimer */}
                    <View
                      style={{
                        marginTop: 16,
                        paddingTop: 16,
                        borderTopWidth: 1,
                        borderTopColor: 'rgba(148,163,184,0.2)',
                      }}
                    >
                      <Text
                        style={{
                          ...type.caption,
                          color: 'rgba(148,163,184,0.7)',
                          textAlign: 'center',
                          fontSize: 10,
                        }}
                      >
                        This is a contribution to support protocol development. rXF provides governance and utility
                        within XFUEL. No promise of profit.
                      </Text>
                    </View>
                  </>
                )}
              </LinearGradient>
            </BlurView>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

