# Providers

XFuel routes inference to pluggable providers. Settlement (USDC / proofs) is on Base — [ADR 0002](../adr/0002-base-settlement-home.md).

| Provider | Role |
|----------|------|
| OpenAI-compatible (Groq, OpenAI, Together, …) | Default neocloud tier |
| EdgeCloud (Theta) | Optional GPU tier — [edgecloud.md](./edgecloud.md) |
| Akash / others | Optional DePIN GPU |

Historical Theta EVM notes (if present) are provider-ops only — not settlement-home docs. Prefer [RUNTIME_STATE.md](../RUNTIME_STATE.md).
