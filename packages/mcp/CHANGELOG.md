# Changelog — xfuel-mcp

All notable changes to the Chit402 MCP server are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## Unreleased

### Changed
- Default API URL is `https://api.chit402.com` (`server.json` and the SDK default). Republish `xfuel-mcp` for the npm package and the registry card to match.
- The Tier-2 settlement proof add-on is not currently offered. `get_verified_quote` lists `tiers_available: ['signed']`; `get_proof` / `verify_proof` read historical proofs only; `proof_tier` on quotes is refused (400 `settlement_proof_not_offered`). Supersedes the 0.4.1 note that SP1 tools remain optional Tier-2.

## 0.5.0: Verifier upgrade

### Changed
- **`verify_receipt` uses `chit402-verify` ^0.4.11** in place of `@xfuel/verify` ^0.1.0, and runs the same check as the `chit402-verify` CLI.
- **Three-way verdict.** `verify_receipt` returns `result` (`VERIFIED`, `INVALID` or `COULD_NOT_CHECK`), `exit_code` (0, 1, 2), `reason`, `message`, `scope`, `receipt_id` and `checks`. It no longer returns `overall`, the raw receipt, or a verification object. `scope: "public"` means the public attestation verified (amount, payee, tx, log position; payer not claimed).
- **Issuer host only.** The receipt is fetched from `https://api.chit402.com/receipt/<id>`. A `verify_url` on `api.xfuel.app` is read from `api.chit402.com`. Any other host, a non-https URL, credentials, an IP address, a port, a path other than `/receipt/<id>`, or a redirect is refused. `task_id` is read from the issuer host, not from the configured API URL.
- **Removed inputs:** `fetch_jwks`, `check_payer` and `check_nullifier`. The payer check always runs, as in the CLI.
- Not published.

## 0.4.1 — MCP book + receipt door

### Added
- **`verify_receipt`** — offline receipt verification via `@xfuel/verify` (default prove-it path).
- **`get_book`** — alias of `get_agent_book` for Eliza / Cursor clients.
- **Top-level `verify_url`** on receipt-bearing tools (`structuredContent` + summary text).
- **`CHIT402_*` / `CHIT_*` env aliases** for API URL and key (xfuel names still accepted).
- **`budget` on book tools** — optional prepaid ceiling Y (USDC 6dp).
- **`npm run smoke`** — local tool-registration smoke script.

### Changed
- Book / receipt tools documented as the product path; SP1 tools remain optional Tier-2.

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
