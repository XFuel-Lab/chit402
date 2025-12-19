# Phase 2 Tokenomics Integration Guide

## Overview

Phase 2 extends Phase 1 tokenomics with two key components:
1. **rXF** - Soulbound revenue-backed receipt tokens with voting boosts
2. **BuybackBurner** - Automated buyback and burn mechanism

## Architecture

```
RevenueSplitter (Phase 1)
├── 50% → veXF yield (Phase 1)
├── 25% → BuybackBurner (Phase 2) → Swap → Burn XF
├── 15% → rXF mint (Phase 2) → Mint rXF to caller
└── 10% → Treasury (Phase 1)
```

## rXF Contract

### Purpose
rXF (Revenue XF) is a soulbound token that represents revenue-backed receipts. Holders receive:
- 4× voting boost on top of veXF power
- Priority flag for future spin-outs
- 1:1 redemption for XF tokens after 365 days

### Key Features

#### Soulbound (Non-Transferable)
- All transfer functions revert
- Tokens cannot be sold or transferred
- Ensures receipts stay with original recipients

#### Voting Boost
- 4× multiplier on rXF balance
- Added to veXF voting power
- Formula: `boostedPower = veXF.votingPower(user) + (rXF.balanceOf(user) * 4)`

#### Redemption
- Default: 365 days (1 year)
- Custom periods: 30 days to 4 years (for investors)
- 1:1 ratio with XF tokens
- Partial redemption supported

#### Minting
- Minted by RevenueSplitter (15% revenue slice)
- Admin mint for Early Strategic Believers at TGE
- Batch minting supported

### Integration with RevenueSplitter

When `RevenueSplitter.splitRevenue()` is called:
1. Calculates 15% of revenue for rXF mint
2. Calls `rXF.mint(msg.sender, amount, 0, false)`
3. Mints rXF 1:1 with revenue amount (same decimals)

### Usage Examples

```solidity
// Check voting boost
uint256 boosted = rXF.getBoostedVotingPower(user);
// Returns: veXF.votingPower(user) + (rXF.balanceOf(user) * 4)

// Check if user can redeem
(bool canRedeem, uint256 amount, uint256 timeRemaining) = rXF.canRedeem(user);

// Redeem after period elapses
rXF.redeem(amount); // 1:1 XF redemption

// Admin mint for TGE
address[] memory recipients = [...];
uint256[] memory amounts = [...];
uint256[] memory periods = [...];
bool[] memory flags = [...];
rXF.adminMintBatch(recipients, amounts, periods, flags);
```

## BuybackBurner Contract

### Purpose
Automatically buys XF tokens with 25% of protocol revenue and burns them to reduce supply.

### Key Features

#### Revenue Reception
- Receives 25% revenue slice from RevenueSplitter
- Tracks total revenue received
- Supports manual buyback if automatic swap fails

#### Buyback Mechanism
- Swaps revenue tokens (e.g., USDC) for XF tokens
- Burns XF tokens to reduce supply
- Tracks total XF burned

#### Swap Router Integration
- Optional swap router for automatic swaps
- Manual mode if router not set
- Owner can record buyback amounts manually

### Integration with RevenueSplitter

When `RevenueSplitter.splitRevenue()` is called:
1. Calculates 25% of revenue for buyback
2. Approves BuybackBurner to spend revenue tokens
3. Calls `BuybackBurner.receiveRevenue(amount)`
4. BuybackBurner swaps and burns XF (if router set)

### Usage Examples

```solidity
// Set swap router for automatic buyback
buybackBurner.setSwapRouter(swapRouterAddress);

// Manual buyback (if automatic swap fails)
buybackBurner.manualBuybackAndBurn(revenueAmount);

// Record buyback amount (after manual swap)
buybackBurner.recordBuyback(xfAmount);
```

## Deployment

### Prerequisites
1. Phase 1 contracts deployed
2. Phase 1 deployment file at `deployments/phase1-{chainId}.json` OR
3. Environment variables set with Phase 1 addresses

### Deployment Steps

```bash
# 1. Ensure Phase 1 is deployed
npx hardhat run scripts/phase1-deploy.ts --network theta-testnet

# 2. Deploy Phase 2
npx hardhat run scripts/phase2-deploy.ts --network theta-testnet
```

### Deployment Script Features
- Automatically loads Phase 1 addresses
- Deploys rXF and BuybackBurner as UUPS proxies
- Configures RevenueSplitter with Phase 2 contracts
- Saves deployment info to `deployments/phase2-{chainId}.json`
- Updates `.env` file with new addresses

### Post-Deployment Configuration

1. **Configure Swap Router** (if using automatic buyback):
   ```bash
   # Set swap router address
   buybackBurner.setSwapRouter(swapRouterAddress)
   ```

2. **Test Revenue Split**:
   ```bash
   # Send revenue to RevenueSplitter
   revenueToken.approve(revenueSplitter, amount)
   revenueSplitter.splitRevenue(amount)
   # - 15% mints rXF
   # - 25% sent to BuybackBurner
   # - 50% to veXF yield
   # - 10% to treasury
   ```

3. **Verify Integration**:
   - Check rXF balance after revenue split
   - Check BuybackBurner received revenue
   - Verify voting boost calculation

## Testing

### Run Tests

```bash
# Test rXF
npx hardhat test test/rXF.test.cjs

# Test BuybackBurner
npx hardhat test test/BuybackBurner.test.cjs

# Test with coverage
npm run test:coverage
```

### Test Coverage

Target: **95%+ coverage** for all Phase 2 contracts

Test scenarios:
- ✅ Deployment and initialization
- ✅ Minting (single and batch)
- ✅ Soulbound (transfer reverts)
- ✅ Redemption (after period elapses)
- ✅ Voting boost calculation
- ✅ Revenue reception
- ✅ Buyback and burn
- ✅ Admin functions
- ✅ UUPS upgradeability

## Security Considerations

### rXF
- **Soulbound**: Prevents token transfers (reverts on transfer)
- **Access Control**: Only minters and owner can mint
- **Redemption Period**: Minimum 30 days, maximum 4 years
- **Reentrancy Protection**: All state-changing functions protected

### BuybackBurner
- **Authorization**: Only RevenueSplitter or owner can receive revenue
- **Swap Router**: Optional, can be set/updated by owner
- **Manual Override**: Owner can manually record buybacks if swap fails
- **Emergency Withdraw**: Owner can withdraw stuck tokens

## Upgradeability

Both contracts use UUPS (Universal Upgradeable Proxy Standard):
- **Proxy**: User-facing address (never changes)
- **Implementation**: Logic contract (upgradeable by owner)
- **Upgrade**: Only owner can authorize upgrades

### Upgrade Process

```bash
# Deploy new implementation
npx hardhat run scripts/upgrade-phase2.ts --network theta-testnet
```

## Integration Checklist

- [ ] Phase 1 contracts deployed
- [ ] Phase 2 contracts deployed
- [ ] RevenueSplitter configured with rXF and BuybackBurner
- [ ] Swap router configured (if using automatic buyback)
- [ ] Test revenue split end-to-end
- [ ] Verify rXF minting works
- [ ] Verify BuybackBurner receives revenue
- [ ] Test voting boost calculation
- [ ] Test redemption after period elapses
- [ ] Transfer ownership to multisig/governance

## Future Enhancements

- **Automatic Swap Integration**: Integrate with DEX router for automatic swaps
- **Price Oracle**: Use price oracle for accurate swap rates
- **Batch Redemption**: Support batch redemption for gas efficiency
- **Governance Integration**: Allow veXF governance to set redemption periods
- **Spin-out Priority**: Implement priority flag logic for future spin-outs

