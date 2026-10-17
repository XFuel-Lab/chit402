# chit402-verify

Offline verification for Chit402 receipts — verify payment binding and output commitment without calling the API.

npm: `chit402-verify` · License: Apache-2.0 · Docs: https://chit402.com

`@xfuel/verify` is an alias pinned to exactly this version (0.4.2). The `xfuel-verify` command stays.

## Installation

```bash
npm install chit402-verify
```

## Usage

### Library

```typescript
import { verifyReceipt, verifyBinding, verifyNullifier } from 'chit402-verify';

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
# One receipt: an id, a URL, a file, or - for stdin.
npx chit402-verify receipt.json
npx chit402-verify chit-39af100b-23dd-4d86-a16b-4556ca6796af
curl -s "https://api.chit402.com/receipt/RECEIPT_ID?format=json" | npx chit402-verify -

# Offline issuer history (the check is always on; with no file, a live snapshot
# must prefix-extend the copy shipped in this package, or that copy is used).
npx chit402-verify receipt.json --issuer-history issuer-history.json

# Machine-readable output
npx chit402-verify receipt.json --json

# A signed refusal (schema chit402.refusal.v1) is not a payment.
npx chit402-verify refusal.json
```

The 0.4 CLI accepts exactly: one receipt argument, `--issuer-history <file>`, `--json`, `-h`/`--help`, and `-V`/`--version`. Any other flag exits 1 (`removed_flag`). Exit codes: 0 VERIFIED, 1 INVALID, 2 COULD_NOT_CHECK.

The CLI fetches the log and anchor itself. `BASE_RPC_URL` and `SOLANA_RPC_URL` set the RPC endpoints for the anchor check; without them it falls back to public RPCs.

The on-chain payer check is not in the CLI. Use the library: `verifyReceipt(receipt, { checkPayer: true })`.

## What This Verifies

| Check | Where | Description |
|-------|-------|-------------|
| Payment binding | CLI and library | Recompute commitment from receipt fields |
| Issuer signature | CLI and library | ES256. Trusted only via JWKS (by kid) or a pinned RFC 7638 kid |
| Output hash | CLI and library | Hash is on the receipt |
| Tree head, inclusion, anchors | CLI and library | Head ES256 signature, index-and-size-bound inclusion proof, Base and Solana anchors |
| Issuer history | CLI and library, always | `iat` is inside the latest `not_before` and the earliest `not_after` for that kid. A changed `not_before` is `kid_status_regression` (exit 1). No covering key is exit 2 |
| On-chain payer / settlement | Library only (`checkPayer: true`) | Payer, payee, asset, and amount in the USDC `Transfer` log |
| Nullifier anchor | Library only (`checkNullifier: true`) | Query ZKVerifierSP1 contract |

## Issuer Signature Verification (ES256)

Receipts include `issuer_signature.jws` (compact ES256 / P-256). The signature
counts only when the verifying key is trusted: a JWKS key whose `kid` matches the
JWS, or an embedded `issuer_jwk` whose RFC 7638 thumbprint equals a trusted kid
(the default pin is the production kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`)
or is in a verified issuer-history entry. `issuer_jwk` on the receipt is not a
trust root: a copy re-signed with an arbitrary P-256 key reports `key untrusted`.

The head's signed `anchors.base.from` and `anchors.solana.fee_payer` must be on the
anchor-wallet list (the package pin, or a verified `/.well-known/anchor-wallets.json`).
Receipts that claim a content-addressed issuer pin are checked against it; see
[issuer-key-pin.md](../../docs/product/issuer-key-pin.md).

```typescript
import { verifyReceipt } from 'chit402-verify';

const result = await verifyReceipt(receipt, { checkPayer: true });
console.log(result.issuer_signature.valid);      // true only for a trusted key
console.log(result.issuer_signature.key_trusted);
console.log(result.amount_usdc);                 // from verified claims, not the outer copy
console.log(result.claim_mismatches);            // any signed path whose outer copy disagrees
console.log(result.unsigned_fields);             // outer paths the signature does not cover
console.log(result.verified_scope);              // 'signed_claims'
```

Amount, payer, payee, asset, and tx are read from the verified JWS claims.
Every signed path is compared with the outer receipt. A mismatch fails.
Paths the signature does not cover are `unsigned_fields` and are printed as
`UNVERIFIED`. Overall does not verify them. The outer document `schema` is
not a copy of the JWS `schema`. A matching inclusion proof does not make a
tampered receipt VERIFIED.

A paid USDC receipt whose signed `binding.expected_commitment` is null is
reported as “No payment-binding commitment”, not as an unmetered or TFUEL receipt.

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

`unsupported_version` uses exit 1. Nothing turns an unknown version into a pass; any flag other than `--issuer-history <file>` and `--json` exits 1 (`removed_flag`). The check runs before any chain RPC.

## Receipt versions

The signed JWS payload is the version. It is an exact JSON number. Strings, booleans, arrays, null, and non-integers are `unsupported_version`. `11.0` and `1.1e1` are the number 11.

| Signed field | Accepted |
|---|---|
| `v` | `11`, and the claims must not contain `payload_version` |
| `payload_version` | integers `1` through `10`, and `11` only when `issuer_root` is signed |
| refusal `payload_version` | integers `1`, `2`, `3` |
| neither field | outer version `4` or `5`, and no field introduced at v6 or later (`version_source: inferred`) |

An outer `v` or `issuer_signature.payload_version` that differs in value or type is `version_mismatch`. A `v` or `payload_version` in the JWS protected header is ignored.

Receipts issued after 2026-10-08 require `chit402-verify` (or the `@xfuel/verify` alias) >= 0.3.5. Older versions may print VERIFIED for formats they do not understand. `--help` and `--version` print this list.

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
