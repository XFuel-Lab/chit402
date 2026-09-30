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
curl -s https://api.chit402.com/receipt/task-123?format=json | npx xfuel-verify -
```

## What This Verifies

| Check | Requires Network? | Description |
|-------|-------------------|-------------|
| Payment binding | No | Recompute commitment from receipt fields |
| Issuer signature | No, unless `--fetch-jwks` | ES256. Trusted only via JWKS (by kid) or a pinned RFC 7638 kid |
| Output hash | No | Hash is on the receipt |
| On-chain settlement | Yes | Query Base RPC for tx |
| Nullifier anchor | Yes | Query ZKVerifierSP1 contract |

## Issuer Signature Verification (ES256)

Receipts include `issuer_signature.jws` (compact ES256 / P-256). The signature
counts only when the verifying key is trusted:

1. **JWKS by kid** — a key in `--jwks-file`, `--jwks-url`, or `--fetch-jwks`
   (allowlisted host, default `api.chit402.com`) whose `kid` matches the JWS.
2. **Pinned thumbprint** — the embedded `issuer_jwk` is used only when its
   RFC 7638 thumbprint equals a trusted kid. The default offline pin is the
   production kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`. Override with
   `--trusted-kid`, or disable with `--no-trusted-kid`.

`issuer_jwk` on the receipt is not a trust root. A copy re-signed with an
arbitrary P-256 key reports `key untrusted` (`issuer_signature.valid === false`),
including when `--jwks-file` points at the real JWKS.

```bash
# Offline: default production pin, no network
npx xfuel-verify receipt.json

# Trust the published JWKS instead of (or in addition to) the pin
curl -o issuer-jwks.json https://api.chit402.com/.well-known/jwks.json
npx xfuel-verify receipt.json --jwks-file issuer-jwks.json --no-trusted-kid

# Fetch the issuer JWKS (https://api.chit402.com/.well-known/jwks.json)
npx xfuel-verify receipt.json --fetch-jwks
```

```typescript
import { verifyReceipt } from '@xfuel/verify';

const result = await verifyReceipt(receipt);
console.log(result.issuer_signature.valid);      // true only for a trusted key
console.log(result.issuer_signature.key_trusted);
console.log(result.amount_usdc);                 // from verified claims, not the outer copy
console.log(result.claim_mismatches);            // outer payment / caller_binding vs JWS
```

Amount, payer, payee, asset, and tx are read from the verified JWS claims.
If the unsigned outer `payment` or `caller_binding` disagrees, verification
fails. `--check-payer` on Base confirms payer, payee, asset, and amount in the
USDC `Transfer` log.

A paid USDC receipt whose signed `binding.expected_commitment` is null is
reported as “No payment-binding commitment”, not as an unmetered or TFUEL receipt.

The CLI does **not** fetch JWKS unless `--fetch-jwks` or `--jwks-url` is set.
Exit code 1 is returned when the key is untrusted, the signature is invalid, or
a signed claim disagrees with the outer copy.

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

## Build digest

`npm run digest` writes `BUILD_DIGEST.txt`. That file is the SHA-256 of the sorted `src/**/*.ts` listing, not a bit-reproducible `tsc` binary. The same sources produce the same digest. The receipt-tree genesis leaf copies this digest so a holder can see which verifier source the issuer vouches for. It does not prove the process that served the receipt ran that exact binary.

## License

Apache-2.0
