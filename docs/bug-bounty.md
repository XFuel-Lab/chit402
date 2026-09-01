# Responsible Disclosure

Coordinated disclosure for issues that affect XFuel users and funds.  
Contact: security@xfuel.app

Last updated: 2026-08-10

> **No cash bounty is offered today.** XFuel is pre-audit, so we do not advertise
> reward amounts we cannot commit to paying. We recognise valid reports publicly
> (with your consent) and credit you in the fix. A funded bounty will launch
> alongside the first external audit. Until then, please report anyway: safe
> harbour below applies in full.

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

## Severity

Used to prioritise triage and fixes. No monetary reward attaches to these today.

| Severity | Examples |
|----------|----------|
| Critical | Direct loss of funds, RCE, auth bypass, private-key compromise |
| High | Settlement forgery, proof-verification bypass, privilege escalation |
| Medium | Information disclosure, receipt tampering without fund loss |
| Low | Hardening gaps with limited practical impact |

## Recognition

- Public credit in the fix commit and release notes, if you want it.
- A named entry in the security acknowledgements when the audit ships.
- Reporters of valid Critical/High issues found before the funded programme opens
  will be invited to it directly.

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
- How you would like to be credited (or "anonymous")

SLA: acknowledge within 48 hours; triage within 5 business days.  
Safe harbor applies when you follow these rules in good faith.
