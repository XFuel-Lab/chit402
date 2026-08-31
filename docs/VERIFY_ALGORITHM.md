# XFuel Receipt Verification Algorithm

This document describes how to verify an XFuel receipt offline, without
trusting the XFuel API. Use this when:

- XFuel is down or unreachable
- You want independent verification
- You hold a co-signer key and XFuel has ceased operations

## 1. What a receipt attests

A signed XFuel receipt attests:

| Field | Meaning |
|-------|---------|
| `task_id` | Unique identifier for the inference job |
| `payment.rail` | Settlement rail (`usdc`, `tfuel`) |
| `payment.ref` | On-chain settlement reference (`network:txHash`) |
| `payment.gross_amount` | Total paid (USDC smallest units, 6dp) |
| `payment.net_amount` | Amount after fees |
| `payment.fee_amount` | Protocol fee charged |
| `route.model` | Model that served the request |
| `route.provider` | Compute provider |
| `provider_cogs.actual` | Measured cost to serve (if present) |
| `output.hash` | Commitment to the model output |
| `binding.expected_commitment` | Payment binding commitment |

The HMAC signature covers all of the above in a canonical order. Tampering
with any field invalidates the signature.

## 2. Signature structure

A receipt may carry one or both:

- `signature` — primary XFuel attestation
- `co_signature` — second attestor (partner/auditor key)

Each signature block:

```json
{
  "alg": "HMAC-SHA256",
  "payload_version": 3,
  "value": "sha256=<64-char hex>",
  "role": "primary" | "co_signer",
  "signed_fields": [ ... ]
}
```

Either signature validates the receipt. If you hold the co-signer secret and
XFuel has disappeared, verify against `co_signature`.

## 3. Canonical payload

The signed payload is a JSON array of values in this exact order:

```javascript
[
  receipt.task_id,
  receipt.payment?.rail ?? null,
  receipt.payment?.ref ?? null,
  receipt.payment?.gross_amount ?? null,
  receipt.payment?.net_amount ?? null,
  receipt.payment?.fee_amount ?? null,
  receipt.payment?.protocol_fee_bps ?? receipt.payment?.fee_bps ?? null,
  receipt.payment?.platform_fee ?? null,
  receipt.payment?.platform_fee_bps ?? null,
  receipt.provider_cogs?.actual ?? null,
  receipt.route?.model ?? null,
  receipt.route?.model_commitment?.commitment ?? null,
  receipt.route?.provider ?? null,
  receipt.output?.hash ?? null,
  receipt.binding?.expected_commitment ?? null,
]
```

Serialize to JSON with `JSON.stringify()` — no pretty-printing, no trailing
newline.

## 4. Verification algorithm (plain language)

1. Extract the signature value from `receipt.signature.value` or
   `receipt.co_signature.value`. Strip the `sha256=` prefix to get the
   64-character hex digest.

2. Build the canonical payload array (section 3).

3. Compute `HMAC-SHA256(secret, JSON.stringify(payload))` to get a hex digest.

4. Compare the computed digest with the extracted digest. Use constant-time
   comparison to prevent timing attacks.

5. If they match, the receipt is authentic for that key.

## 5. Runnable code (Node.js)

```javascript
#!/usr/bin/env node
// verify-receipt.mjs — offline XFuel receipt verification
// Usage: node verify-receipt.mjs <receipt.json> <secret>

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

function canonicalPayload(r) {
  return JSON.stringify([
    r.task_id,
    r.payment?.rail ?? null,
    r.payment?.ref ?? null,
    r.payment?.gross_amount ?? null,
    r.payment?.net_amount ?? null,
    r.payment?.fee_amount ?? null,
    r.payment?.protocol_fee_bps ?? r.payment?.fee_bps ?? null,
    r.payment?.platform_fee ?? null,
    r.payment?.platform_fee_bps ?? null,
    r.provider_cogs?.actual ?? null,
    r.route?.model ?? null,
    r.route?.model_commitment?.commitment ?? null,
    r.route?.provider ?? null,
    r.output?.hash ?? null,
    r.binding?.expected_commitment ?? null,
  ]);
}

function verify(receipt, secret, sigField = 'signature') {
  const sig = receipt?.[sigField]?.value;
  if (!sig) return { valid: false, reason: 'no_signature' };
  
  const expected = sig.replace(/^sha256=/, '');
  const computed = createHmac('sha256', secret)
    .update(canonicalPayload(receipt))
    .digest('hex');
  
  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(computed.toLowerCase());
  const valid = a.length === b.length && timingSafeEqual(a, b);
  
  return { valid, expected, computed };
}

// CLI entry point
const [,, receiptPath, secret] = process.argv;
if (!receiptPath || !secret) {
  console.error('Usage: node verify-receipt.mjs <receipt.json> <secret>');
  process.exit(1);
}

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));

// Try primary signature first, then co_signature
let result = verify(receipt, secret, 'signature');
if (!result.valid && receipt.co_signature) {
  result = verify(receipt, secret, 'co_signature');
  result.checked = 'co_signature';
} else {
  result.checked = 'signature';
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
```

Save as `verify-receipt.mjs` and run:

```bash
node verify-receipt.mjs receipt.json "$RECEIPT_CO_SIGNER_SECRET"
```

## 6. Payment binding verification

Beyond the HMAC, you can independently verify the payment binding:

```javascript
import { keccak256, toUtf8Bytes, solidityPacked } from 'ethers';

function verifyPaymentBinding(receipt) {
  const b = receipt.binding;
  if (!b) return { present: false };
  
  const paymentRefHash = receipt.payment?.ref
    ? keccak256(toUtf8Bytes(receipt.payment.ref))
    : '0x' + '0'.repeat(64);
  const taskIdHash = keccak256(toUtf8Bytes(receipt.task_id));
  const rail = receipt.payment?.rail === 'usdc' ? 1 : 2;
  const amount = BigInt(b.amount || '0');
  
  const recomputed = keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256'],
      [paymentRefHash, taskIdHash, rail, amount],
    ),
  );
  
  return {
    present: true,
    expected: b.expected_commitment,
    recomputed,
    matches: b.expected_commitment?.toLowerCase() === recomputed.toLowerCase(),
  };
}
```

## 7. On-chain verification (`in_proof: true`)

When `receipt.binding.in_proof === true`, the payment commitment is part of
the SP1 proof's public values and anchored on-chain with a single-use
nullifier. In this case:

1. Fetch the on-chain proof using the `nullifier` from `receipt.proof.nullifier`
2. Extract the `paymentCommitment` from the proof's public values
3. Compare with `receipt.binding.expected_commitment`

The SP1 verifier contract address is in `deploy/manifests/`. This is the
**escape hatch**: even if XFuel and all co-signers disappear, an `in_proof`
receipt can be verified purely on-chain.

## 8. Security notes

- **Never reuse secrets** across different roles (primary / co-signer / webhook).
- **Rotate secrets** by adding a new co-signer, then retiring the old primary.
- **Constant-time compare** the HMAC digests to prevent timing attacks.
- **Check `in_proof`** for highest assurance — it's the on-chain escape hatch.

## 9. What can be proven if XFuel disappears

With this algorithm and either the primary or co-signer secret:

1. **The receipt is authentic** — no tampering with any signed field.
2. **Payment moved on-chain** — verify `payment.ref` on a block explorer.
3. **The output hash is committed** — `output.hash` was attested at serve time.
4. **Cost is attested** — `provider_cogs.actual` is what we paid the provider.

With `in_proof: true`, add:

5. **Nullifier is anchored** — single-use, cannot be replayed.
6. **Commitment is on-chain** — survives XFuel entirely.
