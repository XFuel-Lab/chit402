# Design: Unify M2M `/task-request` with the 6-tier DePIN Router

Status: **Implemented (behind flag)** · Owner: platform · Audit scope: none (off-chain only)

> **Implementation note (Phase 1 + 3 of Option A landed):**
> - `circuits/theta-inference/compute-router.js` — `ComputeRouter` extracts the
>   6-tier waterfall control flow. Unit-tested in
>   `circuits/theta-inference/test/compute-router.test.mjs` (CI: `m2m-sdk-skills`).
> - `theta-inference-handler.js` `_executeService()` now delegates to
>   `ComputeRouter.fromHandler(this)` — behavior preserved (existing 23 handler
>   tests stay green; mock fallback + stats unchanged).
> - `ai-listener.js` `_routeInferenceRequest` routes through the full router when
>   `M2M_USE_FULL_ROUTER=true` (**default OFF**). Hash-only requests (no raw
>   `input`) and any provider failure fall back to the existing `THETA_EDGE_URL`
>   path. `POST /task-request` accepts an optional raw `input` to enable it.

## Problem

There are two task-processing paths that have drifted apart:

1. **M2M path** — `backend/theta-bridge/src/server.js` `POST /task-request` →
   `ai-listener.js` `_processAIIntent`. This listener routes inference via
   `THETA_EDGE_URL` or a mock. It does **not** run the full provider waterfall.

2. **Full router path** — `circuits/theta-inference/theta-inference-handler.js`
   `_executeService()` implements the documented **6-tier DePIN router**
   (EdgeCloud → RapidAPI → MCP → Akash → Render → Bedrock) and the
   `/theta-ai/*` routes (with per-request `callbackUrl`).

`AGENTS.md`, `README.md`, and `docs/M2M_API.md` advertise the 6-tier routing as
the behavior of the public M2M API. An external agent calling `/task-request`
today may get EdgeCloud-or-mock, not the promised waterfall. This is a
correctness/trust gap, not a crash.

## Goals

- A single, well-tested routing function used by both entry points.
- `/task-request` (the public M2M front door) gets true 6-tier routing.
- No change to on-chain contracts or proof verification (off-chain only).
- Backwards compatible: existing `/theta-ai/*` behavior preserved.
- Reversible via a feature flag during rollout.

## Non-goals

- Changing fee math, proof generation, or settlement.
- Changing the A2A path.

## Options considered

### Option A — Extract a shared `ComputeRouter` module (recommended)

Pull the 6-tier waterfall out of `theta-inference-handler._executeService()`
into a standalone `circuits/theta-inference/compute-router.js` exporting a pure
`routeAndExecute(intent, config)` that returns `{ providerTag, output, outputHash,
latencyMs, nodeId }`. Both the handler and `ai-listener._processAIIntent` call it.

- **Pros:** single source of truth; unit-testable in isolation; no duplicated
  tier logic; clean dependency direction.
- **Cons:** requires careful extraction of the tier code and its env/config
  dependencies (EdgeCloud key, RapidAPI, Akash, etc.); medium refactor.

### Option B — `/task-request` delegates to the ThetaInferenceHandler

Have the M2M server instantiate/forward inference intents to the existing
`ThetaInferenceHandler` instance instead of the minimal listener path.

- **Pros:** smallest code change; reuses the proven handler.
- **Cons:** couples the M2M server to the heavier handler lifecycle; the handler
  is currently mounted via CoreListener, not the minimal server; risk of double
  fee/proof logic; harder to test the seam.

### Option C — Document-only (defer)

Update docs to state `/task-request` uses EdgeCloud/mock and direct power users
to `/theta-ai/agent-intent` for full routing.

- **Pros:** zero risk now.
- **Cons:** leaves the orchestration-layer promise unmet; not where we want to be.

## Recommendation

**Option A**, phased:

1. **Extract** `compute-router.js` with the 6-tier logic + a `RouterConfig`
   assembled from env (one place). Keep `_executeService` as a thin wrapper that
   calls it (no behavior change → existing theta-inference tests stay green).
2. **Add tests** for the router in isolation (mock each tier; assert priority,
   skip-on-missing-key, fallback, and `providerTag` mapping).
3. **Wire `ai-listener._processAIIntent`** to call `routeAndExecute` for
   inference intents, behind `M2M_USE_FULL_ROUTER` (default off → on after bake).
4. **Flip the flag**, update `AGENTS.md`/`docs/M2M_API.md` to match reality, and
   surface `routedTo`/`provider_tag` in `/task-status` + the `TaskSettled`
   webhook (already plumbed in `webhooks.js buildPayload`).

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Tier code has hidden coupling to handler state | Extract to pure fn taking explicit config; no `this` |
| Behavior change surprises current `/theta-ai/*` users | Wrapper keeps identical path; only the M2M path changes, flag-gated |
| Env var sprawl | Centralize tier config in one `RouterConfig` builder + document in env.example |
| Cost blowups if Bedrock (tier 6) is hit unexpectedly | Keep tier enable/disable explicit; log + meter provider_tag |

## Test plan

- Unit: `compute-router.test.cjs` — priority order, skip-on-missing-key,
  fallthrough to next tier on error, final-tier failure surfaces error.
- Integration: `/task-request` with `M2M_USE_FULL_ROUTER=true` against mocked
  tiers asserts `routedTo` reflects the first available tier.
- Regression: existing `theta-inference-handler.test.cjs` stays green (wrapper).

## Rollout

Flag `M2M_USE_FULL_ROUTER` (default `false`) → enable in staging → bake → default
`true` → remove flag next minor. Webhook `provider_tag`/`routedTo` gives
observability during bake.
