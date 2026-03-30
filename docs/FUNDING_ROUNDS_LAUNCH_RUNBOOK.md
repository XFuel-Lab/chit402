# Funding rounds launch runbook (Believer + Angel)

**TFUEL only** · **BelieverRound** + **AngelRound** on Theta testnet **365** first, then mainnet **361**.

Related docs: [`LEGAL_LAUNCH_CHECKLIST.md`](LEGAL_LAUNCH_CHECKLIST.md) · [`AUDIT_READINESS_CHECKLIST.md`](AUDIT_READINESS_CHECKLIST.md) · [`COMMUNITY_ENGAGEMENT_REWARDS.md`](COMMUNITY_ENGAGEMENT_REWARDS.md) (post-TGE engagement) · [`PRICING_TFUEL_XF.md`](PRICING_TFUEL_XF.md)

---

## Tests (run before any deploy)

From **repo root**:

```bash
npm run test:believer
```

This runs Hardhat tests for **BelieverRound** and **AngelRound** (commit, cap, TGE, vesting, refund logic in tests, angel treasury pull).

Optional full contract sweep:

```bash
npm run test:contracts
```

---

## Part A — Testnet (Theta chain 365)

### A1. Prerequisites

- Hardhat / deploy wallet funded with **testnet TFUEL** on **365**.
- `.env` / `.env.local` with `DEPLOYER_PRIVATE_KEY` (or your usual Hardhat secret) and `ADMIN_ADDRESS` if not using default multisig.
- Env for caps/prices if you override defaults (see `believer/launch-round.cjs` and `believer/launch-angel-round.cjs` headers). Default deploy XF per TFUEL: **Believer 5**, **Angel 8** — see [`PRICING_TFUEL_XF.md`](PRICING_TFUEL_XF.md).

### A2. Deploy contracts

**Community (BelieverRound):**

```bash
npx hardhat run believer/launch-round.cjs --network theta-testnet
```

**Angel:**

```bash
npx hardhat run believer/launch-angel-round.cjs --network theta-testnet
```

Save the printed addresses and JSON report. Add or merge into **`deploy/manifests/`** (e.g. `testnet-believer-angel-<timestamp>.json`) with:

- `BelieverRound` address, params (`xfAllocationCap`, `hardCap`, price num/den)
- `AngelRound` address, same
- Network `theta-testnet`, chainId **365**

### A3. Block explorer

Verify source on **Theta testnet explorer** if you want public links for testers.

### A4. xfuel.app (testnet)

1. Copy **`xfuel-app/.env.example`** → **`.env.local`** (or set **Vercel Preview** env).
2. Set **`VITE_BELIEVER_ROUND_ADDRESS`** and **`VITE_ANGEL_ROUND_ADDRESS`** to the **365** addresses (minimum for funding pages).
3. Set other **`VITE_*`** only if you want **Governance / Dashboard / Monitoring** live — see **`xfuel-app/.env.example`**. **`VITE_GOVERNANCE_ADDRESS`**, **`VITE_API_URL`**, **`VITE_M2M_API_URL`**, and **subchain RPC** vars are **not** required for `/believers` or `/angels`.
4. Build and deploy:

```bash
cd xfuel-app
npm run build
```

### A5. Manual testnet checks (wallet on 365)

| Step | Community | Angel |
|------|-----------|--------|
| Open UI | `/believers` | `/angels` |
| Connect wallet | Chain **365** | Chain **365** |
| Commit | ≥ min TFUEL; try lock tier on fresh wallet | ≥ min TFUEL |
| Stats | TFUEL + XF cap bars update | Same |
| Operator | `closeRound` | `closeRound` |
| XF token | Deploy/mint test ERC-20 | Same |
| Admin | `approve` + `triggerTGE` | `approve` + `triggerTGE` |

**Note:** Full **claim** timing uses cliff/vesting; use **`npm run test:believer`** for time-advanced proof. Optional: wait on testnet for a small claim demo.

**Believer refund (180d, no TGE):** covered by automated tests; full wait on public testnet is optional.

**Angel `withdrawToTreasury`:** optional rehearsal before TGE.

### A6. Sign-off testnet

- [ ] Manifest file committed or stored with addresses + params  
- [ ] UI smoke passed on **365**  
- [ ] `npm run test:believer` green on same commit you deploy  

---

## Part B — Mainnet (Theta chain 361)

### B1. Preflight

- [ ] Legal/comms: [`LEGAL_LAUNCH_CHECKLIST.md`](LEGAL_LAUNCH_CHECKLIST.md) with counsel as needed  
- [ ] Audit: scope vs [`AUDIT_READINESS_CHECKLIST.md`](AUDIT_READINESS_CHECKLIST.md) and **WHITEPAPER §11.5** (your policy)  
- [ ] Multisig (Safe) ready on **361**; signers confirmed  
- [ ] Treasury holds enough **XF** (after mint/TGE planning) for **`totalXFReserved`** on each round after commits  

### B2. Deploy mainnet

Use the **same scripts**, **mainnet network**:

```bash
npx hardhat run believer/launch-round.cjs --network theta-mainnet
npx hardhat run believer/launch-angel-round.cjs --network theta-mainnet
```

Record **`deploy/manifests/mainnet-believer-angel-<timestamp>.json`** (or your naming convention).

### B3. Verify on explorer (361)

Verify contract source on **Theta mainnet explorer** for transparency.

### B4. xfuel.app (production)

1. **Vercel Production** (or host): set **`VITE_BELIEVER_ROUND_ADDRESS`** and **`VITE_ANGEL_ROUND_ADDRESS`** to **361** addresses (not testnet).  
2. Update any other **`VITE_*`** from **361** manifest.  
3. Redeploy site (rebuild so Vite inlines env).  

### B5. Operational sequence (after commits close)

1. **Close** each round: `closeRound` (operator).  
2. **TGE** each contract separately: `triggerTGE(xfToken)` with **`totalXFReserved`** pulled from contract; multisig approves ERC-20 **`transferFrom`**.  
3. Monitor **`Committed`**, **`TGETriggered`**, **`TokensClaimed`** events.  
4. Optional: `node believer/monitoring-script.cjs --manifest <path>`  

### B6. After TGE (engagement bucket)

**Not** the same as round TGE: deploy/fund **`CommunityEngagementDistributor`** when XF exists — [`COMMUNITY_ENGAGEMENT_REWARDS.md`](COMMUNITY_ENGAGEMENT_REWARDS.md#post-tge--xf-token-runbook).

### B7. Sign-off mainnet

- [ ] Production env only **361** addresses  
- [ ] Explorer links published for both rounds  
- [ ] Runbook/manifest archived for auditors and ops  

---

## Quick reference — env vars (xfuel.app)

| Variable | Purpose |
|----------|---------|
| `VITE_BELIEVER_ROUND_ADDRESS` | BelieverRound `0x…` |
| `VITE_ANGEL_ROUND_ADDRESS` | AngelRound `0x…` |
| `VITE_VERIFIER_ADDRESS` | ZKVerifierSP1 (dashboard) |
| `VITE_SPLITTER_ADDRESS` | CoreRevenueSplitter |
| `VITE_GOVERNANCE_ADDRESS` | veXFGovernance |
| `VITE_THETA_INFERENCE_ADDRESS` | ThetaInferenceCircuit |

Full list: **`xfuel-app/.env.example`**.

---

## Network IDs

| Network | Chain ID |
|---------|----------|
| Theta mainnet | **361** |
| Theta testnet | **365** |

Never reuse **365** contract addresses on the production site.
