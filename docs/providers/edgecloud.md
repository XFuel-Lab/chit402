# EdgeCloud (Theta) — optional GPU provider

> **Not settlement home.** Money + proofs are on **Base** (USDC/x402, `ZKVerifierSP1`).
> EdgeCloud is a **compute / optional CUDA proving host** you can enable in the router.
> See [ADR 0002](../adr/0002-base-settlement-home.md).

## What to use

- On-demand inference: `ondemand.thetaedgecloud.com` (API key from EdgeCloud dashboard)
- Optional dedicated deployments for heavy provers (SP1 / zkGPT images)
- Provider-specific Solidity (`ThetaInferenceCircuit`, etc.) may remain as EdgeCloud adapters

## What not to use EdgeCloud/Theta for

- Protocol treasury / Safe
- Default payment rail (use USDC on Base)
- Product identity (“Theta-hybrid hub”)

## Reference (historical + ops)

| Doc | Notes |
|-----|--------|
| [`docs/THETA_INTEGRATIONS.md`](../THETA_INTEGRATIONS.md) | API surfaces, RPC, EdgeCloud auth |
| [`docs/THETA_INTEGRATION_PLAN.md`](../THETA_INTEGRATION_PLAN.md) | Historical integration tracker |
| `.cursorrules` / `AGENTS.md` | RPC chain IDs for ops — provider reference only |

## Legacy API paths

Gateway routes under `/theta-ai/*` are **legacy EdgeCloud-oriented** names. Prefer
`/task-request`, `/v1/chat/completions`, and MCP/SDK. Do not treat `/theta-ai` as
settlement branding; aliases may be added later without breaking existing clients.
