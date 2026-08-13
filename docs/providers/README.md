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

## Theta EdgeCloud is a desktop-GPU marketplace, not pooled consumer devices

Researched 2026-08-12, because the "combine phones and laptops" framing keeps resurfacing and it is worth not re-litigating.

**It is not what it is described as.** Theta's own client requirements are bare-metal Ubuntu 22.04+, a discrete NVIDIA GPU with **≥8 GB VRAM** (they recommend 3090/4090/A100/H100), 16 GB RAM, 256 GB free disk and 100 Mbps symmetric. There is no macOS client, so every M-series Mac is excluded, and no phone meets a single line of it. The phone framing appears only in third-party summaries, never in Theta's own docs. Their own 235B prefill/decode disaggregation benchmark ran on **two H200 servers over RDMA** — when Theta does serious LLM engineering it uses datacenter hardware; the edge tier gets small models on consumer cards.

**Scale, measured.** Theta's only usage disclosure (Sept 2025 AMA, covering Aug 2025) is 261M LLM tokens/month. At our measured 68,247-token median agent call that is **127 agent calls a day**, about 9% of one RTX 4090's throughput, and roughly **0.5% of AkashML's 1.7B tokens/day**. Their homepage advertises "30,000+ edge nodes" and, lower on the same page, a live counter reading 8,742 — consistent with the DePIN base rate, where io.net reports 327,000 registered GPUs against 6,720 daily active (2.1%). Treat any advertised device count as ~2% real.

This is why [ADR 0002](../adr/0002-base-settlement-home.md) makes Theta an optional provider rather than a strategic bet. Keep the adapter; do not build positioning on it.

**Two findings that change decisions elsewhere.** Long context inverts the usual batching argument — at 68k tokens the KV cache dominates and does not amortise across a batch, so a datacenter's edge over a 4090 narrows to ~5.6x on energy rather than the ~43x a naive concurrency comparison suggests. But prefix caching restores it to ~58x, because agent calls share prompts and a 24 GB card cannot hold the shared cache. That is another argument for prompt caching being the largest cost lever we have. Separately, the sub-4B tier — the only model class our old flat $0.01 was profitable on — is the exact tier becoming free on-device (Apple runs ~3B locally and routes ~20% of requests to its own servers). Cheap-tier pricing has a floor under it that is falling toward zero.

Behind-the-meter generation, not distributed edge, is the industry's answer to the grid-interconnection queue: it converts a 5–7 year utility wait into 12–18 months while keeping industrial power rates, HBM, batching and RDMA. Residential electricity runs 2.12x industrial in the US (EIA, May 2026) and the ECB finds ~2x in the euro area, so pooled consumer compute pays more for power and gets no schedule advantage a BTM operator does not also get.

## Preferred provider + COGS

`preferred_provider` on `/task-request` selects the *routing preference* and which float is checked at quote time. COGS are burned **after** inference against the provider that actually served (`provider_cogs.provider` / signed `route.provider`). This keeps multi-provider accounting honest.
