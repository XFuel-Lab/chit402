# Cosmos Yield Station — Archived

> **Status:** Archived — Phase 2 Reactivation Planned
> **Archived:** March 2026
> **Original path:** `src/`

## What This Was

The **Cosmos Yield Station** was the original XFuel frontend. It provided a UI for:
- TFUEL → Persistence LSTfi bridging (osETH, stkATOM)
- Osmosis AI yield pool interactions (30–50%+ APY target)
- Liquidity dashboard and rebalancing controls
- Institutions portal for accredited participants

## Why It Was Archived

XFuel's strategic focus has shifted entirely to **AI DePIN** — routing intelligence, compute, and value across Theta, Bittensor, Akash, Render, and Bittensor. The Cosmos yield thesis remains valid but requires:

1. **Persistence governance approval** — whitelisting the XFuel bridge contract on mainnet
2. **Active Osmosis pool liquidity** — sufficient TVL to make yield routing worthwhile
3. **Protocol maturity** — post-CertiK audit credibility before onboarding LSTfi positions

Cosmos yield integrations are **tabled**, not cancelled.

## Phase 2 Reactivation Plan

When Persistence governance approval is secured (expected post-audit, Q3 2026+):

1. Restore this directory to `src/` or integrate as a route within `xfuel-app/`
2. Wire `CosmosYieldDashboard` → `CoreRevenueSplitter.routeToCosmosYield()` (governance-gated)
3. Re-enable IBC relay configuration in `backend/theta-bridge/`
4. Re-enable `cosmwasm-contracts/persistence-minter` deployment

## Files

| File | Purpose |
|---|---|
| `App.tsx` | Root app with Cosmos-focused routing |
| `InstitutionsPortal.tsx` | Accredited participant UI |
| `LiquidityDashboard.tsx` | Pool rebalancing and yield display |
| `components/` | Cosmos bridge, pool, and IBC components |
| `hooks/` | Cosmos SDK, Keplr wallet hooks |
| `stores/` | Zustand stores for yield state |

## Dependencies

The following are still present in the root `package.json` for reference but not actively built:
- `@cosmjs/stargate`, `@cosmjs/proto-signing`
- `@cosmos-kit/react`, `@cosmos-kit/keplr`
- Osmosis/Persistence IBC configurations

---

**For questions about reactivation:** See `WHITEPAPER.md` Section 12 (Roadmap) and `docs/GAP_ANALYSIS.md`.
