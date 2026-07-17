# AITaskPublicValues — Proof Public Values Layout

The SP1/zkGPT proof commits to an `AITaskPublicValues` tuple. These are the
public outputs verified on-chain by `ZKVerifierSP1.verifyProof(...)` and are what
a verifier or auditor inspects to confirm what was proven.

| Field | Type | Meaning |
|-------|------|---------|
| `taskType` | uint8 | Intent type (inference, compute, attestation, …). |
| `sourceChain` | uint32 | Origin chain/domain. |
| `destChain` | uint32 | Settlement chain/domain. |
| `taskIdHash` | bytes32 | keccak256 of the task id. |
| `senderHash` | bytes32 | Hash of the sender identity. |
| `netAmount` | uint256 | Amount after fee (wei). |
| `feeAmount` | uint256 | Protocol fee (wei). |
| `feeBps` | uint16 | Fee rate in basis points (50–100). |
| `outputHash` | bytes32 | keccak256 of the task output — compare against your result. |
| `blockHeight` | uint64 | Block height at proof generation. |
| `timestamp` | uint64 | Unix timestamp. |
| `nonce` | uint256 | Replay-protection nonce (feeds the nullifier). |
| `paymentCommitment` *(v2, Phase 2)* | bytes32 | **Optional 13th field** — binds the x402 `payment_ref` to the task so the proof attests payment + computation. `bytes32(0)` = unbound (TFUEL rail or binding disabled). See below. |

## v2 payment binding (Phase 2, flag-gated)

When `X402_PROOF_BINDING` is enabled for a USDC/x402 task, the layout is extended
with a trailing `paymentCommitment`:

```
paymentCommitment = keccak256(abi.encodePacked(paymentRefHash, taskIdHash, paymentRail, amount))
```

(`paymentRail`: 1 = USDC, 2 = TFUEL). Encoded on-chain by
`SP1ProofHooks.encodeAITaskPublicValuesV2(...)` and mirrored off-chain by
`services/gateway/src/payment-binding.js` (parity-tested). Surfaced in
`/task-status` and `/prove-result` as `payment_binding`. `in_proof` becomes `true`
once the SP1 guest commits this layout (new `programVKey`); until then it is
server-attested settlement metadata. The v1 12-field layout is unchanged.

### Activating v2 in the SP1 guest

Guest-side support lives in `sp1-prover/program` (in-circuit verify) and
`core-layer/sp1-hooks` (shared keccak + ABI encode). The host selects the layout via
`SP1_PUBLIC_VALUES_V2` (prover env) together with a non-zero `payment_commitment` on
the `/prove` request.

**Steps:**

1. **Rebuild** the SP1 guest ELF and host binary (`sp1-prover/script/build.ps1` or
   `build.sh`). Requires the Succinct SP1 toolchain.
2. **Register** the new `programVKey` on `ZKVerifierSP1` for AI-task proofs (13-field
   decode). Addresses: `deploy/manifests/`.
3. **Prover host:** `SP1_PUBLIC_VALUES_V2=true` (CUDA, ZAN PowerZebra, or local host).
4. **Backend:** `X402_PROOF_BINDING=true` + `X402_ENABLED=true` for USDC tasks.
5. **Verify:** `payment_binding.in_proof === true` in `/task-status`, or run
   `packages/sdk/examples/pay-prove-verify.ts` (re-derives commitment independently).

**Rollback:** unset `SP1_PUBLIC_VALUES_V2` on the prover; v1 proofs and the existing
vKey continue to work. No M2M API change between phases.

**Implementation map:**

| Layer | Path |
|-------|------|
| Solidity (source of truth) | `contracts/core/SP1ProofHooks.sol` |
| Rust hooks (guest + host) | `core-layer/sp1-hooks/src/payment_binding.rs` |
| SP1 guest verify | `sp1-prover/program/src/main.rs` (`validate_ai_task`, v2 branch) |
| SP1 host version switch | `sp1-prover/host/src/main.rs` (`resolve_public_values_version`) |
| Backend threading | `services/gateway/src/payment-binding.js`, `services/gateway/src/ai-listener.js` |

## Nullifier

The nullifier is derived from `(taskIdHash, senderHash, nonce)` and is recorded
on-chain on first verification. A spent nullifier means the proof was already
settled — re-submitting the same proof is rejected (replay protection).

Read on-chain: `ZKVerifierSP1.usedNullifiers(bytes32) view returns (bool)` (public
mapping). The SDK exposes this as `XFuelOnChain.isNullifierUsed(nullifier)`.

## Source of truth

- Encoding/commitment: `contracts/core/SP1ProofHooks.sol`.
- Verification: `contracts/core/ZKVerifierSP1.sol` (`verifyProof`, `relayProofCrossChain`).
- Addresses per network: `deploy/manifests/`.

> Note: field names/order reflect the protocol reference in `AGENTS.md`. If you
> need byte-exact ABI decoding, generate it from `SP1ProofHooks.sol` rather than
> hand-decoding from this table.
