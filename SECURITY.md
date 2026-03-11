# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| v2.4 (current) | ✅ Actively supported |
| v2.x | ✅ Security patches only |
| v1.x | ❌ End of life |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

### Contact

- **Email:** security@xfuel.app
- **Response SLA:** We will acknowledge your report within **48 hours** and provide a status update within **7 days**.
- **Encryption:** PGP key available on request.

### What to Include

A strong report helps us triage and fix faster. Please include:

1. A description of the vulnerability and affected component(s)
2. Steps to reproduce (proof-of-concept code or transaction trace)
3. The potential impact and attack scenario
4. Your suggested fix (optional but appreciated)

### Scope

See the full bug bounty scope in **[docs/bug-bounty.md](docs/bug-bounty.md)**.

**In scope (highest priority):**
- `contracts/core/ZKVerifierSP1.sol` — SP1 proof verification bypass
- `contracts/core/CoreRevenueSplitter.sol` — fee routing manipulation or fund theft
- `contracts/core/veXFGovernance.sol` — governance takeover or vote manipulation
- `contracts/core/SP1ProofHooks.sol` — hook spoofing or replay attacks
- Any circuit contract that can drain user funds or manipulate fee distribution

**Out of scope:**
- Issues in `contracts/legacy/` (archived, not deployed)
- Theoretical attacks requiring >51% network hash rate
- Frontend phishing or social engineering attacks
- Issues in third-party dependencies (report directly to those maintainers)

## Disclosure Policy

We follow **coordinated disclosure**:

1. You report privately → we confirm and fix → we deploy a patch → we credit you publicly (unless you prefer anonymity).
2. We request a **90-day embargo** from the date of your report to allow time for a patch and coordinated announcement.
3. For critical vulnerabilities that are actively exploited, we may shorten this timeline.

## Bug Bounty

We maintain a formal bug bounty program. Details including reward tiers (up to $50,000 for critical findings) are documented in **[docs/bug-bounty.md](docs/bug-bounty.md)**.

## Security Resources

- [Security Design Document](docs/security-design.md)
- [Audit Preparation Checklist](docs/audit/AUDIT_PREPARATION_CHECKLIST.md)
- [CertiK Phase 1 Scope](docs/certik-phase1-scope.json)
- [ZK Audit Baseline](docs/zk-audit-baseline.json)

## Past Security Advisories

No advisories have been published yet. The first external audit (CertiK Phase 1) is scheduled for Q2 2026.
