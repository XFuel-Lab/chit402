# ERC-8004 Validation Registry

Phase 3 of [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).  
XFuel maps a PBR receipt into an ERC-8004 validation response so third parties can read an on-chain verdict for an agent task.

Adapter: `contracts/core/XFuelValidationAdapter.sol` (isolates EIP churn).  
Gateway: `POST /erc8004/validate`. MCP: `get_validation_status`.

Flow: agent opens `validationRequest` naming the adapter → gateway builds response from task receipt → adapter submits `validationResponse` (score 0–100 + evidence).

Registry address is deployment-pinned. See EIP-8004 for upstream semantics.
