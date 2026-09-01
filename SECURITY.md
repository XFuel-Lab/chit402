# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| v2.6 (current) | Actively supported |
| v2.x | Security patches only |
| v1.x | End of life |

## Reporting

Do not open a public GitHub issue for security vulnerabilities.

- Email: security@xfuel.app
- Acknowledge within 48 hours; status within 7 days
- PGP on request

Include: description, affected components, reproduction steps, impact, optional fix.

## Scope

Full scope and disclosure policy: [docs/bug-bounty.md](docs/bug-bounty.md). XFuel is
pre-audit and offers no cash bounty today; safe harbour and public credit still apply.

Priority:

- `contracts/core/ZKVerifierSP1.sol`
- `contracts/core/SP1ProofHooks.sol`
- `contracts/core/veXFGovernance.sol`
- `ModelRegistry` / `ProviderStaking`
- Gateway payment and receipt paths
- Circuit contracts that can drain funds or manipulate settlement

Out of scope: `contracts/legacy/`, theoretical >51% attacks, phishing, third-party dependency issues (report upstream).

## Disclosure

Coordinated disclosure: private report → fix → deploy → optional public credit.  
Default embargo: 90 days from report (may shorten if actively exploited).

## Resources

- [docs/bug-bounty.md](docs/bug-bounty.md)
- [docs/security-design.md](docs/security-design.md)
- [WHITEPAPER.md](WHITEPAPER.md)
