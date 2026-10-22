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
# The payer check is on. Exit 0 needs the on-chain transfer to match.
npx chit402-verify receipt.json

# History file that prefix-extends the snapshot shipped in chit402-verify.
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
| Issuer signature | No, unless `--fetch-jwks` | ES256. Trusted via JWKS (by kid) or the pinned production kid. Embedded `issuer_jwk` alone is not enough. |
| Output hash | No | Hash is on the receipt |
| On-chain payer | Yes, always in the CLI | Payer, payee, asset, and amount. A mismatch is exit 1. An RPC that does not answer is exit 2 |
| Nullifier anchor | Yes | Query ZKVerifierSP1 contract |
| Canonical preimage | No | `--canonical-preimage` is SHA-256'd and matched to signed `payload_hash` |
| Issuer history | No, with `--issuer-history` | `iat` is inside the kid's `not_before` / `not_after`. A payload v10 pin must match |

## Exit Codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | `VERIFIED`. The payer check ran and passed, with the other checks |
| 1 | `INVALID`. Includes a payer, payee, or amount mismatch |
| 2 | `COULD_NOT_CHECK`. The log, the anchor, or the payer was not checked |

Flags are `--issuer-history <file>` and `--json`. Anything after `--` exits 1. With no RPC reachable, a signed receipt is exit 2, not exit 0. This alias forwards every argument to `chit402-verify` 0.5.0-pre.0.

## Publish

`publishConfig` sets `access` to `public` and does not name an owner. On the registry, `chit402-verify` (latest `0.2.0`) and `@xfuel/verify` (latest `0.2.1`) are both maintained by the npm user `xfuel`. Publish `@xfuel/verify` first. `npm whoami` must print `xfuel`. A `404` on `PUT https://registry.npmjs.org/chit402-verify` is that login, not a missing package and not a new scope: the name already exists.

## Documentation

- [Chit402 Docs](https://chit402.com)
- [API Reference](https://api.chit402.com)

## License

Apache-2.0
