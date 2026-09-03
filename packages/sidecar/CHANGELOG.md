# Changelog — xfuel-sidecar

All notable changes to the Chit402 sidecar are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.1.0 — Initial release

First public release of the Chit402 sidecar.

### Features
- **SDK middleware** — `createSidecarFetch()` wraps any OpenAI-compatible client fetch to emit receipts.
- **Cloudflare Worker** — Deploy an edge proxy in front of any upstream for server-side receipt stamping.
- **Usage import** — `importUsageExport()` converts OpenRouter/Groq/generic CSV/JSON exports to receipts.
- **Receipt building** — `buildSidecarReceipt()` for manual receipt construction.
- **Signature verification** — `verifySidecarSignature()` for HMAC tamper-evidence.
- **Book ingest** — `ingestToBook()` / `registerAgent()` for posting verified receipts to Chit402.

### Receipt Schema
- `xfuel.receipt.v3` schema with hub, model, amount, output hash, payment binding.
- Supports both `usdc` (collected) and `uncollected` rails.
