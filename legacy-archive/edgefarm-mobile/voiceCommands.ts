/**
 * VOICE COMMANDS - Hands-Free Luxury Navigation
 * 
 * Features:
 * - Expo Speech for voice command recognition
 * - Natural language processing for common actions
 * - "Show my yields", "Swap to stkXPRT", "Check balance"
 * - Voice feedback with text-to-speech
 * - Tesla-like hands-free experience
 */

import * as Speech from 'expo-speech'
import * as Haptics from 'expo-haptics'

// ============================================================================
// VOICE COMMAND TYPES
// ============================================================================

export type VoiceCommand =
  | 'show_yields'
  | 'show_balance'
  | 'navigate_swap'
  | 'navigate_stake'
  | 'navigate_profile'
  | 'navigate_home'
  | 'check_apy'
  | 'refresh_data'
  | 'disconnect_wallet'
  | 'unknown'

export interface VoiceCommandResult {
  command: VoiceCommand
  confidence: number
  params?: Record<string, any>
  spokenResponse: string
}

// ============================================================================
// COMMAND PATTERNS (Simple NLP-style matching)
// ============================================================================

const COMMAND_PATTERNS: Record<VoiceCommand, RegExp[]> = {
  show_yields: [
    /show\s+(my\s+)?yields?/i,
    /what('?s|\s+is)\s+(my\s+)?yield/i,
    /how\s+much\s+(am\s+i\s+)?earning/i,
    /display\s+yields?/i,
  ],
  show_balance: [
    /show\s+(my\s+)?balance/i,
    /what('?s|\s+is)\s+(my\s+)?balance/i,
    /check\s+balance/i,
    /how\s+much\s+(do\s+i\s+)?have/i,
    /wallet\s+balance/i,
  ],
  navigate_swap: [
    /swap/i,
    /go\s+to\s+swap/i,
    /open\s+swap/i,
    /navigate\s+to\s+swap/i,
    /i\s+want\s+to\s+swap/i,
    /exchange/i,
  ],
  navigate_stake: [
    /stake/i,
    /go\s+to\s+stake/i,
    /open\s+stake/i,
    /lock\s+(xf|x\s+f)/i,
    /boost/i,
  ],
  navigate_profile: [
    /profile/i,
    /go\s+to\s+profile/i,
    /open\s+profile/i,
    /my\s+account/i,
    /settings/i,
  ],
  navigate_home: [
    /home/i,
    /go\s+to\s+home/i,
    /dashboard/i,
    /main\s+screen/i,
    /go\s+back/i,
  ],
  check_apy: [
    /what('?s|\s+is)\s+the\s+apy/i,
    /check\s+apy/i,
    /show\s+(me\s+)?apy/i,
    /interest\s+rate/i,
    /yield\s+rate/i,
  ],
  refresh_data: [
    /refresh/i,
    /update/i,
    /reload/i,
    /sync/i,
    /get\s+latest/i,
  ],
  disconnect_wallet: [
    /disconnect/i,
    /log\s*out/i,
    /sign\s*out/i,
    /disconnect\s+wallet/i,
  ],
  unknown: [],
}

// ============================================================================
// VOICE COMMAND PARSER
// ============================================================================

/**
 * Parse spoken text into a recognized command
 */
export function parseVoiceCommand(spokenText: string): VoiceCommandResult {
  const normalized = spokenText.toLowerCase().trim()

  // Try to match against each command pattern
  for (const [command, patterns] of Object.entries(COMMAND_PATTERNS)) {
    if (command === 'unknown') continue

    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      if (match) {
        const confidence = pattern.test(normalized) ? 0.9 : 0.7

        // Generate spoken response
        const spokenResponse = generateResponse(command as VoiceCommand, normalized)

        return {
          command: command as VoiceCommand,
          confidence,
          spokenResponse,
        }
      }
    }
  }

  // No match found
  return {
    command: 'unknown',
    confidence: 0,
    spokenResponse: "I didn't understand that command. Try saying 'show my yields' or 'navigate to swap'.",
  }
}

/**
 * Generate contextual spoken response
 */
function generateResponse(command: VoiceCommand, spokenText: string): string {
  const responses: Record<VoiceCommand, string> = {
    show_yields: 'Showing your yields.',
    show_balance: 'Displaying your wallet balance.',
    navigate_swap: 'Opening the swap screen.',
    navigate_stake: 'Opening the stake screen.',
    navigate_profile: 'Opening your profile.',
    navigate_home: 'Returning to dashboard.',
    check_apy: 'Let me check the current APY for you.',
    refresh_data: 'Refreshing your data.',
    disconnect_wallet: 'Disconnecting your wallet.',
    unknown: "I didn't understand that command.",
  }

  return responses[command] || responses.unknown
}

// ============================================================================
// TEXT-TO-SPEECH (Voice Feedback)
// ============================================================================

/**
 * Speak text with luxury voice settings
 */
export async function speak(
  text: string,
  options: {
    rate?: number
    pitch?: number
    haptic?: boolean
  } = {}
): Promise<void> {
  const { rate = 1.0, pitch = 1.0, haptic = true } = options

  try {
    if (haptic) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    }

    await Speech.speak(text, {
      language: 'en-US',
      rate,
      pitch,
    })

    console.log('🔊 Spoken:', text)
  } catch (error) {
    console.error('Speech error:', error)
  }
}

/**
 * Stop current speech
 */
export async function stopSpeaking(): Promise<void> {
  try {
    await Speech.stop()
  } catch (error) {
    console.error('Failed to stop speech:', error)
  }
}

/**
 * Check if currently speaking
 */
export async function isSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync()
  } catch {
    return false
  }
}

// ============================================================================
// VOICE COMMAND HANDLER (Execute Actions)
// ============================================================================

export interface VoiceCommandContext {
  navigation: any // React Navigation instance
  currentBalance?: number
  currentYield?: number
  currentApy?: number
  onRefresh?: () => Promise<void>
  onDisconnect?: () => Promise<void>
}

/**
 * Execute voice command with context
 */
export async function executeVoiceCommand(
  result: VoiceCommandResult,
  context: VoiceCommandContext
): Promise<boolean> {
  try {
    const { command, spokenResponse } = result
    const { navigation } = context

    // Speak response
    await speak(spokenResponse, { haptic: true })

    // Execute action
    switch (command) {
      case 'show_yields':
        // Navigate to home or display yields overlay
        navigation.navigate('Home')
        if (context.currentYield !== undefined) {
          setTimeout(() => {
            speak(`You're earning ${context.currentYield.toFixed(2)} dollars per day.`, {
              rate: 0.95,
            })
          }, 1500)
        }
        return true

      case 'show_balance':
        // Navigate to profile or speak balance
        if (context.currentBalance !== undefined) {
          setTimeout(() => {
            speak(`Your balance is ${context.currentBalance.toFixed(2)} TFUEL.`, { rate: 0.95 })
          }, 1000)
        } else {
          navigation.navigate('Profile')
        }
        return true

      case 'navigate_swap':
        navigation.navigate('Swap')
        return true

      case 'navigate_stake':
        navigation.navigate('Stake')
        return true

      case 'navigate_profile':
        navigation.navigate('Profile')
        return true

      case 'navigate_home':
        navigation.navigate('Home')
        return true

      case 'check_apy':
        if (context.currentApy !== undefined) {
          setTimeout(() => {
            speak(
              `The current blended APY is ${context.currentApy.toFixed(1)} percent. That's ${
                context.currentApy > 20 ? 'excellent' : 'good'
              }.`,
              { rate: 0.95 }
            )
          }, 1000)
        } else {
          navigation.navigate('Home')
        }
        return true

      case 'refresh_data':
        if (context.onRefresh) {
          await context.onRefresh()
          setTimeout(() => {
            speak('Your data has been refreshed.', { rate: 0.95 })
          }, 500)
        }
        return true

      case 'disconnect_wallet':
        if (context.onDisconnect) {
          await context.onDisconnect()
          setTimeout(() => {
            speak('Wallet disconnected.', { rate: 0.95 })
          }, 500)
        }
        return true

      case 'unknown':
        // Already spoken the error message
        return false

      default:
        return false
    }
  } catch (error) {
    console.error('Failed to execute voice command:', error)
    await speak('Sorry, something went wrong.', { haptic: true })
    return false
  }
}

// ============================================================================
// VOICE COMMAND LISTENER (Mock - Real implementation needs native module)
// ============================================================================

/**
 * NOTE: React Native doesn't have built-in speech recognition.
 * In production, you'd use:
 * - @react-native-voice/voice (requires native setup)
 * - Expo Speech Recognition (if available)
 * - Cloud API (Google Speech-to-Text, AWS Transcribe)
 * 
 * For now, this provides the command processing infrastructure.
 */

export interface VoiceListenerConfig {
  autoStart?: boolean
  continuous?: boolean
  onResult?: (result: VoiceCommandResult) => void
  onError?: (error: string) => void
}

/**
 * Mock voice listener (in production, integrate @react-native-voice/voice)
 */
export class VoiceCommandListener {
  private isListening = false
  private config: VoiceListenerConfig

  constructor(config: VoiceListenerConfig = {}) {
    this.config = config
  }

  start() {
    if (this.isListening) return

    this.isListening = true
    console.log('🎤 Voice listener started (mock)')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})

    // In production: Initialize @react-native-voice/voice here
    // Voice.start('en-US')
  }

  stop() {
    if (!this.isListening) return

    this.isListening = false
    console.log('🎤 Voice listener stopped')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

    // In production: Stop voice recognition
    // Voice.stop()
  }

  isActive(): boolean {
    return this.isListening
  }

  // Mock method for testing voice commands
  simulateCommand(spokenText: string) {
    if (!this.isListening) {
      console.warn('Voice listener not active')
      return
    }

    const result = parseVoiceCommand(spokenText)
    console.log('🎤 Simulated command:', result)

    if (this.config.onResult) {
      this.config.onResult(result)
    }
  }
}

// ============================================================================
// HELPER: Voice Command Button Component Data
// ============================================================================

export interface VoiceCommandButton {
  label: string
  icon: string
  command: string
  description: string
}

export const QUICK_VOICE_COMMANDS: VoiceCommandButton[] = [
  {
    label: 'Show Yields',
    icon: '💰',
    command: 'show my yields',
    description: 'View your earnings',
  },
  {
    label: 'Swap',
    icon: '🔄',
    command: 'navigate to swap',
    description: 'Open swap screen',
  },
  {
    label: 'Check APY',
    icon: '📊',
    command: 'what is the apy',
    description: 'Get current rates',
  },
  {
    label: 'Refresh',
    icon: '🔄',
    command: 'refresh data',
    description: 'Update balances',
  },
]

