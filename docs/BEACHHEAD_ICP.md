# Beachhead ICP — Crypto-native agent teams

Sprint 1 lock. Beachhead **A** from [STRATEGY.md](./STRATEGY.md).

Status: active · Last updated: 2026-08-06

## One sentence

Sell **budgets + receipts + optional settlement proofs** (crypto routing machine) to teams already building agents that hold USDC on Base and speak (or will speak) x402.

## GTM motions (from STRATEGY)

| # | Motion | Who | Offer |
|---|--------|-----|-------|
| 1 | Framework embed | Eliza / MCP authors | OpenAI baseURL → XFuel; USDC budget + verify_url |
| 2 | Launchpad sidecars | Virtuals agent teams | Escape siloed compute credits; DePIN + proofs |
| 3 | Swarm operators | Olas / Theoriq / ACP runners | A2A lineage + multi-hop spend receipts |
| 4 | Compute co-sell | Akash / Theta BD | Cheap GPUs ↔ Base agent demand |
| 5 | Standards attach | ERC-8004 / x402 bazaar | Settlement receipt + validation objects |

Full strategy: [STRATEGY.md](./STRATEGY.md). Hunt targets below.

## Who buys

| Role | Why they care |
|------|----------------|
| Agent / protocol founder | Needs spend control without sharing org API keys |
| Platform eng on agent frameworks | Wants OpenAI-compatible drop-in + payment rail |
| Crypto product lead | Needs auditable USDC spend for investors / treasury |

## Who does not buy (yet)

Enterprises that only pay fiat invoices, teams that need confidential prompts day-one (point them at TEE compose later), anyone shopping for “cheapest GPU DePIN.”

## Jobs to be done

1. Give an agent a **USDC budget** instead of a provider API key.
2. Route to whatever model works; get a **verifiable receipt**.
3. Optionally prove settlement on Base (Tier-2) for high-value tasks.
4. **Private Spend** (v0): vendor does not see the end-customer’s spend topology.

## Must-have product surface

- OpenAI-compatible `/v1` + `/task-request`
- x402 USDC on Base (testnet now → mainnet per [MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md))
- Signed receipt + public verify URL
- SDK + MCP install path `< 1 day`

## Design-partner criteria

A good partner:

- Ships an agent that already spends (or will spend) on inference weekly
- Has a Base wallet / CDP familiarity
- Will give written feedback in 2 weeks
- Accepts testnet → mainnet path without demanding Tier-3 zkLLM

Hard pass: “just need free credits,” “need custom tokenomics,” “Theta settlement.”

## Target list (research starters — founder fills Contact)

Aim: **10 outreach → 3 design partners** in Sprint 3.  
These are **hunt targets**, not intros. Replace Contact with LinkedIn / TG / email when you have it. Templates: [OUTREACH_TEMPLATES.md](./OUTREACH_TEMPLATES.md).

| # | Org / project | Contact | Status | Notes |
|---|----------------|---------|--------|-------|
| 1 | Coinbase CDP / x402 ecosystem builders | | todo | Warm via CDP Discord / Base Builders; sell receipts + budgets on top of facilitator |
| 2 | Cloudflare Agents (x402 Workers / paid MCP) | | todo | They already gate tools with 402 — ask who builds agents on Workers needing spend audit |
| 3 | Base Builder Code / base.dev app teams shipping agent UIs | | todo | Attribution + spend transparency angle |
| 4 | Virtuals / agent-token platforms (pick one live agent team) | | todo | Agents that already hold wallets; hard-pass if they only want tokenomics |
| 5 | ElizaOS / framework plugin authors routing LLM spend | | todo | Drop-in OpenAI baseURL + USDC budget story |
| 6 | Autonolas / Olas agent operators | | todo | Multi-agent spend + A2A lineage pitch |
| 7 | Bankr / onchain agent tooling (or peer) | | todo | Crypto-native agents that already pay onchain |
| 8 | MCP server authors who proxy LLM APIs | | todo | npm/`mcp` registries — “your users need budgets” |
| 9 | Base hackathon winners (agent / AI track, last 2 events) | | todo | Fresh builders; offer free design-partner slot |
| 10 | OpenRouter power users who want receipts (your network) | | todo | “Same UX, USDC + verify URL instead of opaque invoice” |

Suggested hunt pools: CDP Discord, Base Builders, x402 bazaar / docs listings, ETHGlobal / Base Batches agent winners, Twitter/X “x402” builders, your existing Theta/EdgeCloud contacts **only if they hold USDC on Base** (GPU ops ≠ buyer ICP).

## Outreach script (short)

> We’re XFuel — budgets + USDC settlement + receipts for agents on Base (x402). Looking for 3 design partners to run real tasks through our gateway and stress Private Spend (vendor-blind routing). You get early access + influence on the receipt schema. 30 min install via SDK or OpenAI base URL swap.

## Success metrics (Sprint 1–3)

- Target list filled (10)
- 3 partners with shared channel + first paid/test task
- North-star dashboard: **paid tasks / week** + USDC fees

## Explicit non-goals this quarter

- Community token sale
- Broad enterprise RFPs
- Competing with Phala/Eigen on confidential inference branding
- Expanding circuit catalog for GTM optics
