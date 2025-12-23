# Bi-Directional Cross-Chain Swap Feature

## Overview

Full bi-directional swap implementation between Theta Network and Cosmos LSTs (Liquid Staking Tokens) with all pairs supported. Powered by Axelar GMP (General Message Passing) for secure cross-chain messaging.

## Features

### 1. Token Support

**Theta Network Tokens:**
- TFUEL (native)
- USDC (ERC20)

**Cosmos LST Tokens:**
- stkTIA (Staked Celestia)
- stkATOM (Staked Cosmos Hub)
- stkOSMO (Staked Osmosis)
- stkXPRT (Staked Persistence)
- milkTIA (MilkyWay TIA)
- qTIA (Quicksilver TIA)

### 2. Swap Directions

#### Theta → Cosmos
1. Swap TFUEL/USDC to bridgeable asset (if needed)
2. Bridge via Axelar GMP to destination Cosmos chain
3. Stake to LST on destination chain

#### Cosmos → Theta
1. Unstake LST to underlying asset
2. Bridge via Axelar GMP to Theta
3. Swap to TFUEL/USDC (if needed)

### 3. UI Components

#### BiDirectionalSwapCard
- **Input Dropdown**: Select from all available tokens (Theta + Cosmos)
- **Output Dropdown**: Auto-suggests opposite chain tokens
- **Swap Direction Button**: Instantly reverse swap direction
- **Amount Input**: Enter swap amount with validation
- **Route Preview**: Shows step-by-step execution plan
- **Fee Breakdown**: Gas + bridge fee transparency
- **Wallet Status**: Shows both Theta and Keplr wallet connections

### 4. Route Calculation

The system automatically calculates the best route based on:
- Source and destination tokens
- Available liquidity
- Bridge fees
- Estimated execution time

Example route (Theta → Cosmos):
```
Step 1: Swap TFUEL → USDC on Theta (~5s)
Step 2: Bridge USDC via Axelar (~60s)
Step 3: Stake to stkTIA on Celestia (~10s)
Total: ~75 seconds
```

### 5. Fee Structure

- **Swap Fee**: 0.3% (30 bps) on Theta swaps
- **Bridge Fee**: ~$1.50-$2.00 (Axelar GMP)
- **Gas Fee**: Dynamic based on network conditions
- **Slippage**: 0.5% default

## Architecture

### File Structure

```
src/
├── config/
│   └── tokenConfig.ts          # Token definitions and chain configs
├── utils/
│   ├── keplrWallet.ts          # Keplr wallet integration
│   └── axelarBridge.ts         # Axelar GMP bridge utilities
└── components/
    └── BiDirectionalSwapCard.tsx  # Main swap UI component
```

### Key Functions

#### Token Configuration (`tokenConfig.ts`)
- `getThetaTokens()`: Returns all Theta network tokens
- `getCosmosTokens()`: Returns all Cosmos LST tokens
- `isValidSwapPair()`: Validates cross-chain swap pairs
- `getTokenBySymbol()`: Lookup token by symbol

#### Keplr Integration (`keplrWallet.ts`)
- `connectKeplr()`: Connect to Keplr wallet for specific chain
- `getKeplrBalance()`: Fetch token balance
- `signAndBroadcast()`: Sign and broadcast Cosmos transactions
- `isKeplrInstalled()`: Check if Keplr extension is installed

#### Axelar Bridge (`axelarBridge.ts`)
- `calculateBestRoute()`: Calculate optimal swap route
- `estimateBridgeFee()`: Estimate Axelar bridge fees
- `bridgeThetaToCosmos()`: Execute Theta → Cosmos bridge
- `bridgeCosmosToTheta()`: Execute Cosmos → Theta bridge
- `getBridgeStatus()`: Track bridge transaction status

## Wallet Requirements

### Theta Wallet
- Required for all swaps involving Theta network
- Supports TFUEL and ERC20 tokens
- Auto-detects window.theta or window.ethereum

### Keplr Wallet
- Required for all swaps involving Cosmos chains
- Supports multiple Cosmos chains (Celestia, Cosmos Hub, Osmosis, Persistence)
- Auto-suggests chain configuration if not present

**Note**: Both wallets must be connected for cross-chain swaps.

## Usage

### Basic Swap Flow

1. **Connect Wallets**
   - Click "Connect Theta Wallet" for Theta side
   - Click "Connect Keplr" for Cosmos side

2. **Select Tokens**
   - Choose input token from dropdown (any chain)
   - Choose output token from dropdown (opposite chain auto-suggested)

3. **Enter Amount**
   - Type amount or use percentage buttons
   - See real-time preview of output amount

4. **Review Route**
   - Check step-by-step execution plan
   - Review fee breakdown
   - Verify estimated completion time

5. **Execute Swap**
   - Click "Execute Cross-Chain Swap"
   - Approve transactions in both wallets
   - Wait for bridge confirmation (~1-2 minutes)

### Example: TFUEL → stkTIA

```typescript
// User inputs
From: TFUEL (Theta)
To: stkTIA (Celestia)
Amount: 100 TFUEL

// Calculated route
Step 1: Swap 100 TFUEL → 95 USDC (~5s)
Step 2: Bridge 95 USDC → Celestia (~60s)
Step 3: Stake 95 USDC → 18.5 stkTIA (~10s)

// Fees
Gas: ~0.001 TFUEL
Bridge: $1.80
Total Time: ~75 seconds
```

## Configuration

### Environment Variables

```bash
# Axelar Gateway Addresses
VITE_AXELAR_GATEWAY_THETA=0x...
VITE_AXELAR_GATEWAY_CELESTIA=celestia1...
VITE_AXELAR_GATEWAY_COSMOS=cosmos1...
VITE_AXELAR_GATEWAY_OSMOSIS=osmo1...
VITE_AXELAR_GATEWAY_PERSISTENCE=persistence1...

# Token Contract Addresses
VITE_USDC_THETA=0x...  # USDC on Theta
```

### Chain IDs

- Theta Mainnet: `361`
- Celestia: `celestia`
- Cosmos Hub: `cosmoshub-4`
- Osmosis: `osmosis-1`
- Persistence: `core-1`

## Security

### Audited Components
- Axelar GMP protocol (third-party audited)
- Theta Network (production mainnet)
- Cosmos IBC (battle-tested)

### Best Practices
- Always verify transaction details before signing
- Check bridge status after initiating cross-chain swaps
- Keep small test amounts for first-time swaps
- Ensure sufficient gas on both chains

## Troubleshooting

### Common Issues

**"Please install Keplr wallet extension"**
- Install Keplr from https://www.keplr.app/

**"Please connect both wallets"**
- Cross-chain swaps require both Theta and Keplr wallets connected

**"Bridge transaction pending"**
- Axelar bridges can take 1-2 minutes
- Check status on https://axelarscan.io

**"Insufficient balance"**
- Ensure you have enough tokens + gas fees
- Leave buffer for gas on both chains

## Future Enhancements

- [ ] Support for more Cosmos chains (Injective, Juno, etc.)
- [ ] Add more Theta tokens (THETA, wrapped assets)
- [ ] Implement route optimization for lowest fees
- [ ] Add transaction history and tracking
- [ ] Support for batch swaps
- [ ] Integration with DEX aggregators for best rates

## API Reference

See inline documentation in:
- `src/config/tokenConfig.ts`
- `src/utils/keplrWallet.ts`
- `src/utils/axelarBridge.ts`
- `src/components/BiDirectionalSwapCard.tsx`

## Support

For questions or issues:
- Email: xfuel.support@xfuel.app
- GitHub: [Create an issue](https://github.com/xfuel-protocol/issues)
- Discord: [Join community](https://discord.gg/xfuel)

## License

MIT License - See LICENSE file for details

