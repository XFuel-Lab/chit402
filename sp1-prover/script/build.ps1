# PowerShell build script for Windows
$ErrorActionPreference = "Stop"

Write-Host "Building SP1 Deposit Proof System" -ForegroundColor Cyan
Write-Host ""

# Check if Rust is installed
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Rust is not installed." -ForegroundColor Red
    Write-Host "Please install from https://rustup.rs/" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Run this command in PowerShell (as Administrator):" -ForegroundColor Yellow
    Write-Host "  Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe" -ForegroundColor White
    Write-Host "  .\rustup-init.exe -y" -ForegroundColor White
    exit 1
}

Write-Host "[OK] Rust detected: $(cargo --version)" -ForegroundColor Green

# Check if SP1 is installed
if (-not (Get-Command cargo-prove -ErrorAction SilentlyContinue)) {
    Write-Host "[WARN] SP1 not found. Installing now..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Installing cargo-prove..." -ForegroundColor Cyan
    cargo install cargo-prove --locked
    if ($LASTEXITCODE -ne 0) { 
        Write-Host "[ERROR] Failed to install cargo-prove" -ForegroundColor Red
        exit 1 
    }
    
    Write-Host ""
    Write-Host "[OK] cargo-prove installed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next: Add RISC-V target..." -ForegroundColor Cyan
    rustup target add riscv32im-succinct-zkvm-elf
    if ($LASTEXITCODE -ne 0) { 
        Write-Host "[ERROR] Failed to add RISC-V target" -ForegroundColor Red
        exit 1 
    }
    
    Write-Host "[OK] RISC-V target added!" -ForegroundColor Green
}

Write-Host "[OK] SP1 detected" -ForegroundColor Green

# Build guest program
Write-Host ""
Write-Host "Building guest program (zkVM)..." -ForegroundColor Cyan
Set-Location program
cargo build --target riscv32im-succinct-zkvm-elf --release
if ($LASTEXITCODE -ne 0) { 
    Write-Host "[ERROR] Guest program build failed" -ForegroundColor Red
    Set-Location ..
    exit $LASTEXITCODE 
}
Set-Location ..

Write-Host ""
Write-Host "Building host program..." -ForegroundColor Cyan
Set-Location host

# Check if CUDA is available
$cudaAvailable = Get-Command nvcc -ErrorAction SilentlyContinue

if ($cudaAvailable) {
    Write-Host "[GPU] CUDA detected, building with GPU support..." -ForegroundColor Green
    $env:SP1_PROVER = "cuda"
    cargo build --release --features cuda
} else {
    Write-Host "[CPU] Building with CPU support..." -ForegroundColor Yellow
    cargo build --release
}

if ($LASTEXITCODE -ne 0) { 
    Write-Host "[ERROR] Host program build failed" -ForegroundColor Red
    Set-Location ..
    exit $LASTEXITCODE 
}
Set-Location ..

Write-Host ""
Write-Host "[SUCCESS] Build complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
Write-Host "  .\host\target\release\prove.exe prove --input test-data\example.json" -ForegroundColor White
Write-Host "  .\host\target\release\prove.exe serve --port 8080" -ForegroundColor White
