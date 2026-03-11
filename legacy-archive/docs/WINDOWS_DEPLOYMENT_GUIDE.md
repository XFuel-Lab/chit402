# 🚀 XFuel Mainnet Beta - Windows PowerShell Commands

**For Windows users running PowerShell**

---

## Step 1: Set Environment Variable (PowerShell Syntax)

```powershell
# Set private key (PowerShell)
$env:THETA_MAINNET_PRIVATE_KEY = "your_private_key_here"

# Verify it's set
$env:THETA_MAINNET_PRIVATE_KEY
```

---

## Step 2: Deploy Smart Contracts

```powershell
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Deploy to Theta Mainnet (use PowerShell script)
.\scripts\deploy-mainnet.ps1
```

**Alternative (if script doesn't work):**
```powershell
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet
```

---

## Step 3: Deploy Web UI

```powershell
# Update .env with contract addresses
@"
VITE_ROUTER_ADDRESS=0x1234...
VITE_NETWORK=mainnet
VITE_API_URL=https://api.xfuel.io
"@ | Out-File -FilePath .env -Encoding utf8

# Test locally
npm run dev

# Build for production
npm run build

# Deploy to Vercel (two separate commands in PowerShell)
npm run build
vercel --prod
```

---

## Step 4: Deploy Mobile UI

```powershell
# Navigate to mobile directory
cd edgefarm-mobile

# Install dependencies
npm install

# Login to EAS
eas login

# Build mainnet version
eas build --profile mainnet --platform all
```

---

## Common PowerShell Commands

### Setting Environment Variables
```powershell
# Set variable (current session)
$env:VARIABLE_NAME = "value"

# Set variable (permanent, current user)
[System.Environment]::SetEnvironmentVariable('VARIABLE_NAME', 'value', 'User')

# View variable
$env:VARIABLE_NAME

# Remove variable
Remove-Item Env:\VARIABLE_NAME
```

### Running Multiple Commands
```powershell
# Option 1: Separate lines
npm run build
vercel --prod

# Option 2: Semicolon separator
npm run build; vercel --prod

# Option 3: Check exit code
npm run build
if ($LASTEXITCODE -eq 0) { vercel --prod }
```

### Running Scripts
```powershell
# PowerShell script (.ps1)
.\scripts\deploy-mainnet.ps1

# Bash script (requires Git Bash or WSL)
bash scripts/deploy-mainnet.sh

# Node script
node scripts/deploy-mainnet-beta.ts
```

---

## Troubleshooting

### "Execution Policy" Error

If you get an error about execution policy:

```powershell
# Check current policy
Get-ExecutionPolicy

# Allow scripts (run as Administrator)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or run script with bypass (one-time)
PowerShell -ExecutionPolicy Bypass -File .\scripts\deploy-mainnet.ps1
```

### "export" Command Not Found

PowerShell doesn't use `export`. Use `$env:` instead:

```bash
# ❌ Bash syntax (doesn't work)
export VARIABLE="value"

# ✅ PowerShell syntax
$env:VARIABLE = "value"
```

### "&&" Not Valid Statement Separator

PowerShell doesn't use `&&`. Use `;` or separate lines:

```bash
# ❌ Bash syntax (doesn't work)
npm run build && vercel --prod

# ✅ PowerShell syntax - Option 1
npm run build; vercel --prod

# ✅ PowerShell syntax - Option 2
npm run build
vercel --prod

# ✅ PowerShell syntax - Option 3 (check exit code)
npm run build; if ($LASTEXITCODE -eq 0) { vercel --prod }
```

### Running Bash Scripts on Windows

**Option 1: Git Bash**
```bash
# Open Git Bash (if installed)
bash scripts/deploy-mainnet.sh
```

**Option 2: WSL (Windows Subsystem for Linux)**
```bash
# Open WSL terminal
wsl bash scripts/deploy-mainnet.sh
```

**Option 3: Use PowerShell script instead**
```powershell
.\scripts\deploy-mainnet.ps1
```

---

## Quick Deployment (Copy-Paste)

```powershell
# 1. Set private key
$env:THETA_MAINNET_PRIVATE_KEY = "YOUR_ACTUAL_PRIVATE_KEY_HERE"

# 2. Install and compile
npm install
npx hardhat compile

# 3. Deploy contracts
.\scripts\deploy-mainnet.ps1

# 4. Update .env (replace with actual addresses)
@"
VITE_ROUTER_ADDRESS=0xYOUR_DEPLOYED_ADDRESS
VITE_NETWORK=mainnet
"@ | Out-File -FilePath .env -Encoding utf8

# 5. Build and deploy web
npm run build
vercel --prod

# 6. Deploy mobile (optional)
cd edgefarm-mobile
eas build --profile mainnet --platform all
```

---

## Alternative: Use Git Bash

If you have Git installed, you can use Git Bash for Unix-like commands:

```bash
# Open Git Bash
# Then use the regular Linux commands:
export THETA_MAINNET_PRIVATE_KEY="your_key"
./scripts/deploy-mainnet.sh
npm run build && vercel --prod
```

---

## WSL (Recommended for Linux Commands)

If you frequently need Linux commands, consider installing WSL:

```powershell
# Install WSL (run as Administrator)
wsl --install

# Restart computer, then:
wsl
# Now you have a full Linux terminal in Windows!
```

---

Last Updated: December 26, 2025

