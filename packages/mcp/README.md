# Chit402 MCP (`xfuel-mcp` / `chit402-mcp`)

MCP server for Chit402 — returns the **book** and **verify_url**, not another chat wrapper.

**First hour:** `list_models` → `chat_completions` (unmetered `POST /v1/chat/completions`).
**Book:** `register_agent` → `get_book` / `get_agent_book` (possession-gated last-N spend).
**Prove it:** `verify_receipt` (offline binding via `@xfuel/verify`). SP1 tools (`get_proof`, `verify_proof`) are optional Tier-2.

Zero config talks to https://api.chit402.com (alias: https://api.xfuel.app) with demo key `chit402-demo`.

Public beta. **Paying that host moves real USDC on Base or Solana.** MCP does not take a human private key — the payer stays client-side (Eliza plugin, wallet, etc.).

npm: `xfuel-mcp` · alias: `chit402-mcp` · Registry: `io.github.XFuel-Lab/xfuel-mcp`

## Run

```bash
npx chit402-mcp
# or
npx xfuel-mcp

npx chit402-mcp --http --port 3033

CHIT402_API_KEY=your-key CHIT402_API_URL=https://your-host npx chit402-mcp
# aliases: CHIT_API_URL, CHIT_API_KEY, XFUEL_API_URL, XFUEL_API_KEY
```

Claude / Cursor stdio config:

```json
{
  "mcpServers": {
    "chit402": {
      "command": "npx",
      "args": ["-y", "chit402-mcp"],
      "env": {
        "CHIT402_API_URL": "https://api.chit402.com",
        "CHIT402_API_KEY": "chit402-demo"
      }
    }
  }
}
```

## Example tool result (`chat_completions`)

Every receipt-bearing tool returns **structuredContent** with a top-level `verify_url` (not stripped by nested `xfuel` only):

```json
{
  "model": "xfuel/auto",
  "choices": [{ "message": { "role": "assistant", "content": "Hello." } }],
  "xfuel": {
    "task_id": "openai-abc123",
    "verify_url": "https://api.chit402.com/receipt/openai-abc123",
    "payment": { "rail": "unmetered" }
  },
  "task_id": "openai-abc123",
  "verify_url": "https://api.chit402.com/receipt/openai-abc123"
}
```

Human-readable `content[0].text` also includes `Verify/share: …` for clients that only render text.

## Tools

| Tool | Purpose |
|------|---------|
| `chat_completions` | Generate text (unmetered `/v1`). Returns top-level `verify_url`. |
| `list_models` | Live catalog — hub, modality, pricing, availability |
| `register_agent` | `POST /v1/agents/register` — bind `agentWallet` + collected receipt → `agent_id` |
| `get_book` / `get_agent_book` | Possession-gated last-N collected spend + budget Y / remaining |
| `verify_receipt` | Offline receipt verify (`@xfuel/verify`) — default prove-it path |
| `submit_inference` | Paid `/task-request`. 402 without a payer. Amount USDC 6dp. |
| `get_task_status` | Status / fees for a task id |
| `get_proof` / `verify_proof` | Optional Tier-2 SP1 settlement (not default) |
| `quote_task` / `get_health` | Pricing / health |
| `verify_model_commitment` | PoMA check (needs RPC + registry) |
| `get_verified_quote` | Price + available trust tiers |
| `get_validation_status` | ERC-8004 validation record |
| `get_provider_stake` | Stake / slash history |
| `get_my_stats` | Usage for the configured key (demo key is shared) |

### API gaps (honest)

- **Book** requires a possession `session` from `register_agent`; demo/unmetered receipts do not qualify for registration.
- **Budget Y** is set via POST body on `/v1/agents/:id/book`; MCP exposes optional `budget` on `get_book` / `get_agent_book`.
- Book **policy / assign / dispute / ingest / rotate / lineage** endpoints exist on the gateway but are not MCP tools yet — call HTTP or extend the server if you need them.
- **Payment** for paid inference is not in MCP (by design). Use the Eliza plugin or x402 client-side payer.

## Test / smoke

```bash
cd packages/mcp
npm install
npm test
npm run smoke
```

## Publish (maintainers)

Publish **xfuel-sdk** and **@xfuel/verify** first, then:

```powershell
cd packages/mcp
npm publish --access public --auth-type=web
```

See [../sdk/PUBLISHING.md](../sdk/PUBLISHING.md).

## Docs

- [docs/M2M_API.md](../../docs/M2M_API.md)
- [docs/CHAT_COMPLETIONS_GATEWAY.md](../../docs/CHAT_COMPLETIONS_GATEWAY.md)
- [Agent playbook](../agent-skills/AGENT_PLAYBOOK.md)
