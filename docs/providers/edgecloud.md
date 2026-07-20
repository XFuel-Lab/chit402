# EdgeCloud (Theta)

Optional GPU provider tier — not settlement home ([ADR 0002](../adr/0002-base-settlement-home.md)).

## Use for

- On-demand inference: `ondemand.thetaedgecloud.com` (dashboard API key)
- Optional heavy prover hosts
- Provider adapter modules (e.g. `ThetaInferenceCircuit`)

## Do not use for

- Protocol treasury / Safe
- Default payment rail (USDC on Base)
- Product identity

## Related

- [README.md](./README.md)
- [RUNTIME_STATE.md](../RUNTIME_STATE.md)

Prefer `/task-request` and `/v1/*` over legacy `/theta-ai/*` route names.
