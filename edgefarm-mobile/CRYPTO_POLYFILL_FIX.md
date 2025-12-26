# Crypto Polyfill Fix - React Native Module Resolution

## Problem
The app was failing with errors:
1. `Unable to resolve module events` - Node.js core modules not available in React Native
2. `property seed` runtime error - crypto polyfills not properly initialized

## Root Causes
1. Missing Node.js core module polyfills (`events`, `buffer`, `process`)
2. Wrong version of `react-native-get-random-values` (2.0.0 instead of 1.11.0)
3. Incorrect polyfill initialization order

## Solutions Applied

### 1. Added Missing Polyfills to Metro Config
**File**: `metro.config.js`

Added polyfills for all required Node.js core modules:
- `events` - EventEmitter for streams
- `buffer` - Buffer implementation
- `process` - Process polyfill for browser
- `crypto` - Crypto operations
- `stream` - Stream implementation

### 2. Downgraded react-native-get-random-values
**File**: `package.json`

Changed from `^2.0.0` to `~1.11.0` for Expo 54 compatibility.

### 3. Fixed Polyfill Initialization Order
**File**: `crypto-polyfill.ts`

Proper order:
1. `react-native-get-random-values` (FIRST - provides secure random)
2. `Buffer` polyfill
3. `process` polyfill with `browser: true` flag
4. `crypto-browserify`
5. `EventEmitter` for streams

### 4. Installed Missing Package
```bash
npm install events@^3.3.0
```

## How to Start the App

```bash
cd edgefarm-mobile
npm install
npx expo start --offline --clear
```

Use `--offline` flag to skip Expo's version validation if you have network issues.

## Files Modified
1. `metro.config.js` - Added Node.js core module polyfills
2. `package.json` - Added `events` package, downgraded `react-native-get-random-values`
3. `crypto-polyfill.ts` - Fixed initialization order and added EventEmitter
4. Entry point (`index.ts`) - Already correctly imports polyfills first

## Testing
The app should now:
- ✅ Resolve `events` module from `readable-stream`
- ✅ Initialize crypto properly without "seed" errors
- ✅ Bundle successfully in Metro
- ✅ Run on physical devices and emulators

## Notes
- Always import `crypto-polyfill.ts` FIRST in entry point
- Metro bundler caches aggressively - use `--clear` when changing polyfills
- Kill all node processes if you get port conflicts: `taskkill /F /IM node.exe`

