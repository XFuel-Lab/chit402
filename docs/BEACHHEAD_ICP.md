# Beachhead ICP — Crypto-native agent teams

Sprint 1 lock. Beachhead **A** from [STRATEGY.md](./STRATEGY.md).

Status: active · Last updated: 2026-08-07

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

## What a design partner is (and is not)

A **design partner** is an early customer who runs **real agent spend** through XFuel for a few weeks, gives blunt product feedback, and (ideally) a quotable note for Seed. They are **not** investors, advisors-for-equity, or “logo wallpaper.”

**Why you need them now**

| Without design partners | With 3 design partners |
|-------------------------|-------------------------|
| Flagship demo is founder-operated only | Independent teams prove install & retention |
| Seed / diligence: “who uses this?” | Named users + paid_tasks_7d + quotes |
| Roadmap guesses (Private Spend, receipts, MCP) | Partners stress the actual pain |
| Risk of building for Theta/GPU cosplay | Buyers are USDC/x402 agent teams (STRATEGY beachhead A) |

Aim: **10 outreach → 3 yeses** with a shared Slack/TG channel and at least one paid/test task each.

**What they get:** partner API key, early influence on receipt schema, onboarding one-pager, optional Private Spend when you flip the flag.  
**What you get:** usage, bugs, quotes, distribution into their agent stack.

Hard pass (still): free-credits tourists, custom tokenomics asks, “Theta settlement” buyers, fiat-only enterprises this quarter.

## Target list (public hunt leads — verify before DM)

Aim: **10 outreach → 3 design partners** in Sprint 3.  
Contacts below are **public X / LinkedIn / org channels** researched 2026-08-07 — not warm intros and **not private emails**. Confirm the handle still posts; prefer a warm path (Discord, mutual, hackathon) over cold-DM to a CEO. Templates: [OUTREACH_TEMPLATES.md](./OUTREACH_TEMPLATES.md).

**Priority order to message first:** Bankr → Virtuals (ACP / agent teams) → Olas operators → x402 Discord builders → Eliza plugin authors → Cloudflare ecosystem → Base hackathon winners → your OpenRouter network.

| # | Org / project | Contact (public) | Status | Notes |
|---|----------------|------------------|--------|-------|
| 1 | Coinbase CDP / x402 ecosystem | [x402 Discord](https://docs.cdp.coinbase.com/x402/support/faq) (link from CDP x402 FAQ); CDP Discord / Base Builders | todo | Don’t cold-email Coinbase execs. Post in x402 Discord: “seller + receipts on top of CDP facilitator.” Pitch builders *using* x402, not CDP BD. |
| 2 | Cloudflare Agents (x402 / paid MCP) | Org: [@Cloudflare](https://x.com/Cloudflare) · Agents docs lead signal: Rita Kozlov (VP Dev Platform) [LinkedIn](https://www.linkedin.com/in/ritakozlov) · [agents x402 docs](https://developers.cloudflare.com/agents/tools/payments/x402/) | todo | Rita is too senior for a cold design-partner ask — use Discord/community + builders shipping paid MCP on Workers. Angle: spend audit / `verify_url` for agent wallets that already pay 402. |
| 3 | Base Builder Code / base.dev agent apps | [Base Builders](https://base.org) / Farcaster Base channels; Builder Code docs on base.dev | todo | Hunt **app teams** shipping agent UIs, not Base Corp. Attribution + spend transparency. |
| 4 | Virtuals Protocol (Base agent commerce) | Jansen Teng (co-founder/CEO) [@ethermage](https://x.com/ethermage) · [LinkedIn](https://www.linkedin.com/in/jansenteng) · org [@virtuals_io](https://x.com/virtuals_io) · co-founder Tiew Wee Kee (Weekee) | todo | **High fit if** you reach an **agent team / ACP integrator**, not tokenomics. Pitch: USDC budgets + receipts for agents that already hold wallets on Base. Hard-pass if conversation becomes launchpad-only. |
| 5 | ElizaOS / Eliza Labs (framework) | Shaw Walters [@shawmakesmagic](https://x.com/shawmakesmagic) · org/framework still building open-source | todo | **Careful (2026-08):** token/foundation wind-down — do **not** pitch tokenomics. Pitch **plugin authors / teams still routing LLM spend** via ElizaOS: OpenAI `baseURL` swap + USDC budget. Prefer Discord/plugin maintainers over founder cold-DM this week. |
| 6 | Olas / Valory (multi-agent) | David Minarsch [@david_enim](https://x.com/david_enim) · Valory/Olas · [olas.network](https://olas.network) | todo | Multi-agent spend + A2A lineage. Better: **operators running live Olas services**, not only CEO. |
| 7 | Bankr (onchain agent tooling on Base) | Product [@bankrbot](https://x.com/bankrbot) · lead [@0xDeployer](https://x.com/0xDeployer) · [bankr.bot](https://bankr.bot/) · Base docs skill | todo | **Top cold target.** Agents that already pay for compute/tools; Coinbase Ventures / Base ecosystem adjacency. Pitch: budgets + receipts instead of opaque API burn. |
| 8 | MCP server authors (LLM proxies) | Hunt via [mcp.so](https://mcp.so) / Glama / npm `mcp` — pick 2–3 servers that wrap OpenAI/Anthropic | todo | “Your users need USDC budgets + receipts.” Contact = GitHub maintainers listed on the repo. |
| 9 | Base hackathon winners (agent / AI track) | ETHGlobal / Base Batches leaderboards (last 2 events) — fill names from public prize pages | todo | Fresh builders; offer free design-partner slot + receipt screenshot in the first call. |
| 10 | OpenRouter power users (your network) | *Founder fills — people you already know who burn OR invoices* | todo | Warmest path. “Same UX, USDC + verify URL instead of opaque invoice.” |

**Also worth a ping (compute co-sell, not buyer ICP):** Theta EdgeCloud BD / community — only if they intro you to **agent teams that settle in USDC on Base**. GPU ops alone ≠ beachhead buyer.

Suggested hunt pools: x402 Discord, Base Builders, Cloudflare Agents Discord, ETHGlobal / Base Batches agent winners, X search “x402” + “agent”, Virtuals ACP Discord, Olas Discord.

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
