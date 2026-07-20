# Growth & Expansion Treasury (GET) — Full Mechanics

> **Whitepaper reference:** [Section 5.3](../WHITEPAPER.md#53-growth--expansion-treasury-get--the-ai-depin-growth-engine)
> **On-chain contract:** `CoreRevenueSplitter.sol` → `getBps = 3000` (30% of distributed fees)

---

## Overview

The **Growth & Expansion Treasury (GET)** is XFuel Protocol's self-sustaining growth engine — a 30% allocation of all distributed protocol fees, purpose-built for the AI DePIN era. It replaces the legacy "Liquidity Provision" bucket with a structured, community-governed fund that fuels machine incentives, deepens liquidity, and empowers autonomous agents to propose and fund their own grants.

GET is designed around one principle: **every dollar should either grow the network or be burned trying.**

---

## Sub-Breakdown

| Sub-Bucket | Share of GET | Effective Share of Total Fees | Purpose |
|------------|-------------|-------------------------------|---------|
| **Machine & Agent Incentives** | 50% | ~14.7% | Compute subsidies, inference routing rewards, volume-triggered AI boosts |
| **LP Boost** | 30% | ~8.8% | AMM pool deepening, concentrated liquidity strategies |
| **Agent-Driven Grant Proposals** | 20% | ~5.9% | Community-governed micro-grants, auto-burn unused after 6 months |

*Effective shares are calculated on the GET allocation (30% of total protocol fees).*

---

## Machine & Agent Incentives (50% of GET)

The largest GET sub-bucket powers the core AI DePIN flywheel — incentivizing compute providers, inference routers, and autonomous agents to participate in the network.

### What It Funds

- **Compute subsidies** — Reduced-fee or free compute credits for new operators onboarding GPU/TPU resources to the network
- **Inference routing rewards** — Bonus payouts for agents that efficiently route inference tasks across the lowest-cost, lowest-latency nodes
- **Agent swarm bounties** — Rewards for multi-agent task completion (e.g., dataset curation, model evaluation, cross-chain arbitrage)
- **M2M payment incentives** — Fee rebates for machine-to-machine micropayments settled through the x402 escrow system

### Volume-Triggered AI Boosts (AI Treasury 2.0)

Machine & Agent Incentives includes a built-in volume-triggered boost mechanism that automatically scales rewards as network utilization grows:

| Monthly Protocol Volume | Boost Multiplier | Effect |
|------------------------|-------------------|--------|
| < $50K | 1.0x (baseline) | Standard incentive rates |
| $50K – $200K | 1.5x | 50% bonus on compute subsidies and routing rewards |
| $200K – $1M | 2.0x | Double incentives, unlocks agent swarm bounty pool |
| > $1M | 2.5x | Maximum boost, unlocks research grant co-funding |

Boost levels are determined by the protocol's on-chain volume oracle. Boosts apply to the **distribution rate** of Machine & Agent Incentives, not the allocation percentage — the 50% share remains constant, but accumulated funds are disbursed faster at higher volumes.

---

## LP Boost (30% of GET)

Ensures XF trading pairs maintain tight spreads and deep liquidity across all supported DEXes and chains.

### Strategy

- **Concentrated liquidity positions** on primary XF/USDC and XF/TFUEL pairs (Uniswap V3 style ranges)
- **Multi-chain LP seeding** across Theta, Bittensor EVM, and Osmosis pools
- **Rebalancing automation** via keeper bots that adjust tick ranges based on volatility and volume
- **LP reward stacking** — LP Boost funds are paired with protocol-owned XF to create protocol-owned liquidity (POL), ensuring permanent baseline depth

### Guardrails

- Maximum single-pool concentration: 40% of LP Boost allocation
- Minimum 3 active pools across at least 2 chains
- Quarterly performance review by governance — underperforming pools can be rebalanced via veXF vote

---

## Agent-Driven Grant Proposals (20% of GET)

The most innovative sub-bucket: a community-governed micro-grant system where **autonomous agents and veXF holders** can propose, vote on, and fund protocol growth initiatives.

### How It Works

1. **Proposal submission** — Any address holding ≥10 veXF can submit a grant proposal with a title, description, requested amount (capped at 5% of current Agent Grant balance), and milestone deliverables
2. **Agent co-proposals** — Registered autonomous agents (via the A2A circuit) can submit proposals programmatically, enabling machine-driven ecosystem expansion
3. **Voting period** — 7-day voting window using veXF voting power (same mechanism as governance proposals)
4. **Quorum** — 5% of total veXF supply must participate for the vote to be valid
5. **Execution** — Approved grants are disbursed in 2 tranches: 60% upfront, 40% on milestone completion (verified by the proposer's designated oracle or multisig attestation)

### Auto-Burn Mechanism

Unused Agent Grant funds that have been sitting in the pool for **6 consecutive months** without an approved proposal are automatically burned via the BBB buyback contract. This prevents treasury bloat and ensures capital efficiency — if the community isn't using the funds, they become deflationary pressure instead.

### Example Use Cases

- An AI agent proposes a $2,000 grant to build a Theta-to-Bittensor inference bridge adapter
- A community member proposes a $500 grant for XFuel dashboard analytics tooling
- A swarm of agents co-proposes a $5,000 grant to subsidize a new GPU operator onboarding campaign

---

---

## Governance & Safeguards

### Multisig Oversight

- GET sub-allocations are managed by a **3-of-5 operational multisig** during the bootstrap phase
- Once protocol volume exceeds $100K/month for 3 consecutive months, sub-allocation governance transitions to veXF voting (same mechanism as `setSplit()`)

### Spending Caps

| Sub-Bucket | Monthly Cap | Rationale |
|------------|------------|-----------|
| Machine & Agent Incentives | No hard cap (volume-driven) | Scales with network growth |
| LP Boost | 80% of allocation per month | Prevents over-concentration in volatile conditions |
| Agent-Driven Grants | 5% of pool per proposal | Limits single-proposal risk |

### Transparency

- All GET disbursements are on-chain and viewable via the protocol dashboard
- Monthly treasury reports published to the community Discord and governance forum
- Real-time GET balance and sub-allocation breakdown displayed on the XFuel dashboard

### Emergency Controls

- Operational multisig can **pause** GET disbursements via `CoreRevenueSplitter.pause()`
- Paused funds accumulate and are distributed when unpaused — no funds are ever lost
- Governance can vote to reallocate GET sub-percentages via a dedicated proposal type

---

## How GET Relates to the Core Split

```
All Protocol Fees (100%) → CoreRevenueSplitter
  ├─ 30% → BBB (Buyback-Burn)
  ├─ 30% → GET (Growth & Expansion Treasury)  ◄── this doc
  │    ├─ 50% → Machine & Agent Incentives
  │    ├─ 30% → LP Boost
  │    └─ 20% → Agent-Driven Grant Proposals
  ├─ 25% → veXF Stake Rewards
  └─ 15% → Ops Treasury
       └─ 15-25% → Fee-to-Stake (validator staking)
```

The on-chain `CoreRevenueSplitter.sol` handles the top-level 4-way split (`bbbBps=3000, getBps=3000, stakerBps=2500, treasuryBps=1500`). GET sub-allocation is now managed directly by the splitter via `setSubSplits()`, `volumeTriggeredBoost()`, and `agentGrantProposal()` — providing full on-chain governance of the GET fund.

---

## Implementation Details

> Added with the GET on-chain mechanics update. All functions live in `CoreRevenueSplitter.sol`.

### Renamed State (LP → GET)

| Old Name | New Name | Description |
|----------|----------|-------------|
| `lpBps` | `getBps` | Top-level BPS allocation (3000 = 30%) |
| `lpWallet` | `getWallet` | Recipient address for GET funds |
| `totalLP` | `totalGET` | Cumulative GET distributed |
| `setLPWallet()` | `setGETWallet()` | Admin setter for GET wallet |
| `SplitUpdated(…lp…)` | `SplitUpdated(…get_…)` | Event field renamed |

### New Functions

| Function | Access | Description |
|----------|--------|-------------|
| `setSubSplits(incentivesBps, lpBoostBps, grantsBps)` | Admin / GOVERNANCE_ROLE | Set GET sub-allocations (must sum to 10000) |
| `volumeTriggeredBoost(multiplier)` | FEE_MANAGER_ROLE | Set incentives boost (10000–25000 = 1.0x–2.5x) |
| `agentGrantProposal(proposalId, amount, recipient)` | Permissionless | Submit a grant proposal (capped at 5% of pool) |
| `voteGrant(proposalIndex, support)` | GOVERNANCE_ROLE | Vote for/against a grant proposal |
| `claimGrant(proposalIndex)` | Permissionless | Execute approved grant; auto-burns if >6 months old |
| `getSubSplit()` | View | Returns (incentivesBps, lpBoostBps, grantsBps) |
| `getGrantProposal(index)` | View | Returns GrantProposal struct |

### Updated `distribute()` Flow

```
distribute() called:
  ├─ 30% → BBB (bbbWallet)
  ├─ 30% → GET (getWallet)  ◄── renamed from LP
  │    ├─ Sub-split tracked: incentives (with boost), LP boost, grants
  │    │    ├─ incentivesRaw = getAmount × incentivesBps / 10000
  │    │    ├─ incentivesAmount = incentivesRaw × boostMultiplier / 10000
  │    │    ├─ lpBoostAmount = getAmount × lpBoostBps / 10000
  │    │    └─ grantsAmount = remainder → grantPoolBalance
  │    └─ Full getAmount sent to getWallet (sub-split is accounting only)
  ├─ 25% → Staker Vault
  └─ 15% → Treasury
       └─ 15-25% → Fee-to-Stake (validator staking)
```

### Grant Lifecycle

```
1. agentGrantProposal(id, amount, recipient)  → GrantProposalSubmitted
2. voteGrant(index, true/false)               → GrantVoteCast  (GOVERNANCE_ROLE)
3. claimGrant(index)
     ├─ If >6 months old → auto-burn (GrantBurned), proposal cancelled
     ├─ If votesFor > votesAgainst → transfer to recipient (GrantExecuted)
     └─ Otherwise → revert "NotApproved"
```

### Boost Multiplier Thresholds

| Monthly Volume | Recommended Multiplier | BPS Value |
|---------------|----------------------|-----------|
| < $50K | 1.0x (baseline) | 10000 |
| $50K – $200K | 1.5x | 15000 |
| $200K – $1M | 2.0x | 20000 |
| > $1M | 2.5x (maximum) | 25000 |

Set via `volumeTriggeredBoost(bpsValue)` — typically called by a keeper or oracle integration.

---

## Cross-References

- [WHITEPAPER.md — Section 5.2](../WHITEPAPER.md) — Revenue Split overview
- [WHITEPAPER.md — Section 5.3](../WHITEPAPER.md) — GET sub-breakdown table
- [CoreRevenueSplitter.sol](../contracts/core/CoreRevenueSplitter.sol) — On-chain fee distribution contract
