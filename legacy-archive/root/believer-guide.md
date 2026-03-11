# XFuel Protocol — Believer Round Guide

**A structured approach to early-stage community funding via micro-commitments and vesting.**

---

## 1. Overview

The Believer Round is a community-first funding mechanism designed for XFuel Protocol's earliest supporters. Rather than a traditional VC raise, this round uses micro-commitments with transparent vesting to align incentives between the protocol and its community.

### Key Principles
- **Accessibility**: Low minimum commitment ($100-$500)
- **Transparency**: All terms, vesting, and allocations are public
- **Alignment**: Vesting ensures long-term alignment with protocol growth
- **Fairness**: No whales — per-wallet caps ensure broad distribution

---

## 2. Round Structure

| Parameter | Value |
|-----------|-------|
| **Round Name** | Believer Round |
| **Target Raise** | $250K – $500K |
| **Token** | XF (ERC-20 on Theta Mainnet) |
| **Valuation** | $[X]M FDV |
| **Allocation** | [X]% of total supply |
| **Min Commitment** | $100 |
| **Max Commitment** | $5,000 per wallet |
| **Payment** | TFUEL, USDC, ETH |
| **Network** | Theta Mainnet (chain ID 361) |

---

## 3. Vesting Schedule

All Believer Round tokens vest linearly to prevent dump-and-run and ensure participants are aligned with long-term protocol success.

| Phase | Duration | Unlock |
|-------|----------|--------|
| **Cliff** | 3 months | 0% (no tokens unlocked) |
| **Linear Vest** | 12 months | ~8.33% per month |
| **Full Unlock** | 15 months total | 100% |

### Example

A $1,000 commitment at $0.10/XF = 10,000 XF tokens:

| Month | Unlocked | Cumulative | Status |
|-------|----------|-----------|--------|
| 0-3 | 0 XF | 0 XF | Cliff |
| 4 | 833 XF | 833 XF | Vesting |
| 5 | 833 XF | 1,666 XF | Vesting |
| ... | ... | ... | ... |
| 15 | 833 XF | 10,000 XF | Fully vested |

---

## 4. Micro-Commitment Tiers

Believers can choose commitment tiers that match their conviction level:

| Tier | Amount | XF Tokens* | veXF Bonus** | Perks |
|------|--------|-----------|-------------|-------|
| **Seed** | $100-$499 | 1,000-4,990 | — | Discord role, early access |
| **Cultivator** | $500-$1,999 | 5,000-19,990 | 5% bonus | + Governance preview, monthly AMA |
| **Architect** | $2,000-$5,000 | 20,000-50,000 | 10% bonus | + Direct team channel, roadmap input |

\* At $0.10/XF illustrative price
\** veXF bonus: additional tokens allocated when committing to 1-year lock

---

## 5. How It Works (Smart Contract Flow)

The Believer Round is powered by `BelieverRound.sol` — a production-grade Solidity contract with OpenZeppelin AccessControl, Pausable, and ReentrancyGuard. The contract manages the full lifecycle from commitment to vesting to claiming.

### Smart Contract Reference
- **Contract**: `believer/BelieverRound.sol`
- **Tests**: `believer/test/BelieverRound.test.cjs` (16 tests passing)
- **Gas**: commit ~45-123K, triggerTGE ~117K, claim ~63-139K, refund ~44K

### Step 1: Commitment Phase (`commit()`)
1. Connect wallet to xfuel.app/believers
2. Select commitment tier
3. Call `BelieverRound.commit()` with TFUEL — validates:
   - Amount >= MIN_COMMITMENT (0.01 TFUEL)
   - Total per wallet <= maxCommitmentPerWallet ($5K equivalent)
   - Total raised <= hardCap ($250K-$500K equivalent)
4. On-chain event `Committed(believer, amount, totalCommitted)` emitted
5. Dashboard shows commitment receipt with tier badge

### Step 2: Round Close + TGE (`closeRound()` + `triggerTGE()`)
1. Operator calls `closeRound()` when commitment period ends
2. Admin deposits XF tokens and calls `triggerTGE(xfTokenAddress)`:
   - Calculates total tokens: `totalCommitted * priceNumerator / priceDenominator`
   - Pulls XF tokens from admin via `safeTransferFrom`
   - Sets `tgeTimestamp` — vesting clock starts
3. Dashboard shows vesting timeline with cliff + linear release schedule

### Step 3: Vesting & Claiming (`claim()`)
1. **Cliff (90 days)**: No tokens claimable — `_vestedAmount()` returns 0
2. **Linear vesting (365 days)**: After cliff, tokens vest linearly:
   ```
   vestedAmount = (tokenAllocation * (elapsed - CLIFF)) / VESTING_DURATION
   ```
3. Call `claim()` at any time after cliff to receive unlocked tokens
4. Optionally lock claimed tokens for veXF (governance + rewards)
5. veXF bonus tokens vest on same schedule

### Step 4: Refund Safety (`requestRefund()`)
- If TGE not triggered within 180 days of round opening:
  - Call `requestRefund()` to get full TFUEL refund
  - No admin key can access escrowed funds without TGE trigger
  - Prevents rug pulls with immutable on-chain refund logic

### Step 5: Ongoing Benefits
- **Staker rewards**: Lock XF → veXF → earn 25% of protocol revenue
- **Governance**: Vote on fee changes, treasury, circuit activation
- **Community**: Priority access to new circuit launches, beta features

## 5b. Execution Checklist (For Team)

| # | Step | Command / Action | Status |
|---|------|-----------------|--------|
| 1 | Deploy BelieverRound | `npx hardhat run deploy/mainnet.cjs` (includes BelieverRound) | Ready |
| 2 | Verify on ThetaScan | Submit source to thetascan.io Smart Contract HQ | Ready |
| 3 | Configure commitment page | Deploy xfuel.app/believers with contract address | Pending |
| 4 | Open round | Contract deploys in `Open` status automatically | Automatic |
| 5 | Marketing campaign | X/Twitter threads (see `community/x-campaign-template.md`) | Ready |
| 6 | Discord campaign | Announce via Discord bot `/stats`, `/feesplit` commands | Ready |
| 7 | Monitor commitments | ThetaScan API + health-check loop (`ENABLE_MONITORING=true`) | Ready |
| 8 | Close round | Admin calls `closeRound()` after commitment period | Manual |
| 9 | Mint XF tokens | Deploy XF ERC-20 if not yet deployed | Pending |
| 10 | Trigger TGE | Admin approves + calls `triggerTGE(xfTokenAddress)` | Manual |
| 11 | Withdraw raised funds | Admin calls `withdrawFunds(treasuryAddress)` | Manual |
| 12 | Monitor vesting claims | ThetaScan API tracks `TokensClaimed` events | Ready |

---

## 6. Believer Benefits vs. Later Rounds

| Benefit | Believer Round | Seed Round | Public Sale |
|---------|---------------|------------|-------------|
| Price per XF | Lowest | +30-50% | +100-200% |
| Vesting | 3mo cliff + 12mo | 6mo cliff + 18mo | None/3mo |
| veXF Bonus | Up to 10% | None | None |
| Direct Team Access | Architect tier | Board seats | None |
| Governance Preview | All tiers | Board seats | Post-launch |
| Max per wallet | $5,000 | $50K+ | Unlimited |

---

## 7. Use of Funds

| Category | % | Amount (at $350K raise) | Purpose |
|----------|---|------------------------|---------|
| Engineering | 40% | $140K | Circuit development, ZK circuits, testing |
| Security Audits | 20% | $70K | 2 independent audits (smart contracts + ZK) |
| Infrastructure | 15% | $52.5K | RPC nodes, prover servers, monitoring |
| BD / Partnerships | 15% | $52.5K | Ecosystem grants, integrations, events |
| Legal / Operations | 10% | $35K | Entity setup, compliance, insurance |

---

## 8. Investor Protections

### On-Chain Transparency
- All vesting contracts are verified and open source
- Token allocations visible on-chain
- No hidden team allocations beyond published tokenomics

### Refund Mechanism
- If TGE does not occur within 6 months of commitment, believers can claim full refund
- Refund smart contract holds funds in escrow until TGE
- No admin key can access escrowed funds without TGE trigger

### Anti-Whale Measures
- $5,000 max per wallet (verified via on-chain identity)
- KYC optional but required for Architect tier
- Sybil resistance via on-chain activity scoring

---

## 9. veXF Lock Strategy Guide

For believers planning to maximize governance power and staking rewards:

### Conservative (1-year lock)
- Lock all vested tokens for 1 year as they unlock
- 1x multiplier → moderate voting power
- Good for: passive participants, smaller commitments

### Balanced (2-year lock)
- Lock all vested tokens for 2 years
- 2x multiplier → strong voting power + 1.5x yield boost
- Good for: active community members

### Maximum Conviction (3-year lock)
- Lock all vested tokens for 3 years immediately after each vest
- 3x multiplier → maximum voting power + 2x yield boost
- Good for: Architect-tier believers, long-term aligned participants

### Simulation

Use the XFuel Discord bot to model your position:

```
/vexf simulate amount:20000 days:1095
→ Multiplier: 3x
→ Voting Power: 60,000 veXF
→ Yield Boost: 2x

/vexf apy amount:20000 days:1095 revenue:25000
→ Estimated APY at $25K/day protocol revenue
```

---

## 10. Timeline

| Date | Event |
|------|-------|
| [TBD] | Believer Round opens |
| [TBD + 2 weeks] | Commitment period closes |
| [TBD + 1 month] | TGE — tokens allocated, vesting begins |
| [TBD + 4 months] | First claim (after 3-month cliff) |
| [TBD + 16 months] | Full unlock |
| Ongoing | veXF staking rewards from protocol revenue |

---

## 11. FAQ

**Q: What if the token price drops after TGE?**
A: Vesting protects against short-term volatility. The 15-month vesting schedule means you're aligned with long-term protocol value, not day-1 price action.

**Q: Can I sell my vested tokens immediately?**
A: Yes, once tokens unlock after the cliff, they're freely transferable. However, locking into veXF earns staking rewards (25% of protocol revenue) and governance power.

**Q: What happens to unvested tokens if I lose my wallet?**
A: Vesting contracts are immutable. You need your wallet to claim. Use hardware wallets and backup recovery phrases.

**Q: Is there a referral program?**
A: Yes. Each believer gets a unique referral link. Successful referrals earn 5% bonus XF tokens (vested on same schedule).

**Q: How is the valuation determined?**
A: Based on comparable protocols (Succinct, Bittensor, Render) adjusted for stage. Full methodology in exec-summary.md.

---

## 12. Activation Guide (For Team)

### Quick Activation

```bash
# 1. Deploy + activate (testnet)
npx hardhat run believer/activation-script.cjs --network theta-testnet

# 2. Deploy + activate (mainnet — included in full-stack deploy)
npx hardhat run deploy/mainnet.cjs --network theta-mainnet

# 3. Standalone activation with custom params
BELIEVER_HARD_CAP=300 BELIEVER_MAX_PER_WALLET=3 npx hardhat run believer/activation-script.cjs
```

### Activation Script Output

The `believer/activation-script.cjs` performs 5 phases:

| Phase | Action | Output |
|-------|--------|--------|
| 1. Configuration | Load env vars, validate params | Admin address, caps, price |
| 2. Deploy | Deploy BelieverRound.sol | Contract address, gas used |
| 3. Smoke Tests | Verify status, caps, commit, stats | 7/7 pass/fail |
| 4. Activation Report | JSON report with all details | `believer/activation-*.json` |
| 5. Campaign Copy | Ready-to-post Discord + X/Twitter text | Copy/paste announcements |

### Post-Activation Campaign

After deployment, the script generates ready-to-use campaign text:

1. **Discord Announcement**: Full announcement with contract address, terms, caps
2. **X/Twitter Thread**: 3-tweet thread with key terms and commitment instructions
3. **Next Steps Checklist**: Verify on explorer, update web app, post announcements

### Monitoring

```bash
# Monitor the testnet dashboard
open dashboard/index.html   # Load deployment manifest to see contract status

# Track grant submissions
node grant-templates/grant-tracker.cjs --report
```

---

## 13. Grant Submission Automation

The `grant/submission-script.cjs` auto-fills grant applications with live deployment data.

```bash
# Show submission status for all 3 programs
node grant/submission-script.cjs --status

# Generate all submission packages (JSON + markdown summary)
node grant/submission-script.cjs --all

# Generate specific program submission
node grant/submission-script.cjs --program solana
node grant/submission-script.cjs --program tao
node grant/submission-script.cjs --program general
```

**Auto-filled data from deployment manifest:**
- Contract addresses (all 17 deployed contracts)
- Gas metrics per contract
- Smoke test pass/fail results
- BelieverRound status and parameters
- MappingSensor + EnergyGrid + FilecoinStorage deployment evidence
- Total traction: 315+ tests, 16 circuits, 20 contracts, cross-circuit DePIN synergy active

**Output:** `grant/submissions/` folder with JSON + markdown per program.

---

## 14. Public Activation (v1.95)

For a full end-to-end public testnet activation:

```bash
# Full orchestrated activation (Core + 13 circuits + BelieverRound + smoke tests + campaign)
npx hardhat run activation/public-activation.cjs --network theta-testnet

# Local simulation
npx hardhat run activation/public-activation.cjs
```

The activation script runs 8 phases:
1. Pre-flight (balance, chain ID, compiler)
2. Core Layer deployment (Splitter + ZK Verifier)
3. 13 circuits deployment (including FilecoinStorage + EnergyGrid)
4. BelieverRound deployment
5. Role grants + verification (13/13)
6. Comprehensive smoke tests (15/15)
7. Dashboard manifest output (JSON)
8. Campaign data output (X/Twitter + Discord copy)

### Believer Round Launch

```bash
# Launch the Believer Round (deploy + configure + smoke tests + campaign copy)
npx hardhat run believer/launch-round.cjs --network theta-testnet

# Local simulation
npx hardhat run believer/launch-round.cjs
```

The launch script handles:
- Manifest-aware deployment (skips if already deployed via EXISTING_MANIFEST env var)
- 7/7 smoke tests: status, hard cap, max/wallet, durations, commit, commitment, stats
- JSON launch report with traction metrics
- Discord + X/Twitter campaign copy

### Previous Launch Script

The older `launch/public-launch.cjs` (12 circuits) remains available for reference but
`activation/public-activation.cjs` supersedes it with 16 circuits (including UplinkCircuit).

---

## 15. Believer Round Monitoring

Use `believer/monitoring-script.cjs` for continuous or one-shot status tracking:

```bash
# One-shot status check (auto-detects latest manifest)
node believer/monitoring-script.cjs

# Continuous polling (30s interval)
node believer/monitoring-script.cjs --watch

# Load specific manifest
node believer/monitoring-script.cjs --manifest deploy/manifests/mainnet-activation-*.json

# Post to Discord/Slack webhook
node believer/monitoring-script.cjs --webhook https://discord.com/api/webhooks/...
```

**Monitored metrics:**
- Contract health: code existence checks for all deployed contracts
- BelieverRound status: round state, hard cap, max/wallet, cliff/vesting parameters
- Gas summary: total gas, heaviest contract, TFUEL cost estimate
- Grant submissions: status of all 3 grants ($350K-$750K potential)
- JSON report output to `believer/reports/`

### Mainnet Activation (v2.1)

For full mainnet deployment with monitoring:

```bash
# Full mainnet activation (Core + 15 circuits + BelieverRound + admin transfer)
npx hardhat run activation/mainnet-activation.cjs --network theta-mainnet

# With continuous monitoring
ENABLE_MONITORING=true npx hardhat run activation/mainnet-activation.cjs --network theta-mainnet
```

The mainnet activation includes 9 phases:
1. Pre-flight (balance >= 50 TFUEL, chain ID 361, address validation)
2. Core Layer (Splitter + ZKVerifier + optional veXFGovernance)
3. 15 circuits deployment (including WirelessDePIN)
4. BelieverRound deployment
5. Role grants + verification (15/15)
6. Admin transfer (deployer -> multisig)
7. Smoke tests (18/18)
8. Health checks (ThetaScan API — 18/18 contracts)
9. Manifest + campaign output

### Monitoring Dashboard (v2.1)

The enhanced monitoring script tracks circuit health individually:

```bash
# One-shot with CSV export
node believer/monitoring-script.cjs --csv

# Continuous with rich Discord embeds
node believer/monitoring-script.cjs --watch --webhook https://discord.com/api/webhooks/...
```

**New in v2.1:**
- Circuit-level health breakdown (15 circuits individually checked)
- Discord rich embed webhooks (color-coded: green = all healthy, amber = issues)
- CSV export for spreadsheet analysis
- WirelessDePIN (Helium/XNET) coverage metrics
- Updated traction: 315+ tests, 20 contracts, 16 circuits

### Governance Activation

The first veXF governance proposal is ready for submission:

```bash
# List all proposal templates
node governance/proposal-script.cjs --list

# Create the first circuit allocation vote
node governance/proposal-script.cjs --create allocation

# Simulate the full governance flow
node governance/proposal-script.cjs --simulate
```

**Available proposal types:** CircuitPriority, LPAllocation, FeeStructure, TreasurySpend, EmergencyPause.

### Community Events

Generate AMA and launch event content:

```bash
# Generate X AMA content package (pre/during/post)
node community/ama-script.cjs --generate ama

# Generate mainnet launch event content
node community/ama-script.cjs --generate launch

# Show event schedule
node community/ama-script.cjs --schedule
```

### Circuit Onboarding

Add new circuits with the scaffolding tool:

```bash
# List all 16 registered circuits
node iteration/add-circuit.cjs --list

# Validate all circuits (contract + handler + test)
node iteration/add-circuit.cjs --validate

# Generate scaffold for a new circuit
node iteration/add-circuit.cjs --name NewCircuit --id new-circuit
```

### DePIN Synergy

The synergy analyzer cross-references WirelessDePIN + MappingSensor + UplinkCircuit:

```bash
# Show regional coverage matrix
node iteration/synergy-script.cjs

# Simulate 100 cross-circuit events
node iteration/synergy-script.cjs --simulate

# Show incentive tier model
node iteration/synergy-script.cjs --incentives

# Generate JSON synergy report
node iteration/synergy-script.cjs --report
```

**Synergy tiers:**
- FULL (3/3 circuits): 1.0x base rewards
- PARTIAL (2/3): 1.5x rewards (incentivize missing layer)
- FRONTIER (1/3): 3.0x rewards (pioneer bonus)

**Governance proposal XFP-004** activates these synergy incentives via veXF vote.

### Funding Monitor

Track grants, milestones, and believer round with real-time monitoring:

```bash
# One-shot status
node funding/monitoring-bot.cjs

# Show milestone tracker
node funding/monitoring-bot.cjs --milestones

# Continuous with Discord webhook
node funding/monitoring-bot.cjs --watch --webhook https://discord.com/api/webhooks/...
```

---

## 18. Legal

- This is not financial advice
- XF tokens are utility tokens providing governance and fee-sharing rights
- Participants should review the full terms at xfuel.app/believers/terms
- Consult local regulations before participating

---

*XFuel Protocol — Pumping intelligence across AI ecosystems.*
*Contact: believers@xfuel.app*
