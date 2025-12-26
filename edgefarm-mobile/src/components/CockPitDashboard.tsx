/**
 * COCKPIT DASHBOARD - Tesla Meets Digital Bugatti (Simplified)
 * 
 * Features:
 * - Simple animated gauges (no complex Reanimated)
 * - Clean metrics display
 * - Expandable cards
 * - At-a-glance luxury metrics
 */

import React, { useEffect, useMemo } from 'react'
import { Pressable, Text, View, StyleSheet, Animated } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'

// ============================================================================
// SIMPLE METRIC DISPLAY (No complex gauges to avoid Reanimated issues)
// ============================================================================

interface SimpleMetricProps {
  label: string
  value: string | number
  unit?: string
  color?: string
  icon?: keyof typeof Ionicons.glyphMap
}

function SimpleMetric({ label, value, unit = '', color = neon.blue, icon = 'stats-chart' }: SimpleMetricProps) {
  return (
    <View style={{ alignItems: 'center', padding: 16 }}>
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: `${color}20`,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Ionicons name={icon} size={28} color={color} />
      </View>
      <Text style={{ ...type.h1, fontSize: 32, color: 'rgba(255,255,255,0.98)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
      {unit && (
        <Text style={{ ...type.caption, fontSize: 11, marginTop: 4, color: 'rgba(255,255,255,0.65)' }}>
          {unit}
        </Text>
      )}
      <Text style={{ ...type.bodyM, marginTop: 8, color: 'rgba(255,255,255,0.95)' }}>{label}</Text>
    </View>
  )
}

// ============================================================================
// EXPANDABLE METRIC CARD
// ============================================================================

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: keyof typeof Ionicons.glyphMap
  color?: string
  onPress?: () => void
  expanded?: boolean
  children?: React.ReactNode
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon = 'stats-chart',
  color = neon.blue,
  onPress,
  expanded = false,
  children,
}: MetricCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(expanded)

  React.useEffect(() => {
    setIsExpanded(expanded)
  }, [expanded])

  return (
    <Pressable
      onPress={() => {
        if (onPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
          onPress()
        }
      }}
      style={{
        borderRadius: 20,
        borderWidth: 1,
        borderColor: `${color}40`,
        backgroundColor: 'rgba(20,20,36,0.7)',
        overflow: 'hidden',
      }}
    >
      <LinearGradient
        colors={[`${color}18`, `${color}08`, 'rgba(0,0,0,0.2)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={{ padding: 16 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: `${color}22`,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Ionicons name={icon} size={18} color={color} />
              </View>
              <View>
                <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.65)' }}>{title}</Text>
                <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.98)' }}>
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </Text>
                {subtitle && (
                  <Text style={{ ...type.caption, color: 'rgba(255,255,255,0.55)' }}>{subtitle}</Text>
                )}
              </View>
            </View>

            {onPress && (
              <View style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}>
                <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.65)" />
              </View>
            )}
          </View>

          {/* Expandable Content */}
          {children && isExpanded && (
            <View style={{ paddingTop: 16 }}>{children}</View>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  )
}

// ============================================================================
// FULL COCKPIT DASHBOARD
// ============================================================================

interface CockPitDashboardProps {
  tfuelBalance: number
  totalValue: number // USD
  dailyRevenue: number
  velocityTrend: number
  apyBlended: number
  lstYields: Array<{ name: string; apy: number; amount: number }>
  onMetricPress?: (metric: string) => void
}

export function CockPitDashboard({
  tfuelBalance,
  totalValue,
  dailyRevenue,
  velocityTrend,
  apyBlended,
  lstYields,
  onMetricPress,
}: CockPitDashboardProps) {
  const [expandedMetric, setExpandedMetric] = React.useState<string | null>(null)

  return (
    <View style={{ gap: 16 }}>
      {/* Simple Metrics Grid */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12 }}>
        <SimpleMetric
          value={tfuelBalance.toFixed(0)}
          unit="TFUEL"
          label="Balance"
          color={neon.blue}
          icon="wallet"
        />
        
        <SimpleMetric
          value={apyBlended.toFixed(1)}
          unit="% APY"
          label="Blended"
          color={neon.purple}
          icon="trending-up"
        />
      </View>

      {/* Daily Revenue */}
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <SimpleMetric
          value={`$${dailyRevenue.toFixed(2)}`}
          label="Daily Revenue"
          color={velocityTrend >= 0 ? neon.green : neon.pink}
          icon={velocityTrend >= 0 ? 'arrow-up' : 'arrow-down'}
        />
      </View>

      {/* Expandable Metrics */}
      <View style={{ gap: 12 }}>
        <MetricCard
          title="TOTAL VALUE"
          value={`$${totalValue.toLocaleString()}`}
          subtitle="All positions combined"
          icon="wallet"
          color={neon.green}
          onPress={() => {
            const metric = 'total-value'
            setExpandedMetric(expandedMetric === metric ? null : metric)
            onMetricPress?.('total-value')
          }}
          expanded={expandedMetric === 'total-value'}
        >
          <View style={{ gap: 8 }}>
            {lstYields.map((lst) => (
              <View key={lst.name} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ ...type.body, color: 'rgba(255,255,255,0.85)' }}>{lst.name}</Text>
                <Text style={{ ...type.body, color: neon.green }}>
                  {lst.amount.toFixed(2)} ({lst.apy.toFixed(1)}% APY)
                </Text>
              </View>
            ))}
          </View>
        </MetricCard>

        <MetricCard
          title="EARNINGS TODAY"
          value={`$${(dailyRevenue * 0.4).toFixed(2)}`}
          subtitle={`Projected: $${dailyRevenue.toFixed(2)}`}
          icon="trending-up"
          color={neon.amber}
        />

        <MetricCard
          title="7-DAY PROJECTION"
          value={`$${(dailyRevenue * 7).toFixed(2)}`}
          subtitle="Based on current APY"
          icon="calendar"
          color={neon.pink}
        />
      </View>
    </View>
  )
}

