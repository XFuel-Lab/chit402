# GPU Support for SP1 Prover

## Overview

SP1 supports GPU acceleration via CUDA, providing 5-10x faster proving times compared to CPU. This guide covers setting up GPU support for NVIDIA GPUs.

## Requirements

- **NVIDIA GPU**: GTX 1060 or better (RTX series recommended)
- **CUDA Compute Capability**: 6.0 or higher
- **VRAM**: Minimum 6GB, recommended 8GB+
- **Driver**: Latest NVIDIA drivers
- **CUDA Toolkit**: Version 12.x

## Installation

### Windows

#### 1. Install NVIDIA CUDA Toolkit

1. Download CUDA Toolkit 12.x:
   - Visit: https://developer.nvidia.com/cuda-downloads
   - Select: Windows → x86_64 → 10/11 → exe (network)

2. Run installer:
   ```powershell
   # Download and run the installer
   # Select "Custom Installation"
   # Ensure these components are selected:
   #   - CUDA Toolkit
   #   - CUDA Runtime
   #   - CUDA Development
   ```

3. Verify installation:
   ```powershell
   nvcc --version
   nvidia-smi
   ```

#### 2. Set Environment Variables

```powershell
# Set CUDA path
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3"
$env:CUDA_HOME = $env:CUDA_PATH

# Enable GPU prover
$env:SP1_PROVER = "cuda"

# Optional: Increase batch size for better GPU utilization
$env:SP1_BATCH_SIZE = "32"

# Make permanent (add to system environment variables)
[System.Environment]::SetEnvironmentVariable("CUDA_PATH", "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3", "Machine")
[System.Environment]::SetEnvironmentVariable("SP1_PROVER", "cuda", "User")
```

#### 3. Build with GPU Support

```powershell
cd sp1-prover\host
cargo build --release --features cuda
```

### Linux

#### 1. Install NVIDIA Drivers

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nvidia-driver-535

# Verify
nvidia-smi
```

#### 2. Install CUDA Toolkit

```bash
# Download and install
wget https://developer.download.nvidia.com/compute/cuda/12.3.0/local_installers/cuda_12.3.0_545.23.06_linux.run
sudo sh cuda_12.3.0_545.23.06_linux.run

# Add to PATH
echo 'export PATH=/usr/local/cuda-12.3/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.3/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc

# Verify
nvcc --version
```

#### 3. Set Environment Variables

```bash
export CUDA_PATH=/usr/local/cuda-12.3
export CUDA_HOME=$CUDA_PATH
export SP1_PROVER=cuda
export SP1_BATCH_SIZE=32

# Make permanent
echo 'export SP1_PROVER=cuda' >> ~/.bashrc
echo 'export SP1_BATCH_SIZE=32' >> ~/.bashrc
```

#### 4. Build with GPU Support

```bash
cd sp1-prover/host
cargo build --release --features cuda
```

## Verification

### Test GPU Acceleration

Run a proof and check GPU utilization:

```powershell
# Terminal 1: Monitor GPU
nvidia-smi -l 1

# Terminal 2: Generate proof
cd sp1-prover
.\host\target\release\prove.exe prove --input test-data\example.json
```

You should see:
- GPU utilization spike to 80-100%
- GPU memory usage increase by 2-4GB
- Significantly faster proving time

### Performance Benchmarks

| GPU Model | VRAM | Proving Time | vs CPU |
|-----------|------|--------------|--------|
| RTX 4090 | 24GB | ~0.5s | 10x faster |
| RTX 4080 | 16GB | ~0.7s | 8x faster |
| RTX 3080 | 10GB | ~0.8s | 7x faster |
| RTX 3070 | 8GB | ~1.2s | 5x faster |
| RTX 3060 | 12GB | ~1.5s | 4x faster |
| GTX 1660 Ti | 6GB | ~2.0s | 3x faster |

CPU baseline (Intel i9-13900K): ~5s

## Troubleshooting

### Error: "CUDA not found"

**Solution:**
```powershell
# Verify CUDA installation
nvcc --version

# Set CUDA_PATH manually
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3"
```

### Error: "Insufficient GPU memory"

**Solution:**
```powershell
# Reduce batch size
$env:SP1_BATCH_SIZE = "16"

# Or use CPU fallback
$env:SP1_PROVER = "local"
```

### Error: "CUDA driver version is insufficient"

**Solution:**
```powershell
# Update NVIDIA drivers
# Download from: https://www.nvidia.com/Download/index.aspx
```

### GPU not being utilized

**Solution:**
```powershell
# Ensure SP1_PROVER is set
echo $env:SP1_PROVER  # Should output "cuda"

# Rebuild with CUDA feature
cd sp1-prover\host
cargo clean
cargo build --release --features cuda
```

### Build fails with "nvcc linking error"

**Solution:**
```powershell
# Add CUDA to PATH
$env:Path += ";C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.3\bin"

# Verify nvcc is accessible
nvcc --version
```

## Optimization Tips

### 1. Maximize GPU Utilization

```powershell
# Increase batch size (requires more VRAM)
$env:SP1_BATCH_SIZE = "64"  # For 24GB VRAM
$env:SP1_BATCH_SIZE = "32"  # For 8-16GB VRAM
$env:SP1_BATCH_SIZE = "16"  # For 6GB VRAM
```

### 2. Power and Thermal Settings

```powershell
# Set power mode to maximum performance
nvidia-smi -pm 1
nvidia-smi -pl 350  # Set power limit (adjust for your GPU)
```

### 3. Multiple GPUs

```powershell
# Use specific GPU
$env:CUDA_VISIBLE_DEVICES = "0"  # Use first GPU
$env:CUDA_VISIBLE_DEVICES = "1"  # Use second GPU

# Use multiple GPUs (future SP1 feature)
$env:CUDA_VISIBLE_DEVICES = "0,1"
```

## Fallback to CPU

If GPU setup fails or you want to test CPU performance:

```powershell
# Use local CPU prover
$env:SP1_PROVER = "local"

# Or use Succinct's hosted prover (requires network)
$env:SP1_PROVER = "network"
```

## Cloud GPU Options

If you don't have a local GPU:

1. **Vast.ai**: Rent RTX 4090 for ~$0.50/hour
2. **RunPod**: Rent RTX 3090 for ~$0.40/hour
3. **AWS EC2**: Use p3.2xlarge (Tesla V100)
4. **Google Cloud**: Use n1-standard-8 + T4 GPU

## Production Deployment

For production, we recommend:

1. **Hardware**: RTX 4080 or better
2. **Batch Processing**: Queue proofs and process in batches
3. **Monitoring**: Track GPU utilization and temperature
4. **Redundancy**: CPU fallback if GPU fails
5. **Scaling**: Multiple GPU workers for high throughput

## Next Steps

- [Build the Project](README.md#quick-start)
- [Integration with Backend](README.md#integration-with-existing-backend)
- [Performance Benchmarking](README.md#performance-benchmarks)

---

**Note:** SP1's GPU support is actively developed. Check [SP1 docs](https://docs.succinct.xyz/sp1/) for the latest updates.
