# Technical Specifications

Companion to [WHITEPAPER.md](../WHITEPAPER.md). Gas figures below are measured or projected for SP1 Groth16 verification.

## Settlement home

Primary deployment: Base (8453) and Base Sepolia (84532).  
Live verifier: `ZKVerifierSP1` on Base mainnet â€” `0x9373499645292715a2275A78eD65B14215C41c06`.

Optional verifier backends also exist for CosmWasm and Solana (same BN254 / Groth16 design). Historical Theta EVM manifests are archive-only under `deploy/legacy/manifests/`.

## EVM verifier (`ZKVerifierSP1.sol`)

Capabilities:

- Single and batch proof verification (up to 20 proofs per tx)
- Nullifier tracking (replay protection)
- Circuit registry
- Circuit breaker (auto-pause on elevated failure rate)
- Optional SP1-CC composed calls, Hyperlane relay, stake-gated verify

Approximate gas (mock wrapper; live Groth16 via gateway ~270K):

| Operation | Gas |
|-----------|-----|
| `verifyProof` (gateway Groth16) | ~270K |
| `verifyProof` wrapper (mock) | ~108K |
| `verifyComposedCall` wrapper | ~220K |
| `verifyWithStakeCheck` wrapper | ~143K |
| `relayProofCrossChain` | ~403K |
| Batch of 3 (mock) | ~176K total |

## Multi-prover targets

| Backend | Method | Cost |
|---------|--------|------|
| EVM | SP1 Verifier Gateway | ~270K gas |
| CosmWasm | arkworks BN254 | ~250K gas-eq |
| Solana | alt_bn128 | ~220K CU |

Shared properties: BN254, Groth16, nullifiers, circuit registry, pause, mock mode for tests.

## SP1 proof hooks

Library: `SP1ProofHooks.sol` / `xfuel-sp1-hooks`.

- `computeNullifier`
- `computeFeeCommitment`
- `encodeAITaskPublicValues` / `encodeAITaskPublicValuesV2` (payment binding)
- `computeComposedCallNullifier`
- `encodeCrossChainPayload`

## Prover

Tier-2 settlement proofs: `services/sp1-prover` on AWS ECS, validated on Succinct, ~25s per proof. Topology: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

Tier-3 Verified Inference: `services/zkllm-prover` (active build).

## Cross-chain (optional)

Proofs can be relayed with Hyperlane (EVMâ†”EVM / Cosmos) or Wormhole (Solana). Settlement home remains Base. Routing times are typically 12â€“30s depending on path.
