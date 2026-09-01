# Tier-3 Timebox Decision

Sprint 4 decision — Verified Inference / zkLLM posture for the next two quarters.

Date: 2026-08-05  
Status: **Narrow + timebox** (not pause, not company identity)  
Related: [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md), founder/VC strategy.

## Decision

| Option | Chosen? |
|--------|---------|
| Continue as company identity / primary roadmap | No |
| **Narrow premium SKU + fixed milestones** | **Yes** |
| Pause entirely; all eng → GTM/privacy | No |

## Rationale

1. Tier 1 + Tier 2 + Private Spend is the **traction surface** and B+ path.
2. TEE / confidential providers are winning “verifiable / private inference” on latency now.
3. Self-owned zkLLM remains a real **moat option** for open-weight anti-downgrade (PoMA) — but only if capital is not burned racing EigenAI on frontier models.
4. Guest v2 payment binding + mainnet USDC + design partners outrank zkLLM E2E this quarter.

## Scope that continues (narrow)

- Keep `services/zkllm-prover` compiling (`cargo test` green) and PoMA registry path.
- One milestone track only: **SP1 spike make-or-break** (matched toolchain) → then decide wrap (C1) vs alternate.
- Cap: **≤20% eng time** until Seed gates clear (mainnet USDC + partners + audit engaged).
- Product marketing: Tier-3 = **premium Verified Inference SKU**, never the one-liner.

## Explicitly out of scope until revisit

- E2E on-chain verify for large open models as a launch blocker
- Competing on black-box / closed-model inference proofs
- Expanding gadget surface without the SP1 spike decision

## Kill / continue gates (90 days from this memo)

| Gate | If true | Action |
|------|---------|--------|
| SP1 spike builds on matched image + proves a block | Pass | Continue to wrap + spot-check E2E |
| Spike still blocked after one dedicated eng-week | Fail | Pause Tier-3; reallocate to Private Spend / GTM |
| Paying design partner asks for open-weight authenticity | Override | Prioritize PoMA + narrow prove path for that model class |

## Owner

Founder reviews gate at next quarterly planning (or when Seed process starts). Update this file with date + outcome — do not leave implied.

## Linkage to raise narrative

Seed deck: Tier-3 is **option value**. Traction slides use paid tasks + USDC fees + Private Spend. Never lead with unfinished zkLLM.
