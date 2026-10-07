# chit402-verify

Offline verification for Chit402 receipts — verify payment binding and output commitment without calling the API.

npm: `chit402-verify` · License: Apache-2.0 · Docs: https://chit402.com

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
# Local binding verification (no network required)
npx chit402-verify receipt.json

# Hash the canonical object (must match signed payload_hash) and read not_after
# from a pinned issuer-history snapshot. Both flags are offline.
npx chit402-verify receipt.json --canonical-preimage preimage.json --issuer-history-file issuer-history.json

# With on-chain nullifier check (requires network)
npx chit402-verify receipt.json --check-nullifier

# Output as JSON
npx chit402-verify receipt.json --json

# From stdin
curl -s https://api.chit402.com/receipt/task-123?format=json | npx chit402-verify -
```

## What This Verifies

| Check | Requires Network? | Description |
|-------|-------------------|-------------|
| Payment binding | No | Recompute commitment from receipt fields |
| Issuer signature | No, unless `--fetch-jwks` | ES256. Trusted via JWKS (by kid) or the pinned production kid. Embedded `issuer_jwk` alone is not enough. |
| Output hash | No | Hash is on the receipt |
| On-chain settlement | Yes | Query Base RPC for tx |
| Nullifier anchor | Yes | Query ZKVerifierSP1 contract |
| Canonical preimage | No | `--canonical-preimage` is SHA-256'd and matched to signed `payload_hash` |
| Issuer history | No, with `--issuer-history-file` | `iat` is inside the kid's `not_before` / `not_after`. A payload v10 pin must match |

## Exit Codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | Verified |
| 1 | Verification failed |
| 2 | Partial (binding ok, nullifier not checked) |
| 3 | Input error |

## Publish

`publishConfig` sets `access` to `public` and does not name an owner. On the registry, `chit402-verify` (latest `0.2.0`) and `@xfuel/verify` (latest `0.2.1`) are both maintained by the npm user `xfuel`. Publish `@xfuel/verify` first. `npm whoami` must print `xfuel`. A `404` on `PUT https://registry.npmjs.org/chit402-verify` is that login, not a missing package and not a new scope: the name already exists.

## Documentation

- [Chit402 Docs](https://chit402.com)
- [API Reference](https://api.chit402.com)

## License

Apache-2.0
