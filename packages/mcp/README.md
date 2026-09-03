# xfuel-mcp

MCP server for Chit402.

**First hour:** `list_models` then `chat_completions` — that is unmetered `POST /v1/chat/completions`.
`submit_inference` is the **paid** `/task-request` door and returns 402 without a payer. It is not unmetered.

Zero config talks to https://api.chit402.com (alias: https://api.xfuel.app) with the public demo key.

Public beta. **Paying that host moves real USDC on Base mainnet.** MCP does not take a human private key to pay.

npm: `xfuel-mcp` · Registry: `io.github.XFuel-Lab/xfuel-mcp` · Docs: https://chit402.com

## Run

```
npx xfuel-mcp
npx xfuel-mcp --http --port 3033
XFUEL_API_KEY=your-key XFUEL_API_URL=https://your-host npx xfuel-mcp
```

Claude / Cursor stdio config:

```
{
  "mcpServers": {
    "xfuel": {
      "command": "npx",
      "args": ["-y", "xfuel-mcp"],
      "env": { "XFUEL_API_KEY": "xfuel-demo" }
    }
  }
}
```

## Tools

| Tool | Purpose |
|------|---------|
| `chat_completions` | Generate text (unmetered `/v1`). Required: `messages`. Default model `xfuel/auto`. |
| `list_models` | Live catalog — hub, modality, pricing, availability |
| `submit_inference` | Paid `/task-request`. 402 without a payer. Pass `messages` or `input`. Amount is USDC 6dp (`10000` = $0.01). |
| `register_agent` | `POST /v1/agents/register` — bind an AAWP / smart-account `agentWallet` + collected receipt → `agent_id`. |
| `get_agent_book` | Possession-gated last-N collected spend for one `agent_id`. Not a public index. |
| `get_task_status` | Status / fees — task ids also come from `chat_completions` |
| `get_proof` / `verify_proof` | Settlement proof + binding checks |
| `quote_task` / `get_health` | Pricing / health |
| `verify_model_commitment` | PoMA check (needs RPC + registry) |
| `get_verified_quote` | Price + available trust tiers |
| `get_validation_status` | ERC-8004 validation record |
| `get_provider_stake` | Stake / slash history |
| `get_my_stats` | Usage for the configured key. Demo key is shared, not yours. |

Proofs attest settlement metadata + output-hash commitment, not inference correctness — unless Tier-3 Verified Inference applies.

## Publish (maintainers)

Same flow as the SDK — browser + security key (not a classic npm token):

```powershell
cd packages/sdk
npm publish --access public --auth-type=web
cd ../mcp
npm publish --access public --auth-type=web
```

See [../sdk/PUBLISHING.md](../sdk/PUBLISHING.md). Publish **xfuel-sdk@0.6.0** first, then this package (`0.4.0`). `xfuel-sdk@^0.6.0` is required.

## Docs

- [docs/M2M_API.md](../../docs/M2M_API.md)
- [docs/CHAT_COMPLETIONS_GATEWAY.md](../../docs/CHAT_COMPLETIONS_GATEWAY.md)
- [Agent playbook](../agent-skills/AGENT_PLAYBOOK.md)
