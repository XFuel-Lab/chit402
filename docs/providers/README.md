# Providers

XFuel routes inference to pluggable providers. Settlement (USDC / proofs) is on Base — [ADR 0002](../adr/0002-base-settlement-home.md). Provider COGS use prepaid floats — [PROVIDER_FLOAT_TREASURY.md](../PROVIDER_FLOAT_TREASURY.md) · [ADR 0005](../adr/0005-provider-float-cogs.md). Strategy: [STRATEGY.md](../STRATEGY.md).

| Provider | Role |
|----------|------|
| OpenAI-compatible (Groq, OpenAI, Together, …) | Default neocloud tier (Web2 float / counsel before scale) |
| **Confidential / TEE-class (Phala-compatible)** | Opt-in content privacy — `CONFIDENTIAL_PROVIDER_BASE_URL` + `CONFIDENTIAL_PROVIDER_API_KEY` |
| EdgeCloud (Theta) | Optional GPU tier — prefer **USDC** prepaid billing; TFUEL optional ops — [edgecloud.md](./edgecloud.md) |
| **AkashML** (`api.akashml.com`) | First-class DePIN chat provider (OpenAI-compatible, pay-per-token). Same GLM-5.2 as Theta default → clean provider comparison. Set `AKASHML_API_KEY`. Catalog ids: `akash/<nativeId>` (e.g. `akash/zai-org/GLM-5.2`). Float id: `akash-network`. |
| Akash SDL / lease | **Not used** for inference — container leasing path deliberately rejected |

### Akash ships two credentials — don't cross them

This is the single easiest mistake to make, because Akash's own docs name the *other* one `AKASH_API_KEY`:

| Key prefix | Product | Endpoint | Header | Billing |
| --- | --- | --- | --- | --- |
| `akml-…` | **AkashML inference** (what XFuel uses) | `api.akashml.com/v1` | `Authorization: Bearer` | per token consumed |
| `ac.sk.…` | Akash Console / managed wallet | `console-api.akash.network` | `x-api-key` | **per lease, for as long as the lease is open** |

Get the inference key at akashml.com → Settings → API Keys, and put it in `AKASHML_API_KEY`.

The billing distinction is why AkashML is a first-class provider and the SDL/lease path is not. A Console lease bills continuously from the moment a provider bid is accepted until the deployment is closed — idle or not — so it needs escrow funding, a lifecycle reaper, and orphan monitoring to avoid draining credits on a container serving nothing. AkashML has no lease and no instance: stop sending requests and spend goes to zero. Nothing to reap.

`akashmlApiKey()` therefore selects on key prefix rather than variable name. A `ac.sk.…` key in the AkashML slot is rejected with a warning instead of forwarded, because a 401 from the inference endpoint would otherwise fall through to mock and look like a working integration.

Confidential tier uses an OpenAI-shaped `/chat/completions` endpoint (e.g. Phala). When unset, the router skips it. Receipts may show `privacy.mode=content_tee` when this tier wins. This is **not** the same as Verified Inference `VI_TEE_*` (assurance attestation).

Private Spend (vendor-blind) is orthogonal — [PRIVATE_SPEND_THESIS.md](../PRIVATE_SPEND_THESIS.md).

Buyers always pay USDC on Base. Do not surface TFUEL/AKT as buyer rails. Historical Theta EVM notes (if present) are provider-ops only — not settlement-home docs. Prefer [RUNTIME_STATE.md](../RUNTIME_STATE.md).

## Preferred provider + COGS

`preferred_provider` on `/task-request` selects the *routing preference* and which float is checked at quote time. COGS are burned **after** inference against the provider that actually served (`provider_cogs.provider` / signed `route.provider`). This keeps multi-provider accounting honest.
