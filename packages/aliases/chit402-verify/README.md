# chit402-verify

Offline verification for Chit402 receipts — verify payment binding and output commitment without calling the API.

npm: `chit402-verify` · License: Apache-2.0 · Docs: https://chit402.com

Current version: 0.4.2. `@xfuel/verify` is an alias pinned to the same version, and the `xfuel-verify` command stays.

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
```

### CLI

```bash
# One receipt: an id, a URL, a file, or - for stdin.
npx chit402-verify receipt.json
curl -s "https://api.chit402.com/receipt/RECEIPT_ID?format=json" | npx chit402-verify -
# An id or public URL gives the unsigned public shell: COULD_NOT_CHECK (exit 2).
# Pass the signed JSON from the owner view for VERIFIED.

# Offline issuer history (the check is always on)
npx chit402-verify receipt.json --issuer-history issuer-history.json

# Machine-readable output
npx chit402-verify receipt.json --json
```

The 0.4 CLI accepts exactly: one receipt argument, `--issuer-history <file>`, `--json`, `-h`/`--help`, and `-V`/`--version`. Any other flag exits 1 (`removed_flag`). `BASE_RPC_URL` and `SOLANA_RPC_URL` set the RPC endpoints for the anchor check (public RPCs otherwise).

## What This Verifies

| Check | Where | Description |
|-------|-------|-------------|
| Payment binding | CLI and library | Recompute commitment from receipt fields |
| Issuer signature | CLI and library | ES256. Trusted via JWKS (by kid) or the pinned production kid. Embedded `issuer_jwk` alone is not enough. |
| Output hash | CLI and library | Hash is on the receipt |
| Log inclusion and anchors | CLI and library | Signed tree head, inclusion proof, Base and Solana anchors |
| Issuer history | CLI and library, always | `iat` is inside the kid's `not_before` / `not_after` |
| On-chain payer / settlement | Library only | `verifyReceipt(receipt, { checkPayer: true })` |
| Nullifier anchor | Library only | `verifyReceipt(receipt, { checkNullifier: true })` |

## Exit Codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | VERIFIED |
| 1 | INVALID |
| 2 | COULD_NOT_CHECK |

The issuer-history check is always on. `VERIFIED_NO_KEY_WINDOW` was retired in 0.4.

## Documentation

- [Chit402 Docs](https://chit402.com)
- [API Reference](https://api.chit402.com)

## License

Apache-2.0
