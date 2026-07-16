# Tokenomics Reconciliation — Redline for Founder + Counsel Review

> **Status:** Proposed (review artifact — NOT yet applied to source docs)
> **Date:** 2026-07-15
> **Trigger:** ADR 0001 (token-light revenue) + the decision to defer staker fee-share.
> **Purpose:** Catalog every representation that promises a **fixed fee-share / "real
> yield" to stakers** (the 30/30/25/15 model) so it can be reworded to the token-light
> model *before any funds are accepted*. **No round has taken funds yet** — this is a
> pre-launch consistency fix, not a remediation of live commitments.

> ⚠️ **Not legal advice.** The rewording below is drafted for founder + counsel review.
> Do not edit investor-facing decks that have been circulated without counsel sign-off.
> Fee/yield activation should pass `docs/LEGAL_LAUNCH_CHECKLIST.md` before mainnet.

---

## 1. The problem in one line

Multiple docs promise **"25% of protocol fees as real yield to veXF stakers, every
epoch"** (part of a hardcoded 30/30/25/15 split). A proportional, passive fee-share to
token holders is the textbook Howey-style securities signal — and it contradicts the
model we've since chosen. The **on-chain sale contracts do NOT contain this promise**
(verified — see §4), so the exposure is entirely in off-chain representations.

## 2. Target wording (token-light north star)

Use this as the canonical replacement everywhere the old split appears:

> **Revenue model.** XFuel is a fee-collecting business. Protocol fees accrue in **USDC
> (x402 on Base)** to the protocol treasury and fund operations + growth. A
> **governance-adjustable** slice (default ~15%, treasury-set) funds **XF buyback-and-burn
> on Theta** — the token's value-accrual flywheel, benefiting all holders via supply
> reduction. **veXF is a governance token** (vote on parameters, treasury, circuit
> priority); it does **not** entitle holders to a fixed share of fees. Any future staker
> reward is a **separate, deferred** governance decision, subject to legal review.
> Allocations live in a governance-owned **Splits v2** Split (Base), adjustable without a
> redeploy — there is **no hardcoded per-fee split**.

Short forms:
- Fee table → **"Treasury (business) · governance-set buyback-burn (~15%, adjustable)."**
- Token utility "Yield" row → **remove**; replace with "Deflationary: governance-set
  buyback-burn (adjustable)." Keep "Governance" and "Access" rows.
- Never use: "real yield", "X% of fees to stakers/holders", "every epoch", "passive income", "APY" (for XF).

## 3. Redline catalog (by priority)

### Tier A — Investor-facing decks (fix BEFORE any raise; highest legal priority)

| Location | Current claim | Proposed |
|---|---|---|
| `docs/grants/PITCH-DECK.md:189–192` (Slide 7 table) | 30% BBB / 30% GET / **25% "veXF Staker Rewards — Real yield … every epoch"** / 15% Ops | Replace whole table with §2 token-light revenue slide (treasury + adjustable buyback; no yield row) |
| `docs/grants/PITCH-DECK.md:224–226` (Token Utility) | **"Yield — 25% of all protocol fees to veXF holders"**; "Deflationary — 30% buyback" | Drop the Yield row; "Deflationary — governance-set buyback-burn (~15%, adjustable)"; keep Governance/Access |
| `pitch-deck.md:44` | "Fee to CoreRevenueSplitter (30% burn, 30% LP, **25% stakers**, 15% treasury)" | "Fee → treasury (USDC/Base); governance-set buyback-burn; no staker fee-share" |
| `pitch-deck.md:83` | "Staker Rewards — 25%" | Remove row / replace with buyback line |
| `docs/grants/YZI-LABS-PITCH-DECK.md` | Contains 30/30/25/15 + yield framing (scan) | Same as above |

### Tier B — Canonical protocol docs (source of truth)

| Location | Current claim | Proposed |
|---|---|---|
| `WHITEPAPER.md:570` | **"veXF Stake Rewards — 25% — Real yield distributed to governance lockers every epoch"** | Remove yield row; veXF = governance; buyback row only |
| `WHITEPAPER.md:292` (§5.2 "Revenue Split (30/30/25/15)") | Whole section built on 30/30/25/15 | Rewrite §5.2 as "Revenue: fee collection + adjustable buyback" (§2) |
| `WHITEPAPER.md:64,575` | "30/30/25/15 revenue split", GET/Fee-to-Stake framing | Reword to token-light; note CoreRevenueSplitter deprecated (ADR 0001) |
| `AGENTS.md:126–132` (Fee Distribution table) | BBB 30 / GET 30 / **Stakers 25 "Yield to XF lockers"** / Treasury 15 | Replace table with §2 model |
| `docs/POSITIONING.md:95` | "CoreRevenueSplitter distributes 30% BBB · 30% GET · 25% veXF · 15% treasury" | "Fees → treasury (USDC/Base); adjustable buyback-burn; splitter deprecated (ADR 0001)" |
| `CONTRIBUTING.md:364` | "contributors may receive protocol **fee share** (30/30/25/15 … veXF …)" | "contributor rewards via the Engagement program (grants/Merkle) — not a fee-share entitlement" |
| `CHANGELOG.md:137` | "Revenue split finalized: 30/30/25/15" | **Keep (historical)**; supersede via a new CHANGELOG entry pointing to ADR 0001 |

### Tier C — Reference / integration docs (mechanical)

`docs/M2M_API.md:114,222,351,378`, `docs/CIRCUITS.md:3`, `docs/Growth-Expansion-Treasury.md`,
`docs/Technical-Specifications.md:363`, `docs/routing-mitigations-design.md` (25% veXFYield
mechanics), `docs/governance/COSMWASM_GOVERNANCE_PROPOSAL.md:60`,
`packages/agent-skills/_shared/reference/payments-x402.md:97`, `docs/THETA_INTEGRATION_PLAN.md:446,622,744`.
→ Replace 30/30/25/15 descriptions with the token-light line; mark `CoreRevenueSplitter`
as **deprecated go-forward (ADR 0001)** where it's cited as the live fee path.

### Tier D — Code / tests / deploy / UI (no external promise; lower priority)

- **Public UI (medium):** `apps/web/src/pages/Dashboard.tsx:301` ("Revenue breakdown (demo split 30/30/25/15)"), `apps/m2m-dashboard/src/components/TaskSimulator.js:298`, `FeeVisualizer.js` — relabel to the token-light model or clearly mark "illustrative, not a fee-share promise."
- **Deploy scripts:** `deploy/{full,mainnet,core}.cjs`, `believer/launch-round.cjs` reference `STAKER_ADDRESS`/"25%" — update comments; the go-forward path uses the Splits v2 Split, not `CoreRevenueSplitter`.
- **Tests / contracts (internal):** `fee.unit.test.js`, `test/ai-depin/integration.test.cjs`, `test/phase3/CoreRevenueSplitter.test.cjs`, `RevSplitterHybridV2.test.cjs`, `services/sp1-prover/.../tests.rs`, `contracts/cosmwasm/revenue-splitter/*`, `contracts/legacy/*` — these exercise the **deprecated** splitter; leave until that path is formally retired, then delete/relabel.

## 4. On-chain contracts — verified clean (no change needed)

- `contracts/circuits/BelieverRound.sol` — promises only: XF/TFUEL price, 90d cliff + 270d
  linear vesting, lock bonuses (+8/20/35%), **full TFUEL refund if TGE not triggered within
  180 days**. `Pausable`. **No yield/fee-share promise on-chain.**
- `contracts/circuits/AngelRound.sol` — same vesting; **no refund path** + admin
  `withdrawToTreasury` pre-TGE. `Pausable`. No yield/fee-share promise on-chain.
- `CoreRevenueSplitter.sol` + `contracts/legacy/RevSplitterHybrid*.sol` implement 30/30/25/15
  but are **deprecated from the go-forward fee path (ADR 0001)**; harmless on testnet.

## 5. Remediation checklist

- [ ] Counsel review of this redline (esp. Tier A) before any raise reopens.
- [ ] Apply Tier A rewording to decks (founder + counsel sign-off).
- [ ] Apply Tier B canonical rewording (WHITEPAPER §5.2, AGENTS fee table, POSITIONING, CONTRIBUTING); add superseding CHANGELOG entry.
- [ ] Sweep Tier C reference docs (mechanical; can be one PR).
- [ ] Relabel public UI split displays (Tier D medium).
- [ ] Update `revenue-split.js` defaults + ADR 0001 note to the confirmed 85 / 15 / 0 posture.
- [ ] Confirm rounds remain paused (no commits) until representations are consistent.
