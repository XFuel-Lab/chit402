/**
 * WalletConnect Session Management Utilities
 * Handles clearing storage and resetting sessions when connection issues occur
 */

/**
 * Clear all WalletConnect storage (helps when Connect button is disabled)
 */
export function clearWalletConnectStorage(): void {
  try {
    console.log('🧹 Clearing WalletConnect storage...')
    
    // Clear all WalletConnect-related localStorage keys
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (
        key.startsWith('wc@2:') ||
        key.startsWith('walletconnect') ||
        key.startsWith('WALLETCONNECT_')
      )) {
        keysToRemove.push(key)
      }
    }
    
    keysToRemove.forEach(key => {
      console.log(`  Removing: ${key}`)
      localStorage.removeItem(key)
    })
    
    console.log(`✅ Cleared ${keysToRemove.length} WalletConnect storage keys`)
  } catch (error) {
    console.error('❌ Error clearing WalletConnect storage:', error)
  }
}

/**
 * Check if there are stale WalletConnect sessions
 */
export function hasStaleWalletConnectSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('wc@2:')) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Get diagnostic info about current WalletConnect state
 */
export function getWalletConnectDiagnostics(): {
  hasStoredSessions: boolean
  sessionCount: number
  storageKeys: string[]
} {
  const storageKeys: string[] = []
  let sessionCount = 0
  
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith('wc@2:') || key.startsWith('walletconnect'))) {
        storageKeys.push(key)
        if (key.includes('session')) {
          sessionCount++
        }
      }
    }
  } catch {
    // Ignore errors
  }
  
  return {
    hasStoredSessions: storageKeys.length > 0,
    sessionCount,
    storageKeys,
  }
}

