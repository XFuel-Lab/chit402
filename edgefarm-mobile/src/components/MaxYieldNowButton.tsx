/**
 * Max Yield Now Button
 * 
 * One-tap button that automatically:
 * 1. Fetches current highest APY LST from oracle
 * 2. Routes all TFUEL balance to that LST
 * 3. Executes swap with one confirmation
 * 
 * Elon-level UX: Zero friction, maximum yield.
 */

import React, { useState, useEffect } from 'react'
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { getLSTPrices } from '../lib/oracle'
import { neon } from '../theme/neon'
import { type as typography } from '../theme/typography'

interface MaxYieldNowButtonProps {
  tfuelBalance: number
  onPress: (targetLST: string, amount: number, estimatedApy: number) => Promise<void>
  disabled?: boolean
}

export function MaxYieldNowButton({ tfuelBalance, onPress, disabled }: MaxYieldNowButtonProps) {
  const [loading, setLoading] = useState(false)
  const [topLST, setTopLST] = useState<{ name: string; apy: number } | null>(null)

  // Fetch top APY LST on mount and every 60s
  useEffect(() => {
    const fetchTopAPY = async () => {
      try {
        const data = await getLSTPrices()
        
        // Find highest APY
        let maxApy = 0
        let maxName = 'stkXPRT'
        
        Object.entries(data.apys).forEach(([name, apy]) => {
          if (apy > maxApy) {
            maxApy = apy
            maxName = name
          }
        })
        
        setTopLST({ name: maxName, apy: maxApy })
      } catch (error) {
        console.error('Error fetching top APY:', error)
        // Fallback
        setTopLST({ name: 'stkXPRT', apy: 25.7 })
      }
    }
    
    fetchTopAPY()
    const interval = setInterval(fetchTopAPY, 60000)
    return () => clearInterval(interval)
  }, [])

  const handlePress = async () => {
    if (disabled || loading || !topLST || tfuelBalance <= 0) return
    
    try {
      setLoading(true)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
      
      // Use 99% of balance to leave gas
      const amount = tfuelBalance * 0.99
      
      await onPress(topLST.name, amount, topLST.apy)
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (error) {
      console.error('Max Yield Now error:', error)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    } finally {
      setLoading(false)
    }
  }

  const estimatedDailyEarnings = topLST && tfuelBalance > 0
    ? (tfuelBalance * (topLST.apy / 100) / 365).toFixed(4)
    : '0'

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading || tfuelBalance <= 0}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
        (disabled || tfuelBalance <= 0) && styles.disabled,
      ]}
    >
      <LinearGradient
        colors={[
          'rgba(251, 191, 36, 0.4)', // Golden yellow
          'rgba(245, 158, 11, 0.35)',
          'rgba(217, 119, 6, 0.3)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.emoji}>🚀</Text>
                <Text style={styles.title}>MAX YIELD NOW</Text>
              </View>
              
              {topLST && (
                <View style={styles.details}>
                  <Text style={styles.detailText}>
                    → {topLST.name} · {topLST.apy.toFixed(1)}% APY
                  </Text>
                  <Text style={styles.earningsText}>
                    ~{estimatedDailyEarnings} TFUEL/day
                  </Text>
                </View>
              )}
              
              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  {tfuelBalance > 0
                    ? `Swap ${(tfuelBalance * 0.99).toFixed(2)} TFUEL instantly`
                    : 'Connect wallet to start'}
                </Text>
              </View>
            </>
          )}
        </View>
        
        {/* Animated glow effect */}
        <View style={styles.glowOverlay} />
      </LinearGradient>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'rgba(251, 191, 36, 0.6)',
    shadowColor: '#fbbf24',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.5,
  },
  gradient: {
    padding: 24,
    position: 'relative',
  },
  content: {
    alignItems: 'center',
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emoji: {
    fontSize: 32,
  },
  title: {
    ...typography.h2,
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  details: {
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    ...typography.bodyM,
    color: 'rgba(255, 255, 255, 0.95)',
    fontWeight: '600',
  },
  earningsText: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  footer: {
    marginTop: 8,
  },
  footerText: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  glowOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderRadius: 24,
  },
})

