# Providers

XFuel routes inference to pluggable providers. Settlement (USDC / proofs) is on Base — [ADR 0002](../adr/0002-base-settlement-home.md).

| Provider | Role |
|----------|------|
| OpenAI-compatible (Groq, OpenAI, Together, …) | Default neocloud tier |
| **Confidential / TEE-class (Phala-compatible)** | Opt-in content privacy — `CONFIDENTIAL_PROVIDER_BASE_URL` + `CONFIDENTIAL_PROVIDER_API_KEY` |
| EdgeCloud (Theta) | Optional GPU tier — [edgecloud.md](./edgecloud.md) |
| Akash / others | Optional DePIN GPU |

Confidential tier uses an OpenAI-shaped `/chat/completions` endpoint (e.g. Phala). When unset, the router skips it. Receipts may show `privacy.mode=content_tee` when this tier wins. This is **not** the same as Verified Inference `VI_TEE_*` (assurance attestation).

Private Spend (vendor-blind) is orthogonal — [PRIVATE_SPEND_THESIS.md](../PRIVATE_SPEND_THESIS.md).

Historical Theta EVM notes (if present) are provider-ops only — not settlement-home docs. Prefer [RUNTIME_STATE.md](../RUNTIME_STATE.md).
