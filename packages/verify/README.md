# @xfuel/verify

Offline verification for Chit402 receipts — verify payment binding and output commitment without calling the API.

npm: `@xfuel/verify` · License: Apache-2.0 · Docs: https://chit402.com

## Installation

```bash
npm install @xfuel/verify
```

## Usage

### Library

```typescript
import { verifyReceipt, verifyBinding, verifyNullifier } from '@xfuel/verify';

// Verify a receipt offline (binding only, no network)
const receipt = { /* Chit402 receipt JSON */ };
const result = verifyBinding(receipt);
console.log(result.matches); // true if binding verified

// Full verification including on-chain nullifier check
const fullResult = await verifyReceipt(receipt, { checkNullifier: true });
console.log(fullResult.overall); // 'verified' | 'partial' | 'failed'
```

### CLI

```bash
# Local binding verification (no network required)
npx xfuel-verify receipt.json

# With on-chain nullifier check (requires network)
npx xfuel-verify receipt.json --check-nullifier

# Output as JSON
npx xfuel-verify receipt.json --json

# From stdin
curl -s https://api.xfuel.app/receipt/task-123?format=json | npx xfuel-verify -
```

## What This Verifies

| Check | Requires Network? | Description |
|-------|-------------------|-------------|
| Payment binding | No | Recompute commitment from receipt fields |
| Issuer signature | No | ES256/JWKS verification (requires JWKS file) |
| Output hash | No | Hash is on the receipt |
| On-chain settlement | Yes | Query Base RPC for tx |
| Nullifier anchor | Yes | Query ZKVerifierSP1 contract |

## Issuer Signature Verification (ES256/JWKS)

Receipts may include an `issuer_signature` signed with ES256 (P-256). Verify it offline:

```bash
# Download JWKS once (or obtain from trusted source)
curl -o issuer-jwks.json https://api.chit402.com/.well-known/jwks.json

# Verify receipt with JWKS file (no network during verification)
npx xfuel-verify receipt.json --jwks-file issuer-jwks.json
```

The CLI does **not** automatically fetch JWKS to ensure offline verification. You must explicitly provide a JWKS file. Exit code 1 (failed) is returned if the signature is invalid or tampered.

## Frozen Fields

These fields are immutable once set and verifiable by any third party:

- `task_id` — unique task identifier
- `route.provider` — compute hub (theta-edgecloud, akash-network)
- `route.model` — model that served the request
- `payment.gross_amount` — total charged in USDC atomic units
- `payment.ref` — settlement reference (network:txHash)
- `output.hash` — commitment to model output
- `proof.nullifier` — single-use nullifier anchored on-chain

## Verification Algorithm

The binding commitment is computed as:

```solidity
// Payment-only binding
keccak256(abi.encodePacked(
  keccak256(payment_ref),
  keccak256(task_id),
  rail_discriminant,  // 1=usdc, 2=tfuel
  amount
))

// PBR (Payment-Bound Receipt) — includes model + output
keccak256(abi.encodePacked(
  keccak256(payment_ref),
  keccak256(task_id),
  rail_discriminant,
  amount,
  model_commitment,
  output_hash
))
```

This matches `SP1ProofHooks.computePaymentCommitment` on-chain.

## Exit Codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | Verified |
| 1 | Verification failed |
| 2 | Partial (binding ok, nullifier not checked) |
| 3 | Input error |

## API Reference

### `verifyBinding(receipt)`

Verify payment binding locally. Returns:

```typescript
{
  verified: boolean;
  expected: string | null;
  recomputed: string | null;
  matches: boolean;
  covers: string[];
  reason?: string;
}
```

### `verifyNullifier(receipt, options?)`

Verify nullifier is anchored on-chain. Requires network access.

```typescript
{
  verified: boolean;
  nullifier: string | null;
  anchored: boolean | null;
  reason?: string;
}
```

### `verifyReceipt(receipt, options?)`

Full verification combining binding and optional nullifier check.

```typescript
{
  receipt_id: string;
  binding: BindingVerification;
  nullifier: NullifierVerification;
  output_hash: string | null;
  hub: string | null;
  model: string | null;
  amount_usdc: string | null;
  tx: string | null;
  overall: 'verified' | 'partial' | 'failed';
  errors: string[];
}
```

## License

Apache-2.0
