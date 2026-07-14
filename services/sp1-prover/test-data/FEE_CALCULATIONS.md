# Test Data Generator - Correct Fee Calculations

## Calculations for TFUEL Deposits (0.5% fee)

### Formula:
```
gross_amount = deposit amount in wei
fee_amount = (gross_amount * 50) / 10000  (0.5%)
net_amount = gross_amount - fee_amount
```

### Sample 1: 0.01 TFUEL (Minimum Deposit)
```
gross = 10,000,000,000,000,000 wei = 0.01 TFUEL = 10^16
fee   = (10^16 * 50) / 10000 = 50,000,000,000,000 = 5*10^13
net   = 10^16 - 5*10^13 = 9,950,000,000,000,000

Hex values (little-endian, 32 bytes):
gross = 0x002386F26FC10000 (padded to 32 bytes)
fee   = 0x00002D79883D2000
net   = 0x0023599D2BB3E000
```

### Sample 2: 1.0 TFUEL (Standard)
```
gross = 1,000,000,000,000,000,000 wei = 1 TFUEL = 10^18
fee   = (10^18 * 50) / 10000 = 5,000,000,000,000,000 = 5*10^15
net   = 10^18 - 5*10^15 = 995,000,000,000,000,000

Hex values:
gross = 0x0DE0B6B3A7640000
fee   = 0x0011C37937E08000
net   = 0x0DCE731E6FE60000
```

### Sample 3: 100 TFUEL (Large)
```
gross = 100,000,000,000,000,000,000 wei = 100 TFUEL = 10^20
fee   = (10^20 * 50) / 10000 = 500,000,000,000,000,000 = 5*10^17
net   = 10^20 - 5*10^17 = 99,500,000,000,000,000,000

Hex values:
gross = 0x56BC75E2D63100000
fee   = 0x06F05B59D3B20000
net   = 0x54FEDC7E26B00000
```

## PowerShell Test Generation:
```powershell
function Get-FeeCalculation {
    param([uint64]$tfuel_amount)
    
    $gross = $tfuel_amount * 1000000000000000000
    $fee = [math]::Floor($gross * 50 / 10000)
    $net = $gross - $fee
    
    Write-Host "TFUEL: $tfuel_amount"
    Write-Host "Gross: $gross wei = 0x$([Convert]::ToString($gross, 16).PadLeft(16,'0'))"
    Write-Host "Fee:   $fee wei = 0x$([Convert]::ToString($fee, 16).PadLeft(16,'0'))"
    Write-Host "Net:   $net wei = 0x$([Convert]::ToString($net, 16).PadLeft(16,'0'))"
}

Get-FeeCalculation 0.01
Get-FeeCalculation 1
Get-FeeCalculation 100
```
