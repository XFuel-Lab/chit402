# Testnet is Live — Announcement Copy

Generated from deployment manifest. Update addresses once deployed to Theta Testnet (chain ID 365).

---

## X / Twitter (Thread)

### Tweet 1 (Main)

XFuel Protocol is LIVE on testnet.

14 contracts deployed. 11 modular AI circuits. Full ZK verification.

Core Layer + TAO + A2A + ThetaGPU + ZKML + Akash + AutonomousVaults + AgentRobotics + DataHubs + Yield + NEAR Agents + Solana AI Bridge.

All smoke tests passing. All roles verified.

### Tweet 2 (Technical)

What we deployed:
- CoreRevenueSplitter (30/30/25/15 fee split)
- ZKVerifierSP1 (Groth16 on-chain)
- 11 ecosystem circuits (TAO, Solana, NEAR, Akash...)
- BelieverRound (on-chain vesting, 3mo cliff + 12mo linear)

Total deployment gas: ~31.3M (~0.13 TFUEL)
All 13/13 smoke tests passed.

### Tweet 3 (Dashboard)

We built a live monitoring dashboard:
- Real-time event feed (TaskRouted, ProofVerified, FeeSent)
- Contract status verification (LIVE / NO CODE)
- Gas profiling with budget targets
- One-click listener restart

Open source. Check the repo.

### Tweet 4 (CTA)

Want to build on XFuel?
- Circuits are modular & isolated: add yours in one file
- ZK-verified AI compute across TAO, Solana, NEAR, Akash, Theta
- Revenue sharing via CoreRevenueSplitter

Testnet is open. Believer Round coming soon.

---

## Discord Announcement

### #announcements

**XFuel Protocol — Public Testnet is LIVE**

We've deployed the full XFuel Protocol stack to testnet:

**14 contracts deployed:**
- Core Layer: `CoreRevenueSplitter` + `ZKVerifierSP1`
- 11 AI Circuits: TAO, A2A, ThetaGPU, ZKML, Akash, AutonomousVaults, AgentRobotics, DataHubs, Yield, NEAR Agents, Solana AI Bridge
- BelieverRound: on-chain vesting with 3-month cliff + 12-month linear release

**What passed:**
- 13/13 smoke tests (every CIRCUIT_ID readable, splitter shares verified, BelieverRound status Open)
- 11/11 CIRCUIT_ROLE grants verified on-chain
- Pre-flight checks: balance, chain ID, compiler version

**Live Dashboard:**
The testnet dashboard now includes a **Live Activity feed** — it polls `eth_getLogs` every 4 seconds to surface TaskRouted, ProofVerified, and FeeSent events in real time. Start/Stop/Restart controls built in.

Load the deployment manifest (`deploy/manifests/testnet-*.json`) into `dashboard/index.html` to monitor everything.

**Deployment gas:** ~31.3M total (~0.13 TFUEL at 4 Gwei)

**Quick start:**
```
npx hardhat run deploy/testnet.cjs --network theta-testnet
start dashboard/index.html
```

**What's next:**
- Public testnet monitoring period
- Believer Round activation
- Grant submissions (Solana Foundation, OpenTensor, general)
- Community circuit contributions welcome

Let us know what you build.
