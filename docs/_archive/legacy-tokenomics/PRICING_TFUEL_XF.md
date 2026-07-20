# TFUEL / XF pricing policy (Community + Angel rounds)

This document defines how **XF per TFUEL** is set and updated for `BelieverRound` and `AngelRound` on Theta.

## On-chain enforcement

- **`xfAllocationCap`**: hard ceiling on **total XF reserved** by commits (Believer: 150M XF, Angel: 100M XF in default tokenomics). Commits revert with `ExceedsXFAllocationCap` once the cap would be exceeded.
- **`setTokenPrice(newNumerator, newDenominator)`**: callable by `DEFAULT_ADMIN_ROLE` **only while `status == Open`**. Defines **XF per 1e18 wei TFUEL** as `numerator / denominator` (same semantics as before).

There is **no automatic on-chain oracle** in v1: Theta may not expose a production TFUEL/USD feed. The multisig (or future oracle adapter) **observes** TFUEL/USD off-chain or via DEX TWAP, then updates price on-chain when policy says so.

## Current default deploy (reference valuation)

**Comms / modeling anchor (not enforced on-chain):** treat **fully diluted valuation** on the **1B XF** supply as **~USD 1.9M** for planning, i.e. **~USD 0.0019 per XF** at that reference.

**Default launch scripts** (override with env):

| Round | Base XF per 1 TFUEL | Contract |
|-------|---------------------|----------|
| Community (`BelieverRound`) | **5 / 1** | `believer/launch-round.cjs` — `BELIEVER_PRICE_NUM` / `BELIEVER_PRICE_DEN` |
| Angel (`AngelRound`) | **8 / 1** | `believer/launch-angel-round.cjs` — `ANGEL_PRICE_NUM` / `ANGEL_PRICE_DEN` |

At default deploy, **Angel** is **8** XF per TFUEL and **Believer** base is **5** XF per TFUEL (policy; multisig may adjust via `setTokenPrice` while Open).

### Believer lock tiers (unchanged bytecode)

`commit()` uses tier 0 (base only). `commitWithLock(1|2|3)` applies **bonus bps** on top of the **current** `tokenPriceNumerator` / `tokenPriceDenominator`:

| Tier | Bonus | Min claim delay after TGE | Effective XF per TFUEL at **base = 5** |
|------|-------|---------------------------|----------------------------------------|
| 0 | — | after cliff (vesting schedule) | **5.0** |
| 1 | +8% | 365 days | **5.4** |
| 2 | +20% | 730 days | **6.0** |
| 3 | +35% | 1095 days | **6.75** |

On-chain: `BelieverRound._bonusBps` (10000 / 10800 / 12000 / 13500). If multisig changes base price while Open, multiply these effective numbers by `(newBase / 5)` for the same tier structure.

`AngelRound` has **no** optional lock tiers in v1.

## TFUEL / USD and multisig updates (policy)

**Policy intent (not enforced as a formula in bytecode):** align **on-chain** `numerator` / `denominator` with **off-chain** TFUEL/USD and the **target implied USD per XF** you want to signal (e.g. tied to FDV on 1B XF). The exact mapping is chosen so that:

- Implied valuation stays **disciplined** vs spot TFUEL and internal targets.
- **Angel** vs **Community** relative pricing is a **policy choice** (current defaults: Angel **8**, Believer **5** XF per TFUEL) and may be updated while rounds are Open.

**Operational recipe:**

1. Observe **TFUEL_USD** (e.g. CEX index, DEX TWAP, or internal reference).
2. Choose **target implied USD per XF** (e.g. from FDV / 1B XF).
3. Compute **XF per 1 TFUEL** = `(1 TFUEL in USD) / (USD per XF)` with consistent decimals.
4. Set `tokenPriceNumerator` / `tokenPriceDenominator` to match **XF per 1e18 wei TFUEL** (18-decimal TFUEL).

Document each update (forum/post + optional `TokenPriceUpdated` event indexing).

## Hedges and communications

- **Announcement** before material price changes while the round is open.
- **Bounds**: consider internal min/max XF per TFUEL checks before signing multisig txs.
- **USDC commits** are **not** in these contracts; a future version would use ERC20 + separate oracle path.

## Related contracts

- `contracts/circuits/BelieverRound.sol`
- `contracts/circuits/AngelRound.sol`
