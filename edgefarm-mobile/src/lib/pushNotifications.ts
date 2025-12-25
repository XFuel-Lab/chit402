/**
 * Push Notifications for Edge Node Earnings
 * 
 * Sends local notifications when new TFUEL earnings are detected.
 * Elon-level engagement: Make users check their phone every time they earn.
 */

import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { type EdgeNodeEarning } from './tpulseApi'

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    
    if (finalStatus !== 'granted') {
      console.warn('Notification permission denied')
      return false
    }
    
    // Configure notification channel for Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('edge-earnings', {
        name: 'Edge Node Earnings',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#A855F7', // Purple
        sound: 'default',
      })
    }
    
    return true
  } catch (error) {
    console.error('Error requesting notification permissions:', error)
    return false
  }
}

/**
 * Send notification for new earning pulse
 */
export async function sendEarningNotification(earning: EdgeNodeEarning): Promise<void> {
  try {
    const sourceEmojis = {
      video: '🎥',
      compute: '⚙️',
      cdn: '🌐',
      storage: '💾',
    }
    
    const emoji = sourceEmojis[earning.source] || '⚡'
    const amount = earning.tfuelAmount.toFixed(4)
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${emoji} Edge Node Earning`,
        body: `Your node earned ${amount} TFUEL from ${earning.source}! 🤑`,
        data: {
          type: 'earning',
          earning,
        },
        badge: 1,
        sound: 'default',
      },
      trigger: null, // Send immediately
    })
  } catch (error) {
    console.error('Error sending earning notification:', error)
  }
}

/**
 * Send notification for daily earnings summary
 */
export async function sendDailySummaryNotification(
  totalEarnings: number,
  numberOfPulses: number
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔥 Daily Earnings Summary',
        body: `You earned ${totalEarnings.toFixed(2)} TFUEL from ${numberOfPulses} pulses today! Keep it going 🚀`,
        data: {
          type: 'daily_summary',
          totalEarnings,
          numberOfPulses,
        },
        badge: 1,
        sound: 'default',
      },
      trigger: null,
    })
  } catch (error) {
    console.error('Error sending daily summary notification:', error)
  }
}

/**
 * Schedule daily summary notification (sent at end of day)
 */
export async function scheduleDailySummaryNotification(
  hour: number = 23, // 11 PM
  minute: number = 0
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔥 Check Your Daily Earnings',
        body: 'See how much your Edge Node earned today!',
        data: {
          type: 'daily_reminder',
        },
      },
      trigger: {
        hour,
        minute,
        repeats: true,
      },
    })
  } catch (error) {
    console.error('Error scheduling daily summary:', error)
  }
}

/**
 * Cancel all notifications
 */
export async function cancelAllNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync()
  } catch (error) {
    console.error('Error canceling notifications:', error)
  }
}

/**
 * Get notification badge count
 */
export async function getBadgeCount(): Promise<number> {
  try {
    return await Notifications.getBadgeCountAsync()
  } catch (error) {
    console.error('Error getting badge count:', error)
    return 0
  }
}

/**
 * Set notification badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count)
  } catch (error) {
    console.error('Error setting badge count:', error)
  }
}

/**
 * Clear badge count
 */
export async function clearBadge(): Promise<void> {
  await setBadgeCount(0)
}

