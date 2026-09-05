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
| Issuer signature | No | ES256 — pinned `issuer_jwk` on receipt, or JWKS file |
| Output hash | No | Hash is on the receipt |
| On-chain settlement | Yes | Query Base RPC for tx |
| Nullifier anchor | Yes | Query ZKVerifierSP1 contract |

## Exit Codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | Verified |
| 1 | Verification failed |
| 2 | Partial (binding ok, nullifier not checked) |
| 3 | Input error |

## Documentation

- [Chit402 Docs](https://chit402.com)
- [API Reference](https://api.chit402.com)

## License

Apache-2.0
