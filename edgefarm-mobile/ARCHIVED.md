# EdgeFarm Mobile — Strategic Pivot Notice

> **Status:** Cosmos Yield features tabled. Pivoting to AI DePIN.
> **Added:** March 2026

## Current State

EdgeFarm Mobile was built as a **React Native (Expo)** companion app for the Cosmos Yield Station, providing:
- TFUEL staking and yield tracking via Keplr mobile
- Osmosis pool position management
- IBC transaction monitoring
- EdgeCloud GPU node operator dashboard (partial)

## Why This Is Tabled

The underlying Cosmos yield thesis (TFUEL → Persistence LSTfi → Osmosis AI yield pools) requires:
1. **Persistence governance approval** — not yet secured
2. **Active IBC relayer** — `backend/theta-bridge` Cosmos module is inactive
3. **Osmosis pool TVL** — no liquidity until bridge is live

Trying to maintain a mobile app for a backend that isn't running creates technical debt with zero user value.

## The Pivot: AI DePIN Mobile

The mobile app has a higher-value direction: a **native mobile companion for the AI DePIN Hub** (`xfuel-app/`). This would provide:

### Phase 1 — Read-only (low effort, high value)
- Live inference task feed from `/theta-ai/infer`
- Fee pipeline revenue dashboard (CoreRevenueSplitter stats)
- veXF governance proposal viewer and voting
- ZK proof explorer (nullifier lookup)

### Phase 2 — Transactional (post-audit)
- Submit AI inference tasks directly from mobile
- Agent-to-Agent (A2A) message sender
- veXF lock/unlock and governance voting
- Cross-chain fee routing status

### Phase 3 — EdgeCloud operator tools (stretch)
- GPU node health monitoring via `edgecloud.GetJobs`
- Earnings tracker for node operators
- Push notifications for proof submissions

## Rebuild Approach

**Recommended:** Clean rebuild against `xfuel-sdk` rather than patching the existing Cosmos-wired codebase.

```
# Start fresh from xfuel-sdk
import { XFuelClient } from '../../sdk/js/src'

const client = new XFuelClient({
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  chainId: 365,  // Theta Testnet
})
```

The existing `src/` screens, `crypto-polyfill.ts`, and `metro.config.js` can be reused. The Cosmos-specific screens (`CosmosYield.tsx`, `IBC*.tsx`, `KeplrConnect.tsx`) should be stripped and replaced with AI DePIN screens.

## What to Keep vs Strip

| Keep | Strip |
|---|---|
| `src/screens/Dashboard.tsx` (adapt) | `src/screens/CosmosYield*.tsx` |
| `src/screens/Settings.tsx` | `src/screens/IBC*.tsx` |
| `src/components/WalletConnect.tsx` (Theta only) | `src/hooks/useKeplr.ts` |
| `crypto-polyfill.ts` | `src/stores/cosmosStore.ts` |
| `metro.config.js`, `babel.config.js` | `src/providers/CosmosProvider.tsx` |
| `assets/` | Osmosis/Persistence branding assets |

## Timeline

| Milestone | Trigger |
|---|---|
| Strip Cosmos screens, wire SDK | When `xfuel-app/` AI DePIN Hub reaches v1.0 |
| Phase 1 read-only release | Post CertiK audit (Q3 2026) |
| Phase 2 transactional | Post mainnet deployment |
| Phase 3 operator tools | Based on node operator demand |

---

**See also:** `xfuel-app/` for the canonical web frontend · `sdk/js/` for the TypeScript client · `WHITEPAPER.md` Section 12 for full roadmap
