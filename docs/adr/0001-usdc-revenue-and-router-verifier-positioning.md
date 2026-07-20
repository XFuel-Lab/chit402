# ADR 0001 — USDC Revenue & Router/Verifier Positioning

Status: Accepted (revenue model). Settlement locus updated by [ADR 0002](./0002-base-settlement-home.md).  
Date: 2026-07-15.

## Context

The product is a provider-agnostic router + verifier: settle buyer payment in USDC via x402 on Base, return a verifiable receipt. A legacy on-chain native-token fee splitter does not match that product (wrong chain/currency, provider bias, large audit surface).

## Decisions

1. Identity: verifiable settlement and payments for AI compute. Providers are pluggable tiers, not identity.
2. Token-light: no tokenomics on the per-task hot path. Buyback / staker policy is downstream treasury policy.
3. Fees accrue in USDC on Base (x402).
4. Distribution: single address / Splits v2 on Base, off the hot path; owner = Safe / veXF governance.
5. Provider settlement: pass-through for crypto-native providers; collect-and-forward for Web2 (legal review before mainnet revenue).
6. Legacy on-chain fee splitters are not on the go-forward fee path.

## Keep / retire

Keep: `ZKVerifierSP1`, SP1 prover, hooks, x402 + receipts, circuits as provider modules, A2A settlement, XF/veXF later on Base.

Retire from go-forward: on-chain 4-way fee splitter as hot path, Theta-native boost, retired TFUEL sale contracts as the raise vehicle.

## Consequences

Near-zero bespoke revenue Solidity; on-strategy; faster path to live. Open: collect-and-forward custody — [LEGAL_LAUNCH_CHECKLIST.md](../LEGAL_LAUNCH_CHECKLIST.md).

Related: [POSITIONING.md](../POSITIONING.md), [ADR 0002](./0002-base-settlement-home.md).
