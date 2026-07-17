# ADR 0001 — USDC Revenue Architecture & Router/Verifier Positioning

- **Status:** Accepted (revenue model). Settlement *locus* partially superseded by [ADR 0002](0002-base-settlement-home.md) (Base = money + proof home; Theta = GPU provider only).
- **Date:** 2026-07-15
- **Deciders:** Founder + engineering
- **Supersedes:** The legacy `CoreRevenueSplitter` fee model and the "Theta-centric DePIN hub" framing
- **Related:** `docs/POSITIONING.md` (north star), `AGENTS.md`, [ADR 0002](0002-base-settlement-home.md)

---

## Context

XFuel began as a "Theta-hybrid AI DePIN hub" with an on-chain, native-token (TFUEL)
fee engine (`CoreRevenueSplitter`, ~1,300 lines) enforcing a 30/30/25/15 split with a
Theta-native boost multiplier, GET sub-splits, multi-chain fee-to-stake, native-TFUEL
escrow, in-contract Chainlink oracles, TDROP accounting, and agent-grant voting.

The product has since become a **provider-agnostic router + verifier**: it routes
inference to the best available provider (Groq, OpenAI, Together, Fireworks, Theta
EdgeCloud, Akash…), settles buyer payment in **USDC via x402 on Base**, and returns a
**verifiable receipt** (signed by default; on-chain SP1 settlement proof on demand).

This creates three problems with the legacy design:

1. **Currency/chain mismatch.** `CoreRevenueSplitter.distribute()` moves native TFUEL on
   Theta. USDC fees earned on Base can only be *parked* in the contract (`receiveERC20Fee`
   → `erc20Balances`, no `distributeERC20()`), forcing a USDC→TFUEL swap per fee event.
2. **Off-strategy logic.** The `boostMultiplier` pays *more* incentives the more volume is
   Theta-native — actively biased against the provider-agnostic positioning.
3. **Audit surface.** A solo, unfunded, pre-audit team should minimize bespoke on-chain
   money code. The monolith is 8 responsibilities in one contract.

## Decisions

1. **Positioning:** XFuel's identity is the **verifiable settlement & payments layer for AI
   compute** ("Route any model. Prove every dollar."). Routing is the on-ramp; the
   **verifier + crypto-native settlement is the moat.** DePIN/orchestration are provider
   *tiers/features*, not identity. EdgeCloud (and other GPU networks) are optional compute
   tiers — complementary volume, not settlement home (see ADR 0002).

2. **Token posture: token-light.** The per-task hot path does **no tokenomics**. XF value
   accrual (buyback-burn) and any staker yield are **downstream treasury policy**, not an
   on-chain per-fee split.

3. **Revenue currency & chain:** Fees accrue in **USDC on Base** (where x402 settles).

4. **Distribution:** Use **Splits v2** (0xSplits — audited by Zach Obront, immutable
   `SplitsWarehouse`, ERC-6909, deterministic CREATE2 address on Base, nested splits) for
   the pro-rata fan-out of protocol USDC to buckets. Nested Split handles any sub-split.
   The Split's owner = the protocol Safe/veXF governance, preserving governance control of
   percentages **without** bespoke Solidity. Allocation is **off the hot path** (pull-flow,
   batched) — per-task cost is a single transfer to one address.

5. **Token value accrual: buyback-burn, downstream.** Treasury periodically routes a slice
   of accumulated USDC → buys & burns **XF on Base** when the token exists (same-chain;
   scheduled multisig/keeper action, adjustable without redeploy). veXF governs the
   *policy*, not each fee event. *(Locus updated by ADR 0002.)*

6. **Provider settlement: hybrid.** Pass-through for crypto-native providers (Theta,
   Akash); collect-and-forward for Web2 providers (Groq, OpenAI) that bill in fiat.
   *(Collect-and-forward custody/money-transmission implications to be reviewed with the
   legal checklist before mainnet revenue.)*

7. **`CoreRevenueSplitter` is deprecated from the go-forward fee path.** It stays deployed
   on Theta testnet (harmless), is removed from go-forward scope/docs, and is not part of
   the USDC revenue design.

## Keep / Retire

| Keep (product + moat) | Retire / rebuild (wrong-product legacy) |
|---|---|
| `ZKVerifierSP1` + SP1 prover + `SP1ProofHooks` | `CoreRevenueSplitter` as the fee hot path |
| x402 integration + receipt / `verify_url` + gateway routing | Theta-native boost multiplier |
| Circuit/handler architecture (provider extensibility) | TDROP accounting, in-contract Chainlink oracles, grant-voting-in-fee-contract |
| A2A / swarm settlement (more verifiable-settlement surface) | Native-TFUEL escrow / deferred claims |
| XF + veXF (later on Base; see ADR 0002) | Live Believer/Angel token sales; 4-way on-chain fee split |

## Shortest path to live (what's actually on the critical path)

```
Agent → x402/USDC fee → [protocol treasury address / Splits v2]
      → route to Groq → return result
      → signed receipt (Tier 0, free, always)
      → [optional] SP1 settlement proof (Tier 1, premium) → verify_url
```

Not on the path (deferrable treasury policy): CoreRevenueSplitter, boost engine, TDROP,
oracle feeds, fee-to-stake, buyback-burn automation, the 4-way split.

**MVP-live checklist:**
- [ ] x402 fee collection → single protocol USDC address on Base
- [ ] Groq routing + signed receipts (Tier 0)
- [ ] SP1 proof path (Tier 1) wired as premium upsell (prover live on AWS, verifier on testnet)
- [ ] Deploy a Splits v2 Split on Base (treasury/ops + buyback buckets), owner = Safe
- [ ] Treasury runbook: periodic USDC → XF buyback-burn on Base (when XF exists)

## Consequences

- **Positive:** near-zero bespoke audit surface for revenue; on-strategy (no provider bias);
  faster path to live; token complexity moves to adjustable treasury policy.
- **Trade-off (superseded by ADR 0002):** original note assumed XF on Theta; go-forward is
  same-chain USDC→XF on Base — no per-task bridge.
- **Open item:** provider collect-and-forward custody model needs legal review before
  mainnet revenue (see `docs/LEGAL_LAUNCH_CHECKLIST.md`).

## Alternatives considered

- **Keep `CoreRevenueSplitter`, add `distributeERC20()`:** rejected — retains a Theta-native,
  off-strategy monolith and a large audit surface; still fights the USDC/Base reality.
- **Bridge USDC to Theta and split there (single settlement locus):** rejected — more
  per-event bridging; contradicts "settle where you earn."
- **Tokenized on-chain enforced split (World B):** rejected — the token has no functional
  job in the actual product loop (agents pay USDC; providers don't want XF).
