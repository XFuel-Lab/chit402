# XFuel Distribution & Discovery

How XFuel is made discoverable to agents and the ecosystem, and the exact steps to
list it in the two networks that matter today: the **x402 Bazaar** (payments/compute
discovery) and the **MCP registry + aggregators** (agent-tool discovery).

Legend: **[shipped]** = in the repo / served by the running node; **[you]** = a
submission that needs a maintainer account/credentials (commands provided).

---

## 1. x402 Bazaar (payments discovery)

The x402 Bazaar is a discovery layer: a facilitator exposes
`GET /discovery/resources`, and a resource server becomes discoverable by describing
its 402-payable routes in the bazaar shape (`accepts` payment requirements + metadata).
Ref: <https://docs.x402.org/extensions/bazaar>.

### What's shipped

- **[shipped] Public discovery manifest:** `GET /.well-known/x402` self-describes
  XFuel's one paid resource — `POST /task-request` with `payment.rail="usdc"`
  (exact scheme, USDC on Base) — including `accepts`, input/output JSON schemas, the
  facilitator we settle through, and pointers to `/llms.txt` + docs.
  Source: `backend/theta-bridge/src/x402-discovery.js`.
- **[shipped] 402 challenge** already emits the `accepts` array a Bazaar-supporting
  facilitator indexes (`backend/theta-bridge/src/x402-adapter.js`).
- **[shipped] Live facilitator:** settlement runs through the standard x402 facilitator
  (public Base-Sepolia reference by default). See `docs/X402_ADAPTER.md`.

### To register in the CDP / Coinbase Bazaar  **[you]**

The CDP Bazaar indexes resources that settle through a Bazaar-supporting facilitator.
To appear:

1. Point the server at the Bazaar facilitator (Base **mainnet** for production listing):
   ```bash
   X402_ENABLED=true
   X402_DEFAULT_RAIL=usdc
   X402_FACILITATOR_PROVIDER=x402
   X402_FACILITATOR_URL=https://x402.org/facilitator   # or the CDP facilitator
   X402_NETWORK=base
   X402_PAY_TO=0x<your-usdc-treasury>
   PUBLIC_BASE_URL=https://api.xfuel.app                # absolute links in the manifest
   ```
2. Drive at least one real settled payment through it (the facilitator caches/indexes
   resources it has seen). The `sdk/js/examples/pay-with-usdc.ts` flow does this.
3. Confirm the listing:
   ```bash
   curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http&limit=50" | jq '.items[] | select(.resource|test("xfuel"))'
   ```
4. Verify our own manifest is live:
   ```bash
   curl https://api.xfuel.app/.well-known/x402 | jq .
   ```

> Testnet (Base Sepolia) resources appear in testnet discovery only; the production
> listing needs the mainnet facilitator + a funded mainnet treasury.

---

## 2. MCP registry + aggregators (agent-tool discovery)

**One publish propagates.** The official MCP Registry
(`registry.modelcontextprotocol.io`) is canonical; PulseMCP, Glama, and mcp.so ingest
from it (and from GitHub). Submit once there, then claim the aggregator listings.

### What's shipped

- **[shipped] Registry manifest:** `xfuel-mcp/server.json` (schema `2025-12-11`,
  namespace `io.github.XFuel-Lab/xfuel-mcp`, npm package `xfuel-mcp@0.1.1`).
- **[shipped] Static server card:** `GET /.well-known/mcp/server-card.json` (served by
  the HTTP transport) publishes accurate tool metadata for scan-based directories that
  can't complete a live scan. Source: `xfuel-mcp/src/server-card.ts`.
- **[shipped] npm package** `xfuel-mcp` (`npx xfuel-mcp`), stdio + streamable HTTP.

### Publish / claim steps  **[you]**

1. **Official MCP Registry** (canonical — do this first). Uses the `mcp-publisher`
   CLI (a Go binary from GitHub releases / Homebrew — *not* an npm package).
   Ownership is verified via the `mcpName` field already published in
   `xfuel-mcp/package.json` on npm (must match the `server.json` `name`).

   **macOS/Linux:**
   ```bash
   brew install mcp-publisher   # or download the release binary
   cd xfuel-mcp
   mcp-publisher validate       # optional: check server.json (no auth)
   mcp-publisher login github   # prove the io.github.XFuel-Lab namespace
   mcp-publisher publish         # reads ./server.json; bump version on each change
   ```

   **Windows (PowerShell):** no `brew`/`uname` — download the binary directly:
   ```powershell
   $dir = "$env:USERPROFILE\mcp-publisher"; New-Item -ItemType Directory -Force $dir | Out-Null
   Invoke-WebRequest "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz" -OutFile "$dir\p.tar.gz" -UseBasicParsing
   tar -xzf "$dir\p.tar.gz" -C $dir
   cd xfuel-mcp
   & "$dir\mcp-publisher.exe" validate
   & "$dir\mcp-publisher.exe" login github   # opens browser; sign in as an XFuel-Lab member
   & "$dir\mcp-publisher.exe" publish
   ```
2. **GitHub topics** (Glama + others auto-index from these): on the repo →
   Settings → Topics, add: `mcp`, `model-context-protocol`, `x402`, `ai-agents`,
   `zk-proofs`, `theta`.
3. **Smithery** (`smithery.ai/new`): enter the public HTTPS MCP URL. If scanning is
   blocked, our static card at `/.well-known/mcp/server-card.json` supplies metadata.
   Optional CLI:
   ```bash
   npx @smithery/cli mcp publish "https://mcp.xfuel.app/mcp" -n XFuel-Lab/xfuel-mcp
   ```
4. **PulseMCP**: auto-ingests from the registry within ~7 days. To expedite, email
   `hello@pulsemcp.com` — ready-to-send template:

   > **Subject:** New MCP server on the official registry — XFuel (`io.github.XFuel-Lab/xfuel-mcp`)
   >
   > Hi PulseMCP team,
   >
   > We just published our first-party MCP server to the official registry and would love
   > to be indexed:
   >
   > - **Name / namespace:** `io.github.XFuel-Lab/xfuel-mcp` (v0.1.1, status: active)
   > - **Registry:** https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.XFuel-Lab/xfuel-mcp
   > - **npm:** https://www.npmjs.com/package/xfuel-mcp (`npx xfuel-mcp`; stdio + streamable HTTP)
   > - **Repo:** https://github.com/XFuel-Lab/xfuel-protocol (subfolder `xfuel-mcp`)
   > - **What it does:** XFuel is a verifiable settlement + payments layer for AI compute.
   >   The server lets an agent submit inference, pay per task (USDC via x402 or TFUEL),
   >   and fetch/verify ZK settlement proofs — 8 tools (list_models, submit_inference,
   >   pay_with_usdc, get_task_status, get_proof, verify_proof, quote_task, get_health).
   >
   > Happy to provide anything else. Thanks!
5. **Glama / mcp.so**: verify they picked up the repo after topics are set; claim the
   listing to control the description.

### Verify

```bash
curl https://mcp.xfuel.app/.well-known/mcp/server-card.json | jq '.tools[].name'
```

---

## 3. Agent-native discovery (already live)

- `GET /llms.txt` — llmstxt.org manifest: OpenAI-compatible + M2M endpoints, SDK,
  and the x402 discovery pointer. Public, no auth.
- OpenAI-compatible surface: `GET /v1/models`, `POST /v1/chat/completions` — point any
  OpenAI client's `baseURL` at `{host}/v1`. Every response carries a verifiable receipt
  (`x-xfuel-*` headers + `xfuel` body field, including `verify_url`).

---

## Ownership / status snapshot

| Channel | Artifact (shipped) | Submission owner |
|---------|--------------------|------------------|
| x402 Bazaar | `/.well-known/x402` manifest, 402 `accepts` | maintainer (mainnet facilitator + settle) |
| MCP Registry | `server.json` | maintainer (`publisher publish`) |
| Smithery | static server card | maintainer (form / CLI) |
| Glama / mcp.so / PulseMCP | server.json + GitHub topics | auto-ingest; maintainer claims |
| llms.txt / OpenAI surface | served by the node | live |
