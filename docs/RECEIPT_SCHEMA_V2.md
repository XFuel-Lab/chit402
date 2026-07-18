# Receipt Schema v2 — Payment-Bound Receipt (PBR)

> **Status:** PARTIALLY SHIPPED. Phase 1 (PoMA) + Phase 2 (PBR core) are live in
> [`services/gateway/src/receipt.js`](../services/gateway/src/receipt.js):
> `route.model_commitment`, `proof.tier`, `binding.covers` (+ `model_commitment` / `output_hash`
> and the superset commitment), and the optional Tier-1 `signature` (HMAC, gated by
> `RECEIPT_SIGNING_SECRET`) are emitted today. The `verified_inference` block (TEE / spot-check /
> full proof) remains **target/design** until Phases 4–5. See
> [`TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md`](TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).
>
> **Non-breaking contract:** v2 only **adds** fields to the v1 receipt. Every v1 field keeps its
> meaning; consumers that read v1 keep working. Not-yet-shipped fields are `null`/absent until the
> producing phase lands.

---

## 1. Why v2

v1 receipts prove **settlement** (fee split + payment binding + output-hash commitment,
SP1 on Base) and are explicit that they do **not** prove the provider ran the model
correctly. Verified Inference (Tier-3) adds two things the market actually needs:

- **PoMA — Proof of Model Authenticity:** bind the receipt to a **committed model
  identity** so a provider can't silently downgrade (serve a smaller/cheaper model than
  paid for). See build spec §"Phase 1".
- **PBR — Payment-Bound Receipt:** bind the **Tier-3 assurance** (attestation / spot-check
  / full proof) to the **x402 payment**, so "paid + model-authentic + verified" is a
  single, independently-checkable object. See build spec §"Phase 2".

---

## 2. v1 → v2 diff (additive only)

Existing v1 blocks (`task_id`, `status`, `proof_outcome`, `verify_url`, `route`, `payment`,
`proof`, `binding`, `output`, `links`) are **unchanged**. v2 adds:

- `route.model_commitment` — the on-chain model-commitment id this task claims to have used (PoMA).
- `verified_inference` — new block describing the Tier-3 mechanism + result.
- `proof.tier` — coarse tier label: `signed` (T1) · `settlement` (T2) · `inference` (T3).
- `binding.covers` — what the payment binding now attests (adds model + inference).

The honest-scope note in `proof.attests` is **updated per tier** so we never overclaim.

---

## 3. New `verified_inference` block

```jsonc
"verified_inference": {
  "tier": "settlement",             // signed | settlement | inference
  "mechanism": null,                // null | tee | zk_spotcheck | zk_full  (Tier-3 only)
  "model": {
    "declared": "llama-3-70b",      // what the task asked for
    "commitment": null,             // 0x… PoMA weight/identity commitment (Phase 1)
    "authentic": null,              // true | false | null  — matched committed model?
    "registry_ref": null            // ModelRegistry entry / tx (Phase 1)
  },
  "attestation": {                  // Tier-3a (TEE) — Phase 4
    "present": false,
    "type": null,                   // e.g. "nvidia-cc-h100"
    "quote_hash": null,             // 0x… hash of the attestation quote
    "verified": null
  },
  "spot_check": {                   // Tier-3b (stochastic ZK) — Phases 4/5
    "present": false,
    "sampled": null,                // e.g. layers/tokens/requests sampled
    "passed": null,
    "proof_ref": null               // link to the spot-check proof
  },
  "full_proof": {                   // Tier-3c (full zkML) — Phase 5
    "present": false,
    "system": null,                 // xfuel-vi (self-owned prover)
    "verified": null,
    "proof_ref": null
  }
}
```

Rules:
- Exactly one of `attestation` / `spot_check` / `full_proof` is `present: true` when
  `tier == "inference"`; all `false` otherwise.
- `model.authentic == false` MUST flip `proof_outcome` to a warning state and be surfaced
  prominently (downgrade detected).

---

## 4. Extended `binding` block (PBR)

v1 `binding` re-derives the x402 payment commitment. v2 extends it to cover model + inference:

```jsonc
"binding": {
  "present": true,
  "in_proof": true,
  "rail": "usdc",
  "amount": "1000000",
  "expected_commitment": "0x…",
  "recomputed_commitment": "0x…",
  "matches": true,
  "covers": ["payment", "settlement"]   // v2 may add "model", "inference"
}
```

`covers` is the honest, machine-readable scope of the binding. A consumer can assert
"this payment is cryptographically bound to model authenticity AND inference verification"
only when `covers` includes both `"model"` and `"inference"`.

---

## 5. `proof.tier` + honest scope note

`proof.tier` gives a one-word assurance level; `proof.attests` stays the human-readable,
per-tier honest scope:

| tier | meaning | attests note (summary) |
|---|---|---|
| `signed` | T1 signed receipt | route/model/cost/output-hash signed by XFuel; no on-chain proof |
| `settlement` | T2 SP1 on Base | correct fee split + payment binding + output-hash commitment; NOT model correctness |
| `inference` | T3 verified inference | + model-authentic (PoMA) and TEE/spot-check/full proof per `mechanism` |

---

## 6. Full v2 example (Tier-3b spot-check, PBR)

```jsonc
{
  "task_id": "m2m-task-1-1784282052789",
  "status": "settled",
  "proof_outcome": "valid",
  "verify_url": "https://api-testnet.xfuel.app/receipt/m2m-task-1-1784282052789",
  "route": {
    "message_type": "inference_request",
    "model": "llama-3-70b",
    "model_commitment": "0xModelCommit…",
    "provider": "edgecloud",
    "chain_id": "base"
  },
  "payment": { "rail": "usdc", "ref": "base:0x…", "gross_amount": "1000000",
               "fee_amount": "5000", "net_amount": "995000", "fee_bps": 50 },
  "proof": {
    "system": "xfuel-vi",
    "tier": "inference",
    "outcome": "valid",
    "has_proof": true,
    "nullifier": "0x…",
    "attests": "Model authenticity verified against committed weights (PoMA); a random "
             + "spot-check of the computation passed; settlement + payment are bound to "
             + "this result. Spot-check is probabilistic deterrence, not a full per-token proof."
  },
  "verified_inference": {
    "tier": "inference",
    "mechanism": "zk_spotcheck",
    "model": { "declared": "llama-3-70b", "commitment": "0xModelCommit…",
               "authentic": true, "registry_ref": "base:0x…" },
    "attestation": { "present": false },
    "spot_check": { "present": true, "sampled": "3/32 layers", "passed": true,
                    "proof_ref": "https://api-testnet.xfuel.app/prove-result?task_id=m2m-task-1-1784282052789" },
    "full_proof": { "present": false }
  },
  "binding": { "present": true, "in_proof": true, "rail": "usdc", "amount": "1000000",
               "expected_commitment": "0x…", "recomputed_commitment": "0x…",
               "matches": true, "covers": ["payment", "settlement", "model", "inference"] },
  "output": { "hash": "0x…", "kind": "committed" },
  "links": { "self": "…/receipt/…", "json": "…?format=json", "status": "…/task-status?…",
             "proof": "…/prove-result?…" }
}
```

---

## 7. Implementation notes (for the phases that fill this in)

- **Producer:** `buildReceipt()` in `services/gateway/src/receipt.js`. Add the new blocks
  behind presence checks on `task.meta` / `task.sp1Proof` / new Tier-3 task fields; default
  every new field to `null`/`false` so v1 output is byte-compatible when Tier-3 is off.
- **Renderer:** `renderReceiptHtml()` gains a "Verified Inference" card only when
  `verified_inference.tier === "inference"`.
- **Consumers to update (docs only for now):** `docs/M2M_API.md`,
  `docs/OPENAI_COMPATIBLE_GATEWAY.md`, SDK receipt typings, MCP `get_proof`.
- **Honesty gate:** never set `model.authentic: true` without a real PoMA check; never set a
  `mechanism` `verified: true` without the corresponding verifier returning true.
