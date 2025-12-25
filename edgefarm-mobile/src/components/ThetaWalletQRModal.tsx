import React, { useEffect, useState } from 'react'
import { Modal, View, Text, Pressable, ActivityIndicator } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import QRCode from 'react-native-qrcode-svg'
import * as Haptics from 'expo-haptics'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { NeonButton } from './NeonButton'
import { getWalletConnectUri, openThetaWalletApp } from '../lib/thetaWallet'

type Props = {
  visible: boolean
  onClose: () => void
  onConnecting?: (uri: string) => void
}

/**
 * ThetaWalletQRModal - Show QR code for WalletConnect
 * Features:
 * - Display WalletConnect QR code
 * - Deep link button to open Theta Wallet app
 * - Auto-refresh URI
 */
export function ThetaWalletQRModal({ visible, onClose, onConnecting }: Props) {
  const [uri, setUri] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)

  // Poll for URI from wallet connect
  useEffect(() => {
    if (!visible) {
      setUri(null)
      return
    }

    const checkUri = () => {
      const currentUri = getWalletConnectUri()
      if (currentUri && currentUri !== uri) {
        setUri(currentUri)
        onConnecting?.(currentUri)
      }
    }

    // Check immediately
    checkUri()

    // Poll every 500ms
    const interval = setInterval(checkUri, 500)

    return () => clearInterval(interval)
  }, [visible, uri, onConnecting])

  const handleOpenApp = async () => {
    if (!uri) return

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    
    const success = await openThetaWalletApp(uri)
    if (!success) {
      // Could show error toast here
      console.warn('Failed to open Theta Wallet app')
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
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.92)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
      >
        <Pressable
          style={{ position: 'absolute', inset: 0 }}
          onPress={handleClose}
        />

        {/* Modal Content */}
        <View
          style={{
            width: '100%',
            maxWidth: 400,
            borderRadius: 24,
            overflow: 'hidden',
          }}
        >
          <BlurView
            intensity={20}
            tint="dark"
            style={{
              backgroundColor: 'rgba(15,23,42,0.96)',
            }}
          >
            <LinearGradient
              colors={[
                'rgba(168,85,247,0.15)',
                'rgba(56,189,248,0.10)',
                'rgba(15,23,42,0.05)',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 24 }}
            >
              {/* Header */}
              <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 999,
                    borderWidth: 2,
                    borderColor: 'rgba(168,85,247,0.6)',
                    backgroundColor: 'rgba(168,85,247,0.15)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <Text style={{ fontSize: 32 }}>⚡</Text>
                </View>

                <Text
                  style={{
                    ...type.h2,
                    color: 'rgba(255,255,255,0.95)',
                    textAlign: 'center',
                    marginBottom: 8,
                  }}
                >
                  Connect Theta Wallet
                </Text>

                <Text
                  style={{
                    ...type.body,
                    color: 'rgba(148,163,184,0.9)',
                    textAlign: 'center',
                  }}
                >
                  Scan with Theta Wallet mobile app
                </Text>
              </View>

              {/* QR Code */}
              <View
                style={{
                  alignItems: 'center',
                  marginBottom: 24,
                }}
              >
                <View
                  style={{
                    padding: 24,
                    borderRadius: 20,
                    backgroundColor: 'white',
                    shadowColor: neon.purple,
                    shadowOpacity: 0.8,
                    shadowRadius: 32,
                    shadowOffset: { width: 0, height: 0 },
                    borderWidth: 2,
                    borderColor: 'rgba(168,85,247,0.6)',
                  }}
                >
                  {uri ? (
                    <QRCode
                      value={uri}
                      size={220}
                      backgroundColor="white"
                      color="black"
                    />
                  ) : (
                    <View
                      style={{
                        width: 220,
                        height: 220,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <ActivityIndicator size="large" color={neon.purple} />
                      <Text
                        style={{
                          ...type.caption,
                          marginTop: 12,
                          color: 'rgba(0,0,0,0.7)',
                        }}
                      >
                        Generating...
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Deep Link Button */}
              {uri && (
                <View style={{ marginBottom: 16 }}>
                  <NeonButton
                    label="Open Theta Wallet App"
                    onPress={handleOpenApp}
                    rightHint="recommended"
                  />
                </View>
              )}

              {/* Info */}
              <View
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(56,189,248,0.3)',
                  backgroundColor: 'rgba(56,189,248,0.08)',
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    ...type.caption,
                    color: 'rgba(56,189,248,0.95)',
                    textAlign: 'center',
                  }}
                >
                  💡 Tap "Open Theta Wallet App" or scan QR code
                </Text>
              </View>

              {/* Close Button */}
              <NeonButton
                label="Cancel"
                variant="secondary"
                onPress={handleClose}
              />
            </LinearGradient>
          </BlurView>
        </View>
      </View>
    </Modal>
  )
}

