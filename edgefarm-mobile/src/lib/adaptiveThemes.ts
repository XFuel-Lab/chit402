/**
 * ADAPTIVE THEMES - Day/Night Auto-Switch + Lottie Animations
 * 
 * Features:
 * - Auto theme switching based on time of day
 * - Smooth theme transitions
 * - Lottie animation presets for luxury micro-interactions
 * - Neon glow intensity adapts to theme
 */

import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Appearance, ColorSchemeName } from 'react-native'

// ============================================================================
// THEME TYPES
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'cyberpunk' | 'auto'

export interface Theme {
  mode: ThemeMode
  colors: {
    bg0: string
    bg1: string
    bg2: string
    card: string
    cardBorder: string
    text: string
    textMuted: string
    primary: string
    secondary: string
    accent: string
    success: string
    warning: string
    error: string
    // Neon colors (always vibrant)
    neonPurple: string
    neonBlue: string
    neonPink: string
    neonGreen: string
    neonAmber: string
  }
  glows: {
    intensity: number // 0-1
    radius: number
    enabled: boolean
  }
  animations: {
    speed: number // 0.5-1.5
    hapticEnabled: boolean
  }
}

// ============================================================================
// THEME PRESETS
// ============================================================================

const CYBERPUNK_DARK: Theme = {
  mode: 'cyberpunk',
  colors: {
    bg0: '#05050a',
    bg1: '#0a0a14',
    bg2: '#14142e',
    card: 'rgba(20, 20, 36, 0.70)',
    cardBorder: 'rgba(168, 85, 247, 0.22)',
    text: '#e5e7eb',
    textMuted: '#9ca3af',
    primary: '#a855f7', // Purple
    secondary: '#38bdf8', // Blue
    accent: '#fb7185', // Pink
    success: '#34d399',
    warning: '#fbbf24',
    error: '#ef4444',
    neonPurple: '#a855f7',
    neonBlue: '#38bdf8',
    neonPink: '#fb7185',
    neonGreen: '#34d399',
    neonAmber: '#fbbf24',
  },
  glows: {
    intensity: 0.8,
    radius: 24,
    enabled: true,
  },
  animations: {
    speed: 1.0,
    hapticEnabled: true,
  },
}

const LIGHT_MODE: Theme = {
  mode: 'light',
  colors: {
    bg0: '#f8fafc',
    bg1: '#f1f5f9',
    bg2: '#e2e8f0',
    card: 'rgba(255, 255, 255, 0.95)',
    cardBorder: 'rgba(148, 163, 184, 0.30)',
    text: '#1e293b',
    textMuted: '#64748b',
    primary: '#8b5cf6', // Softer purple
    secondary: '#0ea5e9', // Softer blue
    accent: '#ec4899', // Softer pink
    success: '#10b981',
    warning: '#f59e0b',
    error: '#dc2626',
    neonPurple: '#a855f7',
    neonBlue: '#38bdf8',
    neonPink: '#fb7185',
    neonGreen: '#34d399',
    neonAmber: '#fbbf24',
  },
  glows: {
    intensity: 0.3,
    radius: 12,
    enabled: true,
  },
  animations: {
    speed: 1.0,
    hapticEnabled: true,
  },
}

const DARK_ELEGANT: Theme = {
  mode: 'dark',
  colors: {
    bg0: '#0f172a',
    bg1: '#1e293b',
    bg2: '#334155',
    card: 'rgba(30, 41, 59, 0.85)',
    cardBorder: 'rgba(148, 163, 184, 0.20)',
    text: '#f1f5f9',
    textMuted: '#cbd5e1',
    primary: '#8b5cf6',
    secondary: '#0ea5e9',
    accent: '#ec4899',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#dc2626',
    neonPurple: '#a855f7',
    neonBlue: '#38bdf8',
    neonPink: '#fb7185',
    neonGreen: '#34d399',
    neonAmber: '#fbbf24',
  },
  glows: {
    intensity: 0.5,
    radius: 18,
    enabled: true,
  },
  animations: {
    speed: 1.0,
    hapticEnabled: true,
  },
}

// ============================================================================
// THEME MANAGER
// ============================================================================

const THEME_STORAGE_KEY = '@xfuel:theme_mode'

/**
 * Get theme based on time of day (for auto mode)
 */
function getThemeByTime(): 'light' | 'dark' {
  const hour = new Date().getHours()
  
  // Light mode: 6 AM - 6 PM
  // Dark mode: 6 PM - 6 AM
  if (hour >= 6 && hour < 18) {
    return 'light'
  }
  
  return 'dark'
}

/**
 * Get theme preset
 */
export function getThemePreset(mode: ThemeMode): Theme {
  switch (mode) {
    case 'light':
      return LIGHT_MODE
    case 'dark':
      return DARK_ELEGANT
    case 'cyberpunk':
      return CYBERPUNK_DARK
    case 'auto':
      const autoMode = getThemeByTime()
      return autoMode === 'light' ? LIGHT_MODE : CYBERPUNK_DARK
    default:
      return CYBERPUNK_DARK
  }
}

/**
 * Load saved theme mode
 */
export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY)
    if (saved && ['light', 'dark', 'cyberpunk', 'auto'].includes(saved)) {
      return saved as ThemeMode
    }
    return 'cyberpunk' // Default to cyberpunk
  } catch (error) {
    console.error('Failed to load theme:', error)
    return 'cyberpunk'
  }
}

/**
 * Save theme mode
 */
export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, mode)
    console.log('✅ Theme saved:', mode)
  } catch (error) {
    console.error('Failed to save theme:', error)
  }
}

/**
 * React hook for theme management
 */
export function useTheme() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('cyberpunk')
  const [theme, setTheme] = useState<Theme>(CYBERPUNK_DARK)

  // Load saved theme on mount
  useEffect(() => {
    loadThemeMode().then((mode) => {
      setThemeMode(mode)
      setTheme(getThemePreset(mode))
    })
  }, [])

  // Auto theme: check time every minute
  useEffect(() => {
    if (themeMode !== 'auto') return

    const interval = setInterval(() => {
      setTheme(getThemePreset('auto'))
    }, 60000) // Check every minute

    return () => clearInterval(interval)
  }, [themeMode])

  // System theme listener (for auto mode)
  useEffect(() => {
    if (themeMode !== 'auto') return

    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setTheme(getThemePreset('auto'))
    })

    return () => subscription.remove()
  }, [themeMode])

  const switchTheme = async (mode: ThemeMode) => {
    setThemeMode(mode)
    setTheme(getThemePreset(mode))
    await saveThemeMode(mode)
  }

  return {
    theme,
    themeMode,
    switchTheme,
  }
}

// ============================================================================
// LOTTIE ANIMATION PRESETS
// ============================================================================

export interface LottieAnimation {
  name: string
  source: any // Lottie JSON source
  loop: boolean
  autoPlay: boolean
  speed: number
}

/**
 * Lottie animation presets for common interactions
 * 
 * Note: In production, you'd import actual Lottie JSON files:
 * import SuccessAnimation from '../assets/lottie/success.json'
 * 
 * For this implementation, we're providing the structure.
 */
export const LOTTIE_PRESETS = {
  // Success celebrations
  success: {
    name: 'success',
    source: null, // Would be: require('../assets/lottie/success.json')
    loop: false,
    autoPlay: true,
    speed: 1.0,
  },

  // Loading spinners
  loading: {
    name: 'loading',
    source: null, // Would be: require('../assets/lottie/loading.json')
    loop: true,
    autoPlay: true,
    speed: 1.2,
  },

  // Neon glow pulse
  neonPulse: {
    name: 'neon-pulse',
    source: null, // Would be: require('../assets/lottie/neon-pulse.json')
    loop: true,
    autoPlay: true,
    speed: 0.8,
  },

  // Rocket launch (for big swaps)
  rocketLaunch: {
    name: 'rocket-launch',
    source: null, // Would be: require('../assets/lottie/rocket.json')
    loop: false,
    autoPlay: true,
    speed: 1.0,
  },

  // Coin flip (for swaps)
  coinFlip: {
    name: 'coin-flip',
    source: null, // Would be: require('../assets/lottie/coin-flip.json')
    loop: false,
    autoPlay: true,
    speed: 1.0,
  },

  // Fire streak
  fireStreak: {
    name: 'fire-streak',
    source: null, // Would be: require('../assets/lottie/fire.json')
    loop: true,
    autoPlay: true,
    speed: 1.0,
  },

  // Badge unlock
  badgeUnlock: {
    name: 'badge-unlock',
    source: null, // Would be: require('../assets/lottie/badge.json')
    loop: false,
    autoPlay: true,
    speed: 1.0,
  },
}

/**
 * Get Lottie animation preset
 */
export function getLottiePreset(name: keyof typeof LOTTIE_PRESETS): LottieAnimation | null {
  return LOTTIE_PRESETS[name] || null
}

// ============================================================================
// MICRO-INTERACTION CONFIGS
// ============================================================================

export interface MicroInteraction {
  name: string
  haptic: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'error'
  animation?: keyof typeof LOTTIE_PRESETS
  sound?: string // For future: sound effects
  duration: number // ms
}

export const MICRO_INTERACTIONS: Record<string, MicroInteraction> = {
  buttonTap: {
    name: 'Button Tap',
    haptic: 'light',
    duration: 100,
  },

  buttonPress: {
    name: 'Button Press',
    haptic: 'medium',
    duration: 150,
  },

  swapSuccess: {
    name: 'Swap Success',
    haptic: 'success',
    animation: 'success',
    duration: 2000,
  },

  carouselScroll: {
    name: 'Carousel Scroll',
    haptic: 'selection',
    duration: 50,
  },

  sliderChange: {
    name: 'Slider Change',
    haptic: 'selection',
    duration: 30,
  },

  cardExpand: {
    name: 'Card Expand',
    haptic: 'light',
    duration: 300,
  },

  badgeUnlock: {
    name: 'Badge Unlock',
    haptic: 'heavy',
    animation: 'badgeUnlock',
    duration: 1500,
  },

  hypercarRev: {
    name: 'Hypercar Rev',
    haptic: 'heavy',
    animation: 'rocketLaunch',
    duration: 500,
  },
}

/**
 * Get micro-interaction config
 */
export function getMicroInteraction(name: keyof typeof MICRO_INTERACTIONS): MicroInteraction | null {
  return MICRO_INTERACTIONS[name] || null
}

