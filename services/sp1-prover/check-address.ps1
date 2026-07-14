# Check which address your NETWORK_PRIVATE_KEY corresponds to

Write-Host "Loading .env file..."
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

if ($env:NETWORK_PRIVATE_KEY) {
    Write-Host "`nYour NETWORK_PRIVATE_KEY corresponds to this address:"
    Write-Host "====================================================`n"
    
    # Use cast to derive the address
    $address = cast wallet address --private-key $env:NETWORK_PRIVATE_KEY
    Write-Host "ADDRESS: $address"
    Write-Host ""
    Write-Host "This is the address that needs PROVE tokens deposited!"
    Write-Host ""
    Write-Host "SOLUTION:"
    Write-Host "========="
    Write-Host "1. Go to: https://explorer.succinct.xyz/account"
    Write-Host "2. Connect your MetaMask (the one with 10 PROVE)"
    Write-Host "3. Click 'Transfer' (not Deposit)"
    Write-Host "4. Transfer PROVE to: $address"
    Write-Host "5. Wait ~1 minute for it to process"
    Write-Host "6. Test again!"
} else {
    Write-Host "NETWORK_PRIVATE_KEY not found!"
}
