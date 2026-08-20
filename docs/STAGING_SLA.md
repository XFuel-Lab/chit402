# Staging SLA

Partner-facing reliability targets for the demo / staging gateway and SP1 prover.

Status: draft targets · Last updated: 2026-08-05  
Related: [RUNTIME_STATE.md](./RUNTIME_STATE.md), [deploy/ecs/README.md](../deploy/ecs/README.md).

## Scope

| Surface | Host | Notes |
|---------|------|-------|
| Gateway (M2M + OpenAI `/v1`) | Lightsail `api.xfuel.app` (alias `api-testnet`) | systemd `xfuel-api` |
| SP1 prover | AWS ECS `xfuel-sp1-prover` + ALB | Ingress locked to Lightsail IP |
| Verifier | Base mainnet `ZKVerifierSP1` | Always-on contract |

This is **staging / design-partner** SLA — not a paid production enterprise SLA.

## Targets (staging)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Gateway availability | ≥ 99% monthly | `/health` uptime (external check) |
| Task accept latency (p95) | &lt; 2s excluding provider inference | Time to `202` on `/task-request` |
| Provider inference | Best-effort | Depends on configured tiers |
| Tier-2 prove start | &lt; 60s when prover scaled up | Task → proof request accepted |
| Tier-2 prove complete | Best-effort (Succinct network) | Document variance; no hard SLA yet |
| Receipt durability | Settled receipts survive restart | `task-store` persistence |

## Hardening checklist (ops)

- [ ] External uptime monitor on `https://api.xfuel.app/health` (or staging host)
- [ ] Alert on PM2 process exit / 5xx spike
- [ ] Confirm ALB security group still only allows Lightsail egress IP
- [ ] ECS task desired count ≥ 1 when partners are proving; scale to 0 only with notice
- [ ] `SP1_PROVER_URL` on gateway matches live ALB ([RUNTIME_STATE.md](./RUNTIME_STATE.md))
- [ ] No mock facilitator in partner-facing env (`X402_FACILITATOR_PROVIDER=x402`)
- [ ] Log retention: with Private Spend, minimize prompt bodies (`PRIVATE_SPEND_MINIMIZE_LOGS`)
- [ ] Weekly: glance `GET /stats` north-star (`paid_tasks_7d`, `usdc_fees_7d`)

## Failure modes (honest)

| Failure | User impact | Mitigation |
|---------|-------------|------------|
| Provider cold | Mock or 5xx / fallthrough | Configure OpenAI-compat + Claude backstop |
| Prover scaled to 0 | Signed receipt only; proof gated | Scale ECS up; `PROVER_ALLOW_KEYS` |
| Facilitator 401 | USDC settle fails | Rotate CDP JWT keys |
| Lightsail reboot | Brief downtime | PM2 resurrect; monitor |

## On-call (founder)

Until a dedicated eng on-call exists:

1. Check `/health` and PM2 `xfuel-m2m`
2. Check ECS service desired/running count
3. Check recent CloudWatch logs for prover
4. Status note to design partners if &gt; 30 min degraded

## Promotion to production SLA

Requires: mainnet USDC live, audit engaged, staging targets held for 30 days, named on-call. Document new targets in a separate `PRODUCTION_SLA.md` when ready.
