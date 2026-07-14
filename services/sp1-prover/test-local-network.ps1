# Test Local Network Mode with NETWORK_PRIVATE_KEY
# Run this script in YOUR PowerShell terminal where you set the key

Write-Host "================================================"
Write-Host "SP1 NETWORK MODE LOCAL TEST"
Write-Host "================================================"
Write-Host ""

# Step 0: Load .env file if it exists
if (Test-Path ".env") {
    Write-Host "Loading .env file..."
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
            Write-Host "  Loaded: $name"
        }
    }
    Write-Host ""
}

# Step 1: Verify key is set
Write-Host "Step 1: Checking NETWORK_PRIVATE_KEY..."
if ($env:NETWORK_PRIVATE_KEY) {
    $keyLength = $env:NETWORK_PRIVATE_KEY.Length
    Write-Host "OK Key found! Length: $keyLength"
    
    if ($keyLength -eq 66) {
        Write-Host "OK Length is correct (66 chars with 0x prefix)"
        Write-Host ""
    } elseif ($env:NETWORK_PRIVATE_KEY -eq "0xYOUR_PRIVATE_KEY_HERE") {
        Write-Host "ERROR: You need to replace the placeholder with your actual key!"
        Write-Host ""
        Write-Host "Edit .env file and replace 0xYOUR_PRIVATE_KEY_HERE with your real key"
        Write-Host ""
        exit 1
    } else {
        Write-Host "WARNING: Expected 66 chars, got $keyLength"
        Write-Host ""
        Write-Host "Press Ctrl+C to abort, or Enter to continue anyway..."
        Read-Host
    }
} else {
    Write-Host "ERROR: NETWORK_PRIVATE_KEY not found!"
    Write-Host ""
    Write-Host "Edit .env file and add your key"
    Write-Host ""
    exit 1
}

# Step 2: Start Docker container
Write-Host "Step 2: Starting Docker container in network mode..."
Write-Host "Command: docker run -p 3000:8080 -e SP1_PRIVATE_KEY=*** -e NETWORK_PRIVATE_KEY=*** -e SP1_PROVER=network sp1-prover-network:latest"
Write-Host "Note: Container runs on port 8080, mapped to localhost:3000"
Write-Host ""

$privateKey = $env:NETWORK_PRIVATE_KEY
docker run -p 3000:8080 -e SP1_PRIVATE_KEY="$privateKey" -e NETWORK_PRIVATE_KEY="$privateKey" -e SP1_PROVER=network sp1-prover-network:latest
