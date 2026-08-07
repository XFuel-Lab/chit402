# ADR 0005 — Provider Float COGS (Dual-Rail Treasury)

Status: Accepted. Date: 2026-08-06.  
Related: [ADR 0001](./0001-usdc-revenue-and-router-verifier-positioning.md), [ADR 0002](./0002-base-settlement-home.md), [STRATEGY.md](../STRATEGY.md), [PROVIDER_FLOAT_TREASURY.md](../PROVIDER_FLOAT_TREASURY.md), [LEGAL_LAUNCH_CHECKLIST.md](../LEGAL_LAUNCH_CHECKLIST.md).

## Context

Buyers settle in USDC via x402 on Base (ADR 0001/0002). Compute providers bill in heterogeneous units (EdgeCloud USDC/TFUEL/TDROP, Akash ACT/AKT, Web2 USD credits). A naive design — atomic USDC→provider-token swap per inference — fails on latency, failure modes, and product clarity (agents must not hold TFUEL/AKT to use XFuel).

ADR 0001 already distinguished pass-through (crypto-native) vs collect-and-forward (Web2, counsel). This ADR locks the **prepaid float** pattern as the default COGS path for DePIN and API providers.

## Decisions

1. **Buyer rail stays USDC-only** on Base via x402 → `X402_PAY_TO` / Safe / Splits. No buyer-facing TFUEL/AKT quotes.
2. **Provider COGS use prepaid floats** owned/operated by XFuel (or pass-through when the provider accepts USDC/x402 natively).
3. **No hot-path FX:** batch refill floats from treasury (CEX/DEX/card/EdgeCloud USDC top-up). Never bridge/swap per task before inference returns.
4. **Prefer USDC billing on Theta EdgeCloud** when available; TFUEL float is optional ops, not settlement identity.
5. **Receipts expose COGS** (`provider_cogs`) separately from buyer `payment` fields — for audit and margin, not as a second buyer rail.
6. **Web2 collect-and-forward** remains gated on counsel ([LEGAL_LAUNCH_CHECKLIST.md](../LEGAL_LAUNCH_CHECKLIST.md)).

## Consequences

- Eng builds Float Manager + quote float-gate + receipt COGS (see STRATEGY P0–P3).
- Ops prefunds EdgeCloud / Akash / credits; reconciles burn vs x402 intake.
- Product story stays: crypto routing machine with proof receipts; DePIN is invisible supply.
- Explicitly rejected: per-task atomic cross-token settlement; Theta/Akash as money home.

## Links

- Ops detail: [PROVIDER_FLOAT_TREASURY.md](../PROVIDER_FLOAT_TREASURY.md)
- Company strategy: [STRATEGY.md](../STRATEGY.md)
- Providers: [providers/README.md](../providers/README.md)
