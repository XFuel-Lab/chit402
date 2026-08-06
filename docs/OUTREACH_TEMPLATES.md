# Outreach Templates — Design Partners

Copy/paste. Customize the `[brackets]`. Targets: [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md).

---

## Cold DM / email (short)

**Subject:** Design partner — budgets + receipts for agents on Base

Hi `[Name]` — saw `[project / post / hackathon]`.

We’re XFuel: USDC budgets via x402 on Base, OpenAI-compatible routing, and verifiable receipts (optional on-chain SP1 settlement proofs). Looking for **3 design partners** to run real agent spend through our gateway and stress Private Spend (vendor-blind — providers don’t see your org’s spend topology).

30 min install: SDK or swap `baseURL` to our `/v1`. Early access + influence on the receipt schema.

Open to a 20-min call this week?

— `[You]` · https://xfuel.app · https://api-testnet.xfuel.app

---

## Follow-up (no reply in 5 days)

Quick bump on design-partner access for `[project]`. Happy to run a live task on a shared screen — you’ll leave with a `verify_url` receipt. Still relevant?

---

## After they say yes

Send [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md) + partner API key.

Hi `[Name]` — you’re in.

1. Key: `[partner-key]` (keep private; not the public demo key)
2. One-pager: `[link to onboarding doc or Notion copy]`
3. Cookbook: `npx tsx examples/private-spend-budget.ts` (from `xfuel-sdk` / repo)
4. Your stats only: `GET /stats/me` with that key
5. Auditor pack when needed: `/receipt/:taskId?format=auditor`

Trust note: Private Spend is gateway-trusted (not prompt encryption). We’ll say that in every doc.

Channel: `[Slack/Telegram invite]`

---

## Ask for a quote (after 2 weeks of usage)

Would you share 2–3 sentences we can use (or paraphrase) for Seed diligence — what broke without budgets/receipts, and what XFuel changed? Attribution optional.
