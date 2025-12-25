# XFUEL Mobile App

Mobile application for XFUEL Protocol built with Expo/React Native.

## Features

✅ **Theta Wallet Connection**
- QR code scanning for WalletConnect
- Deep link support (`xfuel://` scheme)
- Auto-connect on mobile devices
- Secure wallet integration with Theta mainnet

✅ **Swap & Stake**
- Real-time swap preview
- Multiple LST options (stkTIA, stkATOM, stkXPRT, stkOSMO, pSTAKE BTC)
- Live APY display
- Transaction history
- Gas-free swaps (paid by treasury)

✅ **Early Believers Modal**
- TFUEL/USDC contribution options
- Tier bonuses (+10% at $50k, +25% at $100k)
- Real-time rXF calculation
- Progress tracking
- Transaction handling

✅ **Profile & Balances**
- TFUEL balance display
- rXF token tracking
- Wallet address management
- Quick actions

✅ **Cyberpunk Neon Styling**
- Neon blue/purple/pink gradients
- Animated glows and effects
- Glass morphism UI
- Dark mode optimized

## Tech Stack

- **Framework**: Expo SDK 54
- **Language**: TypeScript
- **Navigation**: React Navigation 7
- **Styling**: NativeWind + Tailwind CSS
- **Animations**: React Native Reanimated
- **Blockchain**: Theta.js + WalletConnect
- **Fonts**: Inter + Orbitron

## Getting Started

### Prerequisites

- Node.js 24+ and npm 10+
- Expo CLI: `npm install -g expo-cli eas-cli`
- iOS Simulator (Mac) or Android Emulator

### Installation

```bash
cd edgefarm-mobile
npm install
```

### Development

```bash
# Start Expo dev server
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android

# Run on web (for testing)
npm run web
```

### Configuration

Edit `app.json` to update:
- Router contract address (`extra.routerAddress`)
- API endpoint (`extra.apiUrl`)
- Theta RPC URL (`extra.thetaMainnetRpc`)

## Project Structure

```
edgefarm-mobile/
├── App.tsx                   # Main app entry with navigation
├── app.json                  # Expo configuration
├── src/
│   ├── components/           # Reusable components
│   │   ├── ThetaWalletQRModal.tsx
│   │   ├── EarlyBelieversModal.tsx
│   │   ├── NeonButton.tsx
│   │   ├── NeonCard.tsx
│   │   └── ...
│   ├── screens/              # Main screens
│   │   ├── SwapScreen.tsx    # Swap & stake interface
│   │   ├── ProfileScreen.tsx # Wallet & balances
│   │   ├── HomeScreen.tsx
│   │   └── ...
│   ├── lib/                  # Utilities
│   │   ├── thetaWallet.ts    # Wallet connection logic
│   │   ├── appConfig.ts      # App configuration
│   │   └── ...
│   └── theme/                # Design system
│       ├── neon.ts           # Color palette
│       └── typography.ts     # Text styles
└── assets/                   # Images and icons
```

## Deep Linking

The app supports deep linking for Theta Wallet mobile:

- **Scheme**: `xfuel://`
- **Web fallback**: `https://xfuel.app`

Configure in `app.json`:
```json
{
  "scheme": "xfuel",
  "android": {
    "intentFilters": [...]
  }
}
```

## Building for Production

### EAS Build (Recommended)

```bash
# Configure EAS
eas build:configure

# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android

# Submit to stores
eas submit
```

### Local Build

```bash
# iOS
expo run:ios --configuration Release

# Android
expo run:android --variant release
```

## Environment Variables

Set in `app.json` under `extra`:

- `routerAddress`: XFUEL Router contract address
- `apiUrl`: Backend API endpoint
- `thetaMainnetRpc`: Theta RPC URL
- `thetaMainnetChainId`: Theta chain ID (361)
- `thetaExplorerUrl`: Block explorer URL

## Testing

```bash
# Run on iOS Simulator
npm run ios

# Run on Android Emulator
npm run android

# Test QR code scanning
# Test deep link: xcrun simctl openurl booted "xfuel://wc?..."
```

## Deployment

1. **Update version** in `app.json`
2. **Build** with EAS: `eas build --platform all`
3. **Test** builds on TestFlight/Internal Testing
4. **Submit** to App Store/Play Store: `eas submit`

## Troubleshooting

### QR Code Not Showing
- Check WalletConnect project ID in env
- Verify network connectivity
- Check console for errors

### Wallet Connection Fails
- Ensure Theta Wallet app is installed
- Check deep link configuration
- Verify chain ID matches mainnet (361)

### Balance Not Updating
- Pull to refresh on SwapScreen
- Check RPC endpoint availability
- Verify wallet address is correct

## Contributing

This is a mainnet production build. Test thoroughly before deploying.

## License

Proprietary - XFUEL Protocol

## Support

- Documentation: https://docs.xfuel.app
- Discord: https://discord.gg/xfuel
- Twitter: @xfuelprotocol

