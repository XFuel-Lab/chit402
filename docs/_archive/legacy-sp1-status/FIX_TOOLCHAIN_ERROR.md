# Fix: Install SP1 Toolchain for RISC-V Support

## The Issue
The error `toolchain '1.81.0-x86_64-pc-windows-msvc' does not support target 'riscv32im-succinct-zkvm-elf'` means we need the SP1-specific Rust toolchain.

---

## Solution: Install SP1 Toolchain

### Option 1: Using cargo-prove (Recommended for Windows)

Run this command in PowerShell:

```powershell
cargo prove install-toolchain
```

**What this does:** Installs the SP1-specific Rust toolchain that includes RISC-V support  
**How long:** 2-3 minutes  
**Expected output:** 
```
Installing SP1 toolchain...
info: downloading component 'rust-std' for 'riscv32im-succinct-zkvm-elf'
info: installing component 'rust-std' for 'riscv32im-succinct-zkvm-elf'
✓ SP1 toolchain installed successfully
```

### Option 2: Manual Installation (If Option 1 doesn't work)

```powershell
# Install the succinct toolchain
rustup toolchain install succinct

# Set it as default for the project
cd C:\Users\seeha\xfuel-protocol\sp1-prover
rustup override set succinct
```

### Option 3: Use Nightly Toolchain (Fallback)

```powershell
# Install nightly
rustup toolchain install nightly

# Try adding RISC-V target to nightly
rustup target add riscv32im-succinct-zkvm-elf --toolchain nightly
```

---

## Verification

After running Option 1, verify it worked:

```powershell
# Check toolchains
rustup toolchain list

# Should show something like:
# stable-x86_64-pc-windows-msvc (default)
# succinct
```

---

## Updated Step-by-Step (CORRECTED)

### Step 2.1: Install cargo-prove (if not done)
```powershell
cargo install cargo-prove --locked
```

### Step 2.2: Install SP1 toolchain (NEW - this was missing!)
```powershell
cargo prove install-toolchain
```

### Step 2.3: Verify
```powershell
cargo prove --version
rustup toolchain list
```

### Step 3: Build
```powershell
cd C:\Users\seeha\xfuel-protocol\sp1-prover
.\script\build.ps1
```

---

## Quick Fix Command

**Just run this:**

```powershell
cargo prove install-toolchain
```

Then try the build again.

---

Let me know what happens after running `cargo prove install-toolchain`!
