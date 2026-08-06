# Design Partner Onboarding

One-pager for Sprint 3 partners (beachhead A). Founder sends this after a yes.

## What you get

- Partner API key (higher limits than public `xfuel-demo`)
- USDC budgets via x402 on Base — no OpenAI org keys in your agent
- Shareable receipts (`verify_url`) + optional SP1 settlement proofs
- Private Spend (when enabled): providers see XFuel pooled traffic, not your org graph
- Buyer stats: `GET /stats/me` — your paid tasks / USDC fees only

## 15-minute install

```bash
npm install xfuel-sdk
export XFUEL_API_URL=https://api-testnet.xfuel.app   # or your staging host
export XFUEL_API_KEY=<partner-key>
npx tsx node_modules/xfuel-sdk/examples/private-spend-budget.ts
# or from the monorepo: cd packages/sdk && npx tsx examples/private-spend-budget.ts
```

Playbook: [packages/agent-skills/AGENT_PLAYBOOK.md](../packages/agent-skills/AGENT_PLAYBOOK.md) Flow 7.  
MCP: `npx xfuel-mcp` then tool `get_my_stats`.

## Trust honesty (read once)

| Mode | What it proves / hides |
|------|-------------------------|
| Signed receipt | Route, cost, output hash |
| SP1 settlement | Fees + payment binding (when guest v2 live) |
| Private Spend | Vendor-blind spend topology — **gateway-trusted**, not prompt encryption |
| Confidential tier | Opt-in TEE/Phala-class content path when configured |

We do **not** claim Tier-2 proves GPT-class black-box inference.

## Feedback we want in 2 weeks

1. Did install take &lt; 1 day?
2. Receipt / verify_url usable for your audit trail?
3. Anything blocking production volume?

Channel: (founder fills Slack/Telegram link)

## Founder checklist before sending

See [FOUNDER_ACTIONS.md](./FOUNDER_ACTIONS.md) Sprint 3.
