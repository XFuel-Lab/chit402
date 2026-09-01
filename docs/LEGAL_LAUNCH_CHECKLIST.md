# Legal Launch Checklist

Not legal advice. Engage qualified counsel before a public sale, token distribution, or broad retail marketing.

Fundraising shape: equity-first SAFE.

## Documents (counsel draft / approve)

| Document | Purpose |
|----------|---------|
| Terms of Use | App agreement, liability, dispute resolution |
| Privacy Policy | Data, retention, subprocessors |
| Cookie / analytics notice | If analytics are used |
| Risk disclosure | Smart-contract / product risk (no investment advice) |

## General

- [ ] Engage counsel: token/offering classification, ToS, Privacy, jurisdiction, marketing limits
- [ ] No investment-contract framing unless counsel approves an exemption path
- [ ] Sanctions / restricted-territory handling per counsel
- [ ] Legal inbox (e.g. legal@xfuel.app)

## Product disclosures

Must match live product:

- Settlement: USDC via x402 on Base; Tier-1 signed / Tier-2 SP1 as documented
- Do not claim Tier 2 proves black-box inference correctness
- Do not present retired on-chain sale UIs as an open raise

## Ops / security

- [ ] Bug bounty public — [bug-bounty.md](./bug-bounty.md)
- [ ] Security contact — [SECURITY.md](../SECURITY.md)

## Before mainnet revenue

- [ ] Collect-and-forward custody / money-transmission review ([ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md))
- [ ] Facilitator + `X402_PAY_TO` / Splits custody documented
