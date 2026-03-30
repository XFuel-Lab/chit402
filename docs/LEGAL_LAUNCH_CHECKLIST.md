# Legal and compliance checklist (launch)

**This is not legal advice.** XFuel should **hire qualified counsel** in relevant jurisdictions before a public sale, token distribution, or broad retail marketing. This file is an **internal planning** aid only.

## Document inventory (counsel to draft or approve)

| Document | Typical contents | Host / link |
|----------|------------------|-------------|
| **Terms of Use** | Binding agreement for xfuel.app; limitation of liability; dispute resolution; no investment advice; software “as is”. | `/terms` or external URL linked from footer |
| **Privacy Policy** | Data collected (wallet, analytics, APIs), retention, subprocessors, GDPR/CCPA hooks if applicable. | `/privacy` |
| **Cookie / analytics notice** | If using Plausible, GA, etc. | Banner + policy |
| **Risk disclosure (funding)** | Short standalone or section: TFUEL risk, smart-contract risk, no guaranteed TGE, **Community** vs **Angel** differences. | `/believers`, `/angels` + linked doc |
| **Engagement program rules** | Eligibility, sybil policy, snapshot methodology, tax responsibility disclaimer (user’s obligation). | Docs site or `/docs` |

## General

- [ ] **Engage counsel** for: token / offering classification, **ToS**, **Privacy**, **jurisdiction** and **marketing** restrictions.
- [ ] **No investment contract framing** unless counsel approves a registered exemption path — prefer **utility**, **contribution**, and **protocol participation** language consistent with product reality.
- [ ] **Geoblock or disclaimers** for **sanctions** and **restricted territories** (implement per counsel).
- [ ] **Email / support** for legal requests: e.g. `legal@xfuel.app` or designated inbox (even if forwarded to counsel).

## Per-product disclosures (must match on-chain behavior)

### Community contribution (`BelieverRound` — xfuel.app `/believers`)

- [ ] **Refund:** if TGE not triggered within **180 days** of round open, users can **`requestRefund`** (native TFUEL) — explain in plain language.
- [ ] **Vesting:** cliff + linear schedule; **lock tiers** delay earliest claim — link to contract or explorer.
- [ ] **Caps:** **TFUEL hard cap** and **XF `xfAllocationCap`** (15% policy) — UI surfaces chain values; legal copy must not contradict.
- [ ] **Price changes:** multisig may call **`setTokenPrice`** while round is **Open** — users should know implied XF/TFUEL can change (see [`docs/PRICING_TFUEL_XF.md`](PRICING_TFUEL_XF.md)).

### Angel / strategic (`AngelRound` — `/angels`)

- [ ] **No on-chain refund** of TFUEL; **pre-TGE** use of funds via **`withdrawToTreasury`** with on-chain memo.
- [ ] **Suitability:** counsel may require **accredited / professional / non-US** restrictions — reflect in UI and eligibility flow if required.
- [ ] **Separate TGE** from Community round.

### Engagement rewards (`CommunityEngagementDistributor`)

- [ ] Not a **sale**; **Merkle claims** after eligibility — rules published before each **season**.
- [ ] **Anti-sybil** and **abuse** policy (right to exclude addresses per rules).

## Marketing and communications

- [ ] No **guaranteed returns**, **APY**, or **profit** promises for XF or rounds.
- [ ] **WHITEPAPER**, **pitch deck**, and **social** copy aligned with **deployed** contracts and caps.
- [ ] **Testnet vs mainnet:** if promoting testnet activity, label clearly **not real funds** / **not the offering**.

## Technical / ops

- [ ] **Contract ownership** = documented multisig; **admin** changes logged.
- [ ] **Incident response:** `security@xfuel.app`, [`docs/bug-bounty.md`](bug-bounty.md).
- [ ] **Audit readiness:** [`docs/AUDIT_READINESS_CHECKLIST.md`](AUDIT_READINESS_CHECKLIST.md) (parallel workstream).

## Audit & third parties

- [ ] Auditor **engagement letter** defines scope (see **WHITEPAPER §11.5**).
- [ ] **Findings remediation** tracked; **public summary** or report link when appropriate.

## When using AI-generated drafts

- [ ] **Counsel review** of every user-facing legal page before publish. Repository markdown is **not** a substitute.
