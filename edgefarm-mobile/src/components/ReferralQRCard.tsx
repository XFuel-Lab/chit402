/**
 * Referral QR Code Generator & Sharing
 * 
 * Viral growth loop: Users share QR codes, earn bonuses for referrals.
 * Elon-level virality: Make sharing addictive with visual rewards.
 */

import React, { useState, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Share, Alert } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import QRCode from 'react-native-qrcode-svg'
import * as Haptics from 'expo-haptics'
import { neon } from '../theme/neon'
import { type as typography } from '../theme/typography'

interface ReferralQRCardProps {
  userAddress: string | null
  referralCount?: number
  bonusEarned?: number
  onShareSuccess?: () => void
}

export function ReferralQRCard({
  userAddress,
  referralCount = 0,
  bonusEarned = 0,
  onShareSuccess,
}: ReferralQRCardProps) {
  const [qrExpanded, setQrExpanded] = useState(false)
  const qrRef = useRef<any>(null)

  const referralLink = userAddress
    ? `https://xfuel.app?ref=${userAddress}`
    : 'https://xfuel.app'

  const handleShare = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})

      const result = await Share.share({
        message: `🚀 Join me on XFUEL—the fastest way to turn Theta Edge Node earnings into Cosmos high-yield LSTs!\n\nEarn 25%+ APY on your TFUEL.\n\nUse my referral link: ${referralLink}`,
        url: referralLink,
        title: 'Join XFUEL',
      })

      if (result.action === Share.sharedAction) {
        if (onShareSuccess) {
          onShareSuccess()
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      }
    } catch (error) {
      console.error('Share error:', error)
      Alert.alert('Error', 'Failed to share referral link')
    }
  }

  const handleQRPress = () => {
    setQrExpanded(!qrExpanded)
    Haptics.selectionAsync().catch(() => {})
  }

  if (!userAddress) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[
            'rgba(168, 85, 247, 0.2)',
            'rgba(56, 189, 248, 0.15)',
            'rgba(15, 23, 42, 0.4)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <Text style={styles.emptyText}>Connect wallet to get your referral link</Text>
        </LinearGradient>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[
          'rgba(168, 85, 247, 0.25)',
          'rgba(56, 189, 248, 0.2)',
          'rgba(15, 23, 42, 0.5)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.emoji}>🎁</Text>
            <View>
              <Text style={styles.title}>Share & Earn</Text>
              <Text style={styles.subtitle}>Get bonuses for referrals</Text>
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{referralCount}</Text>
            <Text style={styles.statLabel}>Referrals</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{bonusEarned.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Bonus Earned</Text>
          </View>
        </View>

        {/* QR Code (collapsible) */}
        {qrExpanded && (
          <Pressable onPress={handleQRPress} style={styles.qrContainer}>
            <View style={styles.qrWrapper}>
              <QRCode
                value={referralLink}
                size={200}
                backgroundColor="white"
                color="black"
                logoSize={40}
                logoBackgroundColor="white"
              />
            </View>
            <Text style={styles.qrHint}>Tap to collapse</Text>
          </Pressable>
        )}

        {/* Action Buttons */}
        <View style={styles.actions}>
          <Pressable
            onPress={handleQRPress}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>
              {qrExpanded ? '✕ Hide QR' : '📱 Show QR Code'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleShare}
            style={({ pressed }) => [
              styles.button,
              styles.primaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <LinearGradient
              colors={['rgba(168, 85, 247, 0.8)', 'rgba(56, 189, 248, 0.7)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.buttonGradient}
            >
              <Text style={styles.buttonText}>🚀 Share Link</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Bonus Info */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            💰 Earn <Text style={styles.infoHighlight}>4x votes + bonus rXF</Text> for each referral!
          </Text>
          <Text style={styles.infoSubtext}>
            Your referrals get bonus rewards too 🤝
          </Text>
        </View>
      </LinearGradient>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(168, 85, 247, 0.4)',
    shadowColor: neon.purple,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  gradient: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emoji: {
    fontSize: 32,
  },
  title: {
    ...typography.h3,
    color: 'rgba(255, 255, 255, 0.95)',
  },
  subtitle: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    alignItems: 'center',
  },
  statValue: {
    ...typography.h2,
    color: neon.purple,
    marginBottom: 4,
  },
  statLabel: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  qrWrapper: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'white',
    borderWidth: 3,
    borderColor: neon.purple,
    shadowColor: neon.purple,
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  },
  qrHint: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  buttonGradient: {
    padding: 12,
    alignItems: 'center',
  },
  primaryButton: {
    borderWidth: 2,
    borderColor: 'rgba(168, 85, 247, 0.6)',
  },
  secondaryButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    padding: 12,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    ...typography.bodyM,
    color: 'rgba(255, 255, 255, 0.95)',
    fontWeight: '600',
  },
  infoBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  infoText: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginBottom: 4,
  },
  infoHighlight: {
    color: neon.cyan,
    fontWeight: '600',
  },
  infoSubtext: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  emptyText: {
    ...typography.bodyM,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    padding: 24,
  },
})

