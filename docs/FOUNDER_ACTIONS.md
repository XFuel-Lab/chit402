# Founder Action Tracker

Things only you (founder / ops / counsel) can do. Engineering tracks the rest in sprints.

Last updated: 2026-08-13 · Public Base mainnet x402 live · Gateway on `main` @ `20fa5d6` (11/11 verify) · SDK `0.5.2` · SP1 prover scaled to 0 · Next: items 16 (AkashML questions), then 12–15 / 17

## How to use

- Check boxes as you complete them.
- Do not put secrets in git — Lightsail / 1Password only.
- Build-from source: [STRATEGY.md](./STRATEGY.md) · floats: [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md)

## Do this week (priority)

| # | You | Eng can help / already done |
|---|-----|------------------------------|
| 1 | ~~Mainnet USDC go-live~~ | **Done 2026-08-06** — public flagship Real |
| 2 | Read and accept [STRATEGY.md](./STRATEGY.md) (or amend in writing) | STRATEGY + ADR 0005 + float treasury shipped |
| 3 | ~~Prefund Theta EdgeCloud with USDC; API key on gateway~~ | **Done 2026-08-07** — real EdgeCloud compute live; float cap enforced (`PROVIDER_FLOAT_ENFORCE=true`) |
| 3b | ~~Publish `xfuel-sdk@0.5.2`~~ | **Done 2026-08-13** — https://www.npmjs.com/package/xfuel-sdk · payload v2 (`route.provider`) matches live receipts |
| 3c | ~~Redeploy the gateway to Lightsail~~ | **Done 2026-08-13** — live on `main` @ `20fa5d6`. Verify 11/11 |
| 3d | Confirm the bounty change: XFuel no longer advertises cash rewards (was "up to $50,000") until the first audit is funded | Eng converted [bug-bounty.md](./bug-bounty.md) to a safe-harbour disclosure policy and scrubbed README / WHITEPAPER / SECURITY / site |
| 3e | ~~Get an AkashML _inference_ key~~ | **Done 2026-08-13** — `akml-` key + `akash-network` float on the live box; `/v1` served `akash-network` in the verify probe |
| 4 | Put real contacts on [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md); send [OUTREACH_TEMPLATES.md](./OUTREACH_TEMPLATES.md) | 10 hunt targets + GTM motions in ICP |
| 5 | Accept or amend [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) (reply “accepted” / edit) | Decision draft shipped |
| 6 | After partners say yes: partner API keys + [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md) | Onboarding + cookbook shipped |
| 7 | Rotate CDP Secret API key (ops hygiene); prefer Safe for `X402_PAY_TO` | — |
| 8 | Counsel: prepaid float COGS vs Web2 collect-and-forward — [LEGAL_LAUNCH_CHECKLIST.md](./LEGAL_LAUNCH_CHECKLIST.md) | ADR 0005 documents float default |
| 9 | Paste [AUDIT_SCOPE_LETTER_DRAFT.md](./AUDIT_SCOPE_LETTER_DRAFT.md) to 2–3 firms (after git tag) | Letter + [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) ready |
| 10 | Deck from [SEED_DECK_OUTLINE.md](./SEED_DECK_OUTLINE.md) — STRATEGY language. Live `/stats` USDC fee figures are **now quotable**, with one caveat: describe them as a post-2026-08-12 window, not lifetime totals | Eng windowed the inflated pre-fix rows out of `/stats` and publishes the excluded count rather than dropping it silently ([KNOWN_ISSUES.md](./KNOWN_ISSUES.md)) |
| 11 | Accept / amend [SPEND_INTELLIGENCE_THESIS.md](./SPEND_INTELLIGENCE_THESIS.md) — agent spend analytics as a wedge. Decide: metadata-only boundary, and advisory recommendations vs opt-in auto-routing | Steps 0–3 of its roadmap are now shipped; its flat-pricing and prepaid-credits recommendations are **superseded** (banner at the top of the doc). Promote to ADR 0006 once accepted |
| 12 | **Accept the price schedule** — [PRICING_STRATEGY.md](./PRICING_STRATEGY.md). Metered per-model rate card with a floor is **already live**, so this is ratification of what runs, not a greenfield decision. Still open inside it: whether `xfuel/auto` may route agent work to a model that costs the buyer $0.21 vs $0.021. Also: stop calling it a "0.5% protocol fee" — that framing caps us in the 5% router band | Market research done: routers top out ~5%, Akash abolished its 20%; verifiability earns 10–20%, not a multiple; an SP1 settlement proof is ~$0.007 on Base and we give it away |
| 13 | **Decide the revenue-split base** (ADR 0001). Splitting the *fee* sends buyback $0.0000175/task — 1M tasks funds $17.50 while gross margin is ~$18,000. If the token thesis matters, the base must be gross margin | Flagged in [PRICING_STRATEGY.md](./PRICING_STRATEGY.md) open decisions |
| 14 | ~~Scale the SP1 prover to zero~~ | **Done 2026-08-13** — ECS `sp1-prover` desired 0 / running 0. ALB left up (~$20/mo). Scale to 1 and wait 3–5 min before a partner session that needs Tier-2 |
| 15 | **Turn on `X402_METER_V1`?** Metering `/v1/chat/completions` is built and tested but off. It is the busiest surface and it is currently free compute. Turning it on **breaks plain OpenAI SDK clients**, which have no way to pay a 402 | Eng shipped the meter; this is a pricing/GTM call, not a technical one |
| 16 | **Ask AkashML four questions** (draft below) — they gate session affinity, cache economics, and a cross-tenant isolation claim we currently cannot verify | Eng probed everything answerable from outside; these are the residue |
| 17 | **Does the receipt product require x402 payment at all?** Today a receipt only exists for a paid task. A free signed receipt for any call would be a much wider wedge, and would decouple "verifiable" from "crypto-paid" | Raised by the pricing work; no code implication until you decide |
| Later | Guest v2 ELF + vKey; uptime monitor; Akash ACT float | Blocked on prover host / ops |

### Before you restart the gateway (item 3c)

Mocks are opt-in now, which is the point — but it means a provider that used to fall back silently
now fails visibly. Check these on the box (`services/gateway/.env`) *before* `systemctl restart`, or
the deploy will look like an outage:

| Var | Why it matters now |
|-----|--------------------|
| `RECEIPT_SIGNING_SECRET` | **Unset = every receipt is unsigned**, with no error. The receipt still renders and looks complete. This is the single highest-consequence one, and it is easy to have missed because nothing ever complained |
| `AKASHML_API_KEY` | Must start `akml-` (item 3e). Without it the Akash hub drops out of the catalogue, `xfuel/auto` degrades to Theta, and any tool-carrying request fails with `tools_unsupported_on_hub` — Theta cannot serve tools |
| `ALLOW_MOCK_INFERENCE` | Leave **unset** in production. Setting it to `true` restores the old behaviour of answering a paid task with a mock, which is the bug we just closed |

Then verify from your machine — one command, no JSON quoting:

```powershell
node scripts/dev/_verify_deploy.mjs https://api-testnet.xfuel.app
```

Twelve checks: the build is actually deployed, signing is on, the quote names the model it priced,
agent work clears its own COGS, the receipt is signed and identical inline vs canonical, and the paid
path reaches a real provider. It exits non-zero on any failure, so it can gate a deploy script.

### Draft: questions for AkashML (item 16)

Ask by email or in their Discord; all four are cheap for them to answer and each unblocks something
specific on our side.

1. **Do you honour `cache_salt` or `prompt_cache_key`?** We send both on every request to partition
   the prompt cache per buyer. If neither is honoured, our tenant isolation is unenforced and we
   need to know.
2. **Are prompt caches isolated per API key?** All XFuel traffic shares one key, so if the cache is
   per-account we get isolation from other Akash customers but **not between our own buyers** — the
   exact architecture CacheProbe found leaking up to 100% on OpenRouter.
3. **Is there a session-affinity mechanism** (a header, a key, a sticky endpoint)? Fireworks,
   Baseten and DeepInfra all expose one. Without it we cannot route a conversation back to the node
   holding its prefix.
4. **Will `usage` ever report cached tokens?** You publish an `input_cache_read` rate for GLM-5.2
   ($0.26/M against $1.40/M) and we can measure the speed-up, but nothing in the response says how
   many tokens hit. We cannot verify we received the discount, bill against it, or attest it.

Also worth flagging to them commercially: Llama 3.3 70B and GPT-OSS-120B have **no** cache-read rate
published while three other models do, which looks like an omission rather than a policy.

---

## Sprint 1 — Money + ICP (your side)

### Mainnet USDC go-live

Follow [MAINNET_X402_CHECKLIST.md](./MAINNET_X402_CHECKLIST.md).

- [x] Create Coinbase CDP project + Secret API Key (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`)
- [x] Fee sink on Base (`X402_PAY_TO=0x23f7…7334` — prefer upgrading to Safe / Splits later)
- [x] Live gateway: `X402_NETWORK=base`, CDP keys, `xfuel-api` on `services/gateway` (not theta-bridge)
- [x] Smoke: public flagship 2026-08-06 — task `ai-task-1-1786004600540` / tx `0x066caacc…db70`
- [x] RUNTIME_STATE flipped to Real (public Base mainnet)

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
| STRATEGY + provider float treasury + ADR 0005 | **Shipped** (build-from source) |
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
| Dependency cleanup: 15 of 17 dependabot PRs resolved | **Shipped** (2 left, both need the CJS→ESM pass) |
| Legacy removal: ~59.5k lines, OpenZeppelin on 5.6.1 | **Shipped** |
| Guest ELF rebuild + on-chain vKey | **Blocked on you / prover host** |
| Design partner keys + onboarding send | **Your Sprint 3 action** |
| Design partner logos / quotes | Blocked on outreach |
| Metered pricing (per-model rate card + floor) | **Shipped** 2026-08-12 — replaced flat $0.01 |
| Measured COGS from real tokens × live provider rates | **Shipped** 2026-08-12 — `basis: measured` on receipts |
| `/v1` receipts signed, byte-identical to `/receipt/:id` | **Shipped** 2026-08-12 |
| Paid path serves real compute; mocks are opt-in only | **Shipped** 2026-08-12 |
| Tool calling on `/task-request` (+ `max_tokens` passthrough) | **Shipped** 2026-08-12 — agent loops now work on the paid surface |
| `xfuel/auto` routes on request shape (agent vs short completion) | **Shipped** 2026-08-12 |
| `/stats` money windowed past the inflated pre-fix rows | **Shipped** 2026-08-12 |
| `/health` reports proof availability | **Shipped** 2026-08-12 — makes prover scale-to-zero safe to operate |
| x402 `upto` + batch-settlement | **Assessed, not built** — CDP supports both on Base mainnet; blocked on our x402 v1→v2 + Permit2 migration ([X402_SCHEME_MIGRATION.md](./X402_SCHEME_MIGRATION.md)) |
| The quote prices the model that actually serves | **Shipped** 2026-08-13 — the per-model rate card was being bypassed by `xfuel/auto`, the default request, so the −$0.075/call loss on agent work was still live a day after being marked fixed |
| `/v1` quotes capped output, not requested output | **Shipped** 2026-08-13 — asking above `OPENAI_GATEWAY_MAX_TOKENS_CAP` was billed at the uncapped figure (~$0.09 overcharge/call). Only reachable with `X402_METER_V1` on, which is off |
| Unsigned receipts are now visible instead of silent | **Shipped** 2026-08-13 — a missing `RECEIPT_SIGNING_SECRET` turned off Tier-1 verifiability with no warning anywhere. Now on `/health` (`receipts.tier1_signed`), warned at boot, and checked by the deploy probe |
| `scripts/dev/_verify_deploy.mjs` | **Shipped** 2026-08-13 — 12 HTTP checks against a *deployed* host. Every other probe boots its own server, so none could tell you what was live |

### Pre-outreach review (2026-08-10) — partner-facing fixes

Found by walking the protocol as a design partner would. All fixed in the repo;
**needs a gateway deploy + an SDK publish to reach partners.**

| Fix | Impact if left alone |
|-----|----------------------|
| Chat responses returned `{"message":"..."}` as the assistant content instead of plain text | Every OpenAI-client integration gets a JSON blob as the answer — the single worst first-impression bug |
| `xfuel/auto` routed to `qwen3` on the paid M2M path but `glm_5_2` on `/v1` | Same alias, two models; `qwen3` is currently at capacity (409), so the paid path failed while the free one worked |
| 401 / 429 on `/v1/*` used XFuel's flat error shape | OpenAI SDK clients throw an opaque error on a bad key or rate limit |
| Every SDK example + doc defaulted to retired `llama-3-70b` | First command a partner runs fails with `model_retired` |
| `quickstart` and `private-spend-budget` never passed a payer | Onboarding doc's primary path 402s on a real-money endpoint |
| Onboarding said `npx tsx node_modules/xfuel-sdk/examples/...` | Published package ships `dist` only — ENOENT |
| `xfuel-mcp` could not compile against published `xfuel-sdk` | `npx xfuel-mcp` (advertised in AGENTS.md) is unbuildable until 0.5.0 ships |
| x402 skill docs said mainnet was "pending CDP" | Partners plan against Sepolia when the endpoint settles real mainnet USDC |

### Dependency + security cleanup (2026-08-10)

Done before outreach on the reasoning that a breakage now costs engineering time,
whereas the same breakage during a partner trial costs the trial.

| Package | Vulnerabilities | Verification |
|---------|-----------------|--------------|
| `services/gateway` | **10 → 0** | 172/172 tests, plus a real boot on express 5 (health, `/v1/models`, 404, malformed POST) |
| `packages/mcp` | **5 → 0** | 30/30 tests |
| `packages/sdk` | **7 → 2** (both transitive, dev-only) | 72/72 tests + examples typecheck |
| repo root | **79 → 31, 2 critical → 0** | 824 contract tests, web app builds (40 → 31 after legacy removal) |

Notable: `snarkjs` (gateway) and `@thetalabs/theta-js` (root) were **imported nowhere**
but between them carried 5 high and 1 critical advisory, including a `lodash` critical
with no upstream fix. Removing them was the single largest win.

Gateway majors taken: express 4→5, redis 4→6, pino 9→10, `ws` (uninitialised memory
disclosure). Express 5 returns `undefined` rather than `{}` for an unparsed body, so
three handlers were hardened — a partner who forgets `Content-Type: application/json`
now gets a 400 instead of a 500.

**Resolved since:**

- **arkworks `ark-*` 0.4→0.6** — **landed** in `xfuel-zkp` and (then) `sp1-verifier`.
  Re-verified rather than bumped blind: the proving-gadget tests pass with no source
  changes, so no algebra-trait behaviour moved under the soundness-critical code.
- **`cw20` 1.1→2.0 / `cosmwasm-schema` 3.0** — **moot.** The question above ("confirm
  whether that contract is still live") was answered: it was not. The whole CosmWasm
  tree was dead and has been deleted (see legacy removal below).
- **TypeScript 7** — **landed for `packages/mcp`** (builds clean, 30/30). Still deferred
  for the SDK only, for the ts-jest reason below.

**Still deferred, with reasons:**

- **TypeScript 7 (SDK only)** — blocked upstream. ts-jest cannot use the TS7 native
  compiler, which no longer exposes the JS compiler API. The workaround needs two parallel
  TypeScript installs; not worth it for a published SDK. Revisit when ts-jest ships support.
- **Hardhat 2→3** (and `solidity-coverage`, `adm-zip`, `undici`, `tmp`) — the last 5 root
  highs. All build-time only: never in the gateway, the published packages, or the web
  bundle, so no partner is exposed. A real migration, worth scheduling on its own.
  Shares one prerequisite with **chai 6** (ESM-only vs the CJS test files), so both open
  dependabot PRs (#54, #59) are really a single CJS→ESM piece of work.

### Legacy removal (2026-08-11)

Deleted ~59.5k lines that could not run in production: `contracts/legacy/`,
`contracts/cosmwasm/` (3 crates), 9 gateway modules, and the three `_archive` trees.

Judged by deployment and reachability, not by test presence — the trap being that
retired code was kept alive by tests that never ran (`test/_archive` is skipped by the
runner, so those suites contributed 0 of the 824 passing tests). `scripts/dev/reachable-from-entrypoint.cjs`
reproduces the check: production runs `node src/server.js`, and the old Cosmos/Persistence
bridge hung off a second entrypoint that shares nothing with it.

Two side effects worth knowing:

- **OpenZeppelin 5.6 unblocked.** The 8 contracts pinning it to `~5.4.0` (they imported
  the removed `ReentrancyGuardUpgradeable`) were among the dead ones. Now on 5.6.1.
- **A latent bug surfaced.** `xfuel-sp1-hooks` declared serde with `default-features = false`
  and only compiled because workspace feature unification with the CosmWasm crates supplied
  `std`. It now declares what it needs.

The `.openzeppelin/` manifests were **kept**: they remain the only record of 30 abandoned
Theta mainnet proxies. Source for those is recoverable from git history if ever needed.
