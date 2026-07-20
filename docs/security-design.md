# Security Design

Defense-in-depth for settlement, proofs, and the agent gateway.  
Audit scope: WHITEPAPER §11.5. Readiness: [AUDIT_READINESS_CHECKLIST.md](./AUDIT_READINESS_CHECKLIST.md).

## Trust ladder

1. Tier 1 — signed receipt (route, model, cost, output hash)
2. Tier 2 — SP1 settlement proof on Base (fees, payment binding when enabled, output commitment, nullifier)
3. Tier 3 — Verified Inference via self-owned zkLLM (`services/zkllm-prover`) for open-weight models

Tier 2 proves correct settlement metadata, not black-box model correctness. Tier 3 targets computation authenticity for eligible models.

## Surfaces

| Surface | Controls |
|---------|----------|
| `ZKVerifierSP1` | Groth16/PLONK verify, nullifier replay protection, role-gated admin |
| `SP1ProofHooks` | Canonical encoding of public values / commitments |
| x402 / gateway | Agent-side payer; no server hot wallets for USDC; HMAC webhooks |
| Fee sink | Single Base address (`X402_PAY_TO` / Splits) — off hot path ([ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md)) |
| Providers | Pluggable; treat as untrusted compute; bind outputs via hashes / proofs |

## Principles

- Minimize bespoke on-chain money movement (token-light USDC sink)
- Settlement and proofs on Base (Safe-compatible custody) — [ADR 0002](./adr/0002-base-settlement-home.md)
- Pause / roles via OpenZeppelin patterns on core contracts
- Never demo mock provers (`services/zkgpt-prover`) as live proofs
- Coordinated disclosure — [bug-bounty.md](./bug-bounty.md)

## Related

- [RUNTIME_STATE.md](./RUNTIME_STATE.md) — what is real vs mock today
- [VERIFIED_INFERENCE_TIERS.md](./VERIFIED_INFERENCE_TIERS.md)
- [SECURITY.md](../SECURITY.md)
