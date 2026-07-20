# Bug Bounty

Rewards for responsible disclosure that protects XFuel users and funds.  
Contact: security@xfuel.app

Last updated: 2026-07-20

## Scope

In scope:

- Deployed contracts in `contracts/core/` and Audit Phase 1 circuits (see WHITEPAPER §11.5)
- Gateway payment / receipt paths that can forge settlement or drain funds (`services/gateway`)
- xfuel.app and API surfaces (auth, injection, SSRF, privilege escalation)

Highest priority:

- `ZKVerifierSP1` — proof verification bypass
- `SP1ProofHooks` — spoofing or replay
- `veXFGovernance` — governance takeover
- `ModelRegistry` / `ProviderStaking` — Verified Inference trust surface

Out of scope:

- `contracts/legacy/`
- Physical / social engineering / phishing
- Pure DoS or spam
- Third-party services (unless they directly break XFuel settlement)
- Automated scanner dumps without a PoC
- Issues that require unlikely user behavior

Full reporting policy: [SECURITY.md](../SECURITY.md).

## Rewards (USD, typically paid in USDC or ETH)

| Severity | Range |
|----------|--------|
| Critical | $10,000 – $50,000 |
| High | $5,000 – $10,000 |
| Medium | $1,000 – $5,000 |
| Low | $100 – $1,000 |

Critical examples: direct loss of funds, RCE, critical auth bypass, private-key compromise.  
Final amounts are at the security team's discretion (impact, quality, exploitability).

## Rules

1. Disclose privately first; do not publish until we clear you.
2. Do not harm availability, modify others' data, or phish users.
3. No automated scanners without permission.
4. One issue per report (unless chained).
5. First valid report wins duplicates.
6. Follow applicable law; no sanctioned jurisdictions; 18+.

## How to report

Email security@xfuel.app with:

- Summary and severity (Critical / High / Medium / Low)
- Affected component
- Steps to reproduce / PoC
- Impact
- Optional suggested fix
- Wallet address for payment

SLA: acknowledge within 48 hours; triage within 5 business days.  
Safe harbor applies when you follow these rules in good faith.
