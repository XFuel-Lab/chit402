# Seed Readiness Scaffold

What “Seed-ready / A-” means after Sprints 1–4. Not an offer — planning only.

Related: [FUNDRAISING_STRUCTURE.md](./FUNDRAISING_STRUCTURE.md), [AUDIT_READINESS_CHECKLIST.md](./AUDIT_READINESS_CHECKLIST.md), [FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md).

## Seed gate (from fundraising structure)

- Mainnet USDC revenue path live
- Audit underway (firm engaged + scope letter)
- Entity formed
- Meaningful volume / named design partners

## Checklist

### Product (eng — largely done in Sprints 1–4)

- [x] Base verifier deployed (see RUNTIME_STATE)
- [x] Tier-1 receipts + verify URL / JSON
- [x] Tier-2 SP1 path (binding server-attested until guest v2)
- [x] CDP mainnet facilitator code path
- [x] Private Spend v0 (flag)
- [x] Buyer `/stats/me` + north-star metrics
- [x] Auditor selective disclosure (`?format=auditor`)
- [x] Partner cookbook + onboarding doc
- [x] Staging SLA draft
- [x] Tier-3 narrowed / timeboxed (not identity)
- [ ] Guest v2 + `in_proof: true` on a live task
- [ ] Mainnet facilitator wired on production host

### Commercial (founder)

- [ ] 3 design partners live
- [ ] North-star: sustained paid tasks / week
- [ ] Real USDC fees on Basescan
- [ ] 2 written partner quotes

### Diligence pack

- [x] [AUDIT_READINESS_CHECKLIST.md](./AUDIT_READINESS_CHECKLIST.md) enough to request quotes
- [x] [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) + [AUDIT_SCOPE_LETTER_DRAFT.md](./AUDIT_SCOPE_LETTER_DRAFT.md) ready to send
- [ ] Manifest pinned + git tag for audit commit
- [ ] LEGAL_LAUNCH counsel engaged
- [ ] Deck uses **live metrics only** — outline: [SEED_DECK_OUTLINE.md](./SEED_DECK_OUTLINE.md)

### Narrative hygiene

- [x] Positioning: Base home, token-light
- [x] Private Spend thesis documented
- [ ] Public site / deck scrubbed of Theta-as-settlement and open sale residue (legacy pitch decks live only under `docs/_archive/` — do not present)

## Deck slide order (Seed)

1. Problem — agents spend; keys + invoices fail  
2. Insight — payments commoditize; budgets + receipts don’t  
3. Product — gateway + tiers + Private Spend  
4. Proof — live demo, verifier addr, `/stats` north-star  
5. GTM — beachhead + partners  
6. Moat path — payment-bound proofs → Tier-3 SKU (timeboxed)  
7. Ask — SAFE use of funds + milestones  

## Next eng after Seed scaffold

Production SLA, selective disclosure policy customization per partner, platform embed (one framework defaults to XFuel).
