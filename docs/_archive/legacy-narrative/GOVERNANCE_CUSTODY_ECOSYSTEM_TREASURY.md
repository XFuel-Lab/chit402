# Ecosystem vs protocol treasury — custody and governance patterns

**Not legal advice.** This describes **common Web3 practice** so the team can align multisig, docs, and future veXF votes.

## Buckets (per WHITEPAPER §10)

| Bucket | % | Intent |
|--------|---|--------|
| **Ecosystem & partnerships** | 20% | Grants, strategic partners, integrations, co-marketing, ecosystem development |
| **Protocol treasury** | 15% | DAO-controlled liquidity for ops, audits, resilience — typically **veXF** governance |

## Typical separation

1. **Custody**
   - **Ecosystem**: dedicated **multisig** or **vesting vault** labeled “Ecosystem” in manifests; spend for **grants / partnerships** with **on-chain memos** or **milestones** in agreements.
   - **Treasury**: **DAO treasury** contract or multisig **controlled by governance** (timelock + veXF voting).

2. **Governance**
   - **Ecosystem**: often **delegated** to a **committee multisig** (3/5 or 4/7) with **public guidelines** (max grant size, categories, conflict rules). Large spends → escalate to **full DAO vote**.
   - **Treasury**: **parameter changes**, **large transfers**, **new chains** → **veXF** proposals with quorum (see `veXFGovernance` docs).

3. **Operational controls (used by many projects)**
   - **Spending caps** per month/quarter for committee multisig.
   - **Timelock** (e.g. 24–72h) on treasury moves above a threshold.
   - **Publication**: quarterly **transparency reports** (where funds went, grant recipients redacted only where NDAs require).

4. **What “ecosystem” should not silently become**
   - A second undisclosed team wallet. Keep **labels** and **manifests** accurate.
   - **Treasury** overlap: if unsure, route through **governance** rather than committee discretion.

## XFuel alignment

- **CoreRevenueSplitter** routes **fee revenue** separately from **this 1B allocation** (allocation is **supply-side**; fees are **flow**).
- **Angel / Believer / Engagement** rounds consume **their** caps from treasury mint or pre-allocation as designed in launch runbooks.

## Action items for the team

- [ ] Name **two** addresses/roles in `deploy/manifests`: `ecosystemVault` vs `daoTreasury`.
- [ ] Publish a **one-page grant policy** (amount tiers, evaluation, KYC if any).
- [ ] Wire **veXF** treasury proposals** to on-chain execution** where possible.
