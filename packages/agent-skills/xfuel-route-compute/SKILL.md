---
name: xfuel-route-compute
description: >-
  Inspect XFuel's 6-tier DePIN compute router and preview which GPU provider a
  task will hit (Theta EdgeCloud → RapidAPI → MCP → Akash → Render → AWS Bedrock),
  plus check server health and available chains/models. Use when a user asks
  "which provider will run this?", "is EdgeCloud available?", "what does XFuel
  route to?", or wants to estimate cost/latency before submitting a task.
---

# XFuel: Route / Inspect Compute

Preview routing and provider availability before (or instead of) submitting work.

## Prerequisites

- `XFUEL_API_URL`, `XFUEL_API_KEY`. See `../_shared/reference/env-and-endpoints.md`.

## Parameters

| Name | Required | Description |
|------|----------|-------------|
| `chain_id` | no | Filter intent chain: `theta` \| `akash` \| `bittensor` \| `osmosis`. |
| `model` | no | Model slug to check (informational). |

## The 6-tier priority router

Tasks route first-available, lowest-cost (see repo `AGENTS.md` / `circuits/theta-inference`):

| Tier | Provider | Enabled by env (server-side) |
|------|----------|------------------------------|
| 1 | Theta EdgeCloud | `THETA_EDGECLOUD_API_KEY` |
| 2 | RapidAPI inference | `THETA_RAPIDAPI_KEY` |
| 3 | MCP (local) | `THETA_MCP_ENDPOINT` |
| 4 | Akash Network | `AKASH_*` |
| 5 | Render Network | `RENDER_API_KEY` |
| 6 | AWS Bedrock (last resort) | `AWS_*` |

> Today the public `/task-request` path may not run the full waterfall — see
> `docs/design/M2M_ROUTING_UNIFICATION.md`. The `routedTo` / `provider_tag`
> fields in `/task-status` and the `TaskSettled` webhook are authoritative for
> what actually ran.

## Procedure

1. Read server health to see configured fees, chains, and listener status:

   ```js
   import { XFuelClient } from 'xfuel-sdk';
   const client = new XFuelClient({ baseUrl: process.env.XFUEL_API_URL, apiKey: process.env.XFUEL_API_KEY });
   const health = await client.getHealth();
   // health.chains, health.message_types, health.fee_config, health.ai_listener
   ```

2. To learn the actual provider for a task, submit via `xfuel-submit-inference`
   and read `routedTo` / `provider_tag` from the status/webhook.

3. Return a routing preview: enabled tiers (from health/listener status), the
   default chain, and the fee model (0.5% default).

## Cost preview (payment rails)

To preview the *price* of a task per payment rail before submitting, call
`POST /task-quote` (read-only): it returns the USDC-via-x402 amount (default rail,
on Base) and the TFUEL amount. Provider *routing* (this skill) and payment *rail*
(`xfuel-submit-inference` `payment` param) are independent — a task can run on any
tier and settle in USDC or TFUEL. See `../_shared/reference/payments-x402.md`.

```js
const quote = await client.quoteTask({ model_id: 'llama-3-70b' }); // POST /task-quote
// quote.rails.usdc.amount, quote.rails.tfuel.amount, quote.recommended
```

## Failure modes

- `ai_listener: null` in health → listener not initialized; routing unavailable.
- All tiers disabled → tasks will stall in `routing`.

## Notes

- This skill is read-only/advisory; it does not submit billable work.
