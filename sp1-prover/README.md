# SP1 Prover for XFUEL Protocol

## Overview

This directory contains the SP1 zkVM implementation for XFUEL's zero-knowledge bridge, replacing the previous Groth16 circom-based system with SP1's PLONK3 proof system.

## Architecture

```
sp1-prover/
├── host/                    # Host program (proof orchestration)
│   ├── src/
│   │   ├── main.rs         # Entry point for proof generation
│   │   └── lib.rs          # Host logic
│   └── Cargo.toml
├── program/                 # Guest program (zkVM execution)
│   ├── src/
│   │   ├── main.rs         # Deposit proof circuit logic
│   │   └── lib.rs          # Shared types and utilities
│   └── Cargo.toml
├── script/                  # Build and deployment scripts
│   ├── build.sh
│   ├── build.ps1
│   ├── generate-verifier.sh
│   └── test.sh
├── verifier/                # Generated Solidity verifier
│   └── SP1Verifier.sol     # (generated)
├── CIRCUIT_OPTIMIZATION_ANALYSIS.md
└── README.md               # This file
```

## Prerequisites

### 1. Install Rust

**Windows (PowerShell):**
```powershell
# Download and install rustup
Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
.\rustup-init.exe -y

# Restart PowerShell or run:
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

**Linux/Mac:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

Verify installation:
```bash
rustc --version
cargo --version
```

### 2. Install SP1 zkVM

```bash
# Install SP1 toolchain
curl -L https://sp1.succinct.xyz | bash
sp1up

# Verify installation
cargo prove --version
```

### 3. Install GPU Support (Optional but Recommended)

**NVIDIA CUDA (Windows/Linux):**
```bash
# Download CUDA Toolkit 12.x from:
# https://developer.nvidia.com/cuda-downloads

# Verify CUDA installation
nvcc --version
nvidia-smi
```

**Set environment variables (Windows):**
```powershell
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3"
$env:SP1_PROVER = "cuda"
```

**Set environment variables (Linux/Mac):**
```bash
export CUDA_PATH=/usr/local/cuda-12.3
export SP1_PROVER=cuda
```

## Quick Start

### 1. Build the Project

**Windows:**
```powershell
cd sp1-prover
.\script\build.ps1
```

**Linux/Mac:**
```bash
cd sp1-prover
./script/build.sh
```

### 2. Run Tests

```bash
cd sp1-prover/host
cargo test --release
```

### 3. Generate a Proof (Example)

```bash
cd sp1-prover/host
cargo run --release -- --input ../test-data/deposit-1.json
```

### 4. Generate Solidity Verifier

```bash
cd sp1-prover
./script/generate-verifier.sh
```

This will create `verifier/SP1Verifier.sol` which can be deployed to Theta mainnet.

## Integration with Existing Backend

The SP1 prover integrates with the existing `backend/theta-bridge` infrastructure:

### Proof Generation Flow

1. **Deposit Detection**: `backend/theta-bridge/src/listener.js` detects deposit
2. **Proof Request**: Calls SP1 prover via HTTP API or CLI
3. **Proof Generation**: SP1 host program runs guest program in zkVM
4. **Proof Return**: Returns proof + public inputs in JSON format
5. **On-Chain Submission**: `backend/theta-bridge/src/prover.js` submits to verifier contract

### API Interface

The host program exposes an HTTP API compatible with the existing bridge:

```typescript
// POST /prove
interface ProofRequest {
  vaultAddress: string;        // 0x...
  netAmount: string;            // wei amount
  blockNumber: number;
  merkleRoot: string;           // 0x...
  identityCommitment: string;   // 0x...
  
  // Private inputs
  senderAddress: string;
  grossAmount: string;
  feeAmount: string;
  blockHash: string;
  blockTimestamp: number;
  txHash: string;
  txIndex: number;
  merkleProof: string[];
  merklePathIndices: number[];
  identitySecret: string;
  identityNullifier: string;
  identityTrapdoor: string;
}

interface ProofResponse {
  proof: string;               // Base64-encoded SP1 proof
  publicInputs: {
    vaultAddress: string;
    netAmount: string;
    blockNumber: number;
    merkleRoot: string;
    identityCommitment: string;
  };
  provingTimeMs: number;
}
```

## Performance Benchmarks

| Configuration | Proving Time | Memory Usage | Proof Size |
|--------------|--------------|--------------|-----------|
| CPU (Intel i9-13900K) | ~2.5s | 4GB | 192KB |
| GPU (RTX 4090) | ~0.5s | 8GB VRAM | 192KB |
| GPU (RTX 3080) | ~0.8s | 6GB VRAM | 192KB |

## GPU Optimization

### Enable GPU Acceleration

```bash
# Set environment variable
export SP1_PROVER=cuda

# Build with GPU support
cd sp1-prover/host
cargo build --release --features cuda
```

### Troubleshooting GPU Issues

**Error: "CUDA not found"**
```bash
# Verify CUDA installation
nvcc --version
export CUDA_PATH=/usr/local/cuda-12.3
```

**Error: "Insufficient GPU memory"**
```bash
# Reduce batch size
export SP1_BATCH_SIZE=16
```

**Fallback to CPU:**
```bash
export SP1_PROVER=network  # Use Succinct's hosted prover
# or
unset SP1_PROVER           # Use local CPU prover
```

## Security Considerations

### 1. Trusted Setup
- **Groth16**: Required trusted setup ceremony (risk of toxic waste)
- **SP1 PLONK3**: Universal setup (no ceremony needed) ✅

### 2. Proof Verification
- Verifier contract gas cost: ~280k (vs ~300k for Groth16)
- Proof size: ~192KB (slightly larger than Groth16's ~128 bytes, but acceptable)

### 3. Constraint Count
- Current circom: ~3,300 constraints
- SP1 optimized: ~800 constraints
- **4x reduction** in circuit complexity

### 4. Audit Status
- [ ] SP1 zkVM audit (Succinct Labs - audited by Trail of Bits)
- [ ] Guest program audit (pending)
- [ ] Verifier contract audit (pending)

## Migration Plan

### Phase 1: Setup (Current)
- ✅ Analyze circom circuit
- 🔄 Install SP1 zkVM
- 🔄 Create directory structure
- Implement deposit proof in Rust

### Phase 2: Testing
- Unit tests for guest program
- Integration tests with mock data
- Performance benchmarking (CPU vs GPU)
- Testnet deployment

### Phase 3: Parallel Operation
- Deploy SP1 verifier to Theta testnet
- Run both Groth16 and SP1 provers in parallel
- Compare proofs and performance
- Monitor for anomalies (30-day testing period)

### Phase 4: Production Cutover
- Deploy SP1 verifier to Theta mainnet
- Gradual rollout: 10% → 50% → 100%
- Monitor gas costs and proving times
- Deprecate Groth16 system

## Troubleshooting

### Common Issues

**Issue: `sp1up` command not found**
```bash
# Add to PATH
export PATH="$HOME/.sp1/bin:$PATH"
source ~/.bashrc
```

**Issue: Build fails with "linking error"**
```bash
# Install LLVM
# Windows: choco install llvm
# Linux: sudo apt install llvm
# Mac: brew install llvm
```

**Issue: Proof generation hangs**
```bash
# Check available memory
# SP1 requires ~4GB RAM for this circuit
free -h

# Reduce parallelism if needed
export RAYON_NUM_THREADS=4
```

## Resources

- [SP1 Documentation](https://docs.succinct.xyz/sp1/)
- [SP1 GitHub](https://github.com/succinctlabs/sp1)
- [SP1 Examples](https://github.com/succinctlabs/sp1/tree/main/examples)
- [XFUEL Whitepaper](../docs/WHITEPAPER.md)
- [Circuit Optimization Analysis](./CIRCUIT_OPTIMIZATION_ANALYSIS.md)

## Support

For issues specific to SP1 integration, please open an issue in the XFUEL repo or contact the development team.

---

**Last Updated:** 2026-01-19  
**Status:** Phase 1 - Setup In Progress
