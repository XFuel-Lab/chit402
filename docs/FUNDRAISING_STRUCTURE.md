# Fundraising Structure — Working Draft for Founder + Counsel

> **Status:** Proposed (working draft — NOT executed). Supersedes the single-open
> token-sale model (`BelieverRound` / `AngelRound` as the raise vehicle).
> **Date:** 2026-07-15
> **Related:** ADR 0001 (token-light revenue), `docs/tokenomics-reconciliation.md`,
> `docs/LEGAL_LAUNCH_CHECKLIST.md`.

> ⚠️ **Not legal or financial advice.** Instruments, securities exemptions, entity, and
> jurisdiction must be set with a startup/crypto attorney. This doc defines the *shape* to
> take to counsel — it is not an offer, and no terms here are final.

---

## 1. Why restructure

The current design is a **community token sale** (sell XF for TFUEL, single open round)
being used as if it were a venture raise. It has no stage gating, no valuation, no
use-of-funds, no milestone discipline, and a volatile (TFUEL) denomination. No funds have
been accepted. We are repositioning to the standard 2026 playbook: **equity-first, USDC,
staged, token-light.**

## 2. Principles

1. **Equity-first.** Raise on **SAFEs (in USDC)** with a **token warrant / side letter**
   granting pro-rata XF at TGE. Defers token-securities exposure; most fundable.
2. **USDC denomination.** Removes price risk on the raise; matches USDC-on-Base revenue.
3. **Staged with gates.** Pre-seed → seed → community token round, each unlocked by
   milestones, not vibes.
4. **Token-light story.** Pairs with ADR 0001: "a fee-collecting business with an
   adjustable buyback flywheel" — not "buy our yield token."

## 3. Stage ladder

| Stage | Instrument | Denom | Size (illustrative) | Unlock gate |
|---|---|---|---|---|
| **Pre-seed** | SAFE (uncapped or high cap) **+ token warrant** | USDC | ~$250K–$1M | Now — conviction angels |
| **Seed** | Priced equity **or** capped SAFE + token side letter | USDC | ~$1–5M | Working product + traction (mainnet, first USDC revenue, audit underway) |
| **Community "Believer" round** | On-chain token sale (existing contracts, repurposed) | USD-priced (USDC/TFUEL accepted) | Capped | Post-product, legal structure in place, tokenomics consistent |

*Sizes are placeholders for counsel/market calibration, not commitments.*

## 4. Token cap table (reconciled)

XF fixed supply: **1,000,000,000**. The key change: a **dedicated Investors bucket** for
pre-seed/seed (via SAFE/warrant), repurposed from the old "Angel/Strategic" token-sale
bucket.

| Allocation | % | XF | Notes |
|---|---|---|---|
| Investors (pre-seed + seed, SAFE/warrant) | 10% | 100,000,000 | **was "Angel/Strategic"**; now equity-first warrant pool |
| Community round (Believers) | 15% | 150,000,000 | later on-chain sale, post-product |
| Engagement rewards | 15% | 150,000,000 | Merkle seasons (not a fee-share) |
| Ecosystem & partnerships | 20% | 200,000,000 | governance-approved |
| Team & founders | 15% | 150,000,000 | 12mo cliff + 36mo linear |
| Protocol treasury | 15% | 150,000,000 | DAO/veXF-controlled |
| Liquidity (LP seed) | 10% | 100,000,000 | at TGE |

*Equity % (company ownership) is a separate cap table set at the priced round — do not
conflate token % with equity %.*

## 5. Use of funds (18-month, illustrative)

| Category | Share | Purpose |
|---|---|---|
| Engineering | ~40% | Prover infra, gateway, verifier, circuits, SDK/MCP |
| Security & legal | ~20% | Audit(s), entity setup, securities counsel, compliance |
| Growth & BD | ~20% | Agent/provider integrations, x402 ecosystem, docs/demos |
| Ops & infra | ~10% | Cloud/prover compute, monitoring |
| Reserve | ~10% | Runway buffer |

## 6. Milestone ladder (stage gates)

- **Pre-seed → Seed:** mainnet verifier live + first real USDC settlement e2e + audit engaged + entity formed.
- **Seed → Community round:** completed audit + meaningful task volume + consistent, counsel-reviewed tokenomics + legal opinion on the token sale.

## 7. Fate of the existing on-chain rounds

- **Pause now** (no commits) — `BelieverRound.pause()` / `AngelRound.pause()` (both are
  `Pausable`, `DEFAULT_ADMIN_ROLE` = the Safe). See §8.
- **Confirm real deployment state first.** The `mainnet-activation-*.json` manifests use
  **local Hardhat deterministic addresses** (e.g. `0x9A676e…`, `0x0B306…`) — almost
  certainly dry runs, not live mainnet. The real production address (if any) is in the app
  production env (`VITE_BELIEVER_ROUND_ADDRESS` / `VITE_ANGEL_ROUND_ADDRESS`) or the Safe's
  tx history. **If nothing is live, there is nothing to pause — just don't launch it.**
- **Repurpose, don't reuse as the venture vehicle:** `BelieverRound` → later *community*
  round (repriced in USD, terms consistent with token-light). Pre-seed/seed run **off-chain
  via SAFE** — no contract needed now. `AngelRound` (token-sale-for-TFUEL, no refund) is
  **retired** in favor of the seed SAFE; angels become seed investors on paper.

## 8. Pause runbook (Safe executes — no keys handled here)

For each **real, live** round contract, submit a Safe transaction:

```
to:    <live round address on Theta mainnet>   # confirm per §7 — NOT the Hardhat manifest addrs
value: 0
data:  0x8456cb59                              # pause()  (no args)
```

`pause()` requires `DEFAULT_ADMIN_ROLE`. It blocks new `commit()` /
`commitWithLock()` and is fully reversible via `unpause()` (`0x3f4ba83a`). Existing
commitments (if any) are untouched. Verify afterward with `paused() == true`.

### 8a. Admin-key finding — on-chain pause not currently executable

Diagnosed via `believer/pause-rounds.mjs` (audits which stored key holds the role):

- The rounds' admin is **`0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257`**.
- **Neither key in root `.env.local`** holds `DEFAULT_ADMIN_ROLE` — `TREASURY_PRIVATE_KEY`
  (`0xe49b47…43bd`) and `DEPLOYER_PRIVATE_KEY` (`0xDC17Cbd2…d33c`) are both different wallets.
- The admin address has **no contract code on Theta mainnet**, so it is **not a live Gnosis
  Safe on Theta** — it behaves as a plain wallet whose key we don't currently have.

**Therefore `pause()` cannot be sent right now.** Because exposure is trivial (~1.1 TFUEL,
founder's own; zero external commitments), the rounds were instead **neutralized by removing
them from the public UI** (nav + home + community + security links; `/believers` and `/angels`
redirect home). The contracts stay `Open` on-chain but are unreachable from the site.

**To actually pause / transfer admin later:** locate the key for `0x9D6fC5…7257` (likely a
MetaMask account) and run `ROUND_ADMIN_PK=0x… node believer/pause-rounds.mjs --execute`, or —
if that address turns out to be a Safe deployed on another chain — resolve admin ownership
before any community-round relaunch.

## 9. Open items for counsel

- Entity: Delaware C-corp (± offshore foundation for the token later)?
- Exemption/jurisdiction for the SAFE raise (e.g. Reg D 506(c) / Reg S) and for a future token sale.
- SAFE + token warrant / side-letter templates; token classification opinion.
- Custody / money-transmission review for provider collect-and-forward (from ADR 0001).
- Whether the community token round needs a separate offering memorandum.
