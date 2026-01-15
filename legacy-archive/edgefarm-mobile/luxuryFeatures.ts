/**
 * LUXURY FEATURES - Biometric, Crew Mode, Gamification
 * 
 * Features:
 * - Face ID / Touch ID wallet unlock (Expo LocalAuthentication)
 * - Crew Mode: Share yields & referral QR (Tesla referral vibes)
 * - Gamified daily streaks with Mars-themed badge unlocks
 * - Dopamine-driven haptics for every milestone
 */

import React, { useState, useEffect } from 'react'
import { View, Text, Pressable, Share, Platform } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Sharing from 'expo-sharing'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'

// ============================================================================
// BIOMETRIC AUTHENTICATION
// ============================================================================

const BIOMETRIC_STORAGE_KEY = '@xfuel:biometric_enabled'

export interface BiometricConfig {
  enabled: boolean
  type: 'fingerprint' | 'facial' | 'iris' | 'none'
}

/**
 * Check if biometric authentication is available on device
 */
export async function checkBiometricAvailability(): Promise<BiometricConfig> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync()
    if (!hasHardware) {
      return { enabled: false, type: 'none' }
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync()
    if (!isEnrolled) {
      return { enabled: false, type: 'none' }
    }

    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync()
    
    let type: BiometricConfig['type'] = 'none'
    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      type = 'facial'
    } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      type = 'fingerprint'
    } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      type = 'iris'
    }

    const enabledStr = await AsyncStorage.getItem(BIOMETRIC_STORAGE_KEY)
    const enabled = enabledStr === 'true'

    return { enabled, type }
  } catch (error) {
    console.error('Biometric check error:', error)
    return { enabled: false, type: 'none' }
  }
}

/**
 * Enable biometric authentication for wallet
 */
export async function enableBiometric(): Promise<boolean> {
  try {
    const config = await checkBiometricAvailability()
    if (config.type === 'none') {
      throw new Error('Biometric authentication not available')
    }

    await AsyncStorage.setItem(BIOMETRIC_STORAGE_KEY, 'true')
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    console.log('✅ Biometric enabled')
    return true
  } catch (error: any) {
    console.error('Failed to enable biometric:', error)
    return false
  }
}

/**
 * Disable biometric authentication
 */
export async function disableBiometric(): Promise<void> {
  await AsyncStorage.setItem(BIOMETRIC_STORAGE_KEY, 'false')
  console.log('🔓 Biometric disabled')
}

/**
 * Authenticate user with biometrics (Tesla key fob vibes)
 */
export async function authenticateWithBiometric(promptMessage?: string): Promise<boolean> {
  try {
    const config = await checkBiometricAvailability()
    if (!config.enabled || config.type === 'none') {
      return false
    }

    const typeLabel =
      config.type === 'facial' ? 'Face ID' : config.type === 'fingerprint' ? 'Touch ID' : 'Biometric'

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage || `Unlock with ${typeLabel}`,
      fallbackLabel: 'Use passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    })

    if (result.success) {
      // Tesla key fob haptic sequence
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
      }, 50)
      setTimeout(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      }, 150)

      console.log('✅ Biometric authentication successful')
      return true
    } else {
      console.log('❌ Biometric authentication failed:', result.error)
      return false
    }
  } catch (error) {
    console.error('Biometric authentication error:', error)
    return false
  }
}

// ============================================================================
// CREW MODE - SOCIAL SHARING (Tesla Referral Vibes)
// ============================================================================

export interface CrewShareData {
  totalYield: number
  apyBlended: number
  streakDays: number
  referralCode: string
  userName?: string
}

/**
 * Share yields & achievements with crew (like Tesla referrals)
 */
export async function shareCrewYields(data: CrewShareData): Promise<boolean> {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})

    const message = `🚀 I'm earning ${data.apyBlended.toFixed(1)}% APY with XFuel Protocol!

💰 Total Yield: $${data.totalYield.toFixed(2)}
🔥 ${data.streakDays}-day streak
⚡ ${data.apyBlended.toFixed(1)}% blended APY

Join my crew with code: ${data.referralCode}

#XFuelProtocol #DeFi #CosmosLST`

    const result = await Share.share(
      {
        message,
        title: 'XFuel Protocol - Join My Crew',
      },
      {
        dialogTitle: 'Share with your crew',
        subject: 'Check out my XFuel yields!',
      }
    )

    if (result.action === Share.sharedAction) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      console.log('✅ Crew share successful')
      return true
    }

    return false
  } catch (error) {
    console.error('Crew share error:', error)
    return false
  }
}

/**
 * Check if Sharing is available (for QR codes, images)
 */
export async function canShareFile(): Promise<boolean> {
  try {
    return await Sharing.isAvailableAsync()
  } catch {
    return false
  }
}

/**
 * Share file (QR code image, yield report, etc.)
 */
export async function shareFile(fileUri: string, mimeType: string = 'image/png'): Promise<boolean> {
  try {
    const available = await canShareFile()
    if (!available) {
      console.warn('File sharing not available on this device')
      return false
    }

    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: 'Share',
    })

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    return true
  } catch (error) {
    console.error('File share error:', error)
    return false
  }
}

// ============================================================================
// GAMIFIED STREAKS - Mars-Themed Badge System
// ============================================================================

const STREAK_STORAGE_KEY = '@xfuel:streak_data'
const BADGES_STORAGE_KEY = '@xfuel:unlocked_badges'

export interface StreakData {
  currentStreak: number
  longestStreak: number
  lastCheckIn: number // timestamp
  totalCheckIns: number
  unlockedBadges: string[]
}

export interface Badge {
  id: string
  name: string
  icon: string
  description: string
  requirement: number // days
  color: string
  unlocked: boolean
}

// Mars-themed badges
const BADGE_TIERS: Badge[] = [
  {
    id: 'mars_recruit',
    name: 'Mars Recruit',
    icon: '🚀',
    description: 'First step to Mars',
    requirement: 1,
    color: neon.blue,
    unlocked: false,
  },
  {
    id: 'orbit_achiever',
    name: 'Orbit Achiever',
    icon: '🛸',
    description: 'Escaped Earth gravity',
    requirement: 7,
    color: neon.purple,
    unlocked: false,
  },
  {
    id: 'asteroid_miner',
    name: 'Asteroid Miner',
    icon: '⛏️',
    description: 'Harvesting cosmic yields',
    requirement: 30,
    color: neon.amber,
    unlocked: false,
  },
  {
    id: 'mars_colonist',
    name: 'Mars Colonist',
    icon: '🏕️',
    description: 'Settled on the Red Planet',
    requirement: 90,
    color: neon.pink,
    unlocked: false,
  },
  {
    id: 'interstellar_legend',
    name: 'Interstellar Legend',
    icon: '🌌',
    description: 'Conquered the galaxy',
    requirement: 365,
    color: neon.green,
    unlocked: false,
  },
]

/**
 * Load streak data from storage
 */
export async function loadStreakData(): Promise<StreakData> {
  try {
    const data = await AsyncStorage.getItem(STREAK_STORAGE_KEY)
    if (data) {
      return JSON.parse(data)
    }

    // Default streak data
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastCheckIn: 0,
      totalCheckIns: 0,
      unlockedBadges: [],
    }
  } catch (error) {
    console.error('Failed to load streak data:', error)
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastCheckIn: 0,
      totalCheckIns: 0,
      unlockedBadges: [],
    }
  }
}

/**
 * Save streak data to storage
 */
async function saveStreakData(data: StreakData): Promise<void> {
  try {
    await AsyncStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.error('Failed to save streak data:', error)
  }
}

/**
 * Daily check-in (records user activity, updates streak)
 */
export async function dailyCheckIn(): Promise<{
  newStreak: number
  badgeUnlocked: Badge | null
  isNewRecord: boolean
}> {
  try {
    const data = await loadStreakData()
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000
    const lastCheckIn = data.lastCheckIn

    // Check if already checked in today
    const daysSinceLastCheckIn = Math.floor((now - lastCheckIn) / oneDayMs)

    let newStreak = data.currentStreak
    let isNewRecord = false

    if (daysSinceLastCheckIn === 0) {
      // Already checked in today
      return { newStreak, badgeUnlocked: null, isNewRecord: false }
    } else if (daysSinceLastCheckIn === 1) {
      // Continue streak
      newStreak = data.currentStreak + 1
    } else {
      // Streak broken, reset
      newStreak = 1
    }

    // Update longest streak
    const longestStreak = Math.max(newStreak, data.longestStreak)
    isNewRecord = newStreak > data.longestStreak

    // Check for newly unlocked badges
    let badgeUnlocked: Badge | null = null
    const newBadges = [...data.unlockedBadges]

    for (const badge of BADGE_TIERS) {
      if (newStreak >= badge.requirement && !data.unlockedBadges.includes(badge.id)) {
        newBadges.push(badge.id)
        badgeUnlocked = { ...badge, unlocked: true }
        break // Only unlock one badge at a time for celebration
      }
    }

    // Save updated data
    const updatedData: StreakData = {
      currentStreak: newStreak,
      longestStreak,
      lastCheckIn: now,
      totalCheckIns: data.totalCheckIns + 1,
      unlockedBadges: newBadges,
    }

    await saveStreakData(updatedData)

    // Haptic feedback
    if (badgeUnlocked) {
      // Epic badge unlock haptic sequence
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
      }, 100)
      setTimeout(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      }, 250)
    } else if (isNewRecord) {
      // New record haptic
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } else {
      // Regular check-in haptic
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    }

    console.log('✅ Daily check-in:', { newStreak, badgeUnlocked: badgeUnlocked?.name, isNewRecord })
    return { newStreak, badgeUnlocked, isNewRecord }
  } catch (error) {
    console.error('Daily check-in error:', error)
    return { newStreak: 0, badgeUnlocked: null, isNewRecord: false }
  }
}

/**
 * Get all badges with unlock status
 */
export async function getBadges(): Promise<Badge[]> {
  try {
    const data = await loadStreakData()

    return BADGE_TIERS.map((badge) => ({
      ...badge,
      unlocked: data.unlockedBadges.includes(badge.id),
    }))
  } catch (error) {
    console.error('Failed to get badges:', error)
    return BADGE_TIERS
  }
}

/**
 * Get next badge to unlock
 */
export async function getNextBadge(): Promise<Badge | null> {
  try {
    const badges = await getBadges()
    const data = await loadStreakData()

    for (const badge of badges) {
      if (!badge.unlocked && data.currentStreak < badge.requirement) {
        return {
          ...badge,
          requirement: badge.requirement - data.currentStreak, // Days remaining
        }
      }
    }

    return null // All badges unlocked!
  } catch (error) {
    console.error('Failed to get next badge:', error)
    return null
  }
}

// ============================================================================
// DOPAMINE HAPTICS - Micro-interactions for every touch
// ============================================================================

/**
 * Subtle tap haptic (for all tappable elements)
 */
export function hapticTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

/**
 * Button press haptic (for primary actions)
 */
export function hapticPress() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
}

/**
 * Success haptic (for completed actions)
 */
export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

/**
 * Error haptic (for failures)
 */
export function hapticError() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
}

/**
 * Hypercar rev haptic (for special moments like big swaps)
 */
export async function hapticHypercarRev() {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  setTimeout(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
  }, 40)
  setTimeout(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
  }, 90)
  setTimeout(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
  }, 150)
}

/**
 * Selection haptic (for slider changes, carousel scrolls)
 */
export function hapticSelection() {
  Haptics.selectionAsync().catch(() => {})
}

