# Escrow helper (ledger v1)

High-value job helper beside the possession-gated book. **Not** an on-chain escrow contract in v1.

## Model

| Piece | v1 behavior |
|-------|-------------|
| Hold | Collected x402 receipt already on the book (USDC moved at payment) |
| Open | Record intent: `task_id`, optional amount check, required `output.hash` and/or `proof_tier`, expiry |
| Release | Principal satisfied — verifies ledger hold + receipt output hash / tier |
| Clawback | Files dispute (`output_missing`, `wrong_model`, `double_charge`) — stand vs refund **instruction** |
| Chain claw | Not automatic — treasury/float credit if refund adjudicated |

## API

`POST /v1/agents/:agent_id/book/escrow` (possession-gated)

Actions: `open` | `release` | `clawback` | `status`

```json
{
  "action": "open",
  "task_id": "task-abc",
  "required": {
    "output_hash": "0x…"
  },
  "expires_at": "2026-09-13T00:00:00.000Z"
}
```

`required.proof_tier: "settlement"` needs the Tier-2 settlement proof add-on, which is not currently offered. While it is off, `open` with that requirement returns `400 settlement_proof_not_offered`, and A2A escrow (which always requires it) refuses `open` and `fund`.

## Honest limits

- Proofs verify **settlement metadata**, not that a closed-weight model ran your prompt.
- Ledger escrow ≠ funds locked in a smart contract — x402 already paid the payee.
- Clawback outcomes tie into [book dispute](../M2M_API.md) adjudication; refunds need operator float path.

## UI

Principal book (`/book`) includes an Escrow panel when possession is loaded. See OpenAPI `bookEscrowHelper` and gateway `llms.txt`.
