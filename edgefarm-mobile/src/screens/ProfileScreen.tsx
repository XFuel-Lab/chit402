import React, { useState, useEffect } from 'react'
import { ScrollView, Text, View, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { ThetaWalletQRModal } from '../components/ThetaWalletQRModal'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { NeonPill } from '../components/NeonPill'
import { NeonButton } from '../components/NeonButton'
import * as Haptics from 'expo-haptics'
import { connectThetaWallet, createDisconnectedWallet, refreshBalance, type WalletInfo } from '../lib/thetaWallet'

export function ProfileScreen() {
  const [wallet, setWallet] = useState(createDisconnectedWallet())
  const [qrModalVisible, setQrModalVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const connect = async () => {
    try {
      setQrModalVisible(true)
      const w = await connectThetaWallet()
      setWallet(w)
      setQrModalVisible(false)
      
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
      console.error('Connection failed:', error?.message || 'Unknown error')
    }
  }

  const handleRefresh = async () => {
    if (!wallet.isConnected || !wallet.addressFull) return
    
    setRefreshing(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    try {
      const newBalance = await refreshBalance(wallet.addressFull)
      setWallet((prev) => ({ ...prev, balanceTfuel: newBalance }))
    } catch (error) {
      console.error('Balance refresh failed:', error)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <ScreenBackground grid={false}>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View className="mb-2 flex-row items-center justify-between">
            <View>
              <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.96)' }}>Profile</Text>
              <Text style={{ ...type.caption, marginTop: 4, color: 'rgba(148,163,184,0.9)' }}>
                Your XFUEL wallet & balances
              </Text>
            </View>
            {wallet.isConnected && (
              <View style={{ alignItems: 'flex-end' }}>
                <NeonPill label="Connected" tone="green" />
              </View>
            )}
          </View>

          {/* Wallet Connection Card */}
          {!wallet.isConnected ? (
            <NeonCard className="mt-4">
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Text
                  style={{
                    fontSize: 48,
                    marginBottom: 16,
                  }}
                >
                  ⚡
                </Text>
                <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)', marginBottom: 8, textAlign: 'center' }}>
                  Connect Theta Wallet
                </Text>
                <Text
                  style={{
                    ...type.body,
                    color: 'rgba(148,163,184,0.9)',
                    textAlign: 'center',
                    marginBottom: 20,
                  }}
                >
                  View your balances, transaction history, and more
                </Text>
                <View style={{ width: '100%' }}>
                  <NeonButton label="Connect Wallet" onPress={connect} rightHint="secure" />
                </View>
              </View>
            </NeonCard>
          ) : (
            <>
              {/* Connected Wallet Info */}
              <NeonCard className="mt-4">
                <View className="flex-row items-center justify-between mb-3">
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>WALLET ADDRESS</Text>
                  <Pressable onPress={handleRefresh} disabled={refreshing}>
                    <Text style={{ ...type.caption, color: neon.blue }}>
                      {refreshing ? 'Refreshing...' : '↻ Refresh'}
                    </Text>
                  </Pressable>
                </View>
                <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)', fontFamily: 'monospace' }}>
                  {wallet.addressFull}
                </Text>

                {/* Balance Display */}
                <View className="mt-6">
                  <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)', marginBottom: 12 }}>
                    TOKEN BALANCES
                  </Text>

                  {/* TFUEL Balance */}
                  <View
                    style={{
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: 'rgba(56,189,248,0.4)',
                      backgroundColor: 'rgba(56,189,248,0.08)',
                      padding: 16,
                      marginBottom: 12,
                    }}
                  >
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>TFUEL</Text>
                        <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)', marginTop: 4 }}>
                          {wallet.balanceTfuel.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                        </Text>
                      </View>
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          borderWidth: 1,
                          borderColor: 'rgba(56,189,248,0.6)',
                          backgroundColor: 'rgba(56,189,248,0.15)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 24 }}>⚡</Text>
                      </View>
                    </View>
                  </View>

                  {/* Placeholder for other tokens */}
                  <View
                    style={{
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: 'rgba(148,163,184,0.3)',
                      backgroundColor: 'rgba(0,0,0,0.2)',
                      padding: 16,
                    }}
                  >
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>rXF (Early Believers)</Text>
                        <Text style={{ ...type.h2, color: 'rgba(148,163,184,0.7)', marginTop: 4 }}>
                          0.00
                        </Text>
                        <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.7)', marginTop: 2 }}>
                          Join Early Believers round
                        </Text>
                      </View>
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          borderWidth: 1,
                          borderColor: 'rgba(168,85,247,0.4)',
                          backgroundColor: 'rgba(168,85,247,0.12)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 24 }}>🚀</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </NeonCard>

              {/* Quick Actions */}
              <NeonCard className="mt-4">
                <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)', marginBottom: 16 }}>
                  Quick Actions
                </Text>
                <View style={{ gap: 12 }}>
                  <NeonButton
                    label="Go to Swap"
                    variant="secondary"
                    rightHint="trade TFUEL"
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                      // Navigate to swap tab
                    }}
                  />
                  <NeonButton
                    label="Join Early Believers"
                    variant="secondary"
                    rightHint="get rXF"
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {})
                      // Navigate to swap tab where the modal is
                    }}
                  />
                </View>
              </NeonCard>
            </>
          )}

          {/* Info Card */}
          <NeonCard className="mt-6">
            <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.96)', marginBottom: 12 }}>
              About XFUEL
            </Text>
            <Text style={{ ...type.body, color: 'rgba(148,163,184,0.9)', lineHeight: 22 }}>
              XFUEL Protocol enables seamless swaps from TFUEL to liquid staking tokens (LSTs) with cyberpunk neon
              aesthetics. Built on Theta Network.
            </Text>
            <View style={{ marginTop: 16, gap: 10 }}>
              <NeonButton
                label="View Documentation"
                variant="secondary"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {})
                }}
              />
            </View>
          </NeonCard>
        </ScrollView>
      </SafeAreaView>

      {/* Theta Wallet QR Modal */}
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
