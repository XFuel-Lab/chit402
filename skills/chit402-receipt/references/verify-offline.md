# Offline receipt verification

Third parties verify a Chit402 receipt **without trusting HTML or live API**
for the signature step.

## Pin-first path (issuer_jwk)

New receipts pin the issuer public key at `issuer_signature.issuer_jwk`.

1. `GET /receipt/:taskId?format=json` (or use a saved file).
2. Read `issuer_signature.jws` (compact JWS).
3. Verify ES256 with `issuer_signature.issuer_jwk` (P-256).
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
