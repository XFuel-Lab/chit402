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
| `payment.gross_amount` | Amount charged (USDC smallest units, 6dp) |
| `payment.settled_amount` | **v8.** On-chain USDC Transfer to the payee. Equal to `gross_amount` once a settlement ref exists. Absent on v7 |
| `payment.net_amount` | **v7 and earlier only.** Was documented as "amount after fees". It is not the on-chain transfer when a fee was subtracted only on the receipt |
| `payment.fee_amount` | **v7 and earlier only.** Protocol fee the receipt claimed. Not an on-chain deduction |
| `payment.accounting` | **v8.** Internal breakdown inside the settled amount (route margin, receipt floor, provider COGS). Not a deduction from the payee |
| `route.model` | Model that served the request |
| `route.provider` | Compute provider |
| `provider_cogs.actual` | Measured cost to serve (if present) |
| `output.hash` | Commitment to the model output |
| `binding.expected_commitment` | Payment binding commitment |

Live receipts carry two different signatures. They do **not** cover the same bytes:

- `issuer_signature.jws` — primary public attestation. Compact ES256 JWS over a
  JSON object (`canonicalSignedClaims`). Verify with a **trusted** key. This is
  what `https://api.chit402.com/receipt/:id?format=json` returns today.
- `hmac_attestation` — HMAC-SHA256 over the canonical array in section 3
  (`canonicalSignedPayload`). Shared-secret path for an attestor who holds the
  secret. Older receipts used `signature` / `co_signature` for this same HMAC.

Tampering with a covered field invalidates the signature that covers it. The
unsigned outer `payment` and `caller_binding` copies are a display mirror.
Quote facts from the verified JWS claims, and flag any mismatch with the outer copy.

## 2. Signature structure

A receipt may carry:

- `issuer_signature.jws` — primary ES256 compact JWS (see section 10)
- `hmac_attestation` — HMAC attestor (`alg: HMAC-SHA256`, `value: sha256=<hex>`)
- `co_attestation` — second HMAC attestor, when configured

Legacy names `signature` and `co_signature` are the same HMAC construction on
older receipts.

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

Branch on payload version. Receipts at version **≤ 7** keep the historical array
below and verify unchanged. Do not re-sign them. Version **8** replaces
`net_amount` / `fee_amount` / `protocol_fee_bps` / `platform_fee` with the settled
amount and the internal accounting breakdown. See [ADR 0011](./adr/0011-receipt-v8-onchain-amount.md).

### 3.1 Payload version ≤ 7

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

### 3.2 Payload version 8

`gross_amount` is the amount charged. `settled_amount` is that same integer once
the USDC transfer to `payee` exists. `accounting.internal_breakdown` is internal
accounting **inside** that amount (`route_margin_bps` from live pricing,
default 100, plus route margin, receipt floor, provider COGS, and any Tier-2
proof). There is no `protocol_fee_bps` and no `net_amount`.

```javascript
[
  receipt.task_id ?? null,
  receipt.payment?.rail ?? null,
  receipt.payment?.ref ?? null,
  receipt.payment?.gross_amount ?? null,
  receipt.payment?.settled_amount ?? null,
  receipt.payment?.accounting?.internal_breakdown?.route_margin_bps ?? null,
  receipt.payment?.accounting?.internal_breakdown?.route_margin_amount ?? null,
  receipt.payment?.accounting?.internal_breakdown?.receipt_floor_amount ?? null,
  receipt.payment?.accounting?.internal_breakdown?.provider_cogs_amount ?? null,
  receipt.payment?.accounting?.internal_breakdown?.tier2_proof_amount ?? null,
  receipt.provider_cogs?.actual ?? null,
  receipt.route?.model ?? null,
  receipt.route?.model_commitment?.commitment ?? null,
  receipt.route?.provider ?? null,
  receipt.output?.hash ?? null,
  receipt.binding?.expected_commitment ?? null,
  receipt.caller_binding?.payer_wallet ?? null,
  receipt.caller_binding?.agent_pubkey ?? null,
  receipt.caller_binding?.api_key_hash ?? null,
]
```

`claim_id` is not in that array. It is an extra field on the v8 JWS object
(`canonicalSignedClaims`): the book `agent_id` as a decimal string. Newly signed
receipts always include the key. Suggested by @ellie-v2 on 1F916
(https://1f916.ai/post/7347#comment-88218).

| `claim_id` on the verified JWS | `payment.ref` | Result |
|---|---|---|
| key absent | any | `claim_id: not_present_legacy`. The receipt still verifies. |
| a book id | set or absent | `claim_id: ok` |
| `null` | set | `claim_id: refused`. `overall` is `failed`. |
| `null` | absent | `claim_id: ok` (nothing was settled) |

The outer `claim_id` is a display copy. A mismatch with the JWS fails verification
the same way `caller_binding` does.

### 3.3 Payload version 9

Version **9** keeps the version 8 HMAC field list and adds two claims on the
issuer JWS object (`canonicalSignedClaims`):

| Claim | Meaning |
|-------|---------|
| `tree_head_hash` | Merkle root of the log prefix that ends at this receipt's leaf (`leaf_index + 1`). That root includes the leaf, so an inclusion proof of that size verifies against it. Null when the receipt is not a leaf yet. It is not the published head from before the append. A later head with a different root verifies only when an inclusion proof shows this leaf is in that head |
| `tolerance` | Clock bound copied into the signature, `{ "base": 300, "solana": 150 }` |

The pair is part of the signed preimage. Verifiers read it only from claims
whose issuer signature has already verified. The outer `tree_head_hash` and
`tolerance` fields are a display copy. If either outer key is present and
disagrees with the verified claims, verification fails (`head_binding_mismatch`).
A version 9 payload that omits either key fails (`head_binding_missing`). The embedded `issuer_jwk` is used for this pair only when its thumbprint is a pinned kid. An unpinned key is `key untrusted` and does not supply the tolerance or the head hash. A supplied head whose root equals `tree_head_hash` is the issuance prefix. A later head verifies when its inclusion proof covers the leaf. Any other root fails (`tree_head_mismatch`).

Version **8 and earlier** omit the pair and verify as before. Do not re-sign
them. The HMAC array is unchanged at version 8, so `hmac_attestation.payload_version`
on a new receipt stays 8 while `issuer_signature.payload_version` is 9.

A settlement claim closes once. The book seat (`claim_id` equal to the agent
id) is shared by every receipt in that book. Closing a different `claim_id`,
or closing with `singleUseClaim`, moves that id from open to settled. A second
receipt gets `claim_already_settled`. The same `task_id` and `payment.ref`
returns the existing receipt.

For a cost-plus quote the breakdown sums to the settled amount:

`provider_cogs_amount + route_margin_amount + receipt_floor_amount + tier2_proof_amount`.

On-chain check (optional, `reconcileSettledTransfer`): given the tx logs, v8's
`settled_amount` must equal the USDC `Transfer` value to `payee`. v7 compares
`net_amount` instead, which flags a receipt whose net subtracted a fee that
never moved on chain. Those amounts and the payee are taken from the JWS only
after the key-trust check in section 10. An untrusted signature is not reconciled
against the outer payment copy.

## 4. HMAC verification algorithm (plain language)

This checks `hmac_attestation` (or legacy `signature` / `co_signature`). It does
not check `issuer_signature.jws`. For the public path, use section 10.

1. Extract the signature value from `receipt.hmac_attestation.value` (legacy:
   `receipt.signature.value` or `receipt.co_signature.value`). Strip the
   `sha256=` prefix to get the 64-character hex digest.

2. Build the canonical payload array (section 3).

3. Compute `HMAC-SHA256(secret, JSON.stringify(payload))` to get a hex digest.

4. Compare the computed digest with the extracted digest. Use constant-time
   comparison to prevent timing attacks.

5. If they match, the receipt is authentic for that key.

## 5. Runnable code (Node.js)

The sample verifies **payload version ≤ 7**. Version 8 uses the field list in
§3.2. `services/gateway/scripts/verify-receipt.mjs` branches on
`issuer_signature.payload_version` / `hmac_attestation.payload_version`.

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

function verify(receipt, secret, sigField = 'hmac_attestation') {
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

// Try hmac_attestation first, then co_attestation. Legacy field names still work.
let result = verify(receipt, secret, receipt.hmac_attestation ? 'hmac_attestation' : 'signature');
if (!result.valid && (receipt.co_attestation || receipt.co_signature)) {
  result = verify(receipt, secret, receipt.co_attestation ? 'co_attestation' : 'co_signature');
  result.checked = receipt.co_attestation ? 'co_attestation' : 'co_signature';
} else {
  result.checked = receipt.hmac_attestation ? 'hmac_attestation' : 'signature';
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

Live receipts:

```json
{
  "alg": "ES256",
  "payload_version": 8,
  "kid": "<RFC 7638 thumbprint>",
  "jws": "<compact JWS header.payload.signature>",
  "issuer_jwk": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…", "kid": "…", "alg": "ES256", "use": "sig" }
}
```

`verification.jwks_uri` is `https://api.chit402.com/.well-known/jwks.json`.
The JWS header is `{ alg, typ: "chit402-receipt+jwt", kid, jku }`. The payload
is the claims object (payment, caller_binding, route, output, binding, …), not
the HMAC array from section 3.

`issuer_jwk` is a convenience copy of the public key. It is **not** a trust
root. A signature is valid only when the verifying key is trusted:

1. It is the JWKS entry with the same `kid` (a JWKS file you supply, or a JWKS
   fetched from the issuer `jwks_uri` on an allowlisted host such as
   `api.chit402.com`), or
2. Its RFC 7638 thumbprint equals a pinned trusted kid. The default offline pin
   is the current production kid
   `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q` (overridable).

Otherwise the verifier reports `key untrusted`, even if the bytes verify under
the embedded key. Re-signing a receipt with an arbitrary P-256 key and embedding
that key as `issuer_jwk` must not verify.

Legacy detached signatures (`issuer_signature.value` over the section 3 array)
still verify against a JWKS entry matched by `kid`.

### Verification steps

1. Fetch the receipt: `GET https://api.chit402.com/receipt/:taskId?format=json`
2. Read `issuer_signature.jws`.
3. Choose a trusted key:
   - JWKS file or `GET https://api.chit402.com/.well-known/jwks.json`, entry whose
     `kid` equals the JWS header `kid`, or
   - embedded `issuer_jwk` only when `thumbprint(jwk)` equals a pinned trusted kid.
4. ES256-verify the compact JWS (signing input is `header.payload`, raw R||S).
5. Read amount, payer, payee, asset, and tx from the verified claims. If the
   unsigned outer `payment` / `caller_binding` disagree, the receipt fails.
6. Optional Base check: the tx's USDC `Transfer` must be from
   `caller_binding.payer_wallet`, to `payment.payee`, of token `payment.asset`
   (Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), for at least
   `payment.gross_amount`.

### Runnable code (Node.js)

The sample below is the legacy detached ES256 path (`issuer_signature.value`
over the section 3 array, payload version ≤ 7). Current receipts use
`issuer_signature.jws`. Verify that compact JWS with a trusted JWKS key or a
pinned thumbprint — not with an untrusted embedded `issuer_jwk`. Version 8 HMAC
arrays use §3.2; the JWS payload is the claims object, not that array.

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

- **HMAC** (`hmac_attestation`, shared secret) is for an attestor who holds the
  secret. It covers the canonical array in section 3.
- **ECDSA** (`issuer_signature.jws`, public key) is the primary check for any
  downstream agent. The JWS payload is a JSON object of named claims, not the
  HMAC array. Trust the key (JWKS by kid, or pinned thumbprint) before treating
  those claims as facts.

They attest the same economic story when the gateway is honest. They are not
the same signed bytes, and a valid HMAC does not make an untrusted ES256 key
acceptable.

## 11. Session delegation (agent_pubkey v1)

Reusable EIP-712 `AuthorizeSession` on Base (`chainId` 8453, secp256k1). The
receipt JWS is born bound — `agent_pubkey`, `delegation_hash`, `session_expiry`.
Late assign is a **child** receipt (`parent_receipt_id`); the genesis JWS is
never re-signed.

Agent verify steps:

1. Verify `issuer_signature.jws` (ES256) with a trusted key: JWKS entry matched
   by `kid` (`GET https://api.chit402.com/.well-known/jwks.json` or a local
   file), or an embedded key whose RFC 7638 thumbprint equals a pinned kid
   (default `IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q`). Embedded `issuer_jwk`
   alone is not enough.
2. Read claims from that verified payload (not the unsigned outer copy). Confirm
   `caller_binding.payer_wallet` against `payment.ref` on-chain (USDC).
   Rail-specific steps:

   **Base** (`base:0x…` or `eip155:8453:0x…`): fetch the tx receipt on Base
   RPC. Parse the USDC `Transfer` event (`0x833589…` on mainnet). `from` must
   equal `caller_binding.payer_wallet`, `to` must equal `payment.payee`, the
   log address must equal `payment.asset` (the network USDC contract), and the
   amount must be ≥ `payment.gross_amount` (atomic, 6 dp). EIP-3009
   `transferWithAuthorization` records the authorizing wallet as `from`.

   **Solana** (`solana:<sig>`): fetch the settled tx via Solana RPC (or
   Solscan). Confirm a USDC SPL transfer (`EPjFWdd5…` mint, 6 dp) of
   `payment.gross_amount` where `caller_binding.payer_wallet` is the
   `authority` on `transferChecked` (x402 exact-svm). The payer may also
   co-sign the versioned tx; balance deltas on their USDC ATA are accepted
   as a fallback. Set `SOLANA_RPC_URL` to override the default public RPC
   (`https://api.mainnet-beta.solana.com`).
3. If `session` is present: `iat` must fall in `valid_after`..`session_expiry`.
   No new payer signature is required.
4. Optional (high-value): `GET /v1/sessions/:delegation_hash` or
   `GET /.well-known/revocations`. Revoke is payer-signed `RevokeSession` on
   the pinned Chit402 / Base domain; unseen grants need the original
   AuthorizeSession proof. Do not amend the receipt.
5. Agent proves possession of `agent_pubkey` (secp256k1). Delegation proof
   (`session.proof.signature` + typed data, or `session.proof.lookup_uri`)
   lets you recover the payer without trusting Chit as sole attestor.

Privileged acts (handoff, read_private, redeem) require a prove-key
SessionAct after those session checks. **Schema is locked** (PR 303):
same EIP-712 `SessionAct` types, same child JWS trust fields
(`session_act`, inherited settlement, `kind`/`action`, `target_agent`).
What follows is **transport only**.

`SessionAct` types are **stable** — clients may sign without fetching a
challenge. Same Chit402 / Base 8453 domain as AuthorizeSession.
Fields: `delegationHash` (bytes32), `nonce` (bytes32), `action` (string),
`resource` (string), `deadline` (uint256), `targetAgent` (address; zero
= self), `payloadHash` (bytes32; zero if unused). secp256k1 only.
Challenge responses still publish the full `types` map for the
interactive path; `/act` error bodies also echo `types` + `domain`.

Two transports, same verify:

**A — challenge → act** (interactive):

1. `POST /v1/sessions/:delegation_hash/challenge` → `{ challenge_id, nonce,
   expires_at, resources[], types, domain }` (TTL 2–5 min).
2. Agent signs `SessionAct` with the issued nonce and a deadline that
   does not outlive `expires_at`.
3. `POST /v1/sessions/:delegation_hash/act` with
   `{ action, resource, signature, challenge_id }` (and `target_agent`
   when the act hands entitlement to someone new).
4. Gateway verifies: session binds `agent_pubkey` + `delegation_hash`;
   session is active; SessionAct recovers to `agent_pubkey`; challenge
   nonce unused; then execute. Challenge-every-act on this path.

**B — 1-shot** (no prior `/challenge`):

1. Client generates a fresh `nonce` (bytes32) and `deadline` (unix
   seconds, not expired, not more than 5 minutes ahead).
2. Agent signs the same `SessionAct` types (delegationHash from the
   bound session; action/resource/targetAgent/payloadHash as the act).
3. `POST /v1/sessions/:delegation_hash/act` with
   `{ action, resource, signature, nonce, deadline, target_agent?,
   payload_hash? }`.
4. Gateway verifies typed data matches the signed message, recovers
   `agent_pubkey`, checks nonce unused (same spent set as challenge
   nonces), deadline window sane, session active; then execute.

No capability-token shortcut in v1.

Child handoff receipts are a distinct row. Genesis JWS is never re-signed.
Signed child claims (source of truth) include:

- `kind` / `action` (`session_handoff` / `handoff`) — not only the outer envelope
- `session_act` — EIP-712 `SessionAct` types + domain + message + signature
  + nonce, so a verifier recovers that `agent_pubkey` authorized
  the act without trusting Chit logs
- `target_agent` — destination of the entitlement (may differ from
  `session.agent_pubkey`, the authorizing key)
- `settlement.kind = inherited` + `settlement.parent_receipt_id` —
  child JWS does **not** re-claim parent `payment.ref`, `gross_amount`,
  or `provider_cogs.actual`. Accounting agents must not sum those twice.

`max_cumulative_spend` is atomic USDC (`decimals: 6`, `unit: atomic_usdc`) —
same scale as `payment.gross_amount`.

### Runnable code (Node.js — Solana payer match)

```javascript
#!/usr/bin/env node
// verify-solana-payer.mjs — offline Solana payer verification
// Usage: node verify-solana-payer.mjs <receipt.json>

import { readFileSync } from 'node:fs';
import {
  verifyPayerBinding,
  receiptPayerClaimsFromEnvelope,
} from '@xfuel/verify';

const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const claims = receiptPayerClaimsFromEnvelope(receipt);
// SOLANA_RPC_URL env overrides default https://api.mainnet-beta.solana.com
const result = await verifyPayerBinding(claims);
console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
```

## 12. Receipt lane (unsigned refusal)

`receipt_lane` sits beside `book_seq` / `book_chain.seq`. It is not covered by
`issuer_signature` or by `chit402.book_seq`. Do not bump `payload_version` to
read it, and do not fail a signature because it is present or absent.

`xfuel-verify` recomputes it:

| Field | Rule |
|-------|------|
| `settled_by` | `observed_transfer` when `--check-payer` confirms the USDC transfer (or the receipt carries arrival / foreign-ingest observation). `receipt` when a **verified** issuer signature asserts `payment.ref` and no observation fired. `null` when unknown, including a reported OpenRouter row and an unsigned `payment.ref` |
| `anchor_changed_since_binding` | true when `anchor_at_binding` and the current head (or `anchor_current`) differ in root, Base tx, or Solana signature. Null if either identity is missing |
| `freeze` | true only when `book_seq` is set, `settled_by` is `receipt`, the anchor changed, and `settled` is false |
| `ordering` | `seq + settled_by + (anchor_changed AND not settled)` |
| `boundary` | complete over registry marks, blind to payments the registry never joined |
| `classification` | `unverifiable_from_registry` when the row is past expiry and `settled_by`, `receipt_id`, `observed_tx_hash`, and `observed_transfer_id` are all null. A joined `settled_by` stays `receipt` or `observed_transfer` |
| `local_check` | payee and amount for the existing Base USDC transfer check when the class is `unverifiable_from_registry` and the asset is Base USDC. `claims_paid` is false. No chain read |

An anchor change on a settled row does not freeze. An expired unmarked binding
is not unpaid. Design by Turbo on 1F916 (post 6579, comments 88201, 88403, and
88596). See [receipt-lane.md](./product/receipt-lane.md).

Gateway copy (no npm install):

```bash
node services/gateway/scripts/verify-receipt-payer.mjs receipt.json
```

Full agent path: JWKS → JWS → payer on-chain (Base or Solana) → session window
→ optional revocation lookup → SessionAct for privileged acts (Base only; no
Solana SessionAct in v1).
