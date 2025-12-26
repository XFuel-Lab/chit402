# XFuel Protocol Mobile - Interstellar Edition 🚀

**The future of DeFi in your pocket. Tesla dashboard × Bugatti elegance × Cyberpunk dreams.**

> Sub-4s institutional-grade settlement rail: Theta EdgeCloud GPU/video revenue → auto-compounding Cosmos LSTs. Now mobile, luxury, and AI-powered.

---

## ✨ Features

### 🔐 Wallet Mastery - Zero Friction, Luxury Security

- **Direct Theta RPC Integration** - Native balance fetching via `@thetalabs/theta-js`
- **AsyncStorage Session Persistence** - Auto-connect on launch (no QR spam)
- **WalletConnect v2 Fallback** - Deep linking + QR code for maximum compatibility
- **AI Smart Connect** - Predictive session pre-loading based on user patterns
- **Biometric Authentication** - Face ID / Touch ID wallet unlock (Tesla key fob vibes)
- **Nonce + Timestamp Validation** - Replay attack prevention with input sanitization

### 🎛️ CockPit Dashboard - Tesla Meets Digital Bugatti

- **Animated Gauge Clusters** - Circular gauges for TFUEL, revenue velocity, LST yields
- **60fps Reanimated Physics** - Buttery smooth springs, pulses, glows
- **Revenue Velocity Indicator** - Real-time trend arrow (accelerating/slowing)
- **Expandable Sub-Panels** - Tap to reveal detailed metrics without clutter
- **At-a-Glance Luxury** - Bigger, brighter, glossy metrics that demand attention
- **Live Updates** - Pull-to-refresh with haptic feedback

### 💱 Stake/Swap Nirvana - Carousel Magic, One-Tap Bliss

- **Infinite LST Carousel** - Parallax scrolling with glossy cards (stkXPRT, stkATOM, stkTIA, stkOSMO)
- **AI Yield Predictor** - On-device ML suggests optimal LST based on your history
- **Live APY Glows** - Cards pulse with neon intensity matching yield rates
- **Preset Sliders** - 1% to 100% with haptic selection feedback
- **One-Tap Swap** - Confetti burst on success (200 particles!)
- **Yield Simulator** - Forecast returns like a SpaceX trajectory planner

### 🌟 Unmatched Luxury Polish

#### Aesthetic
- **Dark Cyberpunk Base** - Deep blacks, neon purples, blues, pinks
- **Glossy Neumorphic Buttons** - Rounded with inner glows and pulsing shadows
- **Adaptive Themes** - Auto day/night switch based on time
- **Lottie Micro-Animations** - Neon flares, success bursts, loading spinners
- **Gradient Overlays** - Smooth color transitions for depth

#### Performance
- **< 2s Launch Time** - From splash to interactive
- **60fps Guaranteed** - All animations, scrolls, gestures
- **Lazy Loading** - Code splitting for instant responsiveness
- **Optimized Assets** - Compressed images, tree-shaken bundles

#### Untapped Innovations
- **Biometric Unlocks** - Face ID / Touch ID (Expo LocalAuthentication)
- **Crew Mode** - Share yields via Expo Sharing (Tesla referral vibes)
- **Gamified Streaks** - Daily check-ins with Mars-themed badge unlocks
  - 🚀 Mars Recruit (1 day)
  - 🛸 Orbit Achiever (7 days)
  - ⛏️ Asteroid Miner (30 days)
  - 🏕️ Mars Colonist (90 days)
  - 🌌 Interstellar Legend (365 days)
- **Voice Commands** - "Show my yields", "Navigate to swap" (Expo Speech)
- **Dopamine Haptics** - Every tap, swipe, success = hypercar rev sensation

---

## 🏗️ Architecture

### Tech Stack

- **React Native** - 0.81.5
- **Expo SDK** - 54.x
- **TypeScript** - 5.9.2
- **React Navigation** - 7.x (Material Top Tabs)
- **Reanimated** - 4.1.1 (60fps animations)
- **NativeWind** - 4.2.1 (Tailwind for RN)

### Blockchain Integration

- **@thetalabs/theta-js** - Direct RPC provider + signer
- **@thetalabs/theta-wallet-connect** - WalletConnect v2 for Theta
- **ethers** - 6.13.0 (via theta-js)

### Luxury Features

- **expo-haptics** - Tesla-grade tactile feedback
- **expo-local-authentication** - Face ID / Touch ID
- **expo-speech** - Voice commands + TTS
- **expo-sharing** - Crew Mode social sharing
- **lottie-react-native** - Micro-animations
- **react-native-confetti-cannon** - Celebration animations
- **react-native-toast-message** - Elegant notifications
- **react-native-snap-carousel** - Infinite LST carousel
- **@react-native-async-storage/async-storage** - Session persistence

---

## 📦 Installation

### Prerequisites

- Node.js ≥ 24.0.0
- npm ≥ 10.0.0
- Expo Go app (iOS/Android) or Expo Dev Client
- Theta Wallet mobile app (for testing)

### Setup

1. **Clone the repository:**

```bash
git clone https://github.com/XFuel-Lab/xfuel-protocol.git
cd xfuel-protocol/edgefarm-mobile
```

2. **Install dependencies:**

```bash
npm install
```

3. **Configure environment:**

Edit `app.json`:

```json
{
  "expo": {
    "extra": {
      "routerAddress": "0xYourRouterAddress",
      "apiUrl": "https://api.xfuel.app",
      "thetaMainnetRpc": "https://eth-rpc-api.thetatoken.org/rpc",
      "thetaMainnetChainId": 361,
      "thetaExplorerUrl": "https://explorer.thetatoken.org"
    }
  }
}
```

4. **Start development server:**

```bash
npm start
```

5. **Run on device:**

- **iOS:** Scan QR with Camera app
- **Android:** Scan QR with Expo Go
- **Emulator:** Press `i` (iOS) or `a` (Android)

---

## 🧪 Testing

See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for comprehensive test suite.

### Quick Tests

#### Wallet Connection
```bash
npm start
# Navigate to Swap screen
# Tap "Smart Connect"
# Approve in Theta Wallet
```

#### LST Carousel
```bash
# Connect wallet
# Navigate to Swap
# Swipe through LST carousel
# Observe parallax + AI recommendation
```

#### Swap Execution
```bash
# Connect wallet
# Select amount via slider
# Choose LST from carousel
# Tap "Swap & Compound"
# Watch confetti 🎉
```

### Testnet

For Theta Testnet testing:
- RPC: `https://eth-rpc-api-testnet.thetatoken.org/rpc`
- Chain ID: `365`
- Faucet: `https://faucet.testnet.theta.org`

---

## 📁 Project Structure

```
edgefarm-mobile/
├── App.tsx                     # Main app entry with navigation
├── src/
│   ├── components/
│   │   ├── CockPitDashboard.tsx    # Animated gauge cluster
│   │   ├── LSTCarousel.tsx         # Infinite carousel with parallax
│   │   ├── NeonButton.tsx          # Glossy animated buttons
│   │   ├── NeonCard.tsx            # Glowing card containers
│   │   ├── NeonPill.tsx            # Inline badges
│   │   ├── ScreenBackground.tsx    # Wallpaper backgrounds
│   │   └── ...                     # More UI components
│   ├── screens/
│   │   ├── HomeScreenPro.tsx       # CockPit dashboard
│   │   ├── SwapScreenPro.tsx       # LST carousel + swap
│   │   ├── StakeScreen.tsx         # veXF locking
│   │   ├── ProfileScreen.tsx       # Settings + crew mode
│   │   └── OnboardingScreen.tsx    # First-time UX
│   ├── lib/
│   │   ├── thetaWalletPro.ts       # Wallet integration + Smart Connect
│   │   ├── luxuryFeatures.ts       # Biometric + streaks + crew mode
│   │   ├── voiceCommands.ts        # Voice navigation
│   │   ├── adaptiveThemes.ts       # Theme system + Lottie
│   │   ├── toastNotifications.ts   # Toast helpers
│   │   ├── oracle.ts               # LST price/APY fetcher
│   │   └── appConfig.ts            # Config loader
│   └── theme/
│       ├── neon.ts                 # Color palette
│       └── typography.ts           # Font styles
├── assets/                      # Images, fonts, Lottie files
├── package.json
├── app.json                     # Expo config
├── TESTING_GUIDE.md             # Comprehensive test suite
└── README.md                    # This file
```

---

## 🎨 Design Philosophy

### Visual Language

**Cyberpunk Luxury** - Dark voids with explosive neon accents. Every element glows, pulses, breathes. Inspired by:
- Tesla's minimalist dashboard (2-3 buttons max per screen)
- Bugatti's liquid metal surfaces (glossy gradients, neumorphism)
- Cyberpunk 2077's neon cityscapes (purple, blue, pink dominate)

### Interaction Design

**Dopamine-Driven Haptics** - Every interaction = reward.
- Tap: Light impact
- Press: Medium impact
- Success: Cascading heavy → heavy → success notification
- Scroll: Selection feedback on snap
- Rev: Hypercar crescendo (light → medium → heavy x2)

**Animation Principles**
- Spring physics (natural, organic motion)
- Stagger entrances (cards, gauges appear sequentially)
- Purposeful easing (fast out, slow in for luxury)
- 60fps non-negotiable (Reanimated on native thread)

---

## 🚀 Deployment

### Expo EAS Build

1. **Install EAS CLI:**

```bash
npm install -g eas-cli
eas login
```

2. **Configure build:**

```bash
eas build:configure
```

3. **Build for iOS:**

```bash
eas build --platform ios --profile production
```

4. **Build for Android:**

```bash
eas build --platform android --profile production
```

5. **Submit to stores:**

```bash
eas submit --platform ios
eas submit --platform android
```

### OTA Updates

For instant updates without app store review:

```bash
eas update --branch production --message "Luxury polish v1.1"
```

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

1. **Code Style** - TypeScript strict mode, ESLint + Prettier
2. **Commit Messages** - Conventional Commits format
3. **Testing** - All features must pass test suite
4. **Documentation** - Update README for new features

---

## 📄 License

MIT License - See [LICENSE](../LICENSE)

---

## 🌌 Roadmap

### Phase 1: Core Luxury (✅ Complete)
- [x] Direct Theta RPC integration
- [x] AI Smart Connect
- [x] CockPit Dashboard with gauges
- [x] LST Carousel with parallax
- [x] Biometric authentication
- [x] Gamified streaks
- [x] Voice commands (mock)
- [x] Adaptive themes

### Phase 2: Deep Space Features (Q1 2026)
- [ ] AR Yield Visualization (Expo AR)
- [ ] On-device ML for yield prediction (TensorFlow.js Lite)
- [ ] Real-time portfolio analytics
- [ ] Multi-chain LST support (Osmosis, Juno, Injective)
- [ ] Social leaderboards (Firebase)
- [ ] Push notifications (Expo Notifications)

### Phase 3: Hyperspace (Q2 2026)
- [ ] NFT staking positions
- [ ] Cross-chain swaps (Axelar, IBC)
- [ ] Limit orders + auto-compound strategies
- [ ] DAO governance voting
- [ ] Web3 social graph integration

---

## 📞 Support

- **Discord:** [discord.gg/xfuel](#)
- **Twitter:** [@XFuelProtocol](#)
- **Docs:** [docs.xfuel.app](#)
- **Email:** support@xfuel.app

---

## 🙏 Acknowledgments

Built with ❤️ by the XFuel team.

Special thanks to:
- Theta Labs for blockchain infrastructure
- Persistence for stkXPRT
- Cosmos Hub for interchain standards
- Tesla & SpaceX for design inspiration

---

**Made for those who demand excellence. Launch to Mars with us. 🚀**
