# XFuel Verified Inference — Trust Tiers

> **Status:** Phase 4 of [`TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md`](TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).
> The tier **selector**, the **TEE attestation verifier** (pluggable), the **spot-check
> sampler**, and the **staking/slashing** contract are shipped in software. The only external
> dependency is a TEE host (e.g. NVIDIA H100 confidential computing) for the T3a fast path;
> until one is wired, `tee` attestations are verified with the `dev` attestor (a real secp256k1
> signature over the attestation, honestly labeled — **not** a hardware root of trust).

XFuel prices **trust to the value at risk**. Every task gets a coarse **tier** and, when the
tier is Tier-3, a **mechanism**:

| Tier | `tier` | Mechanism (`mechanism`) | What it attests | Cost / latency |
|------|--------|-------------------------|-----------------|----------------|
| 1 | `signed` | — | XFuel-signed receipt: route, model, cost, output hash | ~free, instant |
| 2 | `settlement` | — | SP1 proof of correct fees + payment binding + output commitment on Base | low, seconds |
| 3a | `inference` | `tee` | Computation ran in an attested enclave loading the committed model (PoMA) | low, sub-second* |
| 3b | `inference` | `zk-spotcheck` | A random fraction of tasks/layers get a ZK/re-exec check; economic deterrence via staking | tunable |
| 3c | `inference` | `zk-full` | Full zkML proof of the forward pass (small–mid models) | high, premium |

\* once a real TEE host is wired; today `tee` uses the `dev` attestor (software signature).

## Selection — value at risk

The tier selector (`services/gateway/src/tier-policy.js`) is a pure function of:

1. **Task value** (`amount`, USDC smallest unit) vs configured thresholds.
2. **Requested tier** (`proof_tier` on the task request) — an agent may **raise** assurance
   above the policy floor (pay for more), but never silently lower it.
3. **Availability** — a mechanism the node isn't configured for degrades to the best available
   with a stated reason (honest; never claims what it can't do).

```
proof_tier (request)  ─┐
task amount ───────────┤→  selectTier(policy)  →  { tier, mechanism, reason, floor, requested }
policy thresholds ─────┤
availability ──────────┘
```

Default policy (all overridable via env, disabled by default so behavior is unchanged):

| Value at risk (USDC) | Floor tier |
|----------------------|-----------|
| `< tier2Min` | `signed` |
| `< tier3Min` | `settlement` |
| `≥ tier3Min` | `inference` (mechanism = `defaultMechanism`, default `tee`) |

## T3a — TEE attestation (`tee`)

`services/gateway/src/tee-attestation.js` verifies an **attestation envelope** against policy:

- **measurement** (MRENCLAVE / binary+model measurement) ∈ allowed set,
- **model_root** == the task's PoMA commitment (the enclave loaded the model the receipt claims),
- **nonce** binds the attestation to the task (keccak of the PBR tuple / task id) — anti-replay,
- **signature** verified by the configured attestor:
  - `dev` — secp256k1 (`personal_sign`) by a pinned signer address (real crypto; software trust),
  - `nvidia-cc` / others — vendor quote verification (slot; wire when the host exists).

Result is stamped on the receipt as `verified_inference.attestation` and, honestly, records the
`method` used so a consumer knows whether it's a hardware root of trust or the dev attestor.

## T3b — Stochastic spot-check (`zk-spotcheck`)

`services/gateway/src/spotcheck.js` decides, **verifiably**, whether a task is sampled for a
deeper check:

```
draw   = keccak256(abi.encodePacked(seed, taskId))
sampled = (uint256(draw) % 10000) < rateBps
```

- `seed` is a per-epoch beacon (revealed later) so the draw is **unpredictable to the provider
  but auditable after the fact** — a provider can't dodge sampling.
- The deep "check" is pluggable: **re-execution / attestation compare** now, the self-owned ZK
  proof (Phase 5) drops in with no API change.
- On a **mismatch**, the orchestrator slashes the provider's stake and records a dispute.

## Staking & slashing

`contracts/core/ProviderStaking.sol` — providers stake an ERC-20 (USDC on Base). A `SLASHER_ROLE`
(the spot-check orchestrator / governance) can slash on a failed check; `ProviderSlashed` is
emitted and reputation is dinged. Unstaking has a cooldown so a provider can't withdraw ahead of
a pending dispute.

| Action | Who | Notes |
|--------|-----|-------|
| `stake(amount)` | provider | must reach `minStake` to be an active provider |
| `requestUnstake(amount)` | provider | starts `unbondingPeriod` cooldown |
| `withdraw()` | provider | after cooldown; blocked while `frozen` |
| `slash(provider, amount, reason, taskIdHash)` | `SLASHER_ROLE` | sends stake to the treasury; bumps `slashCount` |
| `freeze/unfreeze(provider)` | `SLASHER_ROLE` | hold withdrawals during a dispute |

## Honesty boundary

- `tee` with the `dev` attestor is **software trust**, not hardware — the receipt says so.
- `zk-spotcheck` provides **economic** assurance (deterrence + slashing), not a per-task proof,
  until the Phase 5 prover lands.
- `zk-full` is **roadmap** (Phase 5). The selector will never label a task `zk-full` unless a real
  full-proof verifier is configured.

## Agent-facing surface

- Receipts: `proof.tier` + `verified_inference { mechanism, attestation, spot_check }`.
- SDK: `selectTier(...)`, `ProviderStaking` reads/encoders.
- MCP: `get_verified_quote` (tiers available) + `get_provider_stake` (stake/slash history —
  shop on trust before you pay).
