# Test if .env.local is being read correctly

Write-Host "Testing .env.local file..." -ForegroundColor Cyan
Write-Host ""

if (Test-Path ".env.local") {
    $content = Get-Content ".env.local"
    Write-Host "[OK] .env.local file exists" -ForegroundColor Green
    Write-Host "Content preview:" -ForegroundColor Gray
    
    foreach ($line in $content) {
        if ($line -match "THETA_MAINNET_PRIVATE_KEY=(.+)") {
            $key = $matches[1]
            if ($key.StartsWith("0x") -and $key.Length -gt 10) {
                Write-Host "  THETA_MAINNET_PRIVATE_KEY=$($key.Substring(0,10))..." -ForegroundColor Green
            } else {
                Write-Host "  [ERROR] Invalid key format in .env.local" -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "  $line" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "[ERROR] .env.local file not found!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Testing Hardhat can read it..." -ForegroundColor Cyan

# Create a simple test script
@"
const hre = require('hardhat')

async function test() {
  try {
    const signers = await hre.ethers.getSigners()
    if (signers && signers.length > 0) {
      const address = await signers[0].getAddress()
      console.log('[OK] Wallet loaded:', address)
      process.exit(0)
    } else {
      console.log('[ERROR] No signers found')
      process.exit(1)
    }
  } catch (error) {
    console.log('[ERROR]', error.message)
    process.exit(1)
  }
}

test()
"@ | Out-File -FilePath scripts/test-env.cjs -Encoding utf8

npx hardhat run scripts/test-env.cjs --network theta-mainnet

Remove-Item scripts/test-env.cjs -ErrorAction SilentlyContinue

