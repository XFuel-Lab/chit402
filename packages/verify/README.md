# chit402-verify

Offline verification for Chit402 receipts — verify payment binding and output commitment without calling the API.

npm: `chit402-verify` · License: Apache-2.0 · Docs: https://chit402.com

`@xfuel/verify` 0.4.1 is an alias pinned to exactly this version. The `xfuel-verify` command stays.

## Installation

```bash
npm install chit402-verify
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
# History is always checked. With no file, a live snapshot must prefix-extend
# the copy shipped in this package, or that copy is used (as of 2026-10-14).
# The on-chain payer check runs as well. Exit 0 needs that check to pass.
npx chit402-verify receipt.json

# Offline history. Every other flag is removed.
npx chit402-verify receipt.json --issuer-history issuer-history.json

# Output as JSON
npx chit402-verify receipt.json --json

# From stdin
npx chit402-verify - < receipt.json
```

## What This Verifies

| Check | Requires Network? | Description |
|-------|-------------------|-------------|
| Payment binding | No | Recompute commitment from receipt fields |
| Issuer signature | No | ES256. The CLI trusts the pinned kid and issuer history. `--fetch-jwks` is not a CLI flag |
| Output hash | No | Hash is on the receipt |
| On-chain payer | Yes, always in the CLI | Base or Solana USDC transfer: payer, payee, asset, and amount. A mismatch is exit 1. An RPC that does not answer is exit 2 |
| Nullifier anchor | Yes | Query ZKVerifierSP1 contract |
| Tree head and inclusion | No | Head ES256 signature over size and root, then an index-and-size-bound inclusion proof |
| Anchored receipt root | Yes, when the log serves a head | The CLI fetches the inclusion and the head, then the Solana memo and the Base calldata. `--rpc` is not a CLI flag |
| Canonical preimage | No | A stored canonical object must match signed `payload_hash`. `--canonical-preimage` is not a CLI flag |
| Issuer history | Always. File, else a live prefix of the shipped snapshot, else the shipped snapshot | `iat` is inside the latest `not_before` and the earliest `not_after` for that kid. A changed `not_before` is `kid_status_regression` (exit 1). No covering key is exit 2 |

## Issuer Signature Verification (ES256)

Receipts include `issuer_signature.jws` (compact ES256 / P-256). The signature
counts only when the verifying key is trusted:

1. **JWKS by kid** — a key supplied to `verifyReceipt` as `jwks`, matched by `kid`.
   The CLI does not take `--jwks-file`.
2. **Pinned thumbprint** — the embedded `issuer_jwk` is used only when its
   RFC 7638 thumbprint equals a trusted kid. The default offline pin is the
   production kid `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`.

The CLI checks the tree head it fetches for the receipt. An embedded key still has to match the trusted-kid pin, or the kid has to be in a verified issuer-history entry. The head's signed `anchors.base.from` and `anchors.solana.fee_payer` must be on the anchor-wallet list. The chain sender and fee payer must be those wallets. `--version` prints `chit402-verify 0.4.6`. Flags other than `--issuer-history` and `--json` exit 1.

Anchor mode also checks a content-addressed issuer pin when the receipt or the head carries `issuer_key_pin`, or when you pass `--issuer-pin`. The pin is a 40-hex commit plus the SHA-256 of `docs/well-known/issuer-key.json`. A branch name is not fetched. A claimed pin requires `issuer_signature.jws` verified under that key. Unsigned envelope kids do not satisfy the check. The registration self-signature is checked when the file has one. A claimed era with no pin fails `ISSUER_PIN_DOWNGRADE`. Receipts that do not claim the era skip this check. The pin chain is Base Sepolia (`eip155:84532`). See [issuer-key-pin.md](../../docs/product/issuer-key-pin.md).

`issuer_jwk` on the receipt is not a trust root. A copy re-signed with an
arbitrary P-256 key reports `key untrusted` (`issuer_signature.valid === false`),
including when `--jwks-file` points at the real JWKS.

```bash
# History is always on. A local snapshot:
npx xfuel-verify receipt.json --issuer-history issuer-history.json

# Recompute a published canonical preimage and check the kid window.
# curl -f stops on HTTP errors. Most receipts have no /preimage (a 404).
# A missing preimage is not a verification failure: omit --canonical-preimage.
curl -fsS "https://api.chit402.com/receipt/RECEIPT_ID?format=json" -o receipt.json
curl -fsS "https://api.chit402.com/.well-known/issuer-history.json?version=1" -o issuer-history.json
if curl -fsS "https://api.chit402.com/receipt/RECEIPT_ID/preimage" -o preimage.json; then
  npx xfuel-verify receipt.json --canonical-preimage preimage.json --issuer-history issuer-history.json
else
  npx xfuel-verify receipt.json --issuer-history issuer-history.json
fi

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
console.log(result.claim_mismatches);            // any signed path whose outer copy disagrees
console.log(result.unsigned_fields);             // outer paths the signature does not cover
console.log(result.verified_scope);              // 'signed_claims'
```

Amount, payer, payee, asset, and tx are read from the verified JWS claims.
Every signed path is compared with the outer receipt. A mismatch fails.
Paths the signature does not cover are `unsigned_fields` and are printed as
`UNVERIFIED`. Overall does not verify them. The outer document `schema` is
not a copy of the JWS `schema`. The CLI always checks the USDC `Transfer`
log for payer, payee, asset, and amount. `verifyReceipt(receipt, { checkPayer: true })`
is the same check. There is no CLI flag to skip it.

`xfuel-verify receipt.json inclusion.json head.json` also runs those receipt
checks. A matching inclusion proof does not make a tampered receipt VERIFIED.

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
- `proof.nullifier`: settlement proof add-on (coming soon, not active)

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
| 0 | `VERIFIED`. Every check passed, including the on-chain payer check |
| 0 | `VERIFIED_PUBLIC` (0.4.6). A public shell's attestation verified. Scope: settled amount, payee, tx, log position. The payer and fulfillment are not claimed |
| 1 | `INVALID`. Tamper, a bad signature, a revoked key, a payer mismatch, `NOT_IN_LOG` |
| 2 | `COULD_NOT_CHECK`. The log, the anchor, or the payer was not checked. An RPC timeout, a null or error result, a missing payer field, an unsigned public shell, or an unsupported rail is this code |

The command is `chit402-verify <id|url|file|-> [--issuer-history <file>] [--json]`. `-h`/`--help` and `-V`/`--version` exit 0. Any other flag, and any argument after `--`, exits 1. `unsupported_version` is exit 2 and is decided before any chain RPC. No flag turns it into a pass.

Offline, with no RPC reachable, a signed receipt is exit 2. It is not exit 0. A fabricated `payment.ref` is also exit 2: the chain was not checked, so it is not a mismatch. Old receipts still verify when the signed transfer is on chain and the log check passes. Solana credits the signed payee in USDC; a missing payee is exit 2. The Base payer read waits 12 seconds. Each Base anchor call waits 8 seconds. The Solana payer read waits 30 seconds, and each Solana anchor call waits 30 seconds. The payer reads do not retry. Since 0.4.10 the anchor lookups do: each chain tries up to two attempts per endpoint (backoff 400 ms) over a public fallback list (Base: `mainnet.base.org`, `base-rpc.publicnode.com`, `1rpc.io/base`; Solana: `api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`), and starts no new attempt after 30 s on Base or 45 s on Solana. Setting `BASE_RPC_URL` or `SOLANA_RPC_URL` replaces that chain's list with your endpoint, still retried.

One confirmed anchor is enough (0.4.10). When the head claims both chains and one confirms the root while the other chain's RPC lookup only failed (error, timeout, or null), the anchor check passes. Human output adds a line such as `Solana not checked: its anchor RPC did not answer. The anchor was confirmed on Base only.`, and `--json` sets `log.partial: true`, `log.unchecked_anchors` (for example `["solana"]`) and `log.warnings` (for example `["solana:solana_rpc_error"]`). Only a transport failure counts: a network error, a timeout, or an HTTP error status. A JSON-RPC error object, a body that is not a JSON-RPC answer, a refused redirect, a bad RPC URL, or a malformed transaction is `*_rpc_rejected` (exit 2, not covered). An anchor reference in the signed head that is not a 64-byte base58 Solana signature or a `0x` + 64-hex Base hash is `anchor_ref_invalid` (exit 1), with no RPC call. A node that answers a well-formed reference with JSON-RPC -32602/-32600 (some public nodes do this for archive reads) is that endpoint rejecting the call: the next endpoint in the list is asked, and if none gives an answer the result is `*_rpc_rejected` (exit 2). Every check on a fetched transaction (calldata, sender, revert, memo, fee payer, slot) runs before the side reads (chain id, tip, genesis), so a failed side read cannot hide a mismatch. RPC calls do not follow redirects. Each call's deadline also covers reading the response body.

The payer check on a public shell reads the payment from Base. So when Base is unreachable the result is exit 2 `payer_unchecked` even if Solana confirms the anchor; in practice the one-chain rule helps when Solana is the chain that did not answer.

The verifier trusts the endpoint it reads, as in 0.4.9: a confirmation from the first endpoint that answers is not cross-checked against a second endpoint. An opt-in cross-check (ask two endpoints and require agreement) is planned for 0.4.11. A mismatch on either chain (memo, calldata, sender, fee payer, cluster, slot, reverted or failed tx) is still exit 1 and is never outvoted by the other chain. Any other unchecked state (not finalized, too shallow, not found) is not covered by the other chain. No chain confirmed is still exit 2. The epoch record is trusted only for a history key that was active at the verified head's `published_at` and was never revoked. The JSON verdict keys are unchanged. `payer_unchecked` is the reason when the payer check is the one that did not finish.

## Receipts issued before the public log (Oct 2, 2026)

The public receipt log began on Oct 2, 2026. Its first receipt leaf (epoch 1, leaf index 1, after the genesis leaf) is `xfuel-39af100b-23dd-4d86-a16b-4556ca6796af`, issued 2026-10-02 17:30 UTC. Receipts issued before that have no log leaf, and their public shell shows `inclusion.leaf_hash: null`. The gateway pins that start time as `PUBLIC_LOG_START` in `services/gateway/src/receipt-shell.js`, because the epoch records carry roots and sizes, not times.

For those receipts the verifier gives exit 1 `NOT_IN_LOG`. That is the documented result for a receipt with no log leaf, and this release does not change it.

What it means: no public log entry covers the receipt, so the log cannot show that the issuer committed to it, and a third party cannot confirm it from the log.

What it does not mean: it is not evidence of tampering or a forged signature. A receipt that predates the log fails the log check whether it is genuine or not, so exit 1 here does not tell those apart.

What can still be checked:
- Anyone can read the payment tx on Base and see whether a USDC transfer of the stated amount went to the stated payee.
- The owner can run `npx chit402-verify@latest` on their signed receipt. In `--json`, `checks.signature`, `checks.key_window` and `checks.payment_binding` still report pass or fail. The overall result stays exit 1, because `checks.log_inclusion` is `fail`.

A public shell alone (no signed receipt) cannot check the signature or the payer: those checks are `could_not_check`.

The public shell JSON for such a receipt carries a `log_note` with the same plain text the receipt page shows. The verifier ignores it, and the verdict is the same with or without it.

## Public receipt attestation (0.4.6)

A public shell may carry `public_attestation: { "jws": "..." }`, or `{ "status": "pending" }` while it is being signed. The JWS typ is `chit402-public-receipt+jwt`. Its payload is not JSON: it is the line `chit402.public_receipt.v1` and a newline, then the RFC 8785 canonical claims. The claims are exactly `task_id`, `iss`, `issued_at` (minute), `attested_at` (minute), `payment` {`rail`, `ref`, `asset`, `payee`, `gross_amount`, `settled_amount`}, and `log` {`epoch`, `leaf_index`, `leaf_hash`}. `payload_version` and `v` are not allowed. The full-receipt hash is not part of it.

`VERIFIED_PUBLIC` (exit 0) needs all of these:
- The JWS parses to that exact shape, with canonical claim bytes.
- The kid is a verified issuer-history key, its JWK thumbprint is the kid, the signature verifies, and the key is active and never revoked for the whole `attested_at` minute.
- The id you asked for, and every outer shell field, equals the signed value. A swapped id is exit 1 `claim_mismatch`.
- A fresh inclusion proof for the signed leaf hash at the signed index reaches a trusted, anchored head. A different leaf is exit 1 `leaf_not_bound`. A different index is exit 1. A different epoch, or (0.4.7) a log that serves no epoch, is exit 2.
- The Base receipt is on chain 8453, succeeded, is at least 12 blocks deep, and holds exactly one USDC Transfer to the signed payee for the signed `settled_amount`. Other Transfers in the same tx are ignored; zero or two to the payee is exit 1 `transfer_mismatch`. The reported sender is the token sender, not `tx.from`. An RPC that does not answer, fewer than 12 blocks, or (0.4.7) a log marked `removed` is exit 2. Only the settled amount is checked on chain.

A malformed or invalid attestation is exit 1. It never falls back to `signed_receipt_unavailable`. A pending one is exit 2. Base only; Solana is a later release. Every published verifier from 0.3.0 to 0.4.5 rejects the tagged payload. `verifyIssuerJws` refuses this typ, so the attestation cannot stand in for a receipt, tree head, epoch, refusal, or history signature.

## Receipt versions

The signed JWS payload is the version. It is an exact JSON number. Strings, booleans, arrays, null, and non-integers are `unsupported_version`. `11.0` and `1.1e1` are the number 11.

| Signed field | Accepted |
|---|---|
| `v` | `11`, and the claims must not contain `payload_version` |
| `payload_version` | integers `1` through `10`, and `11` only when `issuer_root` is signed |
| refusal `payload_version` | integers `1`, `2`, `3` |
| neither field | outer version `4` or `5`, and no field introduced at v6 or later (`version_source: inferred`) |

An outer `v` or `issuer_signature.payload_version` that differs in value or type is `version_mismatch`. A `v` or `payload_version` in the JWS protected header is ignored.

Use `chit402-verify` 0.4.9 or later. Older versions may print VERIFIED for formats or documents they should refuse. `--help` and `--version` print this list.

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
