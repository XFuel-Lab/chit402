# Providers

XFuel routes inference to **pluggable providers**. Settlement (USDC / proofs) lives on
**Base** — see [ADR 0002](../adr/0002-base-settlement-home.md).

| Provider | Docs | Role |
|----------|------|------|
| OpenAI-compatible (Groq, OpenAI, Together, …) | Gateway env / `docs/OPENAI_COMPATIBLE_GATEWAY.md` | Default neocloud tier |
| **EdgeCloud (Theta)** | [edgecloud.md](edgecloud.md) | Optional **GPU** tier only |
| Akash / others | Circuit runtime + env | Optional DePIN GPU |

Deep historical Theta EVM / subchain notes remain in `docs/THETA_INTEGRATION_*.md`
with a provider-only banner — they are **not** settlement-home docs.
