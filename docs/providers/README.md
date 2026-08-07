# Providers

XFuel routes inference to pluggable providers. Settlement (USDC / proofs) is on Base — [ADR 0002](../adr/0002-base-settlement-home.md). Provider COGS use prepaid floats — [PROVIDER_FLOAT_TREASURY.md](../PROVIDER_FLOAT_TREASURY.md) · [ADR 0005](../adr/0005-provider-float-cogs.md). Strategy: [STRATEGY.md](../STRATEGY.md).

| Provider | Role |
|----------|------|
| OpenAI-compatible (Groq, OpenAI, Together, …) | Default neocloud tier (Web2 float / counsel before scale) |
| **Confidential / TEE-class (Phala-compatible)** | Opt-in content privacy — `CONFIDENTIAL_PROVIDER_BASE_URL` + `CONFIDENTIAL_PROVIDER_API_KEY` |
| EdgeCloud (Theta) | Optional GPU tier — prefer **USDC** prepaid billing; TFUEL optional ops — [edgecloud.md](./edgecloud.md) |
| Akash / others | Optional DePIN GPU — ACT float (USD-pegged credits) |

Confidential tier uses an OpenAI-shaped `/chat/completions` endpoint (e.g. Phala). When unset, the router skips it. Receipts may show `privacy.mode=content_tee` when this tier wins. This is **not** the same as Verified Inference `VI_TEE_*` (assurance attestation).

Private Spend (vendor-blind) is orthogonal — [PRIVATE_SPEND_THESIS.md](../PRIVATE_SPEND_THESIS.md).

Buyers always pay USDC on Base. Do not surface TFUEL/AKT as buyer rails. Historical Theta EVM notes (if present) are provider-ops only — not settlement-home docs. Prefer [RUNTIME_STATE.md](../RUNTIME_STATE.md).
