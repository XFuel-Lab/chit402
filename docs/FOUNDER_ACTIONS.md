# Founder Action Tracker

Things only you (founder / ops / counsel) can do. Engineering tracks the rest in sprints.

Last updated: 2026-08-05 · Sprints 1–4 engineering complete · Your checklist below

## How to use

- Check boxes as you complete them.
- Do not put secrets in git — Lightsail / 1Password only.
- When mainnet USDC lands, tell eng so RUNTIME_STATE can flip to Real.

## Do this week (priority)

| # | You | Eng can help / already done |
|---|-----|------------------------------|
| 1 | CDP Secret keys + Base Safe → wire mainnet env ([MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md)) | Code path shipped |
| 2 | Put real contacts on [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md); send [OUTREACH_TEMPLATES.md](./OUTREACH_TEMPLATES.md) | 10 hunt targets + templates ready |
| 3 | Accept or amend [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) (reply “accepted” / edit) | Decision draft shipped |
| 4 | After partners say yes: partner API keys + [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md) | Onboarding + cookbook shipped |
| 5 | Paste [AUDIT_SCOPE_LETTER_DRAFT.md](./AUDIT_SCOPE_LETTER_DRAFT.md) to 2–3 firms (after git tag) | Letter + [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) ready |
| 6 | Deck from [SEED_DECK_OUTLINE.md](./SEED_DECK_OUTLINE.md) — live numbers only | Outline ready |
| Later | Guest v2 ELF + vKey; uptime monitor; counsel | Blocked on prover host / counsel |

---

## Sprint 1 — Money + ICP (your side)

### Mainnet USDC go-live

Follow [MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md).

- [ ] Create Coinbase CDP project + Secret API Key (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`)
- [ ] Create or reuse a **Safe** (or Splits v2) on Base mainnet for fees
- [ ] Set on live gateway `.env`: `X402_NETWORK=base`, `X402_PAY_TO=<safe>`, CDP keys, `X402_ENABLED=true`, `X402_FACILITATOR_PROVIDER=x402`
- [ ] Smoke: one real USDC payment → confirm on Basescan at `X402_PAY_TO`
- [ ] Tell eng / update RUNTIME_STATE when done (or ask eng to flip the row)

### Design partners (beachhead A)

Fill [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md). Templates: [OUTREACH_TEMPLATES.md](./OUTREACH_TEMPLATES.md).

- [x] Research starter list of 10 hunt targets in ICP table (eng filled 2026-08-05)
- [ ] Replace Contact column with real people; drop dead targets
- [ ] Send outreach (ICP script + OUTREACH_TEMPLATES)
- [ ] Book first 3 design-partner calls
- [ ] Shared Slack/Telegram channel per partner once they say yes

### Counsel / legal

- [ ] Engage counsel on collect-and-forward / money-transmission before Web2 provider pass-through at scale ([LEGAL_LAUNCH_CHECKLIST.md](./LEGAL_LAUNCH_CHECKLIST.md))
- [ ] Confirm entity / Safe signers documented in ops vault

---

## Sprint 2 — Trust + Private Spend (your side)

Engineering ships the code paths; you enable and validate in prod.

### Private Spend v0 (after eng merges)

- [ ] Set `PRIVATE_SPEND_ENABLED=true` on demo/prod gateway
- [ ] Confirm provider dashboards (OpenAI/etc.) do **not** show partner org names — only XFuel pooled keys
- [ ] Give each design partner their own `X-API-Key` and point them at `GET /stats/me` (buyer-only usage)
- [ ] Read trust caveat with partners: gateway-trusted; not prompt-confidential unless TEE route later

### In-proof payment binding (guest v2)

Code supports binding; live prover must be rebuilt/redeployed. See [public-values.md](../packages/agent-skills/_shared/reference/public-values.md).

- [ ] Rebuild SP1 guest ELF + host on a matched SP1 Linux/Docker image (`services/sp1-prover/`)
- [ ] Register new `programVKey` on Base `ZKVerifierSP1` (`0x9373499645292715a2275A78eD65B14215C41c06`)
- [ ] Deploy prover with `SP1_PUBLIC_VALUES_V2=true`
- [ ] Gateway: `X402_PROOF_BINDING=true` (+ USDC path live)
- [ ] Confirm a settled task shows `payment_binding.in_proof === true` on `/task-status` or receipt JSON

### Receipt verify (partner-facing)

- [ ] Share `verify_url` / `?format=json` with one partner; have them recompute binding via SDK without trusting the HTML page
- [ ] Optional: set `RECEIPT_SIGNING_SECRET` on gateway for Tier-1 HMAC (ops secret — not for public third parties)

---

## Sprint 3 — Design partners + distribution (your side)

Engineering shipped: north-star metrics, partner cookbook, A2A lineage fields, confidential provider stub, MCP `get_my_stats`.

- [ ] Issue **distinct partner API keys** (not shared demo key) for each design partner
- [ ] Send [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md) after each yes
- [ ] Schedule weekly review of `GET /stats` north-star (`paid_tasks_7d`, `usdc_fees_7d`)
- [ ] Optional: set `CONFIDENTIAL_PROVIDER_BASE_URL` + key if a partner needs prompt privacy (Phala-class)
- [ ] Collect 2 written quotes / feedback notes for Seed narrative

---

## Sprint 4 — B+ lock + Seed scaffold (your side)

Engineering shipped: auditor selective disclosure, staging SLA draft, Tier-3 timebox decision, Seed readiness checklist.

- [ ] Read and accept [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) (or amend in writing)
- [ ] Pin git tag + update deploy manifest for audit quote requests ([AUDIT_READINESS_CHECKLIST.md](./AUDIT_READINESS_CHECKLIST.md))
- [ ] Request audit firm quotes — paste [AUDIT_SCOPE_LETTER_DRAFT.md](./AUDIT_SCOPE_LETTER_DRAFT.md) + [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)
- [ ] Wire staging uptime monitor per [STAGING_SLA.md](./STAGING_SLA.md)
- [ ] Deck scrub: use [SEED_DECK_OUTLINE.md](./SEED_DECK_OUTLINE.md); live metrics only ([SEED_READINESS.md](./SEED_READINESS.md))
- [ ] Share auditor export with one partner: `/receipt/:id?format=auditor`

---

## Do not do yet

- Community / token sale marketing
- Claiming “ZK = private prompts”
- Broad enterprise RFPs before 3 design partners
- Enabling Web2 collect-and-forward revenue without counsel sign-off

---

## Eng status (for your awareness)

| Item | Status |
|------|--------|
| CDP JWT + mainnet facilitator URL defaults | Shipped (Sprint 1) |
| Mainnet operator checklist | Shipped |
| Beachhead ICP + Private Spend thesis docs | Shipped |
| Private Spend v0 flag + buyer stats + receipt privacy | **Shipped** (enable with `PRIVATE_SPEND_ENABLED=true`) |
| Binary prover path skips when payment binding needed | **Shipped** |
| SDK `getReceipt` + `getMyStats` | **Shipped** |
| North-star `/stats` (paid_tasks_7d, usdc_fees_7d) | **Shipped** |
| Partner cookbook + onboarding one-pager | **Shipped** |
| A2A / multi-hop receipt lineage | **Shipped** |
| Confidential provider stub | **Shipped** (env opt-in) |
| MCP `get_my_stats` | **Shipped** |
| Auditor selective disclosure (`?format=auditor`) | **Shipped** |
| Staging SLA draft | **Shipped** |
| Tier-3 timebox decision | **Shipped** — narrow SKU |
| Seed readiness scaffold | **Shipped** |
| Guest ELF rebuild + on-chain vKey | **Blocked on you / prover host** |
| Design partner keys + onboarding send | **Your Sprint 3 action** |
| Design partner logos / quotes | Blocked on outreach |
