# XFuel Mainnet Beta - Implementation Diffs

Complete diffs for all modified and new files in the mainnet beta testing implementation.

---

## Smart Contracts

### contracts/RevenueSplitter.sol

**Changes:**
- Added `maxSwapAmount` (1,000 TFUEL limit)
- Added `totalUserLimit` (5,000 TFUEL limit)
- Added `userTotalSwapped` mapping
- Added `paused` boolean
- Added swap validation in `splitRevenue()` and `splitRevenueNative()`
- Added admin functions: `updateSwapLimits()`, `setPaused()`, `resetUserSwapTotal()`
- Added events: `SwapLimitUpdated`, `PauseToggled`, `UserSwapRecorded`

**Key Additions:**

```solidity
// State variables
uint256 public maxSwapAmount;            // Max per swap (default: 1,000 TFUEL)
uint256 public totalUserLimit;           // Max total per user (default: 5,000 TFUEL)
mapping(address => uint256) public userTotalSwapped;
bool public paused;                      // Emergency pause switch

// Events
event SwapLimitUpdated(uint256 maxSwapAmount, uint256 totalUserLimit);
event PauseToggled(bool paused);
event UserSwapRecorded(address indexed user, uint256 amount, uint256 totalSwapped);

// Initialize with limits
function initialize(...) public initializer {
    // ... existing code ...
    maxSwapAmount = 1000 * 1e18;      // 1,000 TFUEL per swap
    totalUserLimit = 5000 * 1e18;     // 5,000 TFUEL total per user
    paused = false;
}

// Validation in splitRevenue
function splitRevenue(uint256 amount) external nonReentrant {
    require(!paused, "RevenueSplitter: contract is paused");
    require(amount <= maxSwapAmount, "RevenueSplitter: amount exceeds max swap limit");
    require(userTotalSwapped[msg.sender] + amount <= totalUserLimit, "RevenueSplitter: user total limit exceeded");
    
    userTotalSwapped[msg.sender] += amount;
    emit UserSwapRecorded(msg.sender, amount, userTotalSwapped[msg.sender]);
    // ... rest of function ...
}

// Admin functions
function updateSwapLimits(uint256 _maxSwapAmount, uint256 _totalUserLimit) external onlyOwner {
    require(_maxSwapAmount > 0, "RevenueSplitter: max swap amount must be greater than 0");
    require(_totalUserLimit >= _maxSwapAmount, "RevenueSplitter: total limit must be >= max swap");
    maxSwapAmount = _maxSwapAmount;
    totalUserLimit = _totalUserLimit;
    emit SwapLimitUpdated(_maxSwapAmount, _totalUserLimit);
}

function setPaused(bool _paused) external onlyOwner {
    paused = _paused;
    emit PauseToggled(_paused);
}

function resetUserSwapTotal(address user) external onlyOwner {
    userTotalSwapped[user] = 0;
}
```

---

### contracts/BuybackBurner.sol

**Changes:**
- Added `maxSwapAmount` (1,000 TFUEL limit)
- Added `totalUserLimit` (5,000 TFUEL limit)
- Added `userTotalSwapped` mapping
- Added `paused` boolean
- Added swap validation in `receiveRevenue()`
- Added admin functions: `updateSwapLimits()`, `setPaused()`, `resetUserSwapTotal()`
- Added events: `SwapLimitUpdated`, `PauseToggled`, `UserSwapRecorded`

**Key Additions:**

```solidity
// Similar to RevenueSplitter, but tracks by tx.origin
function receiveRevenue(uint256 amount) external nonReentrant {
    require(!paused, "BuybackBurner: contract is paused");
    require(amount <= maxSwapAmount, "BuybackBurner: amount exceeds max swap limit");
    
    address user = tx.origin;
    require(userTotalSwapped[user] + amount <= totalUserLimit, "BuybackBurner: user total limit exceeded");
    
    userTotalSwapped[user] += amount;
    emit UserSwapRecorded(user, amount, userTotalSwapped[user]);
    // ... rest of function ...
}
```

---

## Web UI

### src/components/BetaBanner.tsx (NEW)

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'

interface BetaBannerProps {
  network: 'mainnet' | 'testnet'
}

export default function BetaBanner({ network }: BetaBannerProps) {
  const [isVisible, setIsVisible] = useState(true)

  if (network !== 'mainnet' || !isVisible) {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-red-600 via-red-500 to-orange-600 shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="flex items-center justify-center w-8 h-8 bg-white/20 rounded-full backdrop-blur-sm">
              <span className="text-white text-xl font-bold">⚠️</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold text-sm sm:text-base uppercase tracking-wide">
                  🚨 Live Mainnet Testing
                </span>
                <span className="hidden sm:inline text-white/90">•</span>
                <span className="text-white/90 text-xs sm:text-sm font-medium">
                  Swap at Your Own Risk
                </span>
              </div>
              <div className="text-white/80 text-xs mt-1">
                Max: 1,000 TFUEL per swap • 5,000 TFUEL total per user • Unaudited Beta
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsVisible(false)}
            className="flex items-center justify-center w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full transition-colors backdrop-blur-sm group"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  )
}
```

---

### src/utils/swapLimits.ts (NEW)

```typescript
export const SWAP_LIMITS = {
  MAX_SWAP_AMOUNT: 1000, // TFUEL
  TOTAL_USER_LIMIT: 5000, // TFUEL
}

const STORAGE_KEY = 'xfuel_user_swap_total'

export function getUserSwapTotal(userAddress: string): number {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return 0
    const swapData = JSON.parse(data) as Record<string, number>
    return swapData[userAddress.toLowerCase()] || 0
  } catch (error) {
    console.error('Error reading swap total:', error)
    return 0
  }
}

export function updateUserSwapTotal(userAddress: string, amount: number): void {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    const swapData = data ? (JSON.parse(data) as Record<string, number>) : {}
    const key = userAddress.toLowerCase()
    swapData[key] = (swapData[key] || 0) + amount
    localStorage.setItem(STORAGE_KEY, JSON.stringify(swapData))
  } catch (error) {
    console.error('Error updating swap total:', error)
  }
}

export function validateSwapLimits(
  userAddress: string,
  swapAmount: number
): { valid: boolean; error?: string; remaining?: number } {
  if (swapAmount > SWAP_LIMITS.MAX_SWAP_AMOUNT) {
    return {
      valid: false,
      error: `Swap amount exceeds maximum of ${SWAP_LIMITS.MAX_SWAP_AMOUNT} TFUEL per transaction`,
    }
  }

  const currentTotal = getUserSwapTotal(userAddress)
  const newTotal = currentTotal + swapAmount

  if (newTotal > SWAP_LIMITS.TOTAL_USER_LIMIT) {
    const remaining = SWAP_LIMITS.TOTAL_USER_LIMIT - currentTotal
    return {
      valid: false,
      error: `Total limit exceeded. You have ${remaining.toFixed(2)} TFUEL remaining (${SWAP_LIMITS.TOTAL_USER_LIMIT} TFUEL total limit)`,
      remaining,
    }
  }

  return {
    valid: true,
    remaining: SWAP_LIMITS.TOTAL_USER_LIMIT - newTotal,
  }
}

export function getRemainingSwapAllowance(userAddress: string): number {
  const currentTotal = getUserSwapTotal(userAddress)
  return Math.max(0, SWAP_LIMITS.TOTAL_USER_LIMIT - currentTotal)
}
```

---

### src/App.tsx

**Changes:**
1. Import BetaBanner and swapLimits
2. Add BetaBanner to render
3. Add limit validation before swap
4. Update swap total after success

```typescript
// Imports
import BetaBanner from './components/BetaBanner'
import { validateSwapLimits, updateUserSwapTotal, getRemainingSwapAllowance } from './utils/swapLimits'

// In render (before main content)
return (
  <ScreenBackground>
    <BetaBanner network={APP_CONFIG.NETWORK as 'mainnet' | 'testnet'} />
    {/* ... rest of app ... */}
  </ScreenBackground>
)

// In handleSwapFlow, before swap execution
if (APP_CONFIG.NETWORK === 'mainnet' && wallet.fullAddress) {
  const validation = validateSwapLimits(wallet.fullAddress, amount)
  if (!validation.valid) {
    setStatusMessage(`❌ ${validation.error}`)
    setSwapStatus('error')
    setTimeout(() => {
      setSwapStatus('idle')
      setStatusMessage('')
    }, 5000)
    return
  }
  const remaining = validation.remaining || 0
  console.log(`✅ [BETA] Swap limit check passed. Remaining: ${remaining.toFixed(2)} TFUEL`)
}

// After successful swap
if (APP_CONFIG.NETWORK === 'mainnet' && wallet.fullAddress) {
  updateUserSwapTotal(wallet.fullAddress, amount)
  const remaining = getRemainingSwapAllowance(wallet.fullAddress)
  console.log(`✅ [BETA] Swap total updated. Remaining: ${remaining.toFixed(2)} TFUEL`)
}
```

---

## Mobile UI

### edgefarm-mobile/src/components/BetaBanner.tsx (NEW)

```tsx
import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, Animated, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'

interface BetaBannerProps {
  network: 'mainnet' | 'testnet'
}

export default function BetaBanner({ network }: BetaBannerProps) {
  const [isVisible, setIsVisible] = useState(true)
  const fadeAnim = React.useRef(new Animated.Value(0)).current
  const pulseAnim = React.useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (network === 'mainnet') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
      
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start()

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start()
    }
  }, [network])

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setIsVisible(false))
  }

  if (network !== 'mainnet' || !isVisible) {
    return null
  }

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        paddingTop: Platform.OS === 'ios' ? 44 : 0,
        zIndex: 9999,
      }}
    >
      <LinearGradient
        colors={['#dc2626', '#ea580c', '#f97316']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 5,
        }}
      >
        {/* Banner content - warning icon, text, dismiss button */}
      </LinearGradient>
    </Animated.View>
  )
}
```

---

### edgefarm-mobile/src/lib/swapLimits.ts (NEW)

Similar to web version but using AsyncStorage instead of localStorage.

---

### edgefarm-mobile/App.tsx

**Changes:**
1. Import BetaBanner
2. Add network constant from env
3. Add BetaBanner to render

```tsx
import BetaBanner from './src/components/BetaBanner'

const NETWORK = (process.env.EXPO_PUBLIC_NETWORK || 'mainnet') as 'mainnet' | 'testnet'

return (
  <UiModeProvider>
    <NavigationContainer theme={theme}>
      <StatusBar style="light" />
      <BetaBanner network={NETWORK} />
      {/* ... rest of app ... */}
    </NavigationContainer>
  </UiModeProvider>
)
```

---

### edgefarm-mobile/eas.json

**Changes:**
- Added mainnet build profile

```json
{
  "build": {
    "mainnet": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_NETWORK": "mainnet"
      },
      "channel": "mainnet-beta"
    }
  }
}
```

---

## Deployment Scripts

### scripts/deploy-mainnet.sh (NEW)

Bash script with environment checks, user confirmation, and deployment execution.

---

### scripts/deploy-mainnet-beta.ts (NEW)

TypeScript deployment script that:
- Deploys all contracts with beta limits
- Configures contract references
- Saves addresses to JSON
- Outputs verification instructions

---

## Tests

### cypress/e2e/mainnet-beta.cy.ts (NEW)

E2E tests covering:
- Banner display/dismiss
- Per-swap limits (1,000 TFUEL)
- Total user limits (5,000 TFUEL)
- Emergency pause
- No unlimited approvals

---

## Documentation

### docs/MAINNET_BETA_TESTING.md (NEW)

540-line comprehensive guide covering:
- Risk warnings
- Architecture
- Deployment (all platforms)
- Testing
- Monitoring
- Emergency procedures
- Security
- Legal

---

### docs/MAINNET_BETA_IMPLEMENTATION_SUMMARY.md (NEW)

Complete implementation summary with:
- All changes documented
- File-by-file breakdown
- Deployment checklist
- Success criteria
- Support contacts

---

### docs/MAINNET_BETA_QUICK_START.md (NEW)

Quick start guide for:
- 1-hour deployment
- Step-by-step instructions
- Troubleshooting
- Emergency procedures

---

### README.md

**Changes:**
- Added mainnet beta section at top
- Added link to MAINNET_BETA_TESTING.md
- Updated documentation section

---

## Summary

**Total Files Changed:** 16  
**New Files:** 10  
**Modified Files:** 6  

**Lines of Code:**
- Smart contracts: ~150 LOC
- Web UI: ~300 LOC
- Mobile UI: ~250 LOC
- Scripts: ~200 LOC
- Tests: ~200 LOC
- Documentation: ~1,500 LOC

**Total:** ~2,600 LOC

---

Last Updated: December 26, 2025

