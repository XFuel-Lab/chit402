/**
 * Edge Node Pulse Tracker
 * 
 * Real-time earnings pulse display with animations and live updates.
 * Shows pulsing dots for each earning as it comes in.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { View, Text, StyleSheet, Animated, Easing } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { type EdgeNodeEarning, getTPulseSummary, startTPulsePoll, getDemoEarnings } from '../lib/tpulseApi'
import { neon } from '../theme/neon'
import { type as typography } from '../theme/typography'

interface EdgeNodePulseTrackerProps {
  nodeAddress: string | null
  isDemo?: boolean // If true, use demo data
  onEarningPulse?: (earning: EdgeNodeEarning) => void
}

export function EdgeNodePulseTracker({ 
  nodeAddress, 
  isDemo = false,
  onEarningPulse 
}: EdgeNodePulseTrackerProps) {
  const [recentEarnings, setRecentEarnings] = useState<EdgeNodeEarning[]>([])
  const [pulseAnim] = useState(new Animated.Value(0))
  const [totalToday, setTotalToday] = useState(0)
  const [earningsThisHour, setEarningsThisHour] = useState(0)

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      if (!nodeAddress && !isDemo) return

      try {
        if (isDemo) {
          // Use demo data
          const demoEarnings = getDemoEarnings()
          setRecentEarnings(demoEarnings.slice(0, 10)) // Show last 10
          setTotalToday(demoEarnings.reduce((sum, e) => sum + e.tfuelAmount, 0))
          setEarningsThisHour(demoEarnings.slice(0, 3).reduce((sum, e) => sum + e.tfuelAmount, 0))
        } else if (nodeAddress) {
          // Fetch real data
          const summary = await getTPulseSummary(nodeAddress)
          setRecentEarnings(summary.last24Hours.slice(0, 10))
          setTotalToday(summary.totalEarningsToday)
          setEarningsThisHour(summary.earningsThisHour)
        }
      } catch (error) {
        console.error('Error loading TPulse data:', error)
      }
    }

    loadData()
  }, [nodeAddress, isDemo])

  // Start real-time polling
  useEffect(() => {
    if (!nodeAddress || isDemo) return

    const cleanup = startTPulsePoll(nodeAddress, (earning) => {
      // Add new earning to top of list
      setRecentEarnings(prev => [earning, ...prev].slice(0, 10))
      
      // Update totals
      setEarningsThisHour(prev => prev + earning.tfuelAmount)
      setTotalToday(prev => prev + earning.tfuelAmount)
      
      // Trigger haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
      
      // Callback
      if (onEarningPulse) {
        onEarningPulse(earning)
      }
      
      // Animate pulse
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start()
    }, 60000) // Poll every minute

    return cleanup
  }, [nodeAddress, isDemo, onEarningPulse, pulseAnim])

  // Pulse animation style
  const pulseStyle = {
    transform: [{
      scale: pulseAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.15],
      }),
    }],
    opacity: pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.6],
    }),
  }

  const getSourceEmoji = (source: string) => {
    switch (source) {
      case 'video': return '🎥'
      case 'compute': return '⚙️'
      case 'cdn': return '🌐'
      case 'storage': return '💾'
      default: return '⚡'
    }
  }

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'video': return neon.purple
      case 'compute': return neon.cyan
      case 'cdn': return neon.blue
      case 'storage': return '#fbbf24'
      default: return neon.purple
    }
  }

  if (!nodeAddress && !isDemo) {
    return (
      <View style={styles.container}>
        <Text style={[typography.caption, { color: 'rgba(255,255,255,0.5)', textAlign: 'center' }]}>
          Connect wallet to see live Edge Node earnings
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Earnings summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Today</Text>
          <Animated.Text style={[styles.summaryValue, pulseStyle]}>
            {totalToday.toFixed(2)} TFUEL
          </Animated.Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>This Hour</Text>
          <Text style={styles.summaryValue}>
            {earningsThisHour.toFixed(2)} TFUEL
          </Text>
        </View>
      </View>

      {/* Recent pulses */}
      <View style={styles.pulsesContainer}>
        <Text style={styles.pulsesTitle}>Recent Earnings Pulses</Text>
        
        {recentEarnings.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No earnings yet today</Text>
            <Text style={styles.emptySubtext}>Keep your Edge Node running!</Text>
          </View>
        ) : (
          <View style={styles.pulsesList}>
            {recentEarnings.map((earning, index) => {
              const sourceColor = getSourceColor(earning.source)
              const timeAgo = formatTimeAgo(earning.timestamp)
              
              return (
                <View key={`${earning.timestamp}-${index}`} style={styles.pulseItem}>
                  <View style={[styles.pulseDot, { backgroundColor: sourceColor, shadowColor: sourceColor }]} />
                  <View style={styles.pulseContent}>
                    <View style={styles.pulseHeader}>
                      <Text style={styles.pulseEmoji}>{getSourceEmoji(earning.source)}</Text>
                      <Text style={styles.pulseAmount}>+{earning.tfuelAmount.toFixed(4)} TFUEL</Text>
                    </View>
                    <Text style={styles.pulseTime}>{timeAgo} • {earning.source}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>
    </View>
  )
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / (60 * 1000))
  const hours = Math.floor(diff / (60 * 60 * 1000))
  
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
  },
  summaryLabel: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
  },
  summaryValue: {
    ...typography.h2,
    color: neon.purple,
  },
  pulsesContainer: {
    gap: 12,
  },
  pulsesTitle: {
    ...typography.bodyM,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 4,
  },
  pulsesList: {
    gap: 12,
  },
  pulseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  pulseContent: {
    flex: 1,
  },
  pulseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  pulseEmoji: {
    fontSize: 16,
  },
  pulseAmount: {
    ...typography.bodyM,
    color: 'rgba(255, 255, 255, 0.95)',
    fontWeight: '600',
  },
  pulseTime: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodyM,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  emptySubtext: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
})

