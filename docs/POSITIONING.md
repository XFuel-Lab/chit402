# Positioning

Locked story for site, deck, README, and agents. Theta / EdgeCloud appears only as an optional GPU provider — never as settlement home. See [ADR 0002](adr/0002-base-settlement-home.md).

Company strategy (GTM, rails, build sequence): [STRATEGY.md](./STRATEGY.md).

## One line

Route any model. Prove every dollar.

Privacy add (when Private Spend v0 is live): Spend without briefing the frontier lab.

## Elevator

AI agents are starting to spend money on their own. Today that means handing over API keys and hoping the invoice is honest. XFuel is the crypto routing machine: give an agent a USDC budget instead of keys, route each task to the best available provider (DePIN or frontier), settle via x402 on Base, and return a verifiable receipt — signed by default, or an on-chain SP1 settlement proof on demand.

Private Spend (product mode, see [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md)): buyer pays XFuel; providers see gateway traffic, not the end-customer’s spend topology. Do not claim prompt confidentiality unless a TEE/confidential route is used.

## Trust tiers

1. Signed receipt (live, default) — route, model, cost, output hash  
2. SP1 settlement proof (live, on demand) — fees, payment binding, output commitment, nullifier on Base  
3. Verified Inference (active build) — model computation for open-weight models  

Do not claim Tier 2 proves a black-box LLM ran correctly.

## Homes

- Money — Base (USDC / x402)
- Proofs — Base (`ZKVerifierSP1`)
- Token (later) — Base (XF / veXF)
- Compute — pluggable providers

## Beachhead

Crypto-native agent teams on Base (USDC / x402). See [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md).

## Why us, in one claim

**Availability through routing, without losing the audit trail.** Not "decentralised GPUs are
cheaper" — measured against live rates, DePIN beats hyperscalers and loses to the best aggregator
routes, so we are ~25–30% *above* the floor on our own baseline model
([PRICING_STRATEGY.md](./PRICING_STRATEGY.md)). Cheapness is not ours to claim and it is not
defensible if it were: anyone can reprice.

What is ours is that a call which fails on one provider completes on another, and the receipt names
which one actually ran. Provider capacity failures are not hypothetical — ~2.5% of calls in our own
model evaluation returned HTTP 504 `queue_timeout`, across two different models
([MODEL_QUALITY_EVAL.md](./MODEL_QUALITY_EVAL.md)). Every other vendor in this space shows spend and
declines to show provenance.

## Guardrails

Say: verifiable settlement over any provider; failover across hubs with an attested route; crypto
routing machine; money and proofs on Base; signed free, proof on demand; budgets instead of API keys.  
Do not say: Theta-centric / DePIN hub as identity; **DePIN / XFuel is cheaper** (it is not the price
floor, and a saving claim needs a named baseline and must be allowed to print negative); TFUEL as
default buyer rail; every task is ZK-proven by default; retired sale rounds are open; ZK alone means
prompts are private.

**Never sell:** an uptime SLA, prepaid credits as the primary model, or a fixed monthly compute
plan. All three sell a promise about supply we do not own — a provider price or capacity shock lands
entirely on us, and the GPU market is exactly where such shocks come from. Per-task settlement means
a supply shock reprices the next call instead of stranding a commitment. Enterprise BYOK is the one
acceptable exception ([PRICING_STRATEGY.md](./PRICING_STRATEGY.md)).
