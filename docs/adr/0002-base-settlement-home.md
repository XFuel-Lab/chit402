# ADR 0002 — Base Settlement Home

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Founder + engineering
- **Supersedes:** Theta-as-settlement-home language in `docs/POSITIONING.md`, `AGENTS.md`, and ADR 0001 §§ that place XF buyback / proof anchoring on Theta
- **Related:** ADR 0001 (USDC revenue), `docs/POSITIONING.md`, `docs/FUNDRAISING_STRUCTURE.md`

---

## Context

ADR 0001 correctly moved **fee currency** to USDC on Base (x402) and deprecated
`CoreRevenueSplitter` as the go-forward fee path. Canonical docs still said
**"Settlement home: Theta (361/365)"** — proof anchoring, treasury narrative, and
token buyback remained Theta-centric.

Operational reality contradicts that home:

1. **Safe / multisig.** Protocol admin Safe is not deployable as a first-class
   Gnosis Safe on Theta. Treasury and governance custody require Base (or another
   Safe-supported chain).
2. **Wallet / tooling UX.** Custom tokens and confirmation flows on Theta EVM are
   weak versus Base explorers, wallets, and developer tooling.
3. **Agent payment standard.** Public x402 settles in USDC on Base; TFUEL/TDROP
   rails (if any) are optional ecosystem adapters, not the product default.
4. **Pre-launch window.** No external token holders; Angel/Believer rounds are
   UI-retired (~1.1 TFUEL founder-only). Re-homing money + proof now is cheap;
   after holders exist it is expensive.

Theta's lasting value to XFuel is **EdgeCloud GPU compute** as a pluggable provider
tier — not settlement, not identity, not the company bank account.

## Decisions

1. **Money home = Base.** Protocol fees land in USDC via x402 on Base
   (`X402_PAY_TO` → Safe, later Splits v2). Default rail is `usdc`.

2. **Proof home = Base.** `ZKVerifierSP1` is (re)deployed on Base (Sepolia →
   mainnet). SP1 proofs anchor where money and Safe live. Prior Theta testnet
   verifier addresses are historical/archive only.

3. **Token home (deferred) = Base.** When XF + veXF launch, they deploy on Base.
   Buyback-burn is same-chain USDC → XF (no Theta bridge). Out of this ADR's
   immediate engineering wave; no Theta token sale relaunch.

4. **Theta = optional GPU / EdgeCloud provider only.** Document and configure
   EdgeCloud as one router tier among Groq, OpenAI, Akash, etc. Solidity names
   like `ThetaInferenceCircuit` may remain as provider-specific modules; they are
   not product identity. Optional TFUEL/TDROP payment rails may be added later
   without moving money/proof home.

5. **AngelRound / BelieverRound = retired.** Not the venture vehicle (see
   `docs/FUNDRAISING_STRUCTURE.md`). Public UI already redirects; contracts may
   remain on Theta mainnet but are not go-forward fundraising.

6. **Docs & defaults.** Canonical docs (README, WHITEPAPER, AGENTS, POSITIONING,
   CONTRIBUTING) must not claim Theta as settlement/primary chain. Gateway
   package identity is `xfuel-gateway` (not `theta-bridge`). Hardhat/wagmi include
   Base `8453` / `84532`. Theta RPC remains only for EdgeCloud provider ops.

## Keep / Retire

| Keep | Retire / demote |
|------|-----------------|
| Router, OpenAI-compat, MCP, SDK, receipts / `verify_url` | "Settlement home: Theta" |
| Tiered trust (signed → ZK settlement → zkGPT roadmap) | TFUEL as default payment rail |
| x402 USDC + token-light revenue (ADR 0001) | Angel/Believer as live raise |
| EdgeCloud as **one** provider tier | Theta-hybrid / DePIN hub identity |
| SP1 prover (chain-agnostic) | `CoreRevenueSplitter` as live fee path |
| A2A / swarm settlement surfaces | Gateway named `theta-bridge` |

## Consequences

- **Positive:** Safe-compatible ops; co-located USDC fees + proofs + (later) token;
  clear provider-agnostic story; Theta GPU thesis preserved without money tooling debt.
- **Trade-off:** Redeploy verifier on Base; update env/docs/examples; historical Theta
  manifests stay in `deploy/manifests/` as archive.
- **Non-consequence:** Leaving Theta as settlement home does **not** abandon EdgeCloud —
  routing volume *to* EdgeCloud is the complementary relationship.

## Alternatives considered

- **Theta settlement + Base payments (straddle):** rejected — Safe gap, bridge complexity,
  dual-home docs forever.
- **Full rebrand / leave Theta entirely:** rejected — EdgeCloud remains a valuable GPU tier;
  name XFuel kept.
- **Rename all `Theta*` Solidity in this wave:** deferred — high risk, low user-facing value;
  provider module names can stay until a dedicated rename PR.
