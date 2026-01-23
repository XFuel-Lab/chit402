# SP1 Installation Guide for Windows

## Step 1: Install Rust

1. Download Rust installer:
   ```powershell
   Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
   ```

2. Run the installer:
   ```powershell
   .\rustup-init.exe -y
   ```

3. Restart PowerShell or update PATH:
   ```powershell
   $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
   ```

4. Verify installation:
   ```powershell
   rustc --version
   cargo --version
   ```

## Step 2: Install SP1 zkVM

### Option A: Native Windows (Recommended for Development)

1. Install build tools:
   ```powershell
   # Install Visual Studio Build Tools 2022
   # Download from: https://visualstudio.microsoft.com/downloads/
   # Select "Desktop development with C++"
   ```

2. Install SP1 CLI:
   ```powershell
   cargo install cargo-prove --locked
   ```

3. Install SP1 toolchain:
   ```bash
   # In Git Bash or WSL
   curl -L https://sp1.succinct.xyz | bash
   sp1up
   ```

4. Add RISC-V target:
   ```powershell
   rustup target add riscv32im-succinct-zkvm-elf
   ```

### Option B: WSL2 (Recommended for Production)

1. Install WSL2:
   ```powershell
   wsl --install
   ```

2. Open Ubuntu WSL and run:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   
   curl -L https://sp1.succinct.xyz | bash
   source ~/.bashrc
   sp1up
   ```

## Step 3: Install Dependencies

```powershell
# Install LLVM (required for building)
winget install LLVM.LLVM

# Add to PATH
$env:Path += ";C:\Program Files\LLVM\bin"
```

## Step 4: Build the Project

```powershell
cd sp1-prover
.\script\build.ps1
```

## Troubleshooting

### Error: "linker 'cc' not found"
Install Visual Studio Build Tools with C++ support.

### Error: "cargo-prove not found"
Run: `cargo install cargo-prove --locked`

### Error: "RISC-V target not found"
Run: `rustup target add riscv32im-succinct-zkvm-elf`

### Build is very slow
Consider using WSL2 for better performance, or enable GPU support (see GPU_SETUP.md).

## Next Steps

After installation, proceed to:
- [GPU Setup Guide](GPU_SETUP.md) (optional but recommended)
- [Building the Project](README.md#quick-start)
