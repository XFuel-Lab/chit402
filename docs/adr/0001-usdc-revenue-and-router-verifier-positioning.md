# ADR 0001 — USDC Revenue on Base

Status: Accepted. Updated 2026-09.  
Date: 2026-07-15.

## Context

XFuel is the book — this agent spent Y on this job, and you hold hub, model, and amount. Buyers settle in USDC via x402 on Base. The product is the collected spend receipt (possession + lineage), not a router, not a model shop. Signed receipt is table stakes.

## Decisions

1. Identity: the book. Possession-gated spend lineage for the principal who funds the agent.
2. Token-light: no tokenomics on the per-task hot path. Buyback / staker policy is downstream treasury policy.
3. Fees accrue in USDC on Base (x402).
4. Distribution: single address / Splits v2 on Base, off the hot path; owner = Safe / veXF governance.
5. Provider settlement: pass-through for crypto-native providers; collect-and-forward for Web2 (legal review before mainnet revenue).
6. Legacy on-chain fee splitters are not on the go-forward fee path.

## Consequences

Near-zero bespoke revenue Solidity; on-strategy; faster path to live. Open: collect-and-forward custody — [LEGAL_LAUNCH_CHECKLIST.md](../LEGAL_LAUNCH_CHECKLIST.md).

Related: [POSITIONING.md](../POSITIONING.md), [ADR 0002](./0002-base-settlement-home.md).
