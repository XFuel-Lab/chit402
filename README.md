# XFUEL Protocol

Sub-4s institutional-grade settlement rail: Theta EdgeCloud GPU/video revenue → auto-compounding Cosmos LSTs

## 🚨 MAINNET BETA TESTING - Live Now

**XFuel Protocol is live on Theta Mainnet in beta testing mode.**

⚠️ **SWAP AT YOUR OWN RISK** - Contracts are unaudited. Use for testing only.

### Safety Limits
- **Max per swap:** 1,000 TFUEL
- **Total per user:** 5,000 TFUEL
- **Emergency controls:** Pause/kill switches active

**[→ Read Full Mainnet Beta Guide](./docs/MAINNET_BETA_TESTING.md)**

---

## ✨ Recent Updates (December 2025)

### WalletConnect v2 Integration
- 🔌 **Unified Wallet Provider** - Seamless connection across Theta Wallet, MetaMask, and WalletConnect
- 📱 **Mobile Deep Linking** - One-tap wallet connection on iOS/Android
- 🔒 **Enhanced Security** - Nonce-based replay attack prevention
- ⚡ **Auto-Reconnection** - Session persistence across page refreshes

### Mobile UI Improvements
- 🎯 **Hierarchical Single-Button Flows** - Streamlined UX with clear CTAs
- 🎨 **Haptic Feedback** - Tactile response for all interactions
- 🔄 **Pull-to-Refresh** - Instant balance and APY updates
- 🎉 **Confetti Animations** - Celebrate successful swaps

See [WalletConnect v2 Guide](./docs/WALLETCONNECT_V2_GUIDE.md) for implementation details.

## Features

- 🚀 Built with Vite 5.0.0, React 18, TypeScript, and Tailwind CSS
- 🔌 **Multi-Wallet Support**: Theta Wallet, MetaMask, WalletConnect v2
- 💱 TFUEL swap interface with intelligent defaults
- ⚡ Quick swap presets: 25% → stkXPRT, 50% → stkATOM, 100% → pSTAKE BTC
- 📊 Live indicators: finality, gas, price impact, Chainalysis safety
- 🎨 Dark cyberpunk theme with purple/blue neon gradients
- 📱 Native mobile app (Expo) with optimized UX
- 🔒 **Security**: Input validation, nonce-based signatures, reentrancy guards

## Setup

### Web Application

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment variables:**
```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```bash
# WalletConnect v2 (get from https://cloud.walletconnect.com)
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here

# Theta Network Contracts (Mainnet)
VITE_ROUTER_ADDRESS=0x...  # Your deployed XFUEL router
VITE_TIP_POOL_ADDRESS=0x...  # Your deployed Tip Pool

# Backend API
VITE_API_URL=http://localhost:3001  # or production URL

# Optional: Simulation mode for testing
SIMULATION_MODE=true
```

3. **Start development server:**
```bash
npm run dev
```

4. **Build for production:**
```bash
npm run build
npm run preview  # Preview production build
```

### Mobile Application

1. **Navigate to mobile directory:**
```bash
cd edgefarm-mobile
npm install
```

2. **Start Expo development server:**
```bash
npm run start
```

3. **Run on device:**
```bash
# iOS Simulator
npm run ios

# Android Emulator
npm run android

# Physical device: Scan QR code with Expo Go app
```

4. **Build for production:**
```bash
# iOS
npx eas-cli build --platform ios --profile production

# Android
npx eas-cli build --platform android --profile production
```

See [Deployment Checklist](./docs/DEPLOYMENT_CHECKLIST_V2.md) for full production deployment guide.

## Architecture

### Web Stack
- **Frontend**: Vite + React 18 + TypeScript + Tailwind CSS
- **Wallet Integration**: WalletConnect v2 + Ethers.js v6
- **State Management**: Zustand (price oracle) + React Context (wallet)
- **Testing**: Jest + Cypress E2E
- **Deployment**: Vercel

### Mobile Stack
- **Framework**: Expo (React Native)
- **Navigation**: React Navigation (Material Top Tabs + Stack)
- **Wallet**: Theta WalletConnect + Deep Linking
- **UI**: NativeWind (Tailwind for RN) + Custom Neon Components
- **Deployment**: Expo Application Services (EAS)

### Smart Contracts
- **Router**: XFUELRouter (swap orchestration)
- **Revenue Split**: RevenueSplitter (tokenomics)
- **Governance**: veXF (vote-escrowed XF)
- **Security**: ReentrancyGuard, input validation, nonce-based signatures

## Testing

### Unit Tests
```bash
npm test                 # Run Jest tests
npm run test:coverage   # With coverage report
```

### E2E Tests
```bash
npm run test:e2e             # Open Cypress UI
npm run test:e2e:headless   # Run headless
```

### Contract Tests
```bash
npm run test:contracts      # Run Hardhat tests
npm run test:coverage       # With coverage
```

### Mobile Tests
```bash
cd edgefarm-mobile
npm run start  # Manual testing on device
```

## Documentation

- **[🚨 Mainnet Beta Testing Guide](./docs/MAINNET_BETA_TESTING.md)** - Live testing, safety limits, deployment
- [WalletConnect v2 Integration Guide](./docs/WALLETCONNECT_V2_GUIDE.md) - Comprehensive implementation details
- [Cursor Implementation Guide](./docs/CURSOR_IMPLEMENTATION_GUIDE.md) - AI assistant reference
- [Deployment Checklist](./docs/DEPLOYMENT_CHECKLIST_V2.md) - Production deployment steps
- [Security Audit Report](./SECURITY_AUDIT_REPORT.md) - Contract security analysis
- [Cosmos LST Staking Guide](./COSMOS_LST_STAKING_GUIDE.md) - Cross-chain staking integration

## Security

### Implemented Protections

- ✅ **Input Validation**: All user inputs sanitized and validated
- ✅ **Nonce-Based Signatures**: Replay attack prevention
- ✅ **Reentrancy Guards**: OpenZeppelin ReentrancyGuard on all state-changing functions
- ✅ **Address Validation**: Strict Ethereum address format checks
- ✅ **Balance Verification**: Pre-transaction balance validation
- ✅ **Timestamp Validation**: 5-minute request window
- ✅ **LST Whitelist**: Only approved LSTs allowed
- ✅ **Rate Limiting**: (Recommended: implement Redis-based)

### Audit Status

Last audited: [Date TBD]  
Auditor: [TBD - recommend OpenZeppelin, Trail of Bits, or Consensys Diligence]

Report: [./SECURITY_AUDIT_REPORT.md](./SECURITY_AUDIT_REPORT.md)

### Responsible Disclosure

Found a security issue? Email: security@xfuel.app  
PGP Key: [Link to public key]

We follow a 90-day disclosure timeline and offer bounties for valid reports.

### Phase 1 Tokenomics

Phase 1 implements the foundation modules for XFUEL tokenomics without modifying existing swap rail, simulation, lottery, or Theta Wallet flows.

### Contracts

#### veXF.sol
Vote-escrowed XF token (Curve-style) that allows users to lock XF tokens for 1-4 years to receive veXF voting power. veXF balance decays linearly over time until unlock.

**Features:**
- Lock XF tokens for 1-4 years
- Linear decay of voting power over time
- Non-transferable voting power
- Receives yield distribution from protocol revenue
- UUPS upgradeable

**Key Functions:**
- `createLock(amount, unlockTime)` - Create or extend a lock
- `increaseAmount(amount)` - Add more XF to existing lock
- `increaseUnlockTime(unlockTime)` - Extend unlock time
- `withdraw()` - Withdraw XF after lock expires
- `votingPower(account)` - Get current voting power
- `balanceOf(account)` - Get current veXF balance
- `distributeYield(yieldToken, amount)` - Distribute yield to veXF holders (called by RevenueSplitter)

**Events:**
- `LockCreated` - Emitted when a lock is created
- `LockIncreased` - Emitted when lock amount is increased
- `LockExtended` - Emitted when unlock time is extended
- `Withdrawn` - Emitted when XF is withdrawn after unlock
- `YieldDistributed` - Emitted when yield is distributed
- `PermanentMultiplierSet` - Emitted when permanent multiplier is set
- `MultiplierSetterSet` - Emitted when multiplier setter is configured

#### RevenueSplitter.sol
Collects protocol revenue and distributes according to Phase 1 tokenomics:
- 90% to veXF holders (yield distribution)
- 10% to Treasury

**Features:**
- Modular revenue collection (no changes to existing router/pool)
- Automatic split calculation with rounding handling
- UUPS upgradeable
- Phase 2 ready (buyback/burn and rXF mint infrastructure prepared)

**Key Functions:**
- `splitRevenue(amount)` - Split ERC20 revenue tokens (90% veXF yield, 10% treasury)
- `splitRevenueNative()` - Split native token (TFUEL) - Phase 1 sends to treasury (swap mechanism TBD)
- `calculateSplits(amount)` - View split amounts without executing

**Events:**
- `RevenueCollected` - Emitted when revenue is collected
- `RevenueSplit` - Emitted when revenue is split
- `VeXFSet`, `TreasurySet`, `RevenueTokenSet`, etc. - Configuration events

#### CyberneticFeeSwitch.sol
Governance-settable fee tiers for protocol:
- Growth mode: 0.1% fees to attract TVL
- Extraction mode: 1.0% fees for revenue
- Controlled by veXF governance (minimum veXF required)

**Features:**
- Two fee modes (Growth/Extraction)
- Custom fee setting (owner only, max 10%)
- 7-day cooldown on fee changes
- IFeeAdapter interface for router integration
- UUPS upgradeable

**Key Functions:**
- `setFeeMode(mode)` - Switch between Growth/Extraction
- `setCustomFee(feeBps)` - Set custom fee (owner only)
- `setFeesEnabled(enabled)` - Enable/disable fees
- `getFeeMultiplier()` - Get current fee multiplier (IFeeAdapter interface)
- `getEffectiveFee(baseFee)` - Calculate effective fee (IFeeAdapter interface)
- `isFeesEnabled()` - Check if fees are enabled (IFeeAdapter interface)

**Events:**
- `FeesEnabled` - Emitted when fees are enabled/disabled
- `FeeModeChanged` - Emitted when fee mode changes
- `FeeChanged` - Emitted when fee amount changes
- `VeXFSet` - Emitted when veXF contract address is set
- `MinVeXFChanged` - Emitted when minimum veXF requirement changes

### Deployment

Deploy Phase 1 contracts to Theta Mainnet:

```bash
# Deploy to Theta Mainnet
npx hardhat run scripts/phase1-deploy.ts --network theta-mainnet
```

**Environment Variables (required for mainnet):**
- `THETA_MAINNET_PRIVATE_KEY` - Private key of deployer account
- `XF_TOKEN_ADDRESS` - XF token address on mainnet (required)
- `REVENUE_TOKEN_ADDRESS` - Revenue token address (e.g., USDC on Theta mainnet) (required)
- `TREASURY_ADDRESS` - Treasury address (defaults to deployer if not set)

**Deployment Output:**
- Contract addresses saved to `deployments/phase1-mainnet.json`
- `.env` file updated with contract addresses
- Implementation addresses for upgrade verification
- Proxy addresses for interaction

**Deployment Steps:**
1. Set environment variables in `.env`
2. Verify sufficient TFUEL balance (minimum 0.1 TFUEL recommended)
3. Run deployment script
4. Verify contracts on block explorer
5. (Optional) Transfer ownership to multisig/governance

**Contract Verification:**
After deployment, verify contracts on Theta block explorer using implementation addresses.

### Testing

Run comprehensive test suite:

```bash
# Run all Phase 1 tests
npm run test:contracts

# Run specific test files
npx hardhat test test/veXF.test.cjs
npx hardhat test test/RevenueSplitter.test.cjs
npx hardhat test test/CyberneticFeeSwitch.test.cjs

# Run all Phase 1 tests together
npx hardhat test test/veXF.test.cjs test/RevenueSplitter.test.cjs test/CyberneticFeeSwitch.test.cjs

# Run with coverage (target: 95%+)
npm run test:coverage
```

**Test Coverage:**
- ✅ 84 tests passing for Phase 1 contracts
- ✅ All critical functions tested
- ✅ Edge cases and error conditions covered
- ✅ Upgradeability tested
- ✅ Events verified
- ✅ Access control tested
- ✅ Uses ethers v6

### Integration

Phase 1 contracts are designed to integrate with existing XFUELRouter via adapter pattern:

1. **Fee Integration**: XFUELRouter can query `CyberneticFeeSwitch` via `IFeeAdapter` interface
2. **Revenue Collection**: Router can call `RevenueSplitter.splitRevenue()` to distribute fees
3. **Governance**: veXF holders can vote on fee changes via `CyberneticFeeSwitch`

**Example Integration:**
```solidity
// In XFUELRouter (future integration)
IFeeAdapter feeAdapter = IFeeAdapter(feeSwitchAddress);
uint256 feeMultiplier = feeAdapter.getFeeMultiplier();
uint256 effectiveFee = feeAdapter.getEffectiveFee(baseFee);
```

### Upgradeability

All Phase 1 contracts use UUPS (Universal Upgradeable Proxy Standard) pattern:

- **Proxy**: User-facing address (never changes)
- **Implementation**: Logic contract (upgradeable by owner)
- **Upgrade**: Only owner can authorize upgrades

**Upgrade Process:**
```bash
# Deploy new implementation
npx hardhat run scripts/upgrade-phase1.ts --network theta-testnet
```

### Security

- Built on OpenZeppelin upgradeable contracts
- Full test coverage (95%+)
- ReentrancyGuard on all state-changing functions
- Access control via Ownable
- Input validation on all functions

### Phase 2 Tokenomics

Phase 2 extends Phase 1 with revenue-backed receipts and automated buyback/burn mechanisms.

#### Contracts

##### rXF.sol
Soulbound revenue-backed receipt token that provides voting boosts and redemption rights.

**Features:**
- Minted by RevenueSplitter (15% revenue slice)
- Soulbound (non-transferable)
- 4× veXF voting boost
- Priority flag for future spin-outs
- Redeem 1:1 XF after 365 days (or custom 12-month for investors)
- Admin mint for Early Strategic Believers at TGE
- UUPS upgradeable

**Key Functions:**
- `mint(to, amount, redemptionPeriod, hasPriorityFlag)` - Mint rXF tokens (minter only)
- `redeem(amount)` - Redeem rXF for XF tokens (1:1 ratio after redemption period)
- `getBoostedVotingPower(account)` - Get veXF power + 4× rXF balance
- `getVotingBoost(account)` - Get 4× rXF voting boost amount
- `canRedeem(account)` - Check if user can redeem
- `adminMintBatch(recipients, amounts, periods, flags)` - Batch mint for TGE

##### BuybackBurner.sol
Receives 25% revenue slice from RevenueSplitter, swaps for XF tokens, and burns them.

**Features:**
- Receives revenue from RevenueSplitter
- Swaps revenue tokens (e.g., USDC) for XF tokens
- Burns XF tokens to reduce supply
- Supports manual buyback if automatic swap fails
- UUPS upgradeable

**Key Functions:**
- `receiveRevenue(amount)` - Receive revenue from RevenueSplitter
- `manualBuybackAndBurn(amount)` - Manual buyback (owner only)
- `recordBuyback(xfAmount)` - Record buyback amount (owner only)
- `setSwapRouter(router)` - Set swap router for automatic swaps

#### Phase 2 Deployment

Deploy Phase 2 contracts (requires Phase 1 to be deployed first):

```bash
# Deploy to local network
npx hardhat run scripts/phase2-deploy.ts

# Deploy to Theta testnet
npx hardhat run scripts/phase2-deploy.ts --network theta-testnet
```

**Prerequisites:**
- Phase 1 contracts must be deployed
- Phase 1 deployment file at `deployments/phase1-{chainId}.json` OR
- Environment variables set:
  - `XF_TOKEN_ADDRESS`
  - `REVENUE_TOKEN_ADDRESS`
  - `VEXF_ADDRESS`
  - `REVENUE_SPLITTER_ADDRESS`

**Optional Environment Variables:**
- `SWAP_ROUTER_ADDRESS` - Swap router for automatic buyback (optional, manual mode if not set)

**Deployment Output:**
- Contract addresses saved to `deployments/phase2-{chainId}.json`
- `.env` file updated with Phase 2 contract addresses
- RevenueSplitter automatically configured with rXF and BuybackBurner

#### Phase 2 Testing

Run comprehensive test suite:

```bash
# Run all Phase 2 tests
npx hardhat test test/rXF.test.cjs
npx hardhat test test/BuybackBurner.test.cjs

# Run with coverage (target: 95%+)
npm run test:coverage
```

#### Phase 2 Integration

Phase 2 contracts integrate seamlessly with Phase 1:

1. **RevenueSplitter Integration**: Automatically mints rXF and sends revenue to BuybackBurner
2. **Voting Boost**: rXF holders get 4× voting boost on top of veXF power
3. **Redemption**: rXF can be redeemed 1:1 for XF after 365 days
4. **Buyback**: 25% of revenue automatically buys and burns XF tokens

**Example Usage:**
```solidity
// RevenueSplitter automatically handles Phase 2 integration
revenueSplitter.splitRevenue(amount);
// - 15% mints rXF to caller
// - 25% sent to BuybackBurner for buyback/burn
// - 50% to veXF yield
// - 10% to treasury

// Check boosted voting power
uint256 boosted = rXF.getBoostedVotingPower(user);
// Returns: veXF.votingPower(user) + (rXF.balanceOf(user) * 4)

// Redeem rXF after 365 days
rXF.redeem(amount); // 1:1 XF redemption
```

## Theta Testnet Integration

This app is fully integrated with Theta testnet for real on-chain execution:

- **Swap & Stake**: Real router contract calls with native TFUEL
- **Tip Pools**: Lottery pools with VRF-based winner selection
- **Transaction Tracking**: All transactions show hash and explorer links
- **Balance Updates**: Real-time balance fetching from chain
- **Faucet Integration**: Get test TFUEL directly from the app

### Network Configuration
- Chain ID: 365
- RPC URL: https://eth-rpc-api-testnet.thetatoken.org/rpc
- Explorer: https://testnet-explorer.thetatoken.org/
- Faucet: https://faucet.testnet.theta.org/request

## Simulation Mode

XFUEL includes a fallback simulation mode for testing and demos when real testnet TFUEL is unavailable.

### How It Works

Simulation mode is automatically enabled when:
- `SIMULATION_MODE=true` environment variable is set on the backend, OR
- User's TFUEL balance is insufficient to cover the swap amount + gas buffer

### Enabling Simulation Mode

**Backend (Server-side):**
```bash
# Set environment variable
export SIMULATION_MODE=true

# Or in .env file
SIMULATION_MODE=true

# Start backend server
npm run health
```

**Frontend (Client-side - Dev Settings):**
- Use the "Sim On/Sim Off" toggle button in the web app header to force simulation mode
- This allows testing simulation UI without requiring low balance

### Features

- **Mock Transactions**: Simulated swaps return fake transaction hashes with realistic delays (3-5 seconds)
- **Simulated Output**: Output amounts calculated using current rates (5% fee simulation)
- **Transaction History**: All simulated transactions appear in history with "Simulated" tag
- **Explorer Links**: Fake transaction hashes are clickable (will show 404 on explorer, but UI remains functional)
- **UI Indicators**: Clear banner shows "Simulation Mode – Real swaps pending testnet TFUEL"
- **Settlement Events**: Mock events are logged for dashboard updates (farming yields, Tip Pools)

### Backend API

The backend swap endpoint (`POST /api/swap`) handles simulation:

```bash
# Example request
curl -X POST http://localhost:3001/api/swap \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0x...",
    "amount": 10,
    "targetLST": "stkATOM",
    "userBalance": 5
  }'

# Response (simulation mode)
{
  "success": true,
  "txHash": "0x...",
  "outputAmount": 9.5,
  "simulated": true,
  "message": "Swap simulated successfully"
}
```

### Testing

Run simulation mode tests:
```bash
# Unit tests
npm test -- swap-simulation.test.cjs

# Integration tests (requires backend running)
npm test -- swap-api.integration.test.cjs
```

### Notes

- Real mode is unchanged and fully functional when TFUEL is available
- Simulation mode does not execute on-chain transactions
- Transaction history distinguishes between simulated and real transactions
- All simulation logic is isolated and does not affect core swap functionality

## Unified Web + Mobile Product

This repo contains both the **web app** (investor site) and the **Expo mobile app** (investor demo) in one place.

- **Web app (Vite, deployed on Vercel)**
  - Run locally:
    ```bash
    npm run dev:web
    ```
  - Build for production / Vercel:
    ```bash
    npm run build:web
    ```

- **Mobile app (Expo + EAS Update, in `edgefarm-mobile/`)**
  - Run in Expo Go (local dev):
    ```bash
    npm run dev:mobile
    ```
  - Publish / refresh the investor demo build (EAS Update on `preview` branch):
    ```bash
    npm run eas:update:preview
    ```

## Investor Demo Links

These are the links you can share with investors to explore the current mock:

- **Mobile app (Expo Go, hosted via EAS Update)**  
  Open this link on a device with **Expo Go** installed, or scan the QR on the page:  
  `https://expo.dev/accounts/xfuel/projects/edgefarm-mobile/updates/227ac41f-0628-40f7-bb60-c29d615be007`

- **Web app (Vercel)**  
  Production preview for the current mock (served from the `main` branch):  
  `https://xfuel-protocol-v2-m1v9p0laq-chris-hayes-projects-ffe91919.vercel.app/`

### Investor demo checklist

- **Web URL (browser)**: deploy the latest `dist` to Vercel from this repo. Share the resulting `https://...vercel.app` link.
- **Mobile app (Expo Go)**: run `npm run eas:update:preview` and share the URL / QR code that the command prints.

Use these two links as the **single source of truth** for external demos so the app and site always match.

## Project Structure

```
xfuel-protocol/
├── src/
│   ├── App.tsx          # Main application component
│   ├── main.tsx         # React entry point
│   └── index.css        # Tailwind CSS styles
├── server/
│   ├── health.js        # Backend API server
│   └── api/
│       └── swap.js      # Swap API endpoint with simulation mode
├── edgefarm-mobile/     # Expo mobile app
├── test/
│   ├── swap-simulation.test.cjs      # Simulation mode unit tests
│   └── swap-api.integration.test.cjs # API integration tests
├── index.html           # HTML entry point
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript configuration
├── tailwind.config.js   # Tailwind CSS configuration
└── package.json         # Dependencies and scripts
```

## Professional Workflow (XFUEL)

To keep this codebase production-grade, follow this workflow for **all changes**:

1. **Never work directly on `main`**
   - Create a new branch for every change:
     - Features: `feature/[short-name]`
     - Fixes: `fix/[short-name]`
2. **Run tests after any code change**
   - Unit/integration tests:
     ```bash
     npm test
     ```
   - E2E tests (local dev, interactive Cypress runner):
     ```bash
     npm run test:e2e
     ```
   - For automation/CI, prefer the headless variant:
     ```bash
     npm run test:e2e:headless
     ```
3. **Only commit if all tests pass**
   - Fix failing tests before committing.
4. **Push branches and use PRs**
   - Push your branch and open a Pull Request against `main`.
   - When work is ready, communicate it as:  
     `Ready on branch feature/[name] — open PR to merge when good`
5. **No direct merges to `main` without explicit approval**
   - `main` is protected; only merge via reviewed/approved PRs.

## Tech Stack

- **Vite 5.0.0** - Next-generation frontend tooling
- **React 18** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS framework

## Bug Bounty Program

XFUEL runs a bug bounty program to encourage security researchers to help identify and fix vulnerabilities. Rewards range from $100 to $50,000 USD based on severity.

For details on scope, reward tiers, submission guidelines, and rules, see [docs/bug-bounty.md](docs/bug-bounty.md).

**Report vulnerabilities to:** security@xfuel.io

## White Paper

You can download the XFuel protocol white paper here:

- `https://github.com/XFuel-Lab/xfuel-protocol/raw/main/XFuel%20White%20Paper.pdf`
