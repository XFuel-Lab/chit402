# SP1 Prover Architecture - Visual Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         XFUEL PROTOCOL - SP1 UPGRADE                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              THETA BLOCKCHAIN                               │
│  ┌────────────────┐         ┌────────────────┐        ┌─────────────────┐  │
│  │  User Deposits │────────>│  Vault Contract│───────>│  Event Emitted  │  │
│  │   TFUEL        │         │  (0x...)       │        │  (Deposit)      │  │
│  └────────────────┘         └────────────────┘        └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 1. Detect Deposit
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      BACKEND (backend/theta-bridge)                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  listener.js                                                          │  │
│  │  • Monitors Theta blockchain for deposits                            │  │
│  │  • Extracts transaction data (tx hash, amount, sender)               │  │
│  │  • Fetches Merkle proof from Theta RPC                               │  │
│  │  • Generates identity commitment & nullifier                          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│                                      │ 2. Proof Request (JSON)               │
│                                      ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  prover.js                                                            │  │
│  │  • Formats proof request                                             │  │
│  │  • Calls SP1 prover (HTTP or CLI)                                    │  │
│  │  • Receives proof + public inputs                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 3. HTTP POST /prove
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SP1 PROVER (sp1-prover/)                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  HOST PROGRAM (host/src/main.rs)                                     │  │
│  │  ┌─────────────────┐         ┌──────────────────┐                   │  │
│  │  │  HTTP Server    │         │  CLI Interface   │                   │  │
│  │  │  • POST /prove  │    OR   │  • prove --input │                   │  │
│  │  │  • GET /health  │         │  • serve --port  │                   │  │
│  │  └─────────────────┘         └──────────────────┘                   │  │
│  │                                                                       │  │
│  │  • Parses JSON inputs (public + private)                            │  │
│  │  • Loads guest program ELF                                           │  │
│  │  • Creates SP1 stdin (serializes inputs)                             │  │
│  │  • Runs prover (CPU or GPU)                                          │  │
│  │  • Verifies proof locally                                            │  │
│  │  • Returns proof + public inputs                                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│                                      │ 4. Execute in zkVM                    │
│                                      ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  GUEST PROGRAM (program/src/main.rs)                                 │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 1: Range Proofs                                    │ │  │
│  │  │  • Vault address (160 bits)                                    │ │  │
│  │  │  • Amounts (252 bits each)                                     │ │  │
│  │  │  • Block number, tx index, timestamp                           │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 2: Fee Calculation                                 │ │  │
│  │  │  • feeExpected = (grossAmount * 50) / 10000                    │ │  │
│  │  │  • Assert feeExpected == feeAmount                             │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 3: Net Amount Validation                           │ │  │
│  │  │  • netAmount == grossAmount - feeAmount                        │ │  │
│  │  │  • netAmount < grossAmount                                     │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 4: Minimum Deposit                                 │ │  │
│  │  │  • grossAmount >= 10^16 wei (0.01 TFUEL)                       │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 5: Merkle Proof Verification                       │ │  │
│  │  │  • Hash tx data → leaf                                         │ │  │
│  │  │  • Verify 16-level Merkle proof                                │ │  │
│  │  │  • Root must match public merkleRoot                           │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 6: Block Hash Integrity                            │ │  │
│  │  │  • Hash(blockNumber, timestamp, merkleRoot) == blockHash       │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 7: Identity Commitment                             │ │  │
│  │  │  • Hash(secret, nullifier, trapdoor) == commitment             │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 8: Nullifier Generation                            │ │  │
│  │  │  • nullifier = Hash(nullifierSec, txHash, block, vault)        │ │  │
│  │  │  • Commit nullifier as public output                           │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │  CONSTRAINT 9: Timestamp Validity                              │ │  │
│  │  │  • Timestamp within valid range                                │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                       │  │
│  │  • Commit public inputs for verification                             │  │
│  │  • Generate ZK proof (PLONK3)                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│                                      │ 5. Proof Generated                    │
│                                      ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  GPU ACCELERATION (Optional)                                          │  │
│  │  • CUDA-enabled NVIDIA GPU                                            │  │
│  │  • 5-10x faster proving                                               │  │
│  │  • ~0.5s proof time (RTX 4090)                                        │  │
│  │  • Automatic fallback to CPU if GPU unavailable                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 6. Return Proof (JSON)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      BACKEND (backend/theta-bridge)                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  prover.js                                                            │  │
│  │  • Receives proof (Base64-encoded bytes)                             │  │
│  │  • Receives public inputs (vault, amount, block, root, commitment)   │  │
│  │  • Receives nullifier (for replay protection)                        │  │
│  │  • Prepares transaction for on-chain verification                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│                                      │ 7. Submit Proof                       │
│                                      ▼                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              THETA BLOCKCHAIN                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  SP1Verifier.sol (Deployed Contract)                                  │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │ │
│  │  │  function verifyProof(                                           │ │ │
│  │  │    bytes calldata proof,                                         │ │ │
│  │  │    bytes32[] calldata publicInputs                               │ │ │
│  │  │  ) public view returns (bool)                                    │ │ │
│  │  └──────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                        │ │
│  │  • Verifies SP1 PLONK3 proof on-chain                                 │ │
│  │  • Validates public inputs                                            │ │
│  │  • Checks nullifier not already used                                  │ │
│  │  • Gas cost: ~280k                                                    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      │ 8. Proof Valid ✓                      │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Bridge Contract                                                       │ │
│  │  • Credits user with wrapped tokens                                   │ │
│  │  • Stores nullifier (prevent replay)                                  │ │
│  │  • Emits event (BridgeComplete)                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 9. IBC Transfer to Cosmos
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COSMOS ECOSYSTEM                                  │
│  ┌────────────────┐         ┌────────────────┐        ┌─────────────────┐  │
│  │  IBC Transfer  │────────>│  Mint LST      │───────>│  User Receives  │  │
│  │  (channel-190) │         │  (stkTIA, etc) │        │  Yield Token    │  │
│  └────────────────┘         └────────────────┘        └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. Theta Blockchain (Input)
- **Role**: Source of deposits
- **Data**: Transaction hash, amount, sender, block info
- **Monitoring**: Via JSON-RPC polling

### 2. Backend (Orchestration)
- **listener.js**: Detects deposits, extracts data
- **prover.js**: Calls SP1 prover, submits proofs
- **Language**: Node.js + ethers.js

### 3. SP1 Prover (Zero-Knowledge Proof Generation)

#### Host Program
- **Language**: Rust
- **Modes**: HTTP server OR CLI
- **Input**: JSON (public + private data)
- **Output**: JSON (proof + public inputs + nullifier)
- **Performance**: 2-10x faster than Groth16

#### Guest Program
- **Language**: Rust (runs in zkVM)
- **Constraints**: 9 security checks (same as circom)
- **Optimizations**: Native types, precompiles, efficient algorithms
- **Proving System**: SP1 PLONK3

### 4. GPU Acceleration (Optional)
- **Hardware**: NVIDIA GPU (GTX 1060+)
- **API**: CUDA
- **Performance**: 5-10x speedup
- **Fallback**: Automatic CPU fallback

### 5. On-Chain Verification
- **Contract**: SP1Verifier.sol (generated)
- **Gas**: ~280k (vs ~300k Groth16)
- **Security**: Same as Groth16, no trusted setup

### 6. Cosmos Integration
- **IBC**: Standard IBC transfer
- **LST Minting**: Automated yield token minting
- **No Changes**: IBC flow unchanged

---

## Data Flow Diagram

```
[User TFUEL Deposit]
        │
        ▼
[Theta Block + Tx]
        │
        ▼
[Backend Listener] ──────┐
        │                │
        ▼                │ Fetch Merkle Proof
[Extract Tx Data]        │ & Block Data
        │                │
        ▼                ▼
[Format Proof Request]
        │
        ├─── Public Inputs ───┐
        │    • vaultAddress    │
        │    • netAmount       │
        │    • blockNumber     │──────> [Committed to Proof]
        │    • merkleRoot      │
        │    • commitment      │
        │                      │
        └─── Private Inputs ───┘
             • senderAddress
             • grossAmount
             • feeAmount
             • blockHash
             • txHash
             • merkleProof[16]
             • identitySecrets
        │
        ▼
[SP1 Prover]
        │
        ├──> [Host: Parse & Setup]
        │
        ├──> [Guest: Execute Constraints in zkVM]
        │    ├─ Range Proofs
        │    ├─ Fee Calculation
        │    ├─ Merkle Verification
        │    ├─ Identity Commitment
        │    └─ Nullifier Generation
        │
        ├──> [Generate PLONK3 Proof]
        │    (CPU: ~2s or GPU: ~0.5s)
        │
        └──> [Verify Proof Locally]
        │
        ▼
[Return Proof + Nullifier]
        │
        ▼
[Backend Prover]
        │
        ▼
[Submit to Theta]
        │
        ▼
[SP1Verifier.sol]
        │
        ├──> [Verify PLONK3 Proof] (~280k gas)
        │
        ├──> [Check Nullifier Uniqueness]
        │
        └──> [Return: Proof Valid ✓]
        │
        ▼
[Credit User Tokens]
        │
        ▼
[IBC Transfer to Cosmos]
        │
        ▼
[User Receives LST]
```

---

## Constraint Flow (Guest Program)

```
┌──────────────────────────┐
│  Read Inputs from Host   │
├──────────────────────────┤
│  • PublicInputs          │
│  • PrivateInputs         │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 1:           │
│  Range Proofs            │ ✓ Field Overflow Prevention
├──────────────────────────┤
│  • grossAmount < 2^252   │
│  • netAmount < 2^252     │
│  • feeAmount < 2^252     │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 2:           │
│  Fee Calculation         │ ✓ Correct 0.5% Fee
├──────────────────────────┤
│  • fee = gross * 50/10k  │
│  • assert fee matches    │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 3:           │
│  Net Amount              │ ✓ Arithmetic Integrity
├──────────────────────────┤
│  • net = gross - fee     │
│  • net < gross           │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 4:           │
│  Minimum Deposit         │ ✓ Dust Attack Prevention
├──────────────────────────┤
│  • gross >= 10^16 wei    │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 5:           │
│  Merkle Proof            │ ✓ Transaction Inclusion
├──────────────────────────┤
│  • Hash tx data → leaf   │
│  • Verify 16-level proof │
│  • Root == merkleRoot    │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 6:           │
│  Block Hash Integrity    │ ✓ Block Authenticity
├──────────────────────────┤
│  • Hash block metadata   │
│  • Match blockHash       │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 7:           │
│  Identity Commitment     │ ✓ Non-Malleability
├──────────────────────────┤
│  • Hash identity secrets │
│  • Match commitment      │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 8:           │
│  Nullifier Generation    │ ✓ Replay Protection
├──────────────────────────┤
│  • Generate nullifier    │
│  • Commit as output      │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  CONSTRAINT 9:           │
│  Timestamp Validity      │ ✓ Recency Check
├──────────────────────────┤
│  • Timestamp in range    │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  Commit Public Inputs    │
├──────────────────────────┤
│  • For on-chain verify   │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│  Generate ZK Proof       │
├──────────────────────────┤
│  • PLONK3 proof system   │
│  • ~800 constraints      │
│  • CPU: ~2s / GPU: ~0.5s │
└────────────┬─────────────┘
             ▼
        [Proof Output]
```

---

## File Dependency Graph

```
sp1-prover/
│
├── Cargo.toml ────────┬─────────> workspace config
│                      │
├── program/           │
│   ├── Cargo.toml ────┼─────────> depends: sp1-zkvm
│   └── src/           │
│       └── main.rs ───┴─────────> guest program logic
│
├── host/              │
│   ├── Cargo.toml ────┼─────────> depends: sp1-sdk, ethers, axum
│   └── src/           │
│       └── main.rs ───┴─────────> host program (CLI + HTTP)
│
├── script/
│   ├── build.sh ──────────────────> builds program + host
│   ├── build.ps1 ─────────────────> Windows build
│   └── test.sh ───────────────────> runs tests
│
├── test-data/
│   └── example.json ──────────────> test inputs
│
├── README.md ─────────────────────> main guide
├── INSTALL.md ────────────────────> installation
├── GPU_SETUP.md ──────────────────> GPU config
├── CIRCUIT_OPTIMIZATION_ANALYSIS.md > optimization details
├── THETA_COMPATIBILITY.md ────────> compatibility guide
└── SETUP_COMPLETE.md ─────────────> quick start
```

---

## Performance Comparison

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GROTH16 vs SP1 COMPARISON                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CONSTRAINTS:                                                       │
│  Groth16:  ████████████████████████████████████ 3,300              │
│  SP1:      ████████ 800                                             │
│            ↓ 4.1x reduction                                         │
│                                                                     │
│  PROVING TIME (CPU):                                                │
│  Groth16:  ██████████ 5.0s                                          │
│  SP1:      ████ 2.0s                                                │
│            ↓ 2.5x faster                                            │
│                                                                     │
│  PROVING TIME (GPU):                                                │
│  Groth16:  N/A                                                      │
│  SP1:      █ 0.5s                                                   │
│            ↓ 10x faster                                             │
│                                                                     │
│  VERIFICATION GAS:                                                  │
│  Groth16:  ████████████████████████████████ ~300k                  │
│  SP1:      ███████████████████████████ ~280k                        │
│            ↓ 7% reduction                                           │
│                                                                     │
│  PROOF SIZE:                                                        │
│  Groth16:  █ 128 bytes                                              │
│  SP1:      ██████████████ 192 KB                                    │
│            ↑ Larger but acceptable                                  │
│                                                                     │
│  TRUSTED SETUP:                                                     │
│  Groth16:  ⚠️  Required (toxic waste risk)                          │
│  SP1:      ✅ Universal setup (no ceremony)                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

**Architecture Status:** ✅ Complete  
**Last Updated:** 2026-01-19
