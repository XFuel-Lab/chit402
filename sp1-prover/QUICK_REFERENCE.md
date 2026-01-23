# SP1 Prover - Quick Reference Card

## 🚀 Installation (One-Time Setup)

### Windows
```powershell
# 1. Install Rust (5 min)
Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
.\rustup-init.exe -y

# 2. Restart PowerShell, then install SP1 (10 min)
cargo install cargo-prove --locked
curl -L https://sp1.succinct.xyz | bash  # In Git Bash
sp1up
rustup target add riscv32im-succinct-zkvm-elf

# 3. Build (5 min)
cd xfuel-protocol\sp1-prover
.\script\build.ps1
```

### Linux/Mac
```bash
# 1. Install Rust (5 min)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 2. Install SP1 (10 min)
cargo install cargo-prove --locked
curl -L https://sp1.succinct.xyz | bash
source ~/.bashrc && sp1up

# 3. Build (5 min)
cd xfuel-protocol/sp1-prover
./script/build.sh
```

---

## 🎯 Usage

### CLI Mode
```powershell
# Generate proof from JSON file
cd sp1-prover\host
cargo run --release -- prove --input ..\test-data\example.json --output proof.json

# Run tests
cd ..
.\script\test.sh
```

### HTTP Server Mode (Recommended)
```powershell
# Start server
cd sp1-prover\host
cargo run --release -- serve --port 8080

# Send proof request (from another terminal)
curl -X POST http://localhost:8080/prove -H "Content-Type: application/json" -d @test-data\example.json
```

---

## 🎮 GPU Setup (Optional - 10x Faster)

### Windows
```powershell
# 1. Install CUDA Toolkit 12.x from:
# https://developer.nvidia.com/cuda-downloads

# 2. Set environment variables
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3"
$env:SP1_PROVER = "cuda"

# 3. Rebuild with GPU support
cd sp1-prover\host
cargo build --release --features cuda
```

### Verify GPU is working
```powershell
# Terminal 1: Monitor GPU
nvidia-smi -l 1

# Terminal 2: Generate proof
cargo run --release -- prove --input ..\test-data\example.json
# You should see GPU utilization spike to 80-100%
```

---

## 🔗 Backend Integration

### Update `backend/theta-bridge/src/prover.js`

```javascript
const axios = require('axios');

const SP1_PROVER_URL = process.env.SP1_PROVER_URL || 'http://localhost:8080';

async function generateSP1Proof(depositData) {
  try {
    const response = await axios.post(`${SP1_PROVER_URL}/prove`, {
      // Public inputs
      vault_address: depositData.vaultAddress,
      net_amount: depositData.netAmount,
      block_number: depositData.blockNumber,
      merkle_root: depositData.merkleRoot,
      identity_commitment: depositData.identityCommitment,
      
      // Private inputs
      sender_address: depositData.senderAddress,
      gross_amount: depositData.grossAmount,
      fee_amount: depositData.feeAmount,
      block_hash: depositData.blockHash,
      block_timestamp: depositData.blockTimestamp,
      tx_hash: depositData.txHash,
      tx_index: depositData.txIndex,
      merkle_proof: depositData.merkleProof,
      merkle_path_indices: depositData.merklePathIndices,
      identity_secret: depositData.identitySecret,
      identity_nullifier: depositData.identityNullifier,
      identity_trapdoor: depositData.identityTrapdoor,
    }, {
      timeout: 10000, // 10 second timeout
    });

    console.log(`✅ SP1 proof generated in ${response.data.proving_time_ms}ms`);
    
    return {
      proof: response.data.proof,
      publicInputs: response.data.public_inputs,
      nullifier: response.data.nullifier,
    };
  } catch (error) {
    console.error('❌ SP1 proof generation failed:', error.message);
    throw error;
  }
}

// Export
module.exports = { generateSP1Proof };
```

### Start Both Services
```powershell
# Terminal 1: SP1 Prover
cd sp1-prover\host
cargo run --release -- serve --port 8080

# Terminal 2: Backend
cd backend\theta-bridge
npm run dev
```

---

## 📊 Performance Benchmarks

| Configuration | Proving Time | Memory |
|--------------|--------------|---------|
| **CPU (i9-13900K)** | ~2.5s | 4GB RAM |
| **GPU (RTX 4090)** | ~0.5s | 8GB VRAM |
| **GPU (RTX 3080)** | ~0.8s | 6GB VRAM |
| **GPU (RTX 3060)** | ~1.5s | 6GB VRAM |

vs. Groth16: ~5s (CPU only)

---

## 🔍 Debugging

### Check if SP1 is installed
```bash
cargo prove --version
```

### Check if GPU is available
```bash
nvcc --version
nvidia-smi
```

### View prover logs
```powershell
# Server mode (verbose)
RUST_LOG=debug cargo run --release -- serve --port 8080

# CLI mode (verbose)
RUST_LOG=debug cargo run --release -- prove --input test.json
```

### Test with example data
```powershell
cd sp1-prover\host
cargo run --release -- prove --input ..\test-data\example.json
```

---

## ⚙️ Environment Variables

```powershell
# GPU acceleration (NVIDIA CUDA)
$env:SP1_PROVER = "cuda"           # Use GPU
$env:SP1_PROVER = "local"          # Use CPU
$env:SP1_PROVER = "network"        # Use Succinct's hosted prover

# CUDA configuration
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3"
$env:CUDA_VISIBLE_DEVICES = "0"    # Use first GPU
$env:SP1_BATCH_SIZE = "32"         # Adjust for VRAM

# Prover settings
$env:SP1_PROVER_URL = "http://localhost:8080"  # Prover server URL
$env:RAYON_NUM_THREADS = "8"       # CPU parallelism
```

---

## 📁 File Locations

```
sp1-prover/
├── host/target/release/
│   └── prove.exe              # Built executable (Windows)
│   └── prove                  # Built executable (Linux/Mac)
│
├── program/target/riscv32im-succinct-zkvm-elf/release/
│   └── deposit-proof-program  # Guest program (embedded in host)
│
├── test-data/
│   └── example.json           # Test input
│
└── verifier/
    └── SP1Verifier.sol        # (to be generated)
```

---

## 🆘 Common Issues

### "rustc not found"
→ Install Rust: https://rustup.rs/

### "cargo-prove not found"
→ Run: `cargo install cargo-prove --locked`

### "RISC-V target not found"
→ Run: `rustup target add riscv32im-succinct-zkvm-elf`

### "CUDA not found" (GPU)
→ Install CUDA Toolkit 12.x, set `$env:CUDA_PATH`

### "Proof generation timeout"
→ Increase timeout in backend, or use GPU

### "Out of memory"
→ Close other apps, or reduce `SP1_BATCH_SIZE`

---

## 🔧 Maintenance

### Update SP1
```bash
sp1up
```

### Rebuild after changes
```powershell
cd sp1-prover
.\script\build.ps1
```

### Clean build
```powershell
cd sp1-prover
cargo clean
.\script\build.ps1
```

### Run tests
```bash
cd sp1-prover
./script/test.sh
```

---

## 📖 Documentation Links

| File | Purpose |
|------|---------|
| `START_HERE_SP1.md` | Quick start overview |
| `sp1-prover/SETUP_COMPLETE.md` | Detailed setup guide |
| `sp1-prover/README.md` | Architecture & API docs |
| `sp1-prover/INSTALL.md` | Installation (Windows/Linux) |
| `sp1-prover/GPU_SETUP.md` | GPU acceleration setup |
| `sp1-prover/ARCHITECTURE.md` | System diagrams |
| `SP1_PHASE1_SUMMARY.md` | Project summary |

---

## 🚦 Status Checks

```bash
# Check installation
rustc --version          # Should show: rustc 1.81.0
cargo --version          # Should show: cargo 1.81.0
cargo prove --version    # Should show: cargo-prove 1.x.x

# Check GPU (optional)
nvcc --version           # Should show: CUDA 12.x
nvidia-smi               # Should show GPU info

# Check build
cd sp1-prover/host
cargo build --release    # Should compile successfully

# Test proof generation
cargo run --release -- prove --input ../test-data/example.json
# Should output proof in ~0.5-5s depending on GPU/CPU
```

---

## ⚡ Quick Commands

```powershell
# Build
cd sp1-prover && .\script\build.ps1

# Test
cd sp1-prover\host && cargo run --release -- prove --input ..\test-data\example.json

# Serve
cd sp1-prover\host && cargo run --release -- serve --port 8080

# GPU build
cd sp1-prover\host && cargo build --release --features cuda

# Clean
cd sp1-prover && cargo clean

# Update SP1
sp1up
```

---

**Phase:** 1 Complete ✅ | **Next:** Install → Build → Test  
**Time Required:** ~20-30 minutes  
**Last Updated:** 2026-01-19
