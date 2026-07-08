# XFuel — Positioning & Narrative (draft)

> Working document. This is the locked story we edit the site, deck, and `AGENTS.md`
> to match. It intentionally **demotes Theta/DePIN from identity to option**, and
> makes the honest proof-scope explicit so we never overclaim. Once approved, the
> copy blocks below are lifted verbatim into each surface.

---

## 0. The one thing to remember

We are **not** an inference reseller and **not** "a router" (OpenRouter already owns
generic routing at Web2 scale). We are the **accountability + payments layer for
machine-bought compute**:

> **Route any model. Prove every dollar.**

Provider-agnostic underneath, crypto-settled, proof-optional-but-available. Theta is
our settlement home and one provider tier — not our identity.

---

## 1. Messaging ladder

**Tagline:** Route any model. Prove every dollar.

**One-liner:** XFuel is the payments-and-proof layer for AI compute — route a task to
any provider, settle over any rail, and get a verifiable receipt.

**Elevator (30s):** AI agents are starting to spend money on their own — buying
inference, tools, and data. Today that means handing an agent your API keys and hoping
the invoice is honest. XFuel gives an agent a *budget instead of your keys*: it routes
each task to the best available provider (centralized, neocloud, or DePIN), settles
payment over any rail (USDC via x402, or TFUEL on Theta), and returns a **verifiable
receipt** — a signed statement by default, or an on-chain ZK settlement proof on demand.
You get accountable autonomous spend with a cryptographic audit trail.

**Wedge (beachhead use case):** *Accountable autonomous compute spend.* Fund an agent,
cap what it can spend (escrow), audit exactly what it bought (receipts), and settle
trust-minimally (proof + nullifier). Nobody has assembled this cleanly.

**Category:** Verifiable AI settlement / agent-native compute payments.

---

## 2. The honest proof-scope model (non-negotiable)

Cost tracks value, and claims track reality. Three tiers:

| Tier | Name | What it cryptographically attests | Cost | Availability |
|------|------|-----------------------------------|------|--------------|
| **0** | **Signed receipt** | Task, chosen route, model, tokens, cost, and a hash of the output — signed by XFuel | ~free, instant | **Always on** |
| **1** | **ZK settlement proof** | Correct fee split, payment binding, output-hash commitment, single-use nullifier (replay-proof), anchored on-chain | Prover cost | **On demand / gated** |
| **2** | **ZK proof-of-inference** | The *computation itself* ran as claimed (zkGPT) | High | **Roadmap — only where XFuel runs the model** |

**What we say (true):** "Verifiable settlement for AI compute — provably correct fees
and an immutable output commitment over any provider, anchored on Theta."

**What we never say (false for black-box APIs):** "We ZK-prove the model ran
correctly." That is only true at **Tier 2**, and only when XFuel controls the compute.
Blurring Tier 1 and Tier 2 is the fastest way to lose a technical reviewer or auditor.

This tiering is a **feature**: it lets the public demo run nearly free (Tier 0), while
the expensive Succinct proof (Tier 1) is a "Verify on-chain" upgrade gated to approved
teams.

---

## 3. Site hero copy (drop-in for `xfuel-app/src/pages/Home.tsx`)

**Badge row**
- Pill: `Beta protocol`
- Subtext: `Verifiable settlement for AI compute — route any model, prove every dollar`

**Title:** XFuel Protocol

**Subtitle:** Route any model. Prove every dollar.

**Description:**
> XFuel is the payments-and-proof layer for AI compute. Route inference to the best
> available provider — centralized, neocloud, or DePIN — settle over any rail (USDC via
> x402 or TFUEL on Theta), and get a **verifiable receipt** for every task: a signed
> statement by default, or an **on-chain SP1 proof** on demand. The stack is in
> **beta**; **Believer and Angel funding rounds are live on Theta mainnet**.

**Primary CTAs:** `Try the API` · `Believer Round` · `Angel Round` · `Docs`

**Repositioned feature cards** (replace the Theta-first framing):

| Title | Description |
|-------|-------------|
| **Provider-agnostic routing** | One OpenAI-compatible endpoint. Route to OpenAI, neoclouds (Groq/Together/Fireworks), or DePIN (Theta, Akash) — configured, not hardcoded. |
| **Verifiable receipts** | Every task returns a signed receipt; upgrade to an on-chain SP1 settlement proof with a single-use nullifier. |
| **Agent-native payments** | Pay per call over x402/USDC — give an agent a budget, not your API keys. Escrow caps the spend. |
| **On-chain settlement** | `CoreRevenueSplitter` distributes fees transparently (30% BBB · 30% GET · 25% veXF · 15% treasury), settled on Theta. |
| **Proof, when it matters** | Signed receipt (free) → ZK settlement proof (on demand) → proof-of-inference via zkGPT (roadmap). Cost tracks trust. |
| **Composable & open** | M2M REST API, MCP server, TypeScript SDK, webhooks. MIT licensed. |

**Stats bar** (swap the Theta-centric line): keep `Provider-agnostic router`, `SP1
proofs (live)`, `x402 + TFUEL rails`, `MIT / open source`.

---

## 4. Deck edits (`docs/grants/PITCH-DECK.md`)

Keep the traction/security/tokenomics slides — they're strong and true. Rewrite the
**identity** slides:

**Slide 1 — Cover**
- Title: **XFuel Protocol**
- Sub: **Route any model. Prove every dollar.**
- Quote: *"Give your AI agent a budget, not your API keys — XFuel routes the task to the
  best provider, settles over any rail, and returns a verifiable receipt."*

**Slide 2 — The Problem (reframed to agents, not DePIN silos)**
> AI agents are beginning to spend money autonomously on compute — but there's no
> accountability layer.
> 1. **No accountable spend** — agents need your API keys; principals can't cap or
>    audit what was bought.
> 2. **No portable trust** — a result from any provider is unverifiable; there's no
>    receipt you can check or settle against on-chain.
> 3. **No native payment rail** — agents can't hold credit cards; per-call crypto
>    micropayments (x402) have no clean, provable settlement layer.

**Slide 3 — The Solution**
> XFuel is the payments-and-proof layer between AI consumers (agents, apps, enterprises)
> and *any* compute provider. Route → settle over any rail → return a verifiable
> receipt. Providers are pluggable tiers (OpenAI, Groq, Together, Bedrock, **Theta**,
> Akash); the invariant is *route anywhere, prove settlement, pay any rail*.

**New slide — Proof scope (insert after Technology):** the Tier 0/1/2 table from §2
verbatim. This turns our honesty into a credibility asset.

**Slide 10 — Competitive Landscape (add the incumbent, sharpen the claim)**
- Add **OpenRouter** as the routing incumbent, and state plainly: *we don't compete on
  model coverage — we add what a Web2 billing router structurally can't: crypto-native
  agent payments + on-chain verifiable settlement + programmable escrow.*
- Claim to defend: **"the only neutral, verifiable settlement + payments rail for
  autonomous AI compute spend."**

**Slide 9 — Market (reframe TAM honestly)**
> Volume today is centralized + neocloud inference; DePIN is a small but fast-growing
> slice. XFuel monetizes settlement across **all** of it now, and rides the DePIN +
> zkML shift as it matures — no rewrite, just new tiers.

---

## 5. `AGENTS.md` top-matter rewrite

Replace the current "What Is XFuel?" block with:

> ## What Is XFuel?
>
> XFuel is the **verifiable settlement + payments layer for AI compute**. Any agent or
> app submits an inference task; XFuel routes it to the best available provider
> (centralized, neocloud, or DePIN), settles payment over any rail (USDC via x402, or
> TFUEL on Theta), and returns a **verifiable receipt**.
>
> **Trust is tiered (and we're precise about it):**
> - **Signed receipt** (default): route, model, cost, and output hash, signed by XFuel.
> - **ZK settlement proof** (on demand): SP1 proof of correct fees + payment binding +
>   output commitment + single-use nullifier, anchored on Theta. *This proves correct
>   settlement, not that a black-box provider computed the model correctly.*
> - **ZK proof-of-inference** (roadmap): zkGPT — proves the computation itself, only
>   where XFuel runs the model.
>
> **Settlement home:** Theta (chain 361/365). **Providers:** pluggable — Theta
> EdgeCloud and Akash are DePIN tiers; OpenAI-compatible endpoints (OpenAI, Groq,
> Together, Fireworks, Bedrock…) plug in via env. **Providers are options; the
> settlement + proof layer is the product.**

---

## 6. Messaging guardrails (do / don't)

| Do say | Don't say |
|--------|-----------|
| "Verifiable settlement over any provider" | "We ZK-prove the LLM ran correctly" (only Tier 2, self-hosted) |
| "Route any model — DePIN-first when it's warm" | "Decentralized GPU network" (we don't run GPUs) |
| "Theta is our settlement home + a provider tier" | "Theta-only" / "Theta inference protocol" |
| "Signed receipt free; on-chain proof on demand" | Imply every task is ZK-proven by default |
| "Best-in-class *verifiable, agent-native* routing" | "Best-in-class routing" (that's OpenRouter's) |

---

## 7. Why this wins now, and later

- **Now:** meets inference where the volume actually is (centralized + neocloud), via a
  universal OpenAI-compatible endpoint, with the differentiator (payments + verifiable
  receipts) layered on top.
- **Later (the shift we're betting on):** as DePIN GPUs mature (Theta, Akash, io.net)
  they become new router tiers — zero rewrite; as zkML matures (zkGPT) the proof scope
  deepens from settlement to computation. The invariant — *route anywhere, prove
  settlement, pay any rail* — is what survives every shift.
