# Signed refusal receipt

A spend the gateway refuses for a policy or cap reason comes back as a signed document, schema `chit402.refusal.v1`, payload version 1. The caller holds it in the refusal response. An async pipeline can fetch the same document later.

```
GET /refusal/:refusal_id
GET /refusal/:refusal_id?format=json
```

Public. No auth. No charge. HTML by default. JSON for agents (`?format=json`, a `.json` suffix, or `Accept: application/json`).

The signature is an ES256 compact JWS (`typ: chit402-refusal+jwt`) from the same issuer key as a payment receipt. Verify it against `GET /.well-known/jwks.json`, or with `xfuel-verify refusal.json`. `xfuel-verify` treats this schema as a refusal. It does not report it as a verified payment.

Payment receipt schemas and payload versions are unchanged. This document is not a receipt.

## When one is issued

A `policy_blocked` book row gets one refusal. That covers book policy (caps, kill switch, model allowlist, and the other policy codes), the prepaid ceiling (`budget_exhausted`), and an expired high-blast SessionAct approval (`approval_ttl_expired`).

The 403 body keeps its existing `error` fields and adds `refusal` (the document) plus `refusal_id` and `verify_url`. A string `error` such as `policy_blocked` stays a string. `verify_url` is filled from the request host and is not inside the signature.

A second record of the same task id returns the original document and the original nonce.

## Signed fields

| Field | Meaning |
|-------|---------|
| `schema` | `chit402.refusal.v1` |
| `payload_version` | `1` |
| `refusal_code` | Stable code (`daily_cap_exceeded`, `kill_switch`, `budget_exhausted`, …) |
| `nonce` | Unique to this document |
| `issued_at` | When the row was recorded |
| `chain_id` | Base chain id from the anchor, or `null` |
| `anchor` | `observed` (block number, block hash, and `state_root` when the RPC returned one) or `status: UNAVAILABLE` |
| `agent_id` / `book_id` | The book the refusal joins |
| `amount_requested` | Quoted atomic USDC when the gateway had a quote, otherwise `null` |
| `book_row` | `task_id`, `seq`, `prev_hash`, `row_hash`, `event: policy_blocked` |
| `charged` | `false` |
| `amount_charged` | `"0"` |

`state_root` is copied from the block when `eth_getBlockByNumber` returns a 32-byte hex root. If the RPC omits it, the field is `null`. It is not computed. `UNAVAILABLE` means the issuer had no block (`no_rpc`, an RPC error, or no observation yet). The refusal is still signed.

The book row stores `refusal_id` and `refusal_verify_path`. The webhook envelope for a blocked row adds `refusal_id` and `refusal_verify_url`. Neither field is a charge.

## What this proves

The issuer signed that it refused this spend, at that anchor, for that `refusal_code`. The nonce identifies the document. `book_row` names the `policy_blocked` row and its append position. `charged: false` and `amount_charged: "0"` say this refusal took no USDC.

## What this does not prove

It does not prove a payment, a settlement, or a balance change. It does not prove the refused spend would have landed in that block, or that a later reorg left the hash or state root in place. `UNAVAILABLE` does not mean the chain was empty. It does not prove the policy rule was the right rule, only that the issuer refused under that code. It does not prove `amount_requested` would have been the settled price. It is not a payment receipt.

## What stays a different response

A 402 payment challenge, a failed settle, a free-tier capacity response, and a model-routing 400 are not this document. Those are not a recorded policy refusal. A free-tier ceiling is the unpaid door, not a refused spend.

## Example

```json
{
  "schema": "chit402.refusal.v1",
  "payload_version": 1,
  "kind": "refusal",
  "refusal_id": "rfs-0123456789abcdef",
  "nonce": "00112233445566778899aabbccddeeff",
  "issued_at": "2026-10-03T11:00:00.000Z",
  "refusal_code": "daily_cap_exceeded",
  "reason": "over the daily cap",
  "agent_id": 7,
  "book_id": 7,
  "task_id": "xfuel-blocked-1",
  "amount_requested": "2000",
  "asset": "USDC",
  "chain_id": 8453,
  "anchor": {
    "status": "observed",
    "rail": "base",
    "chain_id": 8453,
    "block_number": "12345678",
    "block_hash": "0xabc…",
    "state_root": "0xdef…",
    "observed_at": "2026-10-03T11:00:00.000Z",
    "reason": null
  },
  "book_row": {
    "task_id": "xfuel-blocked-1",
    "seq": 4,
    "prev_hash": null,
    "row_hash": "…",
    "event": "policy_blocked"
  },
  "charged": false,
  "amount_charged": "0",
  "issuer_signature": {
    "alg": "ES256",
    "typ": "chit402-refusal+jwt",
    "payload_version": 1,
    "jws": "eyJ…",
    "kid": "…"
  },
  "verify_url": "https://api.chit402.com/refusal/rfs-0123456789abcdef"
}
```

`verify_url` is not covered by the JWS. The claims inside `issuer_signature.jws` are.

Suggested by bankr_1d5b on 1F916 (post 6645, comments c88181 and c89581). The chain anchor on the book row is still [refusal-anchor.md](./refusal-anchor.md).
