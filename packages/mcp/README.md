# xfuel-mcp

First-party **Model Context Protocol (MCP)** server for the [XFuel Protocol](https://github.com/XFuel-Lab/xfuel-protocol) — the ZK settlement + orchestration layer for AI compute across decentralized GPU networks (DePIN).

It exposes XFuel's core capabilities as MCP tools so any MCP client (Claude Desktop, Cursor, your own agent) can submit AI inference, price tasks, and fetch/verify ZK settlement proofs. Runs over **stdio** (local) or **streamable HTTP** (remote/shared).

Zero config: with no env set it talks to XFuel's hosted testnet demo (`https://api-testnet.xfuel.app`) using the shared, rate-limited public demo key — so `npx xfuel-mcp` just works.

## Install

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-000?logo=cursor)](https://cursor.com/en/install-mcp?name=xfuel&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInhmdWVsLW1jcCJdfQ==)
[![npm](https://img.shields.io/npm/v/xfuel-mcp?logo=npm)](https://www.npmjs.com/package/xfuel-mcp)

- **Cursor** — click the badge above (or **Settings → MCP → Add**), which installs the
  `npx -y xfuel-mcp` stdio server.
- **Claude Desktop / Claude Code / other MCP clients** — copy the JSON under
  [Add to Claude / other MCP clients (stdio)](#add-to-claude--other-mcp-clients-stdio) below.
- **MCP Registry** — published as [`io.github.XFuel-Lab/xfuel-mcp`](https://registry.modelcontextprotocol.io/v0/servers?search=xfuel)
  (discoverable in the [official registry](https://registry.modelcontextprotocol.io) and
  aggregators like Glama / mcp.so / PulseMCP).

## Tools

| Tool | Purpose |
|------|---------|
| `list_models` | List routable model ids (OpenAI-compatible) — call first for discovery |
| `submit_inference` | Submit an AI inference task (routed to a GPU provider, settled with a ZK proof) |
| `pay_with_usdc` | Submit **and pay** for inference with USDC over x402 — opt-in (needs a payer key) |
| `get_task_status` | Poll a task's status, proof outcome, and fee breakdown |
| `get_proof` | Fetch the SP1 ZK settlement proof for a settled task |
| `verify_proof` | Verify a proof client-side: integrity + x402 payment-binding re-derivation (+ optional on-chain nullifier read) |
| `quote_task` | Preview per-rail pricing (USDC via x402 / TFUEL) — no side effects |
| `get_health` | XFuel API health, fee config, supported chains (discovery/diagnostics) |

> The proof attests settlement metadata + a commitment to the output hash — **not** inference correctness. `verify_proof` reports exactly what was checked.

> `submit_inference` settles with the server's default (unpaid/TFUEL) rail and needs no key.
> `pay_with_usdc` is the only tool that moves funds — it is **inert unless** the server is
> started with `XFUEL_PAYER_PRIVATE_KEY`, so the default experience stays zero-config.

## Quick start

```bash
# stdio (default) — talks to the hosted testnet demo with the public demo key
npx xfuel-mcp

# streamable HTTP on :3033
npx xfuel-mcp --http --port 3033

# bring your own key / endpoint
XFUEL_API_KEY=your-key XFUEL_API_URL=https://your-host npx xfuel-mcp
```

### Add to Claude / other MCP clients (stdio)

Add this to your MCP client config — `claude_desktop_config.json` (Claude Desktop),
`~/.cursor/mcp.json` (Cursor), or any client's `mcpServers` map — then restart the client:

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

**Claude Code (CLI)** — one command, no file editing:

```bash
claude mcp add xfuel -e XFUEL_API_KEY=xfuel-demo -- npx -y xfuel-mcp
```

That's the full zero-config setup: it talks to the hosted testnet demo out of the box.
Swap `XFUEL_API_KEY` (and add `XFUEL_API_URL`) for your own key/endpoint, and set
`XFUEL_PAYER_PRIVATE_KEY` only if you want to enable `pay_with_usdc`.

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
| `XFUEL_PAYER_PRIVATE_KEY` | — | (none) | Enables `pay_with_usdc`. **Env only** (never a CLI flag). |

See [`.env.example`](./.env.example).

### Paying with USDC (x402) — `pay_with_usdc`

By default the server holds no keys and `pay_with_usdc` is inert. To let it settle
tasks in USDC, start the server with a funded payer wallet:

```bash
XFUEL_PAYER_PRIVATE_KEY=0xabc... npx xfuel-mcp
```

The tool signs an EIP-3009 `transferWithAuthorization` (USDC) for whatever network the
server's x402 challenge specifies (e.g. Base or Base Sepolia) via the SDK's
`createEip3009Payer` — the key never leaves the process. If the server has x402 disabled,
the call transparently falls back to the TFUEL rail (no payment is made) and the result
reports `payment_rail: "tfuel"`.

> **Security:** this key can spend USDC. Scope it to a low-balance wallet, keep it out of
> shell history (env/secret store only), and prefer running the server on a trusted host.
> For agent-held keys, use the [`xfuel-sdk`](../sdk/js) directly with your own payer instead.

## Typical flow

1. `list_models` → discover valid model ids. `quote_task` → preview cost.
2. `submit_inference` (TFUEL, zero-config) **or** `pay_with_usdc` (USDC/x402, needs a payer key) → get a `task_id`.
3. `get_task_status` → poll until `proof_outcome: "valid"`.
4. `get_proof` → fetch the proof.
5. `verify_proof` → confirm integrity + payment binding (set `check_nullifier: true` with `XFUEL_RPC_URL` + `ZK_VERIFIER_ADDRESS` to also read on-chain replay state).

Every task-producing tool (`submit_inference`, `pay_with_usdc`, `get_task_status`,
`get_proof`) surfaces a **`verify_url`** — the public, no-auth `/receipt/:taskId` page —
in its summary and structured output. It's one shareable link that renders the
settlement, proof status, and (for USDC tasks) an independent payment-binding check.

## Development

```bash
npm install       # installs deps (resolves the published xfuel-sdk@^0.2.0)
npm run build     # tsc → dist/
npm start         # node dist/index.js
npm run dev       # tsx watch
npm run inspect   # @modelcontextprotocol/inspector against the built server
```

Built on the official [`xfuel-sdk`](../sdk/js) — MCP tools are thin wrappers so behaviour matches the SDK and examples exactly.

## Publishing

Both packages are live: [`xfuel-sdk`](https://www.npmjs.com/package/xfuel-sdk) and
[`xfuel-mcp`](https://www.npmjs.com/package/xfuel-mcp) on npm, and
[`io.github.XFuel-Lab/xfuel-mcp`](https://registry.modelcontextprotocol.io/v0/servers?search=xfuel)
in the MCP registry.

The `xfuel-sdk` dependency is pinned to the published range `^0.2.0` (which includes the
helpers this server uses: `verifyProof`, `createEip3009Payer`, `listModels`). For **local**
development against the in-repo SDK, temporarily `npm install ../sdk/js` (or restore
`file:../sdk/js`) — the committed `^0.2.0` is what consumers resolve from npm.

Release order (bump versions first; npm auth required):

```bash
# 1. Publish the SDK first (the MCP depends on xfuel-sdk@^0.2.0).
#    --auth-type=web opens a browser for 2FA / security-key auth.
cd ../sdk/js && npm publish --auth-type=web    # runs build + tests via prepublishOnly

# 2. Publish the MCP (prepublishOnly runs build + tests).
cd ../../xfuel-mcp && npm publish --auth-type=web
```

Then list in the MCP registry. The registry namespace is **case-sensitive** and must match
your GitHub org exactly (`io.github.XFuel-Lab/...`), and it verifies ownership by reading
`mcpName` from the *published* npm tarball — so `server.json` `name`, `packages[].version`,
and `package.json` `mcpName` must all be in sync with what's on npm.

```bash
# Install the publisher CLI (standalone binary — not on npm).
# macOS/Linux: brew install mcp-publisher
# Windows (PowerShell): download the release binary, e.g.
#   Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz" -OutFile mcp-publisher.tar.gz
#   tar xf mcp-publisher.tar.gz mcp-publisher.exe

mcp-publisher validate        # check server.json against the registry schema
mcp-publisher login github    # GitHub device-flow (no npm OTP involved)
mcp-publisher publish         # publishes ./server.json
```

## License

Apache-2.0
