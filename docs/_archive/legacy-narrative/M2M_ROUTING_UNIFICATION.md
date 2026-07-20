# M2M Routing Unification

Status: implemented (flag-gated). Off-chain only.

`ComputeRouter` owns the multi-tier waterfall. `POST /task-request` uses the full router when `M2M_USE_FULL_ROUTER=true` (default off historically — confirm current env). Hash-only requests without raw `input` fall back safely.

Prefer [M2M_API.md](../M2M_API.md) and [providers/README.md](../providers/README.md) for operator-facing behavior.
