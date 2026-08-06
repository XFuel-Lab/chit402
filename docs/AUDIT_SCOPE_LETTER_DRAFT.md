# Audit Scope Letter (Draft)

Draft for counsel / audit firm outreach. Not legal advice. Customize before sending.

---

**Subject:** XFuel Protocol — Phase 1 smart contract audit quote request

Hello,

We are requesting a quote for a Phase 1 security audit of the XFuel Protocol Base settlement core.

## Product (one line)

XFuel is a verifiable settlement and payments layer for AI compute: USDC via x402 on Base, provider-agnostic routing, tiered receipts (signed → SP1 settlement proofs).

## Scope (in)

| Artifact | Notes |
|----------|-------|
| `ZKVerifierSP1` | Base mainnet `0x9373499645292715a2275A78eD65B14215C41c06` |
| `SP1ProofHooks` | Nullifiers, fee commitments, public values v1/v2 |
| Related Phase 1 surfaces | `ModelRegistry` / provider staking if included in pinned manifest |
| Public-values layout | Documented in-repo (`public-values.md`) |
| Fee sink | Off-path: `X402_PAY_TO` / Splits v2 on Base (not a bespoke fee-splitter hot path) |

Pinned commit / tag: **`[TO FILL after git tag]`**  
Manifest: `deploy/manifests/` (Base verifier JSON)

Checklist: https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/AUDIT_READINESS_CHECKLIST.md  
Known issues: https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/KNOWN_ISSUES.md  
Whitepaper security section: WHITEOBER §11.5

## Scope (out) — Phase 1 exclusions

- `contracts/legacy/` and retired TFUEL sale contracts (Believer/Angel)
- CosmWasm / IBC reverse-bridge yield paths
- Out-of-wave circuits (full catalog)
- Off-chain gateway application code (optional separate review later)
- Tier-3 zkLLM prover (active R&D; not production settlement path)

## Deliverables requested

1. Written report (Critical / High / Medium / Low / Informational)
2. Fix review round after remediation
3. Public summary suitable for Seed diligence

## Timeline / budget

Target start: **`[DATE]`**  
Preferred turnaround: **`[N weeks]`**  
Budget range: **`[RANGE]`**

## Contact

security@xfuel.app · **`[FOUNDER NAME / CALENDAR LINK]`**

---

*XFuel Lab — equity-first raise; token-light fee path (USDC on Base).*
