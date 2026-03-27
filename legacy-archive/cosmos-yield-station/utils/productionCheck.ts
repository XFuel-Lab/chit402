/**
 * Production Launch Mode Check
 * Verifies the app is ready for production deployment
 */

export interface ProductionCheckResult {
  ready: boolean
  checks: {
    name: string
    passed: boolean
    message: string
  }[]
  errors: string[]
  warnings: string[]
}

export function runProductionCheck(): ProductionCheckResult {
  const checks: ProductionCheckResult['checks'] = []
  const errors: string[] = []
  const warnings: string[] = []

  // Check 1: Environment Variables
  const hasRouterAddress = !!import.meta.env.VITE_ROUTER_ADDRESS
  checks.push({
    name: 'Router Address',
    passed: hasRouterAddress,
    message: hasRouterAddress
      ? '✓ Router address configured'
      : '✗ Missing VITE_ROUTER_ADDRESS',
  })
  if (!hasRouterAddress) {
    errors.push('VITE_ROUTER_ADDRESS not set')
  }

  // Check 2: Network Configuration
  const isMainnet = import.meta.env.VITE_NETWORK === 'mainnet'
  checks.push({
    name: 'Network Mode',
    passed: isMainnet,
    message: isMainnet
      ? '✓ Mainnet mode active'
      : '⚠ Not in mainnet mode',
  })
  if (!isMainnet) {
    warnings.push('VITE_NETWORK should be "mainnet" for production')
  }

  // Check 3: Console Errors (runtime check)
  const hasConsoleErrors = typeof window !== 'undefined' && 
    window.console.error.toString().includes('originalError')
  checks.push({
    name: 'Console Error Suppression',
    passed: hasConsoleErrors,
    message: hasConsoleErrors
      ? '✓ Console error suppression active'
      : '⚠ Console errors not suppressed',
  })

  // Check 4: Build Mode
  const isProduction = import.meta.env.PROD
  checks.push({
    name: 'Build Mode',
    passed: isProduction,
    message: isProduction
      ? '✓ Production build'
      : '⚠ Development mode',
  })
  if (!isProduction) {
    warnings.push('Running in development mode - build for production before deploying')
  }

  // Check 5: API Configuration
  const hasApiUrl = !!import.meta.env.VITE_API_URL
  checks.push({
    name: 'API Configuration',
    passed: true, // API is optional
    message: hasApiUrl
      ? '✓ API URL configured'
      : 'ℹ API URL not set (optional)',
  })

  // Check 6: WalletConnect Project ID
  const hasWalletConnectId = !!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
  checks.push({
    name: 'WalletConnect Project ID',
    passed: hasWalletConnectId,
    message: hasWalletConnectId
      ? '✓ WalletConnect configured'
      : '✗ Missing VITE_WALLETCONNECT_PROJECT_ID',
  })
  if (!hasWalletConnectId) {
    errors.push('VITE_WALLETCONNECT_PROJECT_ID not set')
  }

  // Determine overall readiness
  const ready = errors.length === 0

  return {
    ready,
    checks,
    errors,
    warnings,
  }
}

/**
 * Log production check results to console
 */
export function logProductionCheck(): void {
  const result = runProductionCheck()

  console.log('\n🚀 XFUEL Production Launch Check\n')
  console.log('━'.repeat(50))

  result.checks.forEach((check) => {
    const icon = check.passed ? '✓' : '✗'
    const color = check.passed ? '\x1b[32m' : '\x1b[31m'
    const reset = '\x1b[0m'
    console.log(`${color}${icon}${reset} ${check.name}: ${check.message}`)
  })

  console.log('━'.repeat(50))

  if (result.errors.length > 0) {
    console.log('\n❌ ERRORS (must fix):')
    result.errors.forEach((err) => console.log(`  - ${err}`))
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS (recommended):')
    result.warnings.forEach((warn) => console.log(`  - ${warn}`))
  }

  if (result.ready) {
    console.log('\n✅ Production Ready! Safe to deploy.\n')
  } else {
    console.log('\n❌ NOT READY - Fix errors before deploying.\n')
  }
}

/**
 * Display production check in UI (for development)
 */
export function getProductionStatusBadge(): {
  ready: boolean
  label: string
  color: string
} {
  const result = runProductionCheck()

  if (result.ready) {
    return {
      ready: true,
      label: '🚀 Production Ready',
      color: 'emerald',
    }
  } else if (result.errors.length > 0) {
    return {
      ready: false,
      label: '❌ Not Ready',
      color: 'red',
    }
  } else {
    return {
      ready: true,
      label: '⚠️ Ready (with warnings)',
      color: 'amber',
    }
  }
}

