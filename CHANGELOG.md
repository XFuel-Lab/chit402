# Changelog

All notable changes to XFuel Protocol are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **x402scan listing:** `GET /openapi.json` (OpenAPI 3.1 with `info.x-guidance`, `x-payment-info`, `responses.402`). Public door is `POST /v1/chat/completions`; `POST /task-request` is second. Unauth `POST /v1/chat/completions` with `{}` returns 402 before body validation. Demo key `xfuel-demo` still skips payment. Runtime 402 amounts stay `"10000"`.

### Changed
- **Docs merge lean:** `DEMO` → `HOSTED_TESTNET_ENDPOINT`; `BASE_CUTOVER` → `RUNTIME_STATE`; `ZKG5_BENCHMARK` → `VERIFIED_INFERENCE_HANDOFF` (thin redirect stubs left at old paths).
- **Aggressive docs lean (single narrative):** archived phase kickoffs, engagement/treasury fluff, grant-audit duplicates, zkGPT research memos, pointer stubs, and phase JSON reports → `docs/_archive/legacy-narrative/`. `docs/README.md` is a clean hub only. Kept technical truth (RUNTIME_STATE, APIs, ADRs, VI, audit readiness).
- **Repo docs → Theta-style GitHub README shape:** `README.md`, `WHITEPAPER.md`, and `docs/README.md` rewritten with opening prose, TOC, `---` section breaks, labeled `bash` fences, and human-readable link text (so GitHub render matches a modern protocol README — not raw editor view).
- **Docs archive (approved):** gateway status dumps → `docs/_archive/legacy-gateway-ops/`; superseded design dumps → `docs/_archive/legacy-design-dumps/`.
- **Docs formatting pass (continued):** ops (`RUNTIME_STATE`, `DEPLOYMENT`, `TESTING`, `DEMO`, `HOSTED_TESTNET`, `BASE_CUTOVER`), security (`bug-bounty`, `SECURITY`, `AUDIT_READINESS`, `security-design`, `LEGAL_LAUNCH`), fundraising, ADRs 0001–0004, Verified Inference front doors (`VERIFIED_INFERENCE_*`, Tier-3 build spec), package READMEs (SDK/MCP/agent-skills/playbook), and service READMEs (gateway/sp1/zkllm/zkgpt). Same sparse contract: plain headings, short paragraphs, link lists; Base + token-light narrative; Tier-3 = zkLLM active build.
- **Docs formatting + lean pass (Theta-sparse):** plain headings, short paragraphs, link lists over badge/table walls. Slimmed `CIRCUITS.md`, `Technical-Specifications.md`, `M2M_API.md`, `OPENAI_COMPATIBLE_GATEWAY.md`, `X402_ADAPTER.md`, `POSITIONING.md`, and `pitch-deck.md`. Archived `Circuit-Design-and-Expansion.md`, obsolete `QUICK_REFERENCE.md`, and outdated `docs/grants/*` decks under `docs/_archive/`.
- **Theta-style lean docs restructure:** `README.md`, `WHITEPAPER.md`, `AGENTS.md`, and `docs/README.md` rewritten as short front doors that point to satellite docs (RUNTIME_STATE, POSITIONING, M2M_API, CIRCUITS, etc.). Removed duplicated architecture essays, deployment tables, mermaid diagrams, and circuit/use-case catalogs from the canonical surfaces — depth lives in `docs/`.
- **Follow-up accuracy sweep (UI + live API + archive):**
  - **Gateway** (`services/gateway/src/server.js`, `revenue-split.js`) — removed hardcoded `30% BBB / 30% LP / 25% veXF / 15% Treasury` from `/health`, `/prove-result`, and `/task-request` fee_info; now returns `describeSplit(resolveSplit())` (token-light USDC on Base).
  - **Frontend** — `Dashboard.tsx` no longer reads `CoreRevenueSplitter`; `Security.tsx` reframed to Base verifier + equity-first fundraising; `Staking.tsx` retitled from Fee-to-Stake to governance staking; `Docs.tsx` badges → v2.6 / Base / 755+.
  - **SDK + agent skill** — `revenue_split` type matches `describeSplit()`; submit-inference skill notes updated.
  - **Archived** to `docs/_archive/`: `Growth-Expansion-Treasury.md`, `FUNDING_ROUNDS_LAUNCH_RUNBOOK.md`, `PRICING_TFUEL_XF.md`, `THETA_INTEGRATION_PLAN.md` (see `docs/_archive/README.md`).
  - **CONTRIBUTING.md / SECURITY.md** — Base-settled framing; removed CoreRevenueSplitter from bounty in-scope; version → v2.6.
- **Docs de-legacy sweep — canonical docs now describe the project as-is (top-project shape).** Removed legacy machinery from the narrative entirely (history remains in git):
  - **`WHITEPAPER.md`** — replaced §5 (GET / Fee-to-Stake / `CoreRevenueSplitter` 30/30/25/15) with a tight token-light "Revenue & Fees" section; removed all `CoreRevenueSplitter`/`RevenueSplitter` references (§2 note, §6 governance hooks, §7.2, §9.1); dropped believer/angel sale mechanics from §10 tokenomics and §11.5 audit scope; replaced the §12 Phase 1–6 completion log with a forward-only "Now → next / Later" roadmap; removed ThetaScan/believer-metrics mentions.
  - **`README.md`** — full lean rewrite toward a top-project shape (~11 tight sections): what it is, trust tiers, quick start, how it works, architecture, providers/chains, current deployment status, repo map, testing, security, community. Cut the phase-by-phase deployment log, "Verifier Patches," standalone CosmWasm/EVM/Solana prover test-count sections, the "AI DePIN Hub / Why Theta First" section, and legacy `.env` vars.
  - **`AGENTS.md`** — cut the retired BelieverRound/AngelRound/engagement fundraising blocks (one-line equity-first note remains), removed `CoreRevenueSplitter` refs, fixed the A2A escrow example (USDC/x402 + Fair Exchange, not `CoreRevenueSplitter.createEscrow`), updated the governance table (TreasuryPolicy), and reframed Tier-3 to the self-owned zkLLM prover.
  - **`docs/README.md`** — core-contract list no longer lists deprecated `CoreRevenueSplitter`.
- **Narrative alignment to locked core story (Base-settled, provider-agnostic, tiered-trust).** Aligned high-visibility surfaces to the locked positioning (`docs/POSITIONING.md`, ADR 0002) with zero change to technical facts, addresses, or test counts:
  - **`WHITEPAPER.md` → v2.6** — reconciled Tier-3 from "zkGPT (blocked on GPU)" to the self-owned **XFuel zkLLM** prover (`services/zkllm-prover`, RAM-bound/CPU-only, active build); zkGPT retained as cited prior art. Updated §3.5 tier table, §3.6 research track, §11.1, roadmap, and references.
  - **`README.md`** — version refs v2.4→v2.6, "As of March 2026"→July 2026, added locked one-liner summary, replaced the 30/30/25/15 fee-flow and "All fees route through CoreRevenueSplitter" with the token-light USDC-on-Base model, and reframed the DePIN-hub / "Why Theta First" section (neocloud-first router; EdgeCloud = optional GPU provider tier, not settlement home).
  - **`apps/web/src/pages/Home.tsx`** — synced to `POSITIONING.md`: removed the "30% BBB · 30% GET · 25% veXF · 15% treasury — settled on Theta" card, made USDC-on-Base the default rail (TFUEL demoted to legacy), added Base/Base Sepolia to the networks list, and set the settlement framing to Base.
  - **`docs/README.md`** — v2.4/"Hybrid Theta-Centric" → v2.6/"Base-Settled, Provider-Agnostic"; added a one-line positioning summary; date → July 2026.
- **Core tests:** Split `test:contracts:core` into `test:contracts:core:listener` (`node:test`, `ai-listener.test.js`) and `test:contracts:core:solidity` (Hardhat `*.test.cjs` only). `ci.yml` runs them as separate steps; `test.yml` gas job uses `:solidity` only.
- **`test:contracts:all`:** Runs the core listener first, then `test:contracts:all:hardhat` via `scripts/hardhat-test-all.cjs` (collects every `test/**/*.test.cjs`, `core-layer/test/*.cjs`, `circuits/*/test/*.cjs` without shell globs — fixes Windows). `test.yml` uses two explicit steps matching that split.
- **`theta-inference-handler.test.cjs`:** Wrapped the runner in `require.main === module` so Hardhat no longer exits the whole process on `require()` (same class of bug as fee-analytics tokenomics tests).

### Planned
- Audit Phase 1 — `contracts/core/` on Base (see `docs/AUDIT_READINESS_CHECKLIST.md`)
- Base mainnet x402 facilitator provisioning
- SP1 guest v2 (in-proof payment binding)
- Tier-3 on-chain verify + E2E (zkLLM)
- veXFGovernance first on-chain proposal (when token launches)

---

## [2.4.0] — 2026-03-11

### Added
- `docs/THETA_INTEGRATION_PLAN.md` — comprehensive 62KB Theta ecosystem integration plan covering EdgeStore, Video API, TDROP payments, and subchain deployment
- `.github/workflows/test.yml` — secondary CI workflow running Solidity (`test:contracts:all`) and CosmWasm (`cargo test`) jobs
- `.env.deploy.example` — fully documented deployment environment template with all 40+ variables explained
- `.solcover.cjs` — Solidity coverage configuration skipping `legacy/`, `mocks/`, `test-helpers/`
- `.hyperlane/chains.yaml` — Hyperlane chain definitions for Theta Mainnet (361), Theta Testnet (365), Bittensor Testnet (945), and Bittensor EVM (964)
- `SECURITY.md` — vulnerability disclosure policy with contact, scope, and bug bounty tiers
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1
- `CHANGELOG.md` — this file
- `.github/dependabot.yml` — automated dependency scanning for npm (root, bridge, mobile, sdk) and Cargo
- `.github/ISSUE_TEMPLATE/` — structured issue templates: bug report, feature request, question
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist with gas impact table
- `docs/GAP_ANALYSIS.md` — pre-submission gap analysis and sprint plan for CertiK + Theta grant
- Cargo workspace members: `core-layer/wasm/zk-verifier`, `core-layer/wasm/revenue-splitter`, `core-layer/sp1-hooks`

### Changed
- `README.md` — full rewrite for v2.4 "Hybrid Theta-Centric Architecture"; added Table of Contents, Mermaid architecture overview, agent-first API examples
- `CONTRIBUTING.md` — updated all contract references to `contracts/core/` and `contracts/circuits/`; updated status to "All 6 phases complete (755+ tests)"
- `.cursorrules` — added Theta ETH-RPC quirks, EdgeCloud API key types, Hyperlane CLI reference, Bittensor EVM chain IDs
- `.gitignore` — added `*.pdb`, `sp1-source/`, `*.bin` (with `!src/**/*.bin` exception)

---

## [2.3.0] — 2026-02-28

### Added
- Phase 6 — Ecosystem Expansion: `contracts/circuits/` additions (AgentRobotics, AutonomousVaults, EnergyGrid, FilecoinStorage, MappingSensor, NearAgents, WirelessDePIN)
- `test/phase6/EcosystemExpansion.test.cjs` — Phase 6 test suite
- `tests/ai-depin/e2e.test.js` — Node `--test` AI/DePIN ecosystem integration tests
- `tests/security/fuzz.test.js` — 40KB fuzz test suite (Node `--test`)
- `docs/phase6-report.json` — Phase 6 completion report
- Coverage HTML report at `coverage/` (85%+ on Phase 1 audit contracts)

### Changed
- Upgraded `@openzeppelin/contracts` and `@openzeppelin/contracts-upgradeable` to v5.4.0

---

## [2.2.0] — 2026-02-14

### Added
- Phase 5 — Privacy & Agent Swarms: `contracts/circuits/A2ACircuit.sol`, `AgentRobotics.sol`
- `test/phase5/` — AgentSwarms, CrossChainExpansion, PrivacyMarkets test suites
- Phase 5 completion report (`docs/phase5-report.json`)
- `backend/theta-bridge/src/theta-video-handler.js` — Theta Video API integration (upload, transcode, DRM)
- TDROP payment option: `ThetaInferenceCircuit.setTdropConfig()` — 20% fee discount for TDROP payers

### Fixed
- ZKVerifierSP1: proof replay attack prevention via `usedProofHashes` mapping
- CoreRevenueSplitter: reentrancy guard on `distributeFees()` for ERC-20 payment paths

---

## [2.1.0] — 2026-02-01

### Added
- Phase 4 — Intelligence Layer: `contracts/circuits/ZKMLCircuit.sol`, `InferenceRouter.sol`
- `test/phase4/` — CoreListener, ZKRollup, TVL simulation, x402 Escrow, SubchainDeploy, MonitoringDashboard
- `monitoring/` — Prometheus + Grafana docker-compose stack for fee analytics
- `backend/theta-bridge/src/fee-analytics.js` — 59KB fee analytics engine with Prometheus metrics
- `dashboard/index.html` — standalone 26KB live dashboard with failure prediction and gas profiles
- `contracts/core/veXFGovernance.sol` — vote-escrowed governance with 4-week lock minimum
- Theta subchain governance: `contracts/governance/XFuelSubchainGovToken.sol`
- `test/hardening/LoadChaos.hardening.test.cjs` — load and chaos stress testing

### Changed
- `contracts/core/CoreRevenueSplitter.sol` — added `dynamicBoost` multiplier for TDROP payers and circuit priority weights

---

## [2.0.0] — 2026-01-15

### Breaking Changes
- Architecture pivot: from "ZK bridge between Theta and Persistence" to "Theta-hybrid AI DePIN Hub"
- `VaultFactory.sol` → deprecated in favor of modular Core Layer + Circuit pattern
- Persistence-primary routing → Theta EdgeCloud-primary with optional Osmosis/Persistence fallback

### Added
- **Core Layer** (`contracts/core/`): ZKVerifierSP1, CoreRevenueSplitter, SP1ProofHooks
- **21 Circuit Contracts** (`contracts/circuits/`): ThetaInferenceCircuit, TAOCircuit, BridgeCircuit, AkashCircuit, YieldCircuit, DataHubs, UplinkCircuit, ComputeMarketplace, SolanaAIBridge, BelieverRound, and 11 more
- SP1 v6.0.2 integration: `sp1-prover/` Rust workspace (host + program) generating real Groth16 proofs
- `core-layer/wasm/zk-verifier/` — CosmWasm ark-groth16 verifier for Cosmos chains
- `core-layer/wasm/revenue-splitter/` — CosmWasm revenue splitter
- `contracts/interfaces/` — IBittensorStaking, ICrossChainMailbox, IChainlinkOracle, IHyperlaneMailbox, ISP1Verifier
- Hyperlane integration: `.hyperlane/` config, `ICrossChainMailbox` interface on core contracts
- `sdk/js/` — TypeScript SDK (`xfuel-sdk`) for M2M/A2A API integration
- `edgefarm-mobile/` — Expo React Native mobile app
- Phase 1–3 test suites: 755+ total tests across Solidity, CosmWasm, and integration
- `docs/security-design.md` (35KB), `docs/routing-mitigations-design.md` (50KB)
- `docs/certik-phase1-scope.json` — formal CertiK audit scope definition
- `.openzeppelin/` — UUPS proxy upgrade manifests for chains 361 and 365

### Removed
- Persistence-specific governance contracts (moved to `contracts/legacy/`)
- `VaultFactory.sol` as primary contract (moved to `contracts/legacy/`)
- `WHITEPAPER_v4.4.md` — replaced by `WHITEPAPER.md`

---

## [1.6.0] — 2025-11-20

### Added
- Phase B completion: 8.997s avg SP1 proof generation, 52.89 tx/min throughput benchmarks
- Bi-directional bridge: `burn_for_unwrap` + `unwrapFromBurn` with SP1 event proofs
- `FeeCollector.wasm` — CosmWasm fee collection on Persistence chain
- Nonce-based replay protection across bridge flows
- `MOCK_MODE` testing flag for CI environments without live ZK proving

### Changed
- Revenue split finalized: 30% Buyback & Burn / 30% Growth & Expansion / 25% Stakers / 15% Treasury
- SP1 zkVM upgraded from STARK-only to STARK → Groth16 wrapper (reduces on-chain verification gas by ~40%)

---

## [1.5.0] — 2025-10-08

### Added
- Osmosis strategic pivot: primary routing target changed from Persistence to Osmosis ($2B+ TVL, 30-50%+ APY AI yield pools)
- Akash IBC integration: TFUEL → AKT for decentralized GPU compute bids/leases
- Bittensor (TAO) routing: ML inference to optimal subnets via Substrate/EVM bridge
- Phase E design: AI DePIN Bridge with ZK-verifiable A2A/M2M communications

---

## [1.4.0] — 2025-09-01

### Added
- SP1 zkVM integration: RISC-V → STARK → Groth16 wrapper proof pipeline
- Phase A completion: CosmWasm contracts deployed on Persistence testnet
- `cosmwasm-contracts/persistence-minter/` and `fee-collector/` with compiled `.wasm` artifacts
- Initial Theta Mainnet beta deployment: VaultFactory at `0xB0a26600074dADC69186632a1B8dFd7c3146Ce56` (chain 361)

---

## [1.0.0] — 2025-07-15

### Added
- Initial protocol design: ZK bridge between Theta (TFUEL) and Persistence LSTfi ecosystem
- `VaultFactory.sol` — initial bridge vault factory contract
- `sp1-prover/` — initial SP1 zkVM proof infrastructure
- Whitepaper v1.0 — ZK bridge architecture
- React frontend at `xfuel.app`
- Hardhat test framework with local chain 1337 configuration

---

[Unreleased]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.4.0...HEAD
[2.4.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.6.0...v2.0.0
[1.6.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/XFuel-Lab/xfuel-protocol/compare/v1.0.0...v1.4.0
[1.0.0]: https://github.com/XFuel-Lab/xfuel-protocol/releases/tag/v1.0.0
