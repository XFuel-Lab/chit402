# Ferrari Module - Tokenomics

This module implements the Ferrari tokenomics model for XFuel Protocol, managing revenue distribution and vote-escrowed governance tokens.

## Components

### RevenueSplitter.sol
**Protocol revenue distribution contract.**

**Revenue Split (Phase 2):**
- 50% → veXF holders (yield distribution)
- 25% → Buyback & burn XF tokens
- 15% → rXF minting (redeemable XF)
- 10% → Treasury

**Security Features:**
- UUPS upgradeable
- Timelock integration for critical operations
- Multi-sig treasury integration
- Emergency pause functionality
- Per-user swap limits (mainnet beta safety)
- Reentrancy protection

**Key Functions:**
- `splitRevenue(amount)` - Distribute revenue according to tokenomics
- `splitRevenueNative()` - Handle native token revenue
- `setBuybackBurner()` - Configure buyback contract
- `setRXF()` - Configure rXF contract
- `setPaused()` - Emergency pause

### veXF.sol
**Vote-escrowed XF token** (Curve-style governance).

**Features:**
- Lock XF for 1 week to 4 years
- Voting power decays linearly over time
- 4x multiplier at max lock duration
- Permanent multipliers from ThetaPulseProof
- Non-transferable voting power
- Yield distribution to veXF holders
- UUPS upgradeable

**Key Functions:**
- `createLock(amount, unlockTime)` - Lock XF for veXF
- `increaseAmount(amount)` - Add more XF to existing lock
- `increaseUnlockTime(unlockTime)` - Extend lock duration
- `withdraw()` - Claim XF after lock expires
- `votingPower(account)` - Get current voting power
- `setPermanentMultiplier()` - Set bonus multiplier (ThetaPulseProof)
- `distributeYield()` - Distribute revenue to veXF holders

## Tokenomics Flow

```
Protocol Revenue (USDC)
         |
    RevenueSplitter
    /    |    |    \
  50%   25%  15%   10%
   |     |    |     |
 veXF  B&B  rXF  Treasury
Yield Burn Mint
```

## Integration

**Used by:**
- `XFUELRouter.sol` - Collects and sends fees to RevenueSplitter
- `BuybackBurner.sol` - Receives 25% for buyback/burn
- `rXF.sol` - Receives 15% for minting redeemable tokens
- `ThetaPulseProof.sol` - Sets permanent multipliers for early believers

**Integrates with:**
- `XFuelTimelock.sol` - Delayed execution for critical operations
- `MultiSigTreasury.sol` - Treasury management

## Governance

veXF holders have voting power proportional to:
1. Amount of XF locked
2. Time remaining in lock (linear decay)
3. Permanent multiplier (from early participation)

**Formula:**
```
veXF = XF * timeBasedMultiplier * permanentMultiplier
timeBasedMultiplier = 1 + (3 * timeRemaining / lockDuration)
```

## Security Considerations

⚠️ **Critical Economic Module**

- Revenue splits are immutable constants (requires upgrade to change)
- Timelock delays protect against malicious parameter changes
- Emergency pause available for incident response
- Per-user limits during mainnet beta (1,000 TFUEL/swap, 5,000 total)

## Testing

**Mainnet Beta Limits:**
- Max per swap: 1,000 TFUEL
- Max total per user: 5,000 TFUEL
- Can be updated by owner via `updateSwapLimits()`

## Deployment

1. Deploy veXF.sol (UUPS proxy)
2. Deploy RevenueSplitter.sol (UUPS proxy)
3. Configure RevenueSplitter with veXF, treasury, buyback, rXF addresses
4. Set timelock controller
5. Initialize beta limits

## Version

Ferrari Module v2.0 (Phase 2 Tokenomics)
UUPS Upgradeable

