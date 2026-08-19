# First-hour house plan

Living register for the 2026-08-19 MCP trial and GTM scan. When a box is checked, the finding is closed in **repo + published surface** (npm / xfuel.app / api host). A git fix that is not deployed or published is still open.

Related: [STRATEGY.md](./STRATEGY.md) · [POSITIONING.md](./POSITIONING.md) · [RUNTIME_STATE.md](./RUNTIME_STATE.md) · [BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md) · [HOSTED_TESTNET_ENDPOINT.md](./HOSTED_TESTNET_ENDPOINT.md)

**Done when:** a stranger who follows published words (site, npm README, `tools/list`, `/llms.txt`) gets a completion and an honest receipt, is never told a path is free / Sepolia / Groq when it is paid / mainnet / Theta+Akash, and is never steered into real USDC without an explicit payer key.

**Not this plan:** catalog expansion, `X402_METER_V1`, guest v2, token/TGE, Eliza Discord launch, images/audio MCP, streaming MCP.

---

## Copy lock (first-hour)

Use this on the site, MCP initialize, `/llms.txt`, and outreach. Keep “Route any model. Prove every dollar.” for a later deck once payment binding is in-proof and someone has paid. Do not use it as the homepage subtitle.

**First-hour line:** Swap one baseURL. Every call comes back with a public receipt that names the model, the hub, and the cost. `/v1` is unmetered (demo key, rate-limited). USDC on Base is a separate paid door. No wallet to try.

**Say:** Theta + Akash live catalog; `xfuel/auto`; signed receipt (HMAC) default; SP1 on demand, $2 COGS gate or explicit `proof_tier`; **Base mainnet** USDC if you pay; hostname still says testnet.

**Do not say:** Groq / Together / Fireworks / OpenAI as live routes; default unmetered MCP submit; Sepolia as the live pay network; prove every dollar on the HMAC path; MCP as the inference install until `chat_completions` is **published**.

---

## Phases

Work in this order. Phase 0 can land on the current Vite app the same week Phase 2 starts. Do not invite anyone until Phase 0 + Phase 1 are **published**.

| Phase | Job | Public when |
|-------|-----|-------------|
| 0 | Stop the lies on the surfaces a bot hits first | Site + `/llms.txt` + READMEs deployed |
| 1 | MCP and SDK can generate text without 402 or a mock payer | `xfuel-sdk` then `xfuel-mcp` published |
| 2 | Replace the legacy SPA with a site that matches the product | `xfuel.app` cutover |
| 3 | Money hostname and health leak | DNS + gateway deploy |
| 4 | GTM motion (only after 0–2) | First DMs |

---

## Phase 0 — Honesty on current surfaces

Close every first-hour lie without waiting for the new site.

### Site (current Vite, [apps/web](../apps/web))

- [ ] Homepage no longer lists OpenAI / Groq / Together / Fireworks as live routes
- [ ] Homepage no longer leads with veXF / subchain / Bittensor / Aptos / “any model”
- [ ] Banner: demo API hostname says testnet; **payments are Base mainnet USDC**; do not send funds unless you mean to
- [ ] Docs page “Try the demo” is `/v1` + `xfuel-demo` + `xfuel/auto`, not `createMockPayer` / Sepolia / flagship paid script
- [ ] Docs SDK version string is not stale `0.2.0`
- [ ] License on the site is Apache-2.0 (repo truth), not MIT
- [ ] Nav does not lead with Bridge / Governance / Circuits / GPU hub / Staking / Treasury / Grants
- [ ] OG / meta subtitle is not “Prove every dollar” until the receipt can attest a dollar

### MCP / SDK copy (repo; publish in Phase 1)

- [ ] [packages/mcp/README.md](../packages/mcp/README.md): `submit_inference` is **paid** `/task-request`; 402 without a payer
- [ ] Amount is “USDC 6 decimals; `10000` = $0.01”, not wei
- [ ] `get_my_stats` says demo key is the shared wallet
- [ ] [packages/sdk/README.md](../packages/sdk/README.md): first snippet is `/v1` (or `chatCompletions`), not `createMockPayer()` against the live host
- [ ] Version lockstep: `SERVER_VERSION` = `package.json` = `server.json`

### Gateway discovery

- [ ] [services/gateway/src/server.js](../services/gateway/src/server.js) `LLMS_TXT`: MCP stanza; `/v1` vs `/task-request`; mainnet money warning
- [ ] `/.well-known/x402` description does not say “prove every dollar” on the HMAC path
- [ ] Receipt HTML tagline matches copy lock

### Health / token leak

- [ ] `GET /health` does not advertise XF buyback-burn / 40-35-25 buckets with **null** addresses as if live. Either omit empty buckets or mark them `post_tge: true` and hide from the default payload

---

## Phase 1 — Install paths that work

A first-hour MCP or SDK client must complete “Say hello in 5 words” without GitHub and without a payer key.

### Why MCP is dead today (do not close this section until published)

1. `submit_inference` has no `messages` / `input` — cannot send a prompt.
2. It wraps `POST /task-request` with SDK default `payment.rail: 'usdc'` → live host **402**.
3. README calls that the “default unmetered path.” Unmetered is REST `/v1` only.
4. `pay_with_usdc` is listed even with no key; if a key is set it spends **real USDC on Base**.
5. Initialize `instructions` is null — no workflow at handshake.
6. npm `0.2.1` reports initialize `0.1.1`.

### MCP ([packages/mcp](../packages/mcp))

- [ ] `chat_completions` tool → `POST /v1/chat/completions` (`messages` required, `model` default `xfuel/auto`)
- [ ] Returns completion + `xfuel.task_id` / `verify_url`; do not block on SP1
- [ ] `McpServer` `instructions`: list_models → chat_completions for text; paid tools are a different door
- [ ] `pay_with_usdc` registered **only** if `XFUEL_PAYER_PRIVATE_KEY` is set; `destructiveHint: true`
- [ ] `submit_inference` forwards `messages` / `input` / `max_tokens`; description says 402 without payer
- [ ] `quote_task` prefers `model`; warn when `priced_model` is null (unknown id still prices $0.01 today)
- [ ] `list_models` documents extra fields; unmetered vs paid is the **tool**, not a per-id flag
- [ ] Bump **0.3.0**; depend on `xfuel-sdk@^0.5.4`

### SDK ([packages/sdk](../packages/sdk))

- [ ] `XFuelClient.chatCompletions()` → `POST /v1/chat/completions`
- [ ] ESM: `"type": "module"` **or** dual CJS/ESM publish so default `import` works (scan: CJS-only, `exports.import` points at CJS)
- [ ] Bump **0.5.4**; changelog; README first path is unmetered `/v1`
- [ ] Founder publish order: SDK then MCP (WebAuthn; CI does not publish)

### Agent docs

- [ ] [packages/agent-skills/AGENT_PLAYBOOK.md](../packages/agent-skills/AGENT_PLAYBOOK.md) Flow 0b: MCP chat
- [ ] [AGENTS.md](../AGENTS.md) demo path mentions MCP `chat_completions` only after publish

---

## Phase 2 — Frontend overhaul

The current [apps/web](../apps/web) Vite SPA is the first impression. Client routes (`/docs`, `/pricing`, `/about`) collapse to the same shell for fetchers and many agents. Nav is a 2025 token/DePIN product. That is the table. Rebuild it.

### Decision

Replace the Vite + react-router SPA with a **Next.js App Router** app on the same Vercel project (`xfuel.app`). Real URLs, real HTML for `/`, `/docs`, `/pricing`, `/security`. No wallet button on first paint. No Theta player.

Keep using the existing gateway as the data source. The site is a clean table over live `/v1` and `/health`, not a second protocol.

### Information architecture (public)

| Route | Job |
|-------|-----|
| `/` | First-hour line, money banner, curl / OpenAI `baseURL` snippet, live catalog from `GET /v1/models`, one example `verify_url` |
| `/docs` | Hosted start: auth, `/v1`, receipts, paid `/task-request`, MCP after Phase 1 publish. Not a wall of GitHub links |
| `/pricing` | Cost-plus 10%, $0.01 floor, Tier-2 +$0.08, `/v1` unmetered + demo limits, what HMAC vs SP1 attests |
| `/security` | Pre-audit, safe-harbour bounty, verifier address, what we do **not** claim |
| `/protocol` | Optional, last in nav: token / veXF / circuits **explicitly not live** — or omit until TGE |

### Delete from public nav (do not rebuild)

Bridge, Governance (live lock UI), Circuits catalog, GPU hub / ThetaAI + EdgeCloud player, Staking, Treasury buckets, Grants, Community-as-token, Believers, Angels, EscrowAdmin, Wallet connect as primary CTA.

Old files can stay unlinked under `apps/web-legacy` for git history, or be deleted in the cutover PR. They must not be reachable from header/footer.

### Live, not hardcoded

- Catalog: `GET https://api-testnet.xfuel.app/v1/models` (hub, availability, pricing). If a hub is `no_capacity`, show that. Do not invent OpenAI/Groq rows.
- Health: status, demo limits, rolling settlement one-liner, **not** null token splits.
- Optional: `/stats` north-star with “includes demo/shared key” caveat.

### Visual bar

One typeface, one accent, no neon “DePIN casino” chrome. Hero is the try snippet, not a 14-item nav. Mobile: three links (Docs, Pricing, Security) + GitHub.

### Cutover

- [ ] New app builds on Vercel preview
- [ ] `/docs` `/pricing` `/security` return distinct HTML (not the 1.3 KB SPA shell)
- [ ] Production `xfuel.app` + `www` + `xfuel-protocol.vercel.app` all point at the new app
- [ ] GitHub org homepage field updated off the old shell
- [ ] Seed readiness “public site scrubbed” box can be checked

---

## Phase 3 — Host and ops (founder + eng)

- [ ] Public hostname that does not say testnet (`api.xfuel.app` or equivalent) **or** a loud, unmissable banner on every HTML/JSON discovery doc until DNS exists
- [ ] `HOSTED_TESTNET_ENDPOINT.md` title/body match the banner
- [ ] Redeploy gateway after `/llms.txt` + health changes
- [ ] Confirm `RECEIPT_SIGNING_SECRET` still set (unsigned receipts look complete)
- [ ] License strings agree: Apache-2.0 everywhere public

---

## Phase 4 — GTM after the table is clean

Do not start this phase against the current site or `xfuel-mcp@0.2.1`.

- [ ] Outreach templates already lead with baseURL + receipt (keep that). Swap the site link only after Phase 2 cutover
- [ ] Hunt list contacts filled ([BEACHHEAD_ICP.md](./BEACHHEAD_ICP.md))
- [ ] Offer: partner key, `/v1` first, paid door later. Do not lead MCP until 0.3.0 is on npm
- [ ] Success: 3 design partners, `paid_tasks_7d` that is not founder TFUEL

---

## Findings register

Every scan/trial item. Close here when the matching phase box is done **and** live.

### MCP trial (2026-08-19)

| # | Finding | Phase | Closed |
|---|---------|-------|--------|
| M1 | No chat/completions MCP tool; unmetered is REST only | 1 | [ ] |
| M2 | `submit_inference` has no prompt; 402 on live host | 1 | [ ] |
| M3 | README “default unmetered path” is false | 0 | [ ] |
| M4 | Package 0.2.1 vs initialize 0.1.1 | 1 | [ ] |
| M5 | `quote_task` prices unknown models at $0.01 with no warning | 1 | [ ] |
| M6 | `model` vs `model_id` split | 1 | [ ] |
| M7 | Initialize `instructions` null | 1 | [ ] |
| M8 | `pay_with_usdc` visible without consent / key | 1 | [ ] |
| M9 | No unmetered flag on model ids (document: endpoint, not id) | 1 | [ ] |
| M10 | `get_my_stats` is shared demo key | 0 | [ ] |
| M11 | Amount documented as wei | 0 | [ ] |
| M12 | `/llms.txt` does not mention MCP | 0 | [ ] |
| M13 | Units / fee_bps 50 vs 1000 (document: health vs quote; do not “fix” into one number) | 0 | [ ] |
| M14 | Chat body `proof_outcome=pending` vs later valid (document, do not wait in the chat tool) | 1 | [ ] |
| M15 | Output hash chat vs later status (investigate only if a partner hits it) | later | [ ] |

### GTM scan (2026-08-19)

| # | Finding | Phase | Closed |
|---|---------|-------|--------|
| G1 | Site overclaims frontier catalog | 0 + 2 | [ ] |
| G2 | `/docs` `/pricing` `/about` are the same SPA shell | 2 | [ ] |
| G3 | SPA still Theta player, veXF, SAFE, token sales residue | 2 | [ ] |
| G4 | GitHub org homepage = old Vercel shell | 2 | [ ] |
| G5 | HMAC receipts sold as “prove every dollar” | 0 + 2 | [ ] |
| G6 | MCP not adoptable as inference | 1 | [ ] |
| G7 | SDK CJS/ESM + mock payer vs live mainnet | 1 | [ ] |
| G8 | Sepolia in README/SPA vs mainnet x402 | 0 + 3 | [ ] |
| G9 | `api-testnet` hostname vs real USDC | 3 | [ ] |
| G10 | Health publishes 40/35/25 with null addresses | 0 | [ ] |
| G11 | Governance page “demo data” | 2 | [ ] |
| G12 | License strings disagree | 0 + 2 | [ ] |
| G13 | No hosted docs / OpenAPI (hosted `/docs` in Phase 2; OpenAPI optional later) | 2 | [ ] |
| G14 | Volume is founder-scale (not an eng fix; Phase 4 metric) | 4 | [ ] |
| G15 | First-hour product is `/v1` proxy + receipt — site must say that | 0 + 2 | [ ] |

---

## Suggested build slices (eng PRs)

Keep PRs small enough to publish.

1. **Honesty PR** — Phase 0 copy on Vite site, MCP/SDK READMEs, `LLMS_TXT`, health payload, receipt tagline.
2. **SDK 0.5.4** — `chatCompletions` + ESM fix + README.
3. **MCP 0.3.0** — `chat_completions`, instructions, gate payer tool, version lockstep.
4. **Founder publish** — npm SDK then MCP; gateway deploy.
5. **New site** — Next.js IA above; Vercel preview; then production cutover.
6. **Hostname** — DNS + banner until it exists.

---

## Acceptance test (repeat the bots)

After publish + site cutover, rerun without the GitHub repo:

1. `GET https://xfuel.app/` — first-hour line, live catalog, mainnet warning, no Groq/veXF hero.
2. `GET https://xfuel.app/docs` — distinct HTML, `/v1` snippet works when pasted.
3. `GET https://api-testnet.xfuel.app/llms.txt` — both doors named.
4. `npx xfuel-mcp` (published) → `list_models` → `chat_completions` “Say hello in 5 words.” → 200, `rail=unmetered`.
5. `submit_inference` without payer → 402 with text that does **not** say unmetered.
6. `pay_with_usdc` absent from `tools/list` without a payer key.
7. `npm install xfuel-sdk` default ESM import works; README does not demo mock payer on the live host.
