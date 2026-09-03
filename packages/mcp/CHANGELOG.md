# Changelog — xfuel-mcp

All notable changes to the Chit402 MCP server are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.4.0 — Chit402 public cutover

### Changed
- **Chit402 branding** — Package description and README now reference Chit402.
  Package name remains `xfuel-mcp` for compatibility. Registry id `io.github.XFuel-Lab/xfuel-mcp` unchanged.
- **API endpoints** — Docs now reference https://api.chit402.com (alias: https://api.xfuel.app).
- **xfuel-sdk ^0.6.0** — Requires the new SDK with ES256/JWKS receipt verification helpers.

## 0.3.1 — Initial published release

- MCP server for chat completions, task submission, quotes, proofs, and settlement.
- Tools: `chat_completions`, `list_models`, `submit_inference`, `register_agent`, `get_agent_book`,
  `get_task_status`, `get_proof`, `verify_proof`, `quote_task`, `get_health`, `verify_model_commitment`,
  `get_verified_quote`, `get_validation_status`, `get_provider_stake`, `get_my_stats`.
- Runs over stdio or streamable HTTP.
