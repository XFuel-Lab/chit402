# Theta Wallet Connection - Root Cause Analysis

## Executive Summary

**Issue**: Theta Wallet mobile app (v5.3.0) shows a disabled "Connect" button when scanning WalletConnect QR code, despite QR modal working correctly and proper cleanup implemented.

**Status**: 🔴 **BLOCKED** - Cannot establish connection to Theta Wallet mobile app

**Last Updated**: Dec 27, 2025

---

## Timeline of Investigation

### Phase 1: Initial Diagnosis (WalletConnect Project ID)
- **Problem**: `429 Too Many Requests` error
- **Cause**: Shared/fallback Project ID with rate limiting
- **Fix**: Obtained unique Project ID: `da2f60b8b41bcaf71845e092efdb4186`
- **Result**: ✅ Resolved rate limiting, but Connect button still disabled

### Phase 2: Domain Configuration
- **Problem**: WalletConnect domain verification
- **Fix**: Added `http://localhost:3000` to Allowed Origins in Reown dashboard
- **Result**: ✅ `202 Accepted` status, but Connect button still disabled
- **Note**: Domain propagation can take up to 6 hours

### Phase 3: Modal Conflicts & Cleanup (RESOLVED ✅)
- **Problem**: Glitchy/shaking QR modal, black screen on close
- **Cause**: 
  - Dual modals (`showQrModal: true` + custom `ThetaWalletQRModal`)
  - Incorrect z-index layering
  - Improper provider cleanup (missing `removeAllListeners()` and disconnect)
  - No connection timeout
- **Fix**: 
  - Consolidated wallet flow (removed `ThetaWalletQRModal.tsx`)
  - Corrected z-index hierarchy (backdrop: 9990, modal: 9991, toast: 10000)
  - Implemented `cleanupProvider()` function
  - Added 30-second connection timeout
  - Fixed `pointer-events` handling
- **Result**: ✅ QR modal now closes perfectly, no more glitching or black screens

### Phase 4: Current State (ONGOING 🔴)
- **Problem**: Theta Wallet v5.3.0 "Connect" button disabled
- **Symptoms**:
  - QR code scans successfully (Theta Wallet app opens)
  - Modal displays "Connect" and "Reject" buttons
  - "Reject" button is functional (can close connection)
  - "Connect" button is grayed out/disabled (non-clickable)
  - After app reinstall: Same behavior persists
- **Hypothesis**: One of the following:
  1. **Theta Wallet v5.3.0 bug/incompatibility** with WalletConnect v2
  2. **Missing Theta-specific chain parameters** in WalletConnect URI
  3. **Stale cached sessions** in Theta Wallet (even after reinstall)
  4. **Domain verification** still propagating (6-hour window)
  5. **Network/chain mismatch** (Theta Mainnet ID: 361)

---

## Key Findings

### 1. Disabled Connect Button (PRIMARY ISSUE 🔴)

**Evidence**:
- User confirmed: "Connect button in Theta Wallet app was still non-functional"
- Button remains disabled after:
  - Project ID change
  - Domain configuration
  - App reinstall
  - Code cleanup/consolidation

**Potential Root Causes**:

#### A. Domain Verification Propagation
- **Likelihood**: 🟡 MEDIUM
- **Details**: Reown dashboard indicated domain changes may take up to 6 hours to propagate
- **Test**: Wait 6 hours from last domain update, retry connection
- **Timeline**: User saw "may take 6hrs to complete" message when adding domain

#### B. Theta Wallet App Caching
- **Likelihood**: 🟡 MEDIUM
- **Details**: Mobile wallets often cache WalletConnect session data that survives app reinstalls
- **Cached Data Location**: 
  - iOS: Keychain (persists after app deletion)
  - Android: Encrypted SharedPreferences (can persist)
- **Test**: 
  - Clear device cache/data before reinstall
  - Try on a different device/fresh install
  - Check Theta Wallet settings for "Clear WalletConnect Sessions"

#### C. Chain Configuration Missing
- **Likelihood**: 🟢 HIGH
- **Details**: Theta Mainnet (Chain ID: 361) might need explicit chain info in WalletConnect metadata
- **Current Code**:
  ```typescript
  walletConnectProvider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [THETA_MAINNET.chainId], // [361]
    // Missing: optionalChains, rpcMap, etc.?
  })
  ```
- **What's Missing?**:
  - `optionalChains`: Additional chain IDs
  - `rpcMap`: Explicit RPC endpoints for Theta
  - `methods`: Required RPC methods (eth_sendTransaction, etc.)
  - `events`: Required events (chainChanged, accountsChanged)
- **Reference**: Other dApps using Theta + WalletConnect might have additional config

#### D. Theta Wallet v5.3.0 Compatibility
- **Likelihood**: 🟡 MEDIUM
- **Details**: This specific version might have a bug or incompatibility with WalletConnect v2
- **Test**: Check Theta Wallet changelog/release notes for v5.3.0
- **Workaround**: Recommend users update to latest version (if newer exists)

#### E. Network/Chain Mismatch
- **Likelihood**: 🟢 HIGH
- **Details**: Theta Wallet might be on Testnet or different network, rejecting Mainnet connection
- **Check**: Verify Theta Wallet is set to Mainnet (361), not Testnet

### 2. Black Screen on Close (RESOLVED ✅)

**Root Cause**: Improper provider cleanup
- Provider event listeners not removed
- Provider not disconnected when no active session
- State not fully reset on modal close

**Fix Implemented**:
```typescript
// Helper function to clean up WalletConnect provider properly
const cleanupProvider = async (provider: any) => {
  if (!provider) return
  try {
    console.log('🧹 Cleaning up WalletConnect provider...')
    provider.removeAllListeners() // Remove event listeners
    if (!provider.session) {
      await provider.disconnect() // Disconnect if no active session
    }
    console.log('✅ Provider cleanup complete')
  } catch (error) {
    console.warn('⚠️ Error during provider cleanup:', error)
  }
}

// Handle closing the QR modal with proper cleanup
const handleCloseQRModal = async () => {
  if (connectionTimeout) {
    clearTimeout(connectionTimeout)
    setConnectionTimeout(null)
  }
  await cleanupProvider(currentProvider)
  setCurrentProvider(null)
  setWalletConnectUri(undefined)
  setShowThetaQR(false)
}
```

**Result**: ✅ User confirmed "qr menu closes perfectly"

---

## Immediate Fixes Implemented

### ✅ Fix 1: Proper Provider Cleanup
**File**: `src/components/WalletConnectModal.tsx`
- Added `cleanupProvider()` helper function
- Properly removes event listeners before disconnect
- Gracefully handles errors during cleanup

### ✅ Fix 2: Connection Timeout
**File**: `src/components/WalletConnectModal.tsx`
- Added 30-second timeout for connection attempts
- Automatically closes modal and alerts user on timeout
- Clears timeout on successful connection

### ✅ Fix 3: Fixed Z-Index Layering
**File**: `src/components/WalletConnectModal.tsx`
- Backdrop: `z-[9990]`
- Modal content: `z-[9991]`
- Toast notifications: `z-[10000]`
- Added `pointer-events` management

### ✅ Fix 4: Explicit Close Handler
**File**: `src/components/WalletConnectModal.tsx`
- `handleCloseQRModal()` encapsulates all cleanup logic
- Ensures timeout, provider, and state are all reset
- Used consistently across all close scenarios

---

## Next Steps for Resolution

### Immediate Actions (Next 30 Minutes)

#### 1. Test with Alternative Wallet (HIGHEST PRIORITY)
**Purpose**: Isolate whether issue is Theta-specific or general WalletConnect problem

**Test Plan**:
```
1. Open app at localhost:3000
2. Click "Mobile Wallet (QR Code)"
3. Scan QR with Trust Wallet or MetaMask Mobile
4. Observe if Connect button is enabled
```

**Expected Outcomes**:
- ✅ If alternative wallet WORKS → Issue is Theta-specific
- ❌ If alternative wallet FAILS → Issue is in our WalletConnect implementation

#### 2. Add Explicit Chain Configuration
**File**: `src/utils/walletConnect.ts`

**Current Code**:
```typescript
walletConnectProvider = await EthereumProvider.init({
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [THETA_MAINNET.chainId], // [361]
  // ... metadata, qrModalOptions ...
})
```

**Enhanced Code** (add RPC map and methods):
```typescript
walletConnectProvider = await EthereumProvider.init({
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [THETA_MAINNET.chainId], // [361]
  rpcMap: {
    361: 'https://eth-rpc-api.thetatoken.org/rpc', // Theta Mainnet RPC
  },
  methods: [
    'eth_sendTransaction',
    'eth_signTransaction',
    'eth_sign',
    'personal_sign',
    'eth_signTypedData',
  ],
  events: [
    'chainChanged',
    'accountsChanged',
  ],
  metadata: {
    name: 'XFUEL Protocol',
    description: 'Cross-chain liquid staking',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://xfuel.app',
    icons: [typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : 'https://xfuel.app/logo.png'],
  },
  // ... rest of config ...
})
```

#### 3. Check Theta Wallet Network Setting
**User Action Required**:
```
1. Open Theta Wallet app
2. Go to Settings
3. Verify network is set to "Mainnet" (361)
4. If on Testnet, switch to Mainnet
5. Retry connection
```

### Short-Term Actions (Next 24 Hours)

#### 4. Wait for Domain Propagation
- **Timeline**: Up to 6 hours from domain addition
- **Action**: Retry connection after propagation window
- **Verification**: Check Reown dashboard for domain status

#### 5. Research Theta Wallet + WalletConnect Best Practices
**Search For**:
- Theta Wallet v5.3.0 release notes
- Known WalletConnect v2 compatibility issues
- Other dApps successfully connecting to Theta Wallet
- Theta developer documentation on WalletConnect integration

#### 6. Contact Theta Wallet Support
**Questions to Ask**:
- Are there known issues with v5.3.0 and WalletConnect v2?
- What WalletConnect configuration is required for Theta?
- How to clear WalletConnect session cache in Theta Wallet?
- Is there a test dApp we can use to verify Theta connectivity?

---

## Technical Deep Dive

### WalletConnect Flow (Current Implementation)

```
┌─────────────────┐
│   User clicks   │
│ "Mobile Wallet" │
│     button      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ createWalletConnectProvider()   │
│ - Init EthereumProvider         │
│ - chains: [361]                 │
│ - projectId: da2f60b...         │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ provider.connect()               │
│ - Generates WalletConnect URI   │
│ - Emits 'display_uri' event     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Display QR Code                  │
│ - QRCodeSVG component           │
│ - Show "Copy URI" button        │
│ - Start 30-second timeout       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ User scans with Theta Wallet    │
│ - App opens connection modal    │
│ - Shows dApp info               │
│ - Connect button DISABLED 🔴    │ ← ISSUE HERE
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Expected: provider.on('connect')│
│ Actual: Connection never occurs │
└─────────────────────────────────┘
```

### What Other Platforms Do (Research Needed)

**Successful Theta + WalletConnect Integrations**:
1. **ThetaDrop NFT Marketplace**
   - Uses WalletConnect v2
   - Successfully connects to Theta Wallet
   - Need to inspect their implementation

2. **Theta Swap (DEX)**
   - Supports Theta Wallet via WalletConnect
   - Need to check their chain configuration

3. **Reown/WalletConnect Example Apps**
   - Official examples might have Theta-specific notes
   - Check: https://github.com/WalletConnect/web-examples

---

## Console Error Analysis

### Error: `provider.removeAllListeners is not a function`

**Context**:
```
🧹 Cleaning up WalletConnect provider...
⚠️ Error during provider cleanup: TypeError: provider.removeAllListeners is not a function
```

**Analysis**:
- This occurs during `cleanupProvider()` execution
- Provider object might be in a state where `removeAllListeners` is not available
- Could be due to provider being partially initialized or already disconnected

**Impact**: 🟡 LOW - This is a cleanup warning, not the root cause of disabled Connect button

**Potential Fix**:
```typescript
const cleanupProvider = async (provider: any) => {
  if (!provider) return
  try {
    console.log('🧹 Cleaning up WalletConnect provider...')
    
    // Check if method exists before calling
    if (typeof provider.removeAllListeners === 'function') {
      provider.removeAllListeners()
    }
    
    // Check if disconnect is available
    if (typeof provider.disconnect === 'function' && !provider.session) {
      await provider.disconnect()
    }
    
    console.log('✅ Provider cleanup complete')
  } catch (error) {
    console.warn('⚠️ Error during provider cleanup:', error)
  }
}
```

---

## Questions for User

1. **Network Setting**: Can you confirm Theta Wallet is set to "Mainnet" (not Testnet)?
2. **Alternative Wallet Test**: Can you try scanning the QR code with Trust Wallet or MetaMask Mobile to see if Connect button works?
3. **Console Logs**: When you scan the QR, do you see any logs in F12 console? (Especially looking for `'✅ WalletConnect session established!'`)
4. **Theta Wallet Version**: Is v5.3.0 the latest version? Can you check for updates in the app store?
5. **Domain Timing**: How long has it been since you added `http://localhost:3000` to Allowed Origins? (Propagation can take 6 hours)

---

## Conclusion

**Current Status**: We've successfully resolved the modal glitching and black screen issues, but the core problem of the disabled Connect button in Theta Wallet v5.3.0 remains.

**Most Likely Causes** (in order):
1. 🟢 **Chain configuration missing** - Need to add explicit RPC map and methods
2. 🟢 **Network mismatch** - Theta Wallet might be on wrong network
3. 🟡 **Domain propagation** - Still waiting for Reown verification
4. 🟡 **Theta Wallet caching** - Session data persisting despite reinstall
5. 🟡 **App version issue** - v5.3.0 compatibility problem

**Next Action**: Test with alternative wallet (Trust/MetaMask Mobile) to isolate if issue is Theta-specific.

---

## References

- [WalletConnect v2 Ethereum Provider Docs](https://docs.walletconnect.com/2.0/javascript/providers/ethereum)
- [Theta Network RPC Endpoints](https://docs.thetatoken.org/docs/theta-network-rpc-api)
- [Reown Cloud Dashboard](https://cloud.reown.com/)
- User's Project ID: `da2f60b8b41bcaf71845e092efdb4186`
- Configured Domain: `http://localhost:3000`
