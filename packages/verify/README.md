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
console.log(fullResult.receipt_lane.freeze); // unsigned; does not change overall
```

### CLI

```bash
# Local binding verification (no network required)
npx xfuel-verify receipt.json

# Hash the canonical object (must match signed payload_hash) and read not_after
# from a pinned issuer-history snapshot. Both flags are offline.
npx xfuel-verify receipt.json --canonical-preimage preimage.json --issuer-history-file issuer-history.json

# A signed refusal (schema chit402.refusal.v1) is not a payment.
# The check proves the issuer refused, at the signed anchor, for that code.
# It does not prove a payment or that the block still stands.
npx xfuel-verify refusal.json

# With on-chain nullifier check (requires network)
npx xfuel-verify receipt.json --check-nullifier

# Output as JSON
npx xfuel-verify receipt.json --json

# From stdin
curl -s https://api.chit402.com/receipt/task-123?format=json | npx xfuel-verify -

# Dual anchor: inclusion, Solana memo, Base calldata
npx xfuel-verify receipt.json inclusion.json head.json --rpc
```

## What This Verifies

| Check | Requires Network? | Description |
|-------|-------------------|-------------|
| Payment binding | No | Recompute commitment from receipt fields |
| Issuer signature | No, unless `--fetch-jwks` | ES256. Trusted only via JWKS (by kid) or a pinned RFC 7638 kid |
| Output hash | No | Hash is on the receipt |
| On-chain settlement | Yes | Query Base RPC for tx |
| Nullifier anchor | Yes | Query ZKVerifierSP1 contract |
| Anchored receipt root | Yes, with `--rpc` | Inclusion proof, then Solana memo and Base calldata for that root |
| Canonical preimage | No | SHA-256 of `--canonical-preimage`, or the stored canonical object, matches signed `payload_hash` |
| Issuer history | No, with `--issuer-history-file` | `iat` is inside the kid's `not_before` / `not_after`. A payload v10 pin must match the snapshot hash |
| Issuer root | Only when a pin is set | Opt-in. Two finalized Base RPCs, `_issuer` TXT, and the legacy freeze. No pin keeps the 0.3.0 result |

## Issuer root (0.4.0)

Root checks stay off until you pass a pin. Nothing in this package is a trusted mainnet registry address.

```bash
# Base Sepolia. The registry address comes from the deploy, not from npm.
npx xfuel-verify receipt.json \
  --pinned-chain eip155:84532 \
  --pinned-registry 0xYourSepoliaRegistry \
  --registry-rpc https://your-second-rpc.example

# Airgapped: package trust only, and only for the genesis kid.
npx xfuel-verify receipt.json --pinned-chain eip155:84532 --pinned-registry 0xYourSepoliaRegistry --offline
```

`CHIT_PINNED_CHAIN` and `CHIT_PINNED_REGISTRY` are the same pin. `pass_dns_unavailable` is a pass printed in yellow. `unverified_root` and `pin_only` are not passes. An unsigned `--root-cache` is reported as `as of block N, caller cache` and does not upgrade the verdict.

With no pin, `root_checked` is false. That is not a root pass. Payload v11 and any receipt with `issuer_root` still require a signed `iat`. A missing one fails `missing_signed_iat`. The unsigned `created_at` is not the key-window clock. v7–v10 receipts that never signed `iat` still use `created_at` for the issuer-history window.

Payload v11 and refusal v2 require `canonicalization` `{ hash_alg: "sha-256", jcs: "RFC8785" }` with no `string_escaping` field. The verifier recomputes `payload_hash` with RFC 8785. `snapshot_hash` is SHA-256 of the RFC 8785 bytes of the embed `entries` array, and `issuer_history.hash` must equal that digest. `entry_hash` and flag-off history pins stay on `chit402-jcs-v1`. With no registry pin and no fetched history document, the embed is `self_asserted` (`ok: false`) and `overall` is `partial`. That is not a history proof, in the same way `root_checked: false` is not a root pass.

A v11 receipt may sign `policy`. The object is exactly `policy_id`, `policy_version`, `dispute_window_seconds`, `retention_days`, `retention_mode` (`compliance`), `max_cumulative_spend` (an atomic-USDC string, or null), and `policy_hash`. `policy_hash` is lowercase hex SHA-256 of the RFC 8785 bytes of those six fields. An extra or missing field, a wrong type, a retention mode other than `compliance`, or a hash mismatch fails the receipt. A session grant's spend cap stays on `session.max_cumulative_spend` and is not part of `policy`. Flag-off and pre-v11 receipts omit `policy`. A v11 receipt with no `policy` is `POLICY_ABSENT`: the other checks still run, and `overall` is not a clean pass.

`xfuel-verify --json` includes a `policy` section with those terms. Policy history (`--policy-history-file`, or `GET /.well-known/receipt-policy-history.json` when `--fetch`, `--fetch-jwks`, or `--rpc` opts into the network) must contain `policy_hash` with `effective_from` at or before the receipt's issued time. Without that opt-in the history is `not_checked`. It is not reported as a pass.

`--policy-version <v>` or `--policy-pin <file>` cross-checks the signed terms against that pinned version. Any difference fails `policy_pin_mismatch`. `retention_days` under 365, or shorter than the dispute window, fails `policy_retention_floor`.

`--issuer-commit repo@sha` and `--issuer-commit-file` supply an off-host copy of the issuer history. That copy, the snapshot, and the Base registry are compared. A disagreement fails by name (`commit_snapshot_disagree`, `commit_registry_disagree`, `snapshot_registry_disagree`). A document served from a chit402 host is `self_asserted` and is never `independent`. One copy is never `independent`. A key the guardian quorum retired fails `KEY_RETIRED` at or after that block. The signing key cannot also be a guardian. A guardian-set change that Base did not order fails `guardian_set_unordered`.

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

# Recompute published preimages and check the kid window.
# A payload v10 receipt pins issuer_history. Hash the stored canonical object:
curl -sS "https://api.chit402.com/receipt/RECEIPT_ID?format=json" -o receipt.json
curl -sS "https://api.chit402.com/receipt/RECEIPT_ID/preimage" -o preimage.json
curl -sS "https://api.chit402.com/.well-known/issuer-history.json?version=1" -o issuer-history.json
npx xfuel-verify receipt.json --canonical-preimage preimage.json --issuer-history-file issuer-history.json

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
