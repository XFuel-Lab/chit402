# Chit402 integration doors

Entry points for agents and platforms. Each door is a self-contained install path.

| Door | Status | Path |
|------|--------|------|
| Chat completions | **live** | `POST /v1/chat/completions` @ `https://api.chit402.com` |
| MCP | **live** | `npx chit402-mcp` — `packages/mcp` |
| Eliza plugin | **live** | `@xfuel/plugin-elizaos` — `packages/plugin-elizaos` |
| **Bankr skill (print receipt)** | **shipped** | [`skills/chit402-receipt/`](../skills/chit402-receipt/) · [spec](./bankr-skill-spec.md) |
| SDK | **live** | `npm install chit402-sdk` |
| LangChain + AI SDK | **shipped** | `@xfuel/adapters` · [www `/docs/framework-adapters`](https://chit402.com/docs/framework-adapters) |
| Cloudflare Agents | **shipped** | Sidecar + Worker · [www `/docs/cloudflare`](https://chit402.com/docs/cloudflare) |
| OpenClaw | **shipped** | [`skills/openclaw-chit402/`](../skills/openclaw-chit402/) · [www `/docs/openclaw`](https://chit402.com/docs/openclaw) |
| Virtuals ACP | **shipped** | [ACP stamp path](./acp-stamp-path.md) · [www `/docs/acp`](https://chit402.com/docs/acp) |
| Olas / Theoriq | **shipped** | [Swarm beachhead](./later-adapters.md) · [www `/docs/swarm-platforms`](https://chit402.com/docs/swarm-platforms) |
| EmDash paid reads | **shipped** | `chit402-emdash` · [`packages/emdash-chit402`](../../packages/emdash-chit402/README.md) |

## Product law (every door)

Beachhead: **chat-completions baseURL swap + USDC budget + verify_url**. Product is the book (possession receipt), not cheaper inference.

## Bankr — chit402-receipt

Install:

```text
install the chit402-receipt skill from https://github.com/XFuel-Lab/chit402/tree/main/skills/chit402-receipt
```

Env: `CHIT_API_URL`, `CHIT_API_KEY`, `CHIT_MAX_USD_PER_CALL`, `CHIT_MAX_USD_SESSION`.

Returns `verify_url` after x402 USDC settle on Base. Full spec: [bankr-skill-spec.md](./bankr-skill-spec.md).

## Framework adapters

```bash
npm install chit402-adapters @langchain/openai
# or: npm install chit402-adapters @ai-sdk/openai ai
```

See [later-adapters.md](./later-adapters.md) for Cloudflare, OpenClaw, ACP, and swarm doors.

## EmDash paid reads

```bash
npm install chit402-emdash @emdash-cms/x402
```

A paid agent read stamps `POST /v1/agents/:agent_id/book/ingest` ($0.002 USDC) and sets `X-Chit-Receipt` to `verify_url`. `CHIT_STAMP_PRIVATE_KEY` pays that stamp when the book key is not waiver-listed. Install: [packages/emdash-chit402/README.md](../../packages/emdash-chit402/README.md).
