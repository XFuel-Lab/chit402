# Offline receipt verification

Third parties verify a Chit402 receipt **without trusting HTML or live API**
for the signature step.

## Start from the owner copy

The public URL `GET /receipt/:taskId?format=json` returns the unsigned public
shell (`chit402.receipt_shell.v1`, `unsigned: true`). It has no
`issuer_signature`, and the CLI exits 2 (`signed_receipt_unavailable`) on it.
The signed receipt is the owner copy:

- the receipt JSON the payer saved at settlement, or
- the owner view, `GET /v1/receipts/:receipt_id/owner` after the wallet
  challenge. It returns the original `jws`, `private_fields` and `row_hash`.

## Pin-first path (issuer_jwk)

New receipts pin the issuer public key at `issuer_signature.issuer_jwk`.

1. Take the owner copy (above). The public URL does not carry the JWS.
2. Read `issuer_signature.jws` (compact JWS), or `jws` from the owner view.
3. Verify ES256 with `issuer_signature.issuer_jwk` (P-256), or with the key
   whose thumbprint is the pinned kid in the JWS header.
4. Decode JWS payload → confirm binds:
   - `caller_binding.payer_wallet` (payer)
   - `payment.payee` (treasury / payTo)
   - `payment.asset` (USDC)
   - `payment.gross_amount` (atomic 6 dp)
   - `payment.ref` (tx: `base:0x…`)
5. The CLI checks the settlement on chain by default. On Base, the USDC
   transfer `from` is the payer, `to` is the payee, and the amount is at
   least `gross_amount`.

CLI:

```bash
npx chit402-verify receipt.json --json
```

Library:

```typescript
import { verifyReceipt } from 'chit402-verify';

const result = await verifyReceipt(receipt, { checkPayer: true });
// result.issuer_signature.valid — pinned kid, or a key in issuer history
// result.payer — the CLI runs this check by default
```

## Issuer key

The CLI does not download a JWKS file, and it does not match
`issuer_signature.kid` to `jwks.keys[].kid`. A signature counts when the
key's thumbprint is the pinned kid, or when that kid is in a verified
issuer-history snapshot. `--jwks-file` is not a CLI flag.

## Payment to log leaf

On payload v10 and v11 receipts the link from the payment to the log leaf is
issuer-asserted. The leaf is
`sha256(0x00 || task_id|row_hash)`, and `row_hash` is owner-held, so a
stranger cannot recompute the leaf from public data. The issuer signature is
what ties the payment fields to the leaf. A public salted preimage commitment
for this link is parked, not shipped.

## What not to default to

- **SP1 / `binding.in_proof`** — optional Tier-2; extra cost and latency.
- **HMAC shared secret** — treasury/auditor path; public verify uses ES256/JWS.

## Payer bind algorithm (Base)

For `payment.ref` = `base:0x<txHash>`:

1. Fetch tx receipt on Base (chain id 8453).
2. Find USDC (`0x833589…`) `Transfer` event.
3. `from` must equal `caller_binding.payer_wallet`.
4. Transferred amount ≥ `payment.gross_amount` (atomic).

Solana: `solana:<sig>` — see `docs/VERIFY_ALGORITHM.md` §11.

## Further reading

- `docs/VERIFY_ALGORITHM.md`
- `packages/verify/README.md`
