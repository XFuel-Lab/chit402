/**
 * TOAST NOTIFICATIONS - Elegant, Non-Intrusive Alerts
 * 
 * Features:
 * - Success, error, info, warning variants
 * - Auto-dismiss with configurable duration
 * - Haptic feedback integration
 * - Neon cyberpunk styling
 */

import Toast from 'react-native-toast-message'
import * as Haptics from 'expo-haptics'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastOptions {
  duration?: number
  haptic?: boolean
  position?: 'top' | 'bottom'
}

const DEFAULT_DURATION = 4000

/**
 * Show success toast with green neon styling
 */
export function showSuccess(message: string, options: ToastOptions = {}) {
  const { duration = DEFAULT_DURATION, haptic = true, position = 'top' } = options

  if (haptic) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  }

  Toast.show({
    type: 'success',
    text1: '✅ Success',
    text2: message,
    position,
    visibilityTime: duration,
  })
}

/**
 * Show error toast with red/pink neon styling
 */
export function showError(message: string, options: ToastOptions = {}) {
  const { duration = DEFAULT_DURATION, haptic = true, position = 'top' } = options

  if (haptic) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
  }

  Toast.show({
    type: 'error',
    text1: '❌ Error',
    text2: message,
    position,
    visibilityTime: duration,
  })
}

/**
 * Show info toast with blue neon styling
 */
export function showInfo(message: string, options: ToastOptions = {}) {
  const { duration = DEFAULT_DURATION, haptic = false, position = 'top' } = options

  if (haptic) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  }

  Toast.show({
    type: 'info',
    text1: 'ℹ️ Info',
    text2: message,
    position,
    visibilityTime: duration,
  })
}

/**
 * Show warning toast with amber neon styling
 */
export function showWarning(message: string, options: ToastOptions = {}) {
  const { duration = DEFAULT_DURATION, haptic = true, position = 'top' } = options

  if (haptic) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  }

  Toast.show({
    type: 'info', // Use info type, customize with config
    text1: '⚠️ Warning',
    text2: message,
    position,
    visibilityTime: duration,
  })
}

/**
 * Connection-specific toasts
 */
export const connectionToasts = {
  connecting: () => showInfo('Connecting to Theta Wallet...', { haptic: true }),
  connected: (address: string) => showSuccess(`Connected: ${address}`, { haptic: true }),
  disconnected: () => showInfo('Wallet disconnected', { haptic: false }),
  sessionRestored: (address: string) => showSuccess(`Session restored: ${address}`, { haptic: true, duration: 2000 }),
  error: (error: string) => showError(`Connection failed: ${error}`, { duration: 6000 }),
}

/**
 * Swap-specific toasts
 */
export const swapToasts = {
  initiated: (amount: number, lst: string) => 
    showInfo(`Swapping ${amount.toFixed(2)} TFUEL → ${lst}...`, { haptic: true }),
  success: (lst: string, apy: number) => 
    showSuccess(`Swapped to ${lst}! Now earning ${apy.toFixed(1)}% APY`, { haptic: true, duration: 6000 }),
  error: (error: string) => showError(error, { duration: 6000 }),
  insufficientFunds: () => showWarning('Insufficient TFUEL balance', { duration: 5000 }),
}

/**
 * Stake-specific toasts
 */
export const stakeToasts = {
  initiated: (amount: number, weeks: number) => 
    showInfo(`Locking ${amount} XF for ${weeks} weeks...`, { haptic: true }),
  success: (veXF: number, boost: number) => 
    showSuccess(`Locked! Received ${veXF.toFixed(0)} veXF (${boost.toFixed(2)}x boost)`, { duration: 6000 }),
  error: (error: string) => showError(error, { duration: 6000 }),
}

