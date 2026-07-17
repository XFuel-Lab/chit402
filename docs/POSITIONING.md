# XFuel — Positioning & Narrative

> Locked story for site, deck, `AGENTS.md`, and README. Theta appears **only** as an
> optional GPU / EdgeCloud provider tier — never as settlement home or product identity.
> See [ADR 0002](adr/0002-base-settlement-home.md).

---

## 0. The one thing to remember

We are **not** an inference reseller and **not** "a router" (OpenRouter already owns
generic routing at Web2 scale). We are the **accountability + payments layer for
machine-bought compute**:

> **Route any model. Prove every dollar.**

Provider-agnostic underneath, crypto-settled on **Base (USDC / x402)**, proof-optional-but-available.

---

## 1. Messaging ladder

**Tagline:** Route any model. Prove every dollar.

**One-liner:** XFuel is the payments-and-proof layer for AI compute — route a task to
any provider, settle in USDC (x402 on Base), and get a verifiable receipt.

**Elevator (30s):** AI agents are starting to spend money on their own — buying
inference, tools, and data. Today that means handing an agent your API keys and hoping
the invoice is honest. XFuel gives an agent a *budget instead of your keys*: it routes
each task to the best available provider (centralized, neocloud, or DePIN GPU), settles
payment in **USDC via x402 on Base**, and returns a **verifiable receipt** — a signed
statement by default, or an on-chain ZK settlement proof on demand.
You get accountable autonomous spend with a cryptographic audit trail.

**Wedge (beachhead use case):** *Accountable autonomous compute spend.* Fund an agent,
cap what it can spend (escrow), audit exactly what it bought (receipts), and settle
trust-minimally (proof + nullifier).

**Category:** Verifiable AI settlement / agent-native compute payments.

---

## 2. The honest proof-scope model (non-negotiable)

| Tier | Name | What it cryptographically attests | Cost | Availability |
|------|------|-----------------------------------|------|--------------|
| **0** | **Signed receipt** | Task, route, model, tokens, cost, output hash — signed by XFuel | ~free | **Always on** |
| **1** | **ZK settlement proof** | Correct fees, payment binding, output-hash commitment, single-use nullifier — anchored on **Base** | Prover cost | **On demand** |
| **2** | **ZK proof-of-inference** | The *computation itself* (zkGPT) | High | **Roadmap — only where XFuel runs the model** |

**What we say (true):** "Verifiable settlement for AI compute — provably correct fees
and an immutable output commitment over any provider, anchored on Base."

**What we never say (false for black-box APIs):** "We ZK-prove the model ran
correctly." That is only true at **Tier 2**, and only when XFuel controls the compute.

---

## 3. Site hero copy

**Badge:** `Beta protocol` — `Verifiable settlement for AI compute`

**Title:** XFuel Protocol

**Subtitle:** Route any model. Prove every dollar.

**Description:**
> XFuel is the payments-and-proof layer for AI compute. Route inference to the best
> available provider — centralized, neocloud, or DePIN GPU — settle in **USDC via x402
> on Base**, and get a **verifiable receipt** for every task: a signed statement by
> default, or an **on-chain SP1 proof** on demand.

**Primary CTAs:** `Try the API` · `Docs` · `AI Hub`

**Feature cards:**

| Title | Description |
|-------|-------------|
| **Provider-agnostic routing** | One OpenAI-compatible endpoint. OpenAI, Groq/Together/Fireworks, or DePIN GPU (EdgeCloud, Akash) — configured, not hardcoded. |
| **Verifiable receipts** | Signed receipt by default; upgrade to on-chain SP1 settlement proof with a single-use nullifier. |
| **Agent-native payments** | Pay per call over x402/USDC on Base — budget, not API keys. |
| **On-chain settlement** | Fees accrue in USDC on Base (Safe / Splits v2). Token-light: buyback is downstream treasury policy (ADR 0001 / 0002). |
| **Proof, when it matters** | Signed → ZK settlement → zkGPT (roadmap). Cost tracks trust. |
| **Composable & open** | M2M REST, MCP, TypeScript SDK, webhooks. MIT licensed. |

---

## 4. Homes & providers (do not conflate)

| Layer | Home |
|-------|------|
| Money (fees) | **Base** — USDC / x402 |
| Proofs | **Base** — `ZKVerifierSP1` |
| Token (later) | **Base** — XF / veXF when ready |
| Compute | Pluggable providers — EdgeCloud is **one GPU option**, not identity |

**Settlement home:** Base (8453 / 84532). **Providers:** OpenAI-compatible + DePIN GPU tiers (EdgeCloud, Akash, …).

---

## 5. Messaging guardrails

| Do say | Don't say |
|--------|-----------|
| "Verifiable settlement over any provider" | "We ZK-prove the LLM ran correctly" (only Tier 2) |
| "Route any model — EdgeCloud when it's the best GPU" | "Theta-hybrid" / "Theta-centric" / "DePIN hub" as identity |
| "Money and proofs on Base (USDC)" | "Theta is our settlement home" |
| "Signed receipt free; on-chain proof on demand" | Imply every task is ZK-proven by default |
| "Optional TFUEL/TDROP rail later" | TFUEL as the default payment story |
| Funding rounds retired / not open | "Believer & Angel rounds are live" |

---

## 6. Why this wins now, and later

- **Now:** meet inference where volume is (neocloud + APIs), with payments + receipts on Base tooling that agents and Safes already use.
- **Later:** as DePIN GPUs mature (EdgeCloud, Akash, …) they become new router tiers — zero rewrite of money/proof home; as zkML matures, proof scope deepens. The invariant — *route anywhere, prove settlement, pay USDC* — survives every shift.
