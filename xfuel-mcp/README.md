# xfuel-mcp

First-party **Model Context Protocol (MCP)** server for the [XFuel Protocol](https://github.com/XFuel-Lab/xfuel-protocol) — the ZK settlement + orchestration layer for AI compute across decentralized GPU networks (DePIN).

It exposes XFuel's core capabilities as MCP tools so any MCP client (Claude Desktop, Cursor, your own agent) can submit AI inference, price tasks, and fetch/verify ZK settlement proofs. Runs over **stdio** (local) or **streamable HTTP** (remote/shared).

Zero config: with no env set it talks to XFuel's hosted testnet demo (`https://api-testnet.xfuel.app`) using the shared, rate-limited public demo key — so `npx xfuel-mcp` just works.

## Tools

| Tool | Purpose |
|------|---------|
| `submit_inference` | Submit an AI inference task (routed to a GPU provider, settled with a ZK proof) |
| `get_task_status` | Poll a task's status, proof outcome, and fee breakdown |
| `get_proof` | Fetch the SP1 ZK settlement proof for a settled task |
| `verify_proof` | Verify a proof client-side: integrity + x402 payment-binding re-derivation (+ optional on-chain nullifier read) |
| `quote_task` | Preview per-rail pricing (USDC via x402 / TFUEL) — no side effects |
| `get_health` | XFuel API health, fee config, supported chains (discovery/diagnostics) |

> The proof attests settlement metadata + a commitment to the output hash — **not** inference correctness. `verify_proof` reports exactly what was checked.

## Quick start

```bash
# stdio (default) — talks to the hosted testnet demo with the public demo key
npx xfuel-mcp

# streamable HTTP on :3033
npx xfuel-mcp --http --port 3033

# bring your own key / endpoint
XFUEL_API_KEY=your-key XFUEL_API_URL=https://your-host npx xfuel-mcp
```

### Claude Desktop / Cursor (stdio)

Add to your MCP client config (e.g. `claude_desktop_config.json` or Cursor's `mcp.json`):

```json
{
  "mcpServers": {
    "xfuel": {
      "command": "npx",
      "args": ["-y", "xfuel-mcp"],
      "env": {
        "XFUEL_API_KEY": "xfuel-demo"
      }
    }
  }
}
```

### Remote / shared (streamable HTTP)

```bash
XFUEL_API_KEY=your-key npx xfuel-mcp --http --port 3033
# → MCP endpoint at http://localhost:3033/mcp  (POST)
# → liveness at http://localhost:3033/health
```

Point a streamable-HTTP MCP client at `http://<host>:3033/mcp`. Optionally require a bearer token by setting `XFUEL_MCP_AUTH_TOKEN` (clients then send `Authorization: Bearer <token>`).

## Configuration

All optional. CLI flags take precedence over environment variables.

| Env | CLI | Default | Description |
|-----|-----|---------|-------------|
| `XFUEL_API_URL` | `--api-url` | `https://api-testnet.xfuel.app` | XFuel API base URL |
| `XFUEL_API_KEY` | `--api-key` | `xfuel-demo` | API key (sent as `X-API-Key`) |
| `XFUEL_MCP_TRANSPORT` | `--stdio` / `--http` | `stdio` | Transport |
| `XFUEL_MCP_PORT` | `--port` | `3033` | HTTP port (http only) |
| `XFUEL_MCP_AUTH_TOKEN` | — | (none) | Optional bearer token for the HTTP endpoint |
| `XFUEL_RPC_URL` | — | (none) | Theta RPC for `verify_proof`'s on-chain nullifier read |
| `ZK_VERIFIER_ADDRESS` | — | (none) | ZKVerifierSP1 address (paired with `XFUEL_RPC_URL`) |

See [`.env.example`](./.env.example).

## Typical flow

1. `quote_task` → preview cost.
2. `submit_inference` → get a `task_id`.
3. `get_task_status` → poll until `proof_outcome: "valid"`.
4. `get_proof` → fetch the proof.
5. `verify_proof` → confirm integrity + payment binding (set `check_nullifier: true` with `XFUEL_RPC_URL` + `ZK_VERIFIER_ADDRESS` to also read on-chain replay state).

## Development

```bash
npm install       # installs deps + the local xfuel-sdk (file:../sdk/js)
npm run build     # tsc → dist/
npm start         # node dist/index.js
npm run dev       # tsx watch
npm run inspect   # @modelcontextprotocol/inspector against the built server
```

Built on the official [`xfuel-sdk`](../sdk/js) — MCP tools are thin wrappers so behaviour matches the SDK and examples exactly.

> **Publishing note:** in the repo, the `xfuel-sdk` dependency uses `file:../sdk/js`
> so it builds against the local SDK (including unreleased helpers like `verifyProof`).
> Before `npm publish`, pin it to the published semver range
> (e.g. `"xfuel-sdk": "^0.2.0"`) so consumers resolve it from npm.

## License

Apache-2.0
