# SP1 Manual Installation - Step-by-Step Guide for Windows

## Current Status
✅ Rust is installed  
⏳ Step 2: Install cargo-prove  
⏳ Step 3: Build the prover  

---

## Step 2: Install cargo-prove (The SP1 CLI Tool)

### 2.1 Open PowerShell and run:

```powershell
cargo install cargo-prove --locked
```

**What this does:** Installs the SP1 proving CLI tool  
**How long:** 5-10 minutes (downloads and compiles)  
**Expected output:** You'll see "Compiling..." messages, then "Installed package `cargo-prove`"

### 2.2 Install SP1 toolchain (required for RISC-V support):

```powershell
cargo prove install-toolchain
```

**What this does:** Installs the SP1-specific Rust toolchain with RISC-V support  
**How long:** 2-3 minutes  
**Expected output:** "Installing SP1 toolchain..." then "✓ SP1 toolchain installed successfully"

**Note:** The standard Rust toolchain doesn't include the SP1 RISC-V target, so we need this special toolchain.

### 2.3 Verify installation:

```powershell
cargo prove --version
```

**Expected output:** Something like `cargo-prove 3.0.0` or similar version

---

## Step 3: Build the SP1 Prover

### 3.1 Navigate to the sp1-prover directory:

```powershell
cd C:\Users\seeha\xfuel-protocol\sp1-prover
```

### 3.2 Run the fixed build script:

```powershell
.\script\build.ps1
```

**What this does:**
1. Checks if Rust is installed ✅ (already done)
2. Checks if cargo-prove is installed (should be ✅ after Step 2)
3. Builds the guest program (zkVM circuit) - takes 5-10 minutes
4. Builds the host program (proof orchestrator) - takes 3-5 minutes

**Total time:** 10-15 minutes

**Expected output:**
```
[OK] Rust detected: cargo 1.81.0
[OK] SP1 detected
Building guest program (zkVM)...
   Compiling deposit-proof-program...
   Finished release [optimized] target(s) in 8m 32s
Building host program...
   Compiling deposit-proof-host...
   Finished release [optimized] target(s) in 4m 18s
[SUCCESS] Build complete!
```

---

## Step 4: Test the Installation

### 4.1 Generate a test proof:

```powershell
cd host
cargo run --release -- prove --input ..\test-data\example.json
```

**What this does:** Generates a ZK proof using the example test data  
**How long:** 2-5 seconds (first run might compile a bit more)  
**Expected output:**
```
Reading input from: ..\test-data\example.json
Generating SP1 proof...
Proof generated successfully!
Verifying proof...
Proof verified!

Results:
  Proving time: 2500ms
  Nullifier: 0x...
```

---

## Troubleshooting

### If cargo-prove installation fails:

**Error: "failed to compile"**
```powershell
# Try with more verbose output
cargo install cargo-prove --locked --verbose
```

**Error: "linker 'cc' not found"**
```powershell
# Install Visual Studio Build Tools
# Download from: https://visualstudio.microsoft.com/downloads/
# Select "Desktop development with C++"
```

### If RISC-V target fails:

```powershell
# Check available targets
rustup target list | Select-String "riscv32im"

# Should show:
# riscv32im-succinct-zkvm-elf (installed)
```

### If build script still has issues:

**Option 1: Manual build**
```powershell
# Build guest program manually
cd C:\Users\seeha\xfuel-protocol\sp1-prover\program
cargo build --target riscv32im-succinct-zkvm-elf --release

# Build host program manually
cd ..\host
cargo build --release
```

**Option 2: Check for encoding issues**
```powershell
# If you still see emoji errors, open PowerShell as UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

# Then run build again
cd C:\Users\seeha\xfuel-protocol\sp1-prover
.\script\build.ps1
```

---

## Quick Command Reference

```powershell
# Step 2: Install SP1
cargo install cargo-prove --locked
rustup target add riscv32im-succinct-zkvm-elf

# Step 3: Build
cd C:\Users\seeha\xfuel-protocol\sp1-prover
.\script\build.ps1

# Step 4: Test
cd host
cargo run --release -- prove --input ..\test-data\example.json
```

---

## Progress Checklist

- [x] Rust installed
- [ ] cargo-prove installed (`cargo install cargo-prove --locked`)
- [ ] RISC-V target added (`rustup target add riscv32im-succinct-zkvm-elf`)
- [ ] Build script fixed (emoji encoding)
- [ ] Guest program built
- [ ] Host program built
- [ ] Test proof generated

---

## What to Do Right Now

**Run these commands in PowerShell:**

```powershell
# 1. Install cargo-prove (5-10 min)
cargo install cargo-prove --locked

# 2. Add RISC-V target (1-2 min)
rustup target add riscv32im-succinct-zkvm-elf

# 3. Verify
cargo prove --version

# 4. Build (10-15 min)
cd C:\Users\seeha\xfuel-protocol\sp1-prover
.\script\build.ps1
```

**Wait for each command to finish before running the next one.**

---

Let me know when you finish Step 2 (installing cargo-prove), and I'll help you with Step 3!
