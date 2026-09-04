# Chit402 Receipt Verification Algorithm

This document describes how to verify a Chit402 receipt offline, without
trusting the Chit402 API. Use this when:

- Chit402 is down or unreachable
- You want independent verification
- You hold a co-signer key and Chit has ceased operations

## 1. What a receipt attests

A signed Chit402 receipt attests:

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

- `signature` — primary Chit attestation
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
Chit has disappeared, verify against `co_signature`.

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
**escape hatch**: even if Chit and all co-signers disappear, an `in_proof`
receipt can be verified purely on-chain.

## 8. Security notes

- **Never reuse secrets** across different roles (primary / co-signer / webhook).
- **Rotate secrets** by adding a new co-signer, then retiring the old primary.
- **Constant-time compare** the HMAC digests to prevent timing attacks.
- **Check `in_proof`** for highest assurance — it's the on-chain escape hatch.

## 9. What can be proven if Chit disappears

With this algorithm and either the primary or co-signer secret:

1. **The receipt is authentic** — no tampering with any signed field.
2. **Payment moved on-chain** — verify `payment.ref` on a block explorer.
3. **The output hash is committed** — `output.hash` was attested at serve time.
4. **Cost is attested** — `provider_cogs.actual` is what we paid the provider.

With `in_proof: true`, add:

5. **Nullifier is anchored** — single-use, cannot be replayed.
6. **Commitment is on-chain** — survives Chit entirely.

## 10. ECDSA issuer signature (public-key verification)

Every receipt also carries an `issuer_signature` using ES256 (ECDSA with P-256
and SHA-256). Unlike HMAC, this can be verified with just the public key — no
shared secret required.

### Signature structure

```json
{
  "alg": "ES256",
  "payload_version": 3,
  "value": "<base64url-encoded signature>",
  "kid": "<key id from JWKS>",
  "jwks_uri": "/.well-known/jwks.json",
  "signed_fields": [ ... ]
}
```

### Verification steps

1. Fetch the receipt: `GET /receipt/:taskId?format=json`
2. Fetch the JWKS: `GET /.well-known/jwks.json`
3. Find the key in `jwks.keys` where `kid` matches `receipt.issuer_signature.kid`
4. Build the canonical payload (same as section 3)
5. Verify: `ES256(publicKey, canonicalPayload) == issuer_signature.value`

### Runnable code (Node.js)

```javascript
#!/usr/bin/env node
// verify-ecdsa.mjs — public-key receipt verification
// Usage: node verify-ecdsa.mjs <receipt.json> <jwks.json>

import { createPublicKey, verify } from 'node:crypto';
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

function verifyEcdsa(receipt, jwks) {
  const sig = receipt?.issuer_signature;
  if (!sig?.value) return { valid: false, reason: 'no_issuer_signature' };
  
  const jwk = jwks.keys.find(k => k.kid === sig.kid && k.alg === 'ES256');
  if (!jwk) return { valid: false, reason: 'no_matching_key' };
  
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const signature = Buffer.from(sig.value, 'base64url');
  const payload = canonicalPayload(receipt);
  
  const valid = verify('sha256', Buffer.from(payload, 'utf8'), {
    key: publicKey,
    dsaEncoding: 'ieee-p1363',
  }, signature);
  
  return { valid, kid: sig.kid };
}

const [,, receiptPath, jwksPath] = process.argv;
if (!receiptPath || !jwksPath) {
  console.error('Usage: node verify-ecdsa.mjs <receipt.json> <jwks.json>');
  process.exit(1);
}

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const jwks = JSON.parse(readFileSync(jwksPath, 'utf8'));

const result = verifyEcdsa(receipt, jwks);
console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
```

### Using the SDK

```javascript
import { verifyReceiptEcdsaWithJwks } from 'xfuel-sdk';

// Fetch receipt and JWKS
const receipt = await fetch('https://api.chit402.com/receipt/chit-xxx?format=json').then(r => r.json());
const jwks = await fetch('https://api.chit402.com/.well-known/jwks.json').then(r => r.json());

const result = verifyReceiptEcdsaWithJwks(receipt, jwks);
// { checked: true, valid: true, kid: '...' }
```

### Why both HMAC and ECDSA?

- **HMAC** (shared secret) is for treasury/auditor verification where the
  verifier holds the secret. It's the "replaceable signer" escape hatch.
- **ECDSA** (public key) is for any downstream agent that wants to verify
  without needing an HMAC secret. Fetch the JWKS, verify the signature.

Both cover the same canonical payload, so both attest the same fields.

## 11. Session delegation (agent_pubkey v1)

Reusable EIP-712 `AuthorizeSession` on Base (`chainId` 8453, secp256k1). The
receipt JWS is born bound — `agent_pubkey`, `delegation_hash`, `session_expiry`.
Late assign is a **child** receipt (`parent_receipt_id`); the genesis JWS is
never re-signed.

Agent verify steps:

1. `GET /.well-known/jwks.json` → verify `issuer_signature.jws` (ES256).
2. Decode claims. Confirm `caller_binding.payer_wallet` against `payment.ref`
   on Base (USDC).
3. If `session` is present: `iat` must fall in `valid_after`..`session_expiry`.
   No new payer signature is required.
4. Optional (high-value): `GET /v1/sessions/:delegation_hash` or
   `GET /.well-known/revocations`. Do not amend the receipt.
5. Agent proves possession of `agent_pubkey` (secp256k1). Delegation proof
   (`session.proof.signature` + typed data, or `session.proof.lookup_uri`)
   lets you recover the payer without trusting Chit as sole attestor.

`max_cumulative_spend` is atomic USDC (`decimals: 6`, `unit: atomic_usdc`) —
same scale as `payment.gross_amount`.
