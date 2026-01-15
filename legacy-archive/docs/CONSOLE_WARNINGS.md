# Console Warnings and Errors

This document explains common console warnings and errors you may see when using XFUEL Protocol, and why they are safe to ignore.

## MetaMask Deprecation Warning

**Warning:**
```
You are accessing the MetaMask window.web3.currentProvider shim. 
This property is deprecated; use window.ethereum instead.
```

**Explanation:**
- This warning comes from MetaMask's own injected script (`inpage.js`), not from XFUEL Protocol code
- MetaMask injects a deprecated `window.web3` shim for backwards compatibility with older dApps
- **XFUEL Protocol correctly uses `window.ethereum`** - the modern EIP-1193 standard
- This warning is automatically suppressed by our error suppression utility
- **Action Required:** None - this is expected behavior and does not affect functionality

## Theta Wallet CORS Error

**Error:**
```
Access to fetch at 'https://api.thetatoken.org/v1/guardian/delegated-nodes' 
from origin 'https://wallet.thetatoken.org' has been blocked by CORS policy
```

**Explanation:**
- This error occurs when opening Theta Wallet website (`wallet.thetatoken.org`) in a new window
- The Theta Wallet website tries to fetch data from `api.thetatoken.org`, but that API doesn't allow CORS from the wallet domain
- This is a **Theta-side configuration issue**, not an XFUEL Protocol issue
- The error does not affect XFUEL Protocol functionality - it only affects Theta Wallet's internal operations
- This error is automatically suppressed by our error suppression utility
- **Action Required:** None - this is expected when opening Theta Wallet website and does not affect XFUEL Protocol

## Theta API "Please update your Theta client" Error

**Error:**
```
https://api.thetatoken.org/v1/guardian/delegated-nodes 
{"error": "Please update your Theta client."}
```

**Explanation:**
- This error comes from the Theta Wallet website (`wallet.thetatoken.org`), not from XFUEL Protocol
- The Theta Wallet website tries to fetch guardian node information from `api.thetatoken.org/v1/guardian/delegated-nodes`
- The API is rejecting the request because it requires a newer client version or specific headers
- **XFUEL Protocol does NOT call this API endpoint** - we only use the RPC endpoint (`eth-rpc-api.thetatoken.org/rpc`)
- This is a **Theta Wallet website issue**, not an XFUEL Protocol issue
- The error does not affect XFUEL Protocol functionality at all
- This error is automatically suppressed by our error suppression utility
- **Action Required:** None - this is a Theta Wallet website problem that Theta needs to fix on their end

**Why This Happens:**
The Theta Wallet website is trying to fetch guardian/delegator node information, but the API endpoint has been updated and now requires:
- A newer client version
- Specific user-agent headers
- Or the endpoint may have been deprecated/changed

This is completely outside of XFUEL Protocol's control and does not impact our application.

## Error Suppression

XFUEL Protocol includes automatic error suppression that runs in two stages:

1. **Early suppression** (in `index.html`): An inline script that runs immediately, before MetaMask injects its scripts
2. **Comprehensive suppression** (in `src/utils/consoleErrorSuppression.ts`): A module-level utility that provides more detailed filtering

The suppression system:

1. Suppresses MetaMask deprecation warnings (we already use `window.ethereum`)
2. Suppresses CORS errors from Theta Wallet website
3. Suppresses network errors from external Theta domains
4. Handles unhandled errors and promise rejections

This keeps the console clean while still showing legitimate errors from XFUEL Protocol code.

**Note:** If you open Theta Wallet website in a new window (`window.open`), that window has its own console. Errors in that window's console cannot be suppressed due to browser security (CORS). However, any errors that bubble up to the main window's console will be suppressed.

## Verifying Your Code is Correct

To verify that XFUEL Protocol is using the correct APIs:

1. **MetaMask:** Search for `window.ethereum` in the codebase - all wallet connections use this
2. **No deprecated APIs:** Search for `window.web3` - should only appear in this documentation or error suppression code
3. **Error suppression:** Check `src/main.tsx` - error suppression is initialized on app startup

## Disabling Error Suppression (Debugging)

If you need to see all console errors for debugging:

1. Comment out the `suppressCrossOriginErrors()` call in `src/main.tsx`
2. Reload the page
3. You will see all warnings/errors, including the suppressed ones

