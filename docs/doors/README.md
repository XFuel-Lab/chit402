# Chit402 integration doors

Entry points for agents and platforms. Each door is a self-contained install path.

| Door | Status | Path |
|------|--------|------|
| Chat completions | live | `POST /v1/chat/completions` @ `https://api.chit402.com` |
| MCP | live | `npx chit402-mcp` — `packages/mcp` |
| Eliza plugin | live | `@xfuel/plugin-elizaos` — `packages/plugin-elizaos` |
| **Bankr skill (print receipt)** | **shipped** | [`skills/chit402-receipt/`](../skills/chit402-receipt/) · [spec](./bankr-skill-spec.md) |
| SDK | live | `npm install chit402-sdk` |

## Bankr — chit402-receipt

Install:

```text
install the chit402-receipt skill from https://github.com/XFuel-Lab/chit402/tree/main/skills/chit402-receipt
```

Env: `CHIT_API_URL`, `CHIT_API_KEY`, `CHIT_MAX_USD_PER_CALL`, `CHIT_MAX_USD_SESSION`.

Returns `verify_url` after x402 USDC settle on Base. Full spec: [bankr-skill-spec.md](./bankr-skill-spec.md).
