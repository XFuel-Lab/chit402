# chit402-mcp

MCP server for Chit402 — receipted AI inference for agents.

**First hour:** `list_models` then `chat_completions` — that is unmetered `/v1`.
`submit_inference` is the **paid** door and returns 402 without a payer.

Zero config talks to https://api.chit402.com with the public demo key.

npm: `chit402-mcp` · Registry: `io.github.XFuel-Lab/chit402-mcp` · Docs: https://chit402.com

**Public beta. Paying that host moves real USDC on Base mainnet.** MCP does not hold a private key to pay.

## Run

```bash
npx chit402-mcp
npx chit402-mcp --http --port 3033
CHIT402_API_KEY=your-key CHIT402_API_URL=https://your-host npx chit402-mcp
```

## Claude / Cursor Config

```json
{
  "mcpServers": {
    "chit402": {
      "command": "npx",
      "args": ["-y", "chit402-mcp"],
      "env": { "CHIT402_API_KEY": "chit402-demo" }
    }
  }
}
```

## Tools

| Tool | Purpose |
|------|---------|
| `chat_completions` | Generate text (unmetered `/v1`). Default model `chit402/auto`. |
| `list_models` | Live catalog — hub, pricing, availability |
| `submit_inference` | Paid `/task-request`. 402 without a payer. |
| `register_agent` | Bind an agent wallet → `agent_id` |
| `get_agent_book` | Possession-gated spend for one agent |
| `get_task_status` | Status / fees |
| `get_proof` / `verify_proof` | Settlement proof + binding checks |
| `quote_task` / `get_health` | Pricing / health |

## Documentation

- [Chit402 Docs](https://chit402.com)
- [API Reference](https://api.chit402.com)

## License

Apache-2.0
