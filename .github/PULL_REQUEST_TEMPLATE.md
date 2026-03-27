## Summary

<!-- What does this PR do? 1–3 sentences. Link the issue it resolves: "Closes #123" -->

Closes #

## Type of Change

<!-- Check all that apply -->

- [ ] `feat` — New feature or circuit
- [ ] `fix` — Bug fix
- [ ] `test` — New or improved tests
- [ ] `docs` — Documentation only
- [ ] `refactor` — Code restructuring (no behavior change)
- [ ] `perf` — Gas optimization or performance improvement
- [ ] `security` — Security fix or hardening
- [ ] `ci` — CI/CD pipeline change
- [ ] `chore` — Tooling, dependency updates, config

## Affected Components

<!-- Check all that apply -->

- [ ] `contracts/core/` — Core Layer contracts (ZKVerifierSP1, CoreRevenueSplitter, veXFGovernance, SP1ProofHooks)
- [ ] `contracts/circuits/` — Circuit contracts
- [ ] `sp1-prover/` — Rust SP1 prover
- [ ] `core-layer/` — Backend AI listener / orchestration
- [ ] `backend/theta-bridge/` — Bridge service
- [ ] `src/` — Frontend
- [ ] `sdk/js/` — JavaScript SDK
- [ ] `cosmwasm-contracts/` — CosmWasm contracts
- [ ] `edgefarm-mobile/` — Mobile app
- [ ] `scripts/` or `deploy/` — Deployment scripts
- [ ] `.github/` — CI/CD
- [ ] `docs/` — Documentation

## Testing

<!-- How did you test this change? -->

- [ ] New unit tests added
- [ ] Existing tests pass (`npm run test:contracts:core`)
- [ ] Gas benchmarks checked (no regression above thresholds)
- [ ] Tested on Hardhat local (chain 1337)
- [ ] Tested on Theta Testnet (chain 365)

**Test command used:**
```
npm run test:contracts:core
```

## Checklist

- [ ] My code follows the style and conventions in [CONTRIBUTING.md](../CONTRIBUTING.md) and `.cursorrules`
- [ ] I have added NatSpec comments to any new public/external functions
- [ ] I have updated relevant documentation (README, WHITEPAPER, or docs/)
- [ ] I have added or updated the `CHANGELOG.md` entry
- [ ] No secrets, private keys, or sensitive data are included
- [ ] Solidity contracts compile without warnings (`npx hardhat compile`)
- [ ] For Core Layer changes: I confirm this change is within the CertiK Phase 1 audit scope and I have noted it in `docs/audit/AUDIT_PREPARATION_CHECKLIST.md`

## Gas Impact

<!-- For Solidity changes: provide before/after gas numbers for affected functions -->
<!-- Leave as N/A if not applicable -->

| Function | Before | After | Delta |
|---|---|---|---|
| N/A | — | — | — |

## Screenshots / Evidence

<!-- For frontend changes: add screenshots. For ZK/proof changes: add proof generation output. -->
