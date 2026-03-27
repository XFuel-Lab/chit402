# Changelog

All notable changes to XFuel Protocol are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- CertiK Phase 1 audit (Q2 2026) — `contracts/core/` scope
- Mainnet deployment (post-audit) — Theta Mainnet (chain 361)
- `xfuel-sdk` 0.1.0 publish to npm
- Hyperlane Mailbox deployment on Theta + Bittensor EVM
- veXFGovernance first on-chain proposal

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
