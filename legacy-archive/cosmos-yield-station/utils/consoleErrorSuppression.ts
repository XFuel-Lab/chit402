/**
 * Suppresses console errors from cross-origin windows/iframes
 * This is useful when opening external wallet websites that may have CORS issues
 * or other errors that we cannot control.
 */

/**
 * Suppress console errors from cross-origin sources
 * This prevents CORS errors and other issues from external windows from cluttering the console
 */
export function suppressCrossOriginErrors() {
  if (typeof window === 'undefined') return

  const originalError = console.error
  const originalWarn = console.warn
  const originalLog = console.log

  // Helper to extract all text from console arguments including stack traces
  const extractMessage = (args: any[]): string => {
    let fullMessage = args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        if (arg instanceof Error) return arg.message + ' ' + (arg.stack || '')
        if (arg?.toString) return arg.toString()
        if (arg?.message) return arg.message
        return JSON.stringify(arg)
      })
      .join(' ')
      .toLowerCase()

    // Also check stack traces in Error objects
    args.forEach((arg) => {
      if (arg instanceof Error && arg.stack) {
        fullMessage += ' ' + arg.stack.toLowerCase()
      }
      // Check for stack property in any object
      if (arg && typeof arg === 'object' && 'stack' in arg) {
        fullMessage += ' ' + String(arg.stack).toLowerCase()
      }
    })

    // Get current stack trace (for console.warn/error calls)
    try {
      const stack = new Error().stack
      if (stack) {
        fullMessage += ' ' + stack.toLowerCase()
      }
    } catch (e) {
      // Ignore
    }

    return fullMessage
  }

  // Suppress MetaMask deprecation warnings (these come from MetaMask's injected script)
  const suppressMetaMaskDeprecation = (args: any[]): boolean => {
    const message = extractMessage(args)
    if (
      message.includes('window.web3.currentprovider') ||
      message.includes('metamask window.web3') ||
      message.includes('you are accessing the metamask') ||
      message.includes('deprecated') ||
      message.includes('use window.ethereum instead') ||
      message.includes('inpage.js') ||
      message.includes('provider-migration')
    ) {
      // Suppress MetaMask deprecation warnings - we already use window.ethereum
      return true
    }
    return false
  }

  // Suppress CORS errors and API errors from Theta Wallet website
  const suppressCorsErrors = (args: any[]): boolean => {
    const message = extractMessage(args)
    if (
      message.includes('cors policy') ||
      message.includes('access-control-allow-origin') ||
      message.includes('api.thetatoken.org') ||
      message.includes('guardian/delegated-nodes') ||
      message.includes('wallet.thetatoken.org') ||
      message.includes('blocked by cors') ||
      message.includes('please update your theta client') ||
      message.includes('{"error":') && message.includes('theta')
    ) {
      // Suppress CORS errors and API errors from Theta Wallet - these are expected when opening their website
      return true
    }
    return false
  }

  // Suppress network errors from external windows
  const suppressNetworkErrors = (args: any[]): boolean => {
    const message = extractMessage(args)
    if (
      message.includes('failed to load resource') ||
      message.includes('net::err_failed') ||
      message.includes('err_blocked_by_client') ||
      message.includes('connect:1') // Theta Wallet connect page errors
    ) {
      // Only suppress if it's from a Theta domain
      if (
        message.includes('thetatoken.org') ||
        message.includes('theta') ||
        args.some((arg) => {
          const str = String(arg)
          return str.includes('thetatoken.org') || str.includes('theta')
        })
      ) {
        return true
      }
    }
    return false
  }

  // Suppress expected retry warnings from rate limiter (these are normal behavior)
  const suppressRetryWarnings = (args: any[]): boolean => {
    const message = extractMessage(args)
    // Check for retry warnings from rate limiter (with or without emoji)
    const isRetryWarning = 
      (message.includes('network error') && message.includes('attempt') && message.includes('retrying')) ||
      (message.includes('rate limit') && message.includes('attempt') && message.includes('retrying')) ||
      (message.includes('retrying in') && message.includes('attempt'))
    
    if (isRetryWarning) {
      // These are expected retry warnings from rateLimiter - they're informational, not errors
      // Only suppress if it's a retry message (not the final failure)
      if (message.includes('attempt') && !message.includes('exceeded after')) {
        return true
      }
    }
    return false
  }

  // Override console methods
  console.error = (...args: any[]) => {
    if (
      suppressMetaMaskDeprecation(args) ||
      suppressCorsErrors(args) ||
      suppressNetworkErrors(args) ||
      suppressRetryWarnings(args)
    ) {
      return
    }
    originalError.apply(console, args)
  }

  console.warn = (...args: any[]) => {
    if (
      suppressMetaMaskDeprecation(args) ||
      suppressCorsErrors(args) ||
      suppressNetworkErrors(args) ||
      suppressRetryWarnings(args)
    ) {
      return
    }
    originalWarn.apply(console, args)
  }

  // Also suppress in console.log (some browsers log errors there)
  console.log = (...args: any[]) => {
    if (
      suppressMetaMaskDeprecation(args) ||
      suppressCorsErrors(args) ||
      suppressNetworkErrors(args) ||
      suppressRetryWarnings(args)
    ) {
      return
    }
    originalLog.apply(console, args)
  }

  // Also handle unhandled errors from cross-origin windows
  window.addEventListener('error', (event) => {
    const message = (event.message || '').toLowerCase()
    const source = (event.filename || '').toLowerCase()
    if (
      message.includes('cors policy') ||
      message.includes('access-control-allow-origin') ||
      message.includes('api.thetatoken.org') ||
      message.includes('window.web3.currentprovider') ||
      message.includes('metamask window.web3') ||
      message.includes('you are accessing the metamask') ||
      message.includes('please update your theta client') ||
      source.includes('inpage.js') ||
      source.includes('thetatoken.org')
    ) {
      event.preventDefault()
      event.stopPropagation()
      return false
    }
  }, true)

  // Handle unhandled promise rejections from cross-origin sources
  window.addEventListener('unhandledrejection', (event) => {
    const reason = (event.reason?.toString() || '').toLowerCase()
    if (
      reason.includes('cors policy') ||
      reason.includes('access-control-allow-origin') ||
      reason.includes('api.thetatoken.org') ||
      reason.includes('guardian/delegated-nodes')
    ) {
      event.preventDefault()
      return false
    }
  })

  // Suppress errors from opened windows (like Theta Wallet)
  // Note: We can't directly suppress errors in cross-origin windows due to CORS,
  // but we've already set up suppression in the main window which should catch
  // any errors that bubble up or are logged to the main console
}

/**
 * Restore original console methods (useful for debugging)
 */
export function restoreConsoleErrors() {
  // This would require storing the original methods, which we don't do
  // For now, just reload the page to restore
  console.warn('To restore console errors, reload the page')
}

