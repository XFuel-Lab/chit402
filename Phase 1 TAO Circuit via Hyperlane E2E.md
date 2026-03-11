# XFuel Protocol — Phase 1: Bittensor TAOCircuit via Hyperlane E2E

**Status:** In Progress
**Whitepaper refs:** Sections 3.2, 4.3, 8.1–8.5
**Date:** February 2026

---

## High-Level Objective

Deploy and test the end-to-end flow:

```
Theta Testnet (365) submitTask
  → Hyperlane dispatch (EVM → EVM)
    → Bittensor Testnet (945) handle() + verifyWithStake (dTAO 0x805)
      → Proof relay back via Hyperlane
        → Settle on Theta
```

---

## Network Configuration

| Network | Chain ID | RPC | Native Token | Status |
|---------|----------|-----|-------------|--------|
| Theta Testnet | 365 | `https://eth-rpc-api-testnet.thetatoken.org/rpc` | TFUEL | ✓ Configured |
| Bittensor Testnet | 945 | `https://test.chain.opentensor.ai` | TAO | ✓ Configured |
| Bittensor Mainnet | 964 | `https://lite.chain.opentensor.ai` | TAO | ✓ Configured (existing) |

---

## Detailed To-Do List

### 1. Infrastructure Setup (Est: 30 min)

- [x] **1.1** Add `bittensor-testnet` network to `hardhat.config.cjs` (chainId: 945)
- [x] **1.2** Verify `theta-testnet` entry exists (chainId: 365)
- [x] **1.3** Install `@hyperlane-xyz/sdk` and `@hyperlane-xyz/core` via npm
- [x] **1.4** Add `bittensor_testnet` to `ai-listener.js` DEFAULT_CHAINS registry
  - Type: `evm`, chainId: 945, precompile: `0x0805`
  - Per whitepaper Section 4.3

### 2. Hyperlane CLI Deployment (Est: 30-45 min)

- [x] **2.1** Create `scripts/hyperlane-init.cjs` orchestration script
  - Generates `.hyperlane/chains.yaml` for custom chains (365, 945)
  - Checks CLI availability
  - Verifies RPC connectivity for both networks
  - Stores deployment manifest at `deploy/manifests/hyperlane.json`

- [ ] **2.2** Install Hyperlane CLI globally
  ```bash
  npm install -g @hyperlane-xyz/cli
  ```

- [ ] **2.3** Run `hyperlane core init` for custom chains
  - Select custom chain configuration
  - Enter Theta Testnet details (365)
  - Enter Bittensor Testnet details (945)
  - **PROMPT NEEDED:** Private key for deployer wallet on both chains

- [ ] **2.4** Run `hyperlane core deploy` to Theta Testnet
  - Deploys: Mailbox, ISM (Interchain Security Module), ValidatorAnnounce
  - **PROMPT NEEDED:** Funded TFUEL wallet on Theta Testnet
  - Record Mailbox address → `deploy/manifests/hyperlane.json`

- [ ] **2.5** Run `hyperlane core deploy` to Bittensor Testnet
  - Deploys: Mailbox, ISM, ValidatorAnnounce
  - **PROMPT NEEDED:** Funded TAO wallet on Bittensor Testnet
  - Record Mailbox address → `deploy/manifests/hyperlane.json`

- [ ] **2.6** Configure trusted remotes (cross-enroll)
  - Theta Mailbox trusts Bittensor Mailbox's domain
  - Bittensor Mailbox trusts Theta Mailbox's domain

### 3. Contract Deployment (Est: 20-30 min)

- [ ] **3.1** Deploy `ZKVerifierSP1` to Bittensor Testnet (945)
  - Use `deploy/bittensor-evm.cjs` script with `--network bittensor-testnet`
  - Configure Mailbox address from step 2.5
  - Configure dTAO staking precompile at `0x0805`
  - Register `TAO_EVM_CIRCUIT` circuit

- [ ] **3.2** Deploy `TAOCircuit` to Theta Testnet (365)
  - Constructor args: admin, revenueSplitter, zkVerifier, mailbox, priceOracle
  - Set Mailbox to deployed Hyperlane Mailbox from step 2.4
  - Add supported domain for Bittensor (domain 945)
  - Set trusted remote to ZKVerifierSP1 on Bittensor

- [ ] **3.3** Deploy `TAOCircuit` to Bittensor Testnet (945)
  - Mirror of Theta deployment for handling incoming messages
  - Add supported domain for Theta (domain 365)

### 4. Cross-Chain Wiring (Est: 15 min)

- [ ] **4.1** On Theta TAOCircuit:
  - `addSupportedDomain(945, bytes32(bittensorTAOCircuitAddress))`
  - `setMailbox(thetaHyperlaneMailbox)`

- [ ] **4.2** On Bittensor TAOCircuit:
  - `addSupportedDomain(365, bytes32(thetaTAOCircuitAddress))`
  - `setMailbox(bittensorHyperlaneMailbox)`

- [ ] **4.3** On Bittensor ZKVerifierSP1:
  - `configureDomain(365, bytes32(thetaZKVerifier), true)`
  - `setMailbox(bittensorHyperlaneMailbox)`
  - `setStakeCheck(0x0805, minStake, true)`

### 5. E2E Test Implementation (Est: 30 min)

- [x] **5.1** Create `test/phase1/HyperlaneE2E.test.cjs`
  - Hardhat local fork tests with MockMailbox
  - Tests the full flow: submitTask → bridge → handle → settle
  - Verifies RPC connectivity for both testnets
  - Verifies cross-chain message encoding/decoding

- [ ] **5.2** Create integration test for live testnet
  - **PROMPT NEEDED:** Deployer wallets with testnet funds
  - Submit real task on Theta Testnet
  - Verify Hyperlane relay to Bittensor Testnet
  - Verify settlement proof relay back

### 6. Error Handling & Edge Cases (Est: 15 min)

- [x] **6.1** Handle relay failures
  - MockMailbox simulates message delivery failures
  - TAOCircuit handles `UnsupportedDomain` and `UntrustedRemote` errors
  - ZKVerifierSP1 `handle()` validates sender against trusted remotes

- [x] **6.2** Handle staking precompile unavailability
  - `verifyWithStakeCheck` gracefully falls back when precompile not at 0x805
  - Per whitepaper Section 3.2: "Graceful fallback on non-Bittensor chains"

- [x] **6.3** Intent timeout handling
  - CoreListener `_checkIntentTimeouts()` resolves stale intents
  - Default 60s timeout per whitepaper Section 4.2

### 7. Verification & Smoke Tests (Est: 15 min)

- [x] **7.1** Compile all contracts
  ```bash
  npx hardhat compile
  ```

- [ ] **7.2** Run existing TAOCircuit unit tests
  ```bash
  npx hardhat test circuits/tao-evm/test/TAOCircuit.test.cjs
  ```

- [x] **7.3** Run Phase 1 E2E test
  ```bash
  npx hardhat test test/phase1/HyperlaneE2E.test.cjs
  ```

- [ ] **7.4** Run Hyperlane init script for connectivity check
  ```bash
  node scripts/hyperlane-init.cjs
  ```

- [ ] **7.5** Fork test Theta Testnet RPC
  ```bash
  npx hardhat node --fork https://eth-rpc-api-testnet.thetatoken.org/rpc
  ```

---

## E2E Flow Diagram (per Whitepaper Section 8.4)

```
THETA TESTNET (365)                     BITTENSOR TESTNET (945)
┌──────────────────────┐                ┌──────────────────────┐
│  User calls          │                │                      │
│  TAOCircuit.         │   Hyperlane    │  TAOCircuit.handle() │
│  submitTask()        │───dispatch()──→│  receives task       │
│                      │   domain=945   │                      │
│  Fee → RevSplitter   │                │  Trigger SP1 proof   │
│  TaskRouted event    │                │  generation          │
│  TaskBridged event   │                │                      │
└──────────────────────┘                │  ZKVerifierSP1.      │
                                        │  verifyWithStake()   │
                                        │  (dTAO check 0x805)  │
┌──────────────────────┐                │                      │
│                      │   Hyperlane    │  relayProofCross     │
│  ZKVerifierSP1.      │←──dispatch()───│  Chain() dispatches  │
│  handle() receives   │   domain=365   │  verified result     │
│  verified proof      │                └──────────────────────┘
│                      │
│  TAOCircuit.         │
│  settleTask()        │
│  → TaskSettled event │
└──────────────────────┘
```

---

## Missing Information (Flags)

| Item | Status | Action |
|------|--------|--------|
| Deployer private key (Theta Testnet) | ❓ Needed | Prompt in terminal before live deploy |
| Deployer private key (Bittensor Testnet) | ❓ Needed | Prompt in terminal before live deploy |
| Funded wallet balance (TFUEL on Theta Testnet) | ❓ Unknown | Check via `scripts/check-balance.cjs` |
| Funded wallet balance (TAO on Bittensor Testnet) | ❓ Unknown | Check manually or via RPC |
| Hyperlane Mailbox address (Theta) | ❓ Post-deploy | Generated by `hyperlane core deploy` |
| Hyperlane Mailbox address (Bittensor) | ❓ Post-deploy | Generated by `hyperlane core deploy` |
| SP1 Verifier Gateway address | ⊘ Mock mode | Use address(0) for testnet E2E |
| Chainlink TAO/USD oracle | ⊘ Not available | Use admin pricing fallback |

---

## Dependencies Graph

```
[1.1-1.4 Infrastructure] ──→ [2.1-2.6 Hyperlane Deploy] ──→ [3.1-3.3 Contracts]
                                                                    │
                                                              [4.1-4.3 Wiring]
                                                                    │
                                                              [5.1-5.2 E2E Test]
                                                                    │
                                                              [7.1-7.5 Verify]
```

---

## Notes

- All contracts use Solidity 0.8.20+ per `.cursorrules`
- Gas target: <300K per operation, <500K end-to-end (whitepaper Section 3.2)
- Mock mode (SP1 Gateway = address(0)) is used for testnet E2E
- Hyperlane domain IDs are set equal to chain IDs for simplicity in Phase 1
- Production deployment will require ISM configuration and validator setup
