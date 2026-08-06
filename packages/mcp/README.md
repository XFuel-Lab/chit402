# xfuel-mcp

MCP server for XFuel: list models, submit inference, pay USDC via x402, quote, fetch/verify settlement proofs.

Zero config talks to https://api-testnet.xfuel.app with the public demo key.

npm: `xfuel-mcp` · Registry: `io.github.XFuel-Lab/xfuel-mcp`

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
| `list_models` | Routable model ids |
| `submit_inference` | Submit task (default unmetered path) |
| `pay_with_usdc` | Pay with x402 (needs `XFUEL_PAYER_PRIVATE_KEY`) |
| `get_task_status` | Status / fees |
| `get_proof` / `verify_proof` | Settlement proof + binding checks |
| `quote_task` / `get_health` | Pricing / health |
| `verify_model_commitment` | PoMA check (needs RPC + registry) |
| `get_verified_quote` | Price + available trust tiers |
| `get_validation_status` | ERC-8004 validation record |
| `get_provider_stake` | Stake / slash history |

Proofs attest settlement metadata + output-hash commitment, not inference correctness — unless Tier-3 Verified Inference applies.

## Publish (maintainers)

Same flow as the SDK — browser + security key (not a classic npm token):

```powershell
cd packages/sdk
npm publish --access public --auth-type=web
cd ../mcp
npm publish --access public --auth-type=web
```

See [../sdk/PUBLISHING.md](../sdk/PUBLISHING.md).

## Docs

- [docs/M2M_API.md](../../docs/M2M_API.md)
- [docs/OPENAI_COMPATIBLE_GATEWAY.md](../../docs/OPENAI_COMPATIBLE_GATEWAY.md)
- [Agent playbook](../agent-skills/AGENT_PLAYBOOK.md)
