# Deprecated rXF Contract

**Status:** DEPRECATED - January 2026

## What Was This?

This contract implemented unlimited revenue-based rXF minting where 15% of protocol revenue was automatically minted as rXF tokens.

## Why Deprecated?

1. **Complexity**: Ongoing minting from revenue added unnecessary complexity
2. **Unlimited Supply**: No cap on rXF supply growth
3. **Revenue Impact**: Reduced veXF holder yields by 15%
4. **Architecture**: Conflated revenue distribution with strategic allocation

## Replaced By

**InnovationTreasury.sol** - Limited rXF Minting

- **5M hard cap** (5% of 100M total supply)
- **Treasury-minted** (not from revenue)
- **2.5M Early Believers** + **2.5M Governance Incentives**
- **Soulbound NFT** (non-transferable)
- **Same mechanics**: +4x veXF boost, 12-month redemption, 1:1 for XF

## Key Differences

| Feature | Old rXF (This File) | New Limited rXF |
|---------|-------------------|-----------------|
| **Source** | 15% of revenue (ongoing) | Treasury mint (one-time) |
| **Cap** | Unlimited | 5M hard cap |
| **Impact** | Reduced veXF yields | Zero (treasury-funded) |
| **Transferable** | Yes | No (soulbound NFT) |
| **Minting** | RevenueSplitter automatic | InnovationTreasury manual |

## Documentation

See **WHITEPAPER.md** Section 5.5 and 6.4 for new limited rXF architecture.

## Contract Location

- **New Implementation**: `contracts/InnovationTreasury.sol` (lines 288-380)
- **rXF Interface**: Still uses `contracts/rXF.sol` interface for minting

## Migration Notes

If you previously deployed this contract:
1. Stop minting from RevenueSplitter
2. Deploy InnovationTreasury with 5M cap enforcement
3. Use InnovationTreasury.mintRXFEarlyBeliever() and mintRXFIncentive()
4. Update RevenueSplitter to 30/30/25/15 split (no rXF)

---

**Date Archived:** January 12, 2026  
**Reason:** Replaced by simpler, capped, treasury-minted model  
**Git Commit:** See "refactor: Final cleanup—close ghosts"

