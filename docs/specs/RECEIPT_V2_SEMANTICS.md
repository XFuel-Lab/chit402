# XFuel Receipt v2 — Semantics

> Public, frozen, offline-verifiable.

This document defines the semantics of `receipt.xfuel.v2` — a receipt schema designed so **any third party can verify payment binding and output commitment without calling the XFuel API**.

Schema: [`receipt.xfuel.v2.schema.json`](./receipt.xfuel.v2.schema.json)

---

## 1. Frozen Fields

Frozen fields are immutable once set. A verifier checks these against on-chain data and the receipt's own cryptographic commitments.

| Field | Path | Description |
|-------|------|-------------|
| **task_id** | `task_id` | Unique task identifier, bound in the payment commitment |
| **hub** | `route.provider` | Compute provider that served the request (theta-edgecloud, akash-network) |
| **model_id** | `route.model` | Model identifier that ran (e.g., `theta/glm-5.2-9b-chat`) |
| **amount_usdc** | `payment.gross_amount` | Total charged in USDC atomic units (6 decimals; `10000` = $0.01) |
| **tx** | `payment.ref` | Settlement reference (`network:txHash`), e.g. `base:0xabc...` |
| **output_hash** | `output.hash` | Commitment to the model output (keccak256 or SHA-256) |
| **nullifier** | `proof.nullifier` | Single-use nullifier anchored on-chain (when SP1 proof present) |
| **agent_id** | `agent_id` | Registered agent identity (when bound via `/v1/agents/register`) |

---

## 2. Verification Algorithm

A third party verifies a receipt **offline** using only:
- The receipt JSON
- Public chain data (Base block explorer / RPC)
- The canonical payload formula (open-source)

### 2.1 Verify Signature (Tier-1 HMAC)

The `signature.value` is an HMAC-SHA256 over the **canonical signed payload** — a JSON array of frozen + settlement fields in a fixed order:

```
[
  task_id,
  payment.rail,
  payment.ref,
  payment.gross_amount,
  payment.net_amount,
  payment.fee_amount,
  payment.protocol_fee_bps,
  payment.platform_fee,
  payment.platform_fee_bps,
  provider_cogs.actual,
  route.model,
  route.model_commitment.commitment,
  route.provider,
  output.hash,
  binding.expected_commitment
]
```

**To verify:**
1. Serialize the canonical payload as `JSON.stringify([...fields])`.
2. Compute `HMAC-SHA256(payload, signing_secret)`.
3. Compare `sha256=<hex>` with `signature.value`.

> The signing secret is shared with partners who need tamper-evidence without on-chain verification. For **trustless** verification, use the payment binding (§2.2).

### 2.2 Verify Payment Binding (Trustless)

The `binding` object contains a **recomputable commitment** that ties the payment to the task. Anyone can verify this without secrets:

```solidity
// Payment-only binding
commitment = keccak256(abi.encodePacked(
  keccak256(payment_ref),   // bytes32
  keccak256(task_id),       // bytes32
  rail_discriminant,        // uint8 (1=usdc, 2=tfuel)
  amount                    // uint256
));

// PBR (Payment-Bound Receipt) — includes model + output
commitment = keccak256(abi.encodePacked(
  keccak256(payment_ref),
  keccak256(task_id),
  rail_discriminant,
  amount,
  model_commitment,         // bytes32
  output_hash               // bytes32
));
```

**To verify:**
1. Read `binding.expected_commitment` from the receipt.
2. Recompute using the formula above with values from the receipt.
3. Compare: `binding.matches` should be `true`.

This mirrors `SP1ProofHooks.computePaymentCommitment` on-chain — byte-for-byte parity is tested.

### 2.3 Verify On-Chain Settlement

For `payment.rail === 'usdc'` with a `payment.ref`:
1. Parse the ref: `base:0x<txHash>` → network `base`, tx `0x...`.
2. Query the network (or use `payment.explorer_url`).
3. Confirm the transaction exists, succeeded, and transferred `payment.gross_amount` USDC to the expected payTo address.

### 2.4 Verify Nullifier (SP1 Proof)

When `proof.has_proof === true` and `proof.nullifier` is present:
1. The nullifier is anchored on-chain by the SP1 verifier contract.
2. Query `ZKVerifierSP1` on Base (`0x9373499645292715a2275A78eD65B14215C41c06`) for the nullifier.
3. A registered nullifier proves the proof was verified on-chain.

---

## 3. Assurance Tiers

| Tier | `proof.tier` | What it attests | Verification |
|------|--------------|-----------------|--------------|
| **Tier-1: Signed** | `signed` | Tamper-evidence (HMAC) | Requires signing secret |
| **Tier-2: Settlement** | `settlement` | Payment binding + output hash anchored on-chain via SP1 | Check nullifier on-chain |
| **Tier-3: Inference** | `inference` | TEE attestation or ZK proof of correct model execution | Attestation / ZK verify |

Most receipts are Tier-1 (HMAC) by default. Tier-2 SP1 proofs are opt-in ($0.08) or automatic above $2.00 COGS.

---

## 4. x402 Settlement-Receipt Extension

A `receipt.xfuel.v2` receipt can serve as an **x402 settlement-receipt extension**:

```json
{
  "x402_extension": "xfuel.receipt.v2",
  "task_id": "<receipt.task_id>",
  "payment_ref": "<receipt.payment.ref>",
  "output_hash": "<receipt.output.hash>",
  "verify_url": "<receipt.verify_url>",
  "binding_commitment": "<receipt.binding.expected_commitment>"
}
```

The x402 facilitator (CDP or PayAI) settles the payment; the XFuel receipt attests what the payment bought.

---

## 5. ERC-8004 Validation Registry Payload

XFuel receipts integrate with [ERC-8004 Validation Registry](https://eips.ethereum.org/EIPS/eip-8004) for agent identity validation:

```json
{
  "request_hash": "<keccak256 of validation request>",
  "agent_id": "<registered agent_id>",
  "response": 100,
  "tag": "xfuel:settlement",
  "response_uri": "<receipt.verify_url>",
  "response_hash": "<keccak256 of canonical payload>"
}
```

| Field | Source |
|-------|--------|
| `response_uri` | `receipt.verify_url` — public evidence |
| `response_hash` | `keccak256(canonicalSignedPayload(receipt))` — commitment to evidence |
| `response` | `100` (pass) or `0` (fail) |
| `tag` | `xfuel:signed`, `xfuel:settlement`, or `xfuel:settlement+pbr` |

The ERC-8004 adapter is implemented in `services/gateway/src/erc8004.js`.

---

## 6. Mapping from v3 to v2

The gateway currently emits `xfuel.receipt.v3`. The v2 spec is a **documentation layer** that names the frozen fields and verification algorithm. No wire-format change is required.

| v3 field | v2 frozen field | Notes |
|----------|-----------------|-------|
| `route.provider` | `hub` | Compute provider |
| `route.model` | `model_id` | Served model |
| `payment.gross_amount` | `amount_usdc` | Atomic USDC units |
| `payment.ref` | `tx` | Settlement reference |
| `output.hash` | `output_hash` | Output commitment |
| `proof.nullifier` | `nullifier` | On-chain anchor |
| `agent_id` | `agent_id` | (Added in v2 when bound) |

---

## 7. Verification Without XFuel

The goal: **anyone can verify a receipt without calling `api.xfuel.app`**.

| Check | Requires XFuel API? | Alternative |
|-------|---------------------|-------------|
| HMAC signature | Yes (needs secret) | Partner-only tamper check |
| Payment binding | **No** | Recompute commitment locally |
| On-chain settlement | **No** | Query Base RPC / explorer |
| Nullifier anchor | **No** | Query ZKVerifierSP1 contract |
| Output hash | **No** | Hash your copy of the output |

The `packages/verify` package provides a CLI and library for offline verification.

---

## 8. Honest Scope

The SP1 proof attests:
- ✅ Correct fee split (protocol + platform)
- ✅ Payment binding (task ↔ settlement)
- ✅ Output hash commitment

It does **not** attest:
- ❌ That the provider computed the model correctly (Tier-3 roadmap)
- ❌ Prompt or output content (only the hash)
- ❌ Model weights authenticity (PoMA is server-attested, not proven)

This is stated on every receipt: `proof.attests`.
