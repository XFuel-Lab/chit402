# ADR 0002 — Base Settlement Home

Status: Accepted. Date: 2026-07-16.  
Related: [ADR 0001](./0001-usdc-revenue-and-router-verifier-positioning.md), [FUNDRAISING_STRUCTURE.md](../FUNDRAISING_STRUCTURE.md).

## Context

ADR 0001 moved fee currency to USDC on Base. Ops reality also requires Base for Safe custody, wallet/tooling UX, and the public x402 standard. Theta's lasting value is EdgeCloud GPU as a provider tier — not settlement home.

## Decisions

1. Money home = Base (`X402_PAY_TO` / Splits; default rail `usdc`).
2. Proof home = Base (`ZKVerifierSP1` on Sepolia → mainnet). Prior Theta verifier addresses are archive.
3. Token home (deferred) = Base when XF / veXF launch; same-chain buyback later.
4. Theta = optional GPU / EdgeCloud provider only. Solidity names like `ThetaInferenceCircuit` may remain as modules.
5. Canonical docs must not claim Theta as settlement home. Gateway identity is `xfuel-gateway`. Equity-first fundraising — see [FUNDRAISING_STRUCTURE.md](../FUNDRAISING_STRUCTURE.md).

## Consequences

Safe-compatible ops; co-located fees + proofs + (later) token; clear provider-agnostic story. Cost: redeploy verifier on Base; update env/examples. EdgeCloud routing volume is preserved.

Live verifier: see [RUNTIME_STATE.md](../RUNTIME_STATE.md).
