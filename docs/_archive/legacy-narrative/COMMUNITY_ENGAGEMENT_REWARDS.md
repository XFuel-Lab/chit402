# Community Engagement Rewards (15% / 150M XF)

Budget line in tokenomics for **airdrops, farming, task rewards, giveaways** — distinct from **Community Contribution** (`BelieverRound`) and **Angel** (`AngelRound`).

## On-chain vehicle

- **`CommunityEngagementDistributor`** (`contracts/legacy/circuits/CommunityEngagementDistributor.sol`)
  - **`maxLifetimeXF`**: deploy with `150_000_000 * 10**18` (match policy).
  - **`fund(amount)`**: treasury sends XF into the contract.
  - **`publishSeason(root)`**: operator sets a Merkle root per **season** (e.g. quarterly snapshot).
  - **`claim(seasonId, amount, proof)`**: users prove eligibility; **`totalClaimedAllTime`** cannot exceed `maxLifetimeXF`.

**Leaf:** `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))` (OpenZeppelin-style).

## Proposed programs (2026)

### 1. Task-based airdrop (majority of the 15%)

- **Points** for measurable protocol usage: first inference, bridge deposit, agent task, LP provision, etc.
- **Off-chain**: index events / API logs → points DB.
- **Every ~3 months**: freeze snapshot → build Merkle tree → `publishSeason` → users `claim`.

### 2. Fee-matching airdrop (recurring hook)

- For fees paid in TFUEL (via `CoreRevenueSplitter` or task pipeline), allocate a **small %** of fee value as XF rebates (e.g. 20–30% of fee **value** in XF, with monthly caps).
- **v1**: off-chain calculation from fee events → periodic Merkle season (“fee rebate Q1”).
- **v2 (optional)**: splitter extension or dedicated `FeeRebateDistributor` (higher audit scope).

### 3. Milestone lottery (e.g. 5,000 protocol txs)

- At milestone, **eligible set** = addresses with ≥1 qualifying tx.
- **Off-chain**: uniform or weighted draw → single Merkle for a **fixed pool** (e.g. 5M XF) or proportional shares in tree.
- **On-chain**: one `publishSeason` + claims.

## Operations checklist

1. Treasury **funds** distributor ≥ expected next seasons (or per season).
2. **Verify** tree total ≤ remaining headroom under `maxLifetimeXF - totalClaimedAllTime`.
3. **Publish** root; announce season id + deadline (socials / docs).
4. **Monitor** `Claimed` events for analytics.

## Deploy

See `believer/deploy-engagement-distributor.cjs` (env: `ADMIN_ADDRESS`, `XF_TOKEN_ADDRESS`, optional overrides).

## Post-TGE & XF token runbook

**`CommunityEngagementDistributor` needs an ERC-20 XF address.** It does **not** replace TGE on Believer/Angel rounds; it is the **separate 15% engagement bucket**.

Recommended order:

1. **Complete TGE** on `BelieverRound` and `AngelRound` (multisig `triggerTGE` + XF `transferFrom` per contract), so users can claim per those contracts.
2. **Mint or allocate** XF for the engagement bucket from treasury (per tokenomics).
3. **Deploy distributor** (once per network):

   ```bash
   # Theta mainnet (361) — set real XF token
   XF_TOKEN_ADDRESS=0x... npx hardhat run believer/deploy-engagement-distributor.cjs --network theta-mainnet
   ```

   Env: `ADMIN_ADDRESS` (multisig), `ENGAGEMENT_MAX_LIFETIME_XF=150000000` (default), optional overrides.

4. **Treasury** `approve` + call **`fund(amount)`** on the distributor so claimants can receive XF.
5. **Operations:** build Merkle trees off-chain → **`publishSeason(root)`** → announce `seasonId` → users **`claim`**.

Record the distributor address in **`deploy/manifests/`** and (if used) a future `VITE_ENGAGEMENT_DISTRIBUTOR_ADDRESS` for dashboards — not required for the basic Merkle claim flow.

**Docs cross-links:** `AGENTS.md` (Engagement section), `WHITEPAPER.md` §10 token table, §12 “Next: Audit & mainnet”, [`docs/AUDIT_READINESS_CHECKLIST.md`](AUDIT_READINESS_CHECKLIST.md).
