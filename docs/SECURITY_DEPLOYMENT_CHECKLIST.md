# 🔐 XFuel Protocol - Security Checklist for Deployment

## ⚠️ CRITICAL: Private Key Security

**GOLDEN RULE:** Private keys are for **deployment only**, NEVER for frontend.

---

## 🔑 What's Private vs Public

### 🔒 PRIVATE (Never Commit, Never Share)
```
THETA_MAINNET_PRIVATE_KEY=0xabc123...
PRIVATE_KEY=0xdef456...
MNEMONIC="word word word..."
```

**Used for:** Contract deployment, transaction signing (backend only)  
**Storage:** Local environment variable, hardware wallet, or secure vault  
**Git:** Must be in `.gitignore`

### 🌐 PUBLIC (Safe to Commit)
```
VITE_ROUTER_ADDRESS=0x1234567890abcdef...
VITE_NETWORK=mainnet
VITE_WALLETCONNECT_PROJECT_ID=abc123...
```

**Used for:** Frontend configuration, connecting to deployed contracts  
**Storage:** `.env` file, Vercel environment variables  
**Git:** Safe to commit (users can see these in browser anyway)

---

## ✅ Pre-Deployment Security Checklist

### 1. Verify `.gitignore` Protection
```powershell
# Check .gitignore includes these lines:
Get-Content .gitignore | Select-String "\.env"

# Should show:
# .env
# .env.local
# .env.production
# *.local
```

✅ **Your repo is already protected!**

### 2. Use Separate Deployment Wallet
```
❌ DON'T: Use your main wallet with all your funds
✅ DO: Create a new wallet just for deployment
```

**Steps:**
1. Create new Theta wallet
2. Fund with ~100 TFUEL (just enough for gas)
3. Use this wallet's private key for deployment
4. After deployment, transfer ownership to multisig if needed

### 3. Check for Leaked Keys in Git History
```powershell
# Scan git history for potential leaks
git log --all --full-history --source -- .env
git log --all --full-history --source -- .env.local
```

If you find leaked keys:
1. **Immediately** transfer funds out of that wallet
2. Use `git-filter-branch` or BFG Repo-Cleaner to remove from history
3. Generate new keys

---

## 🚀 Secure Deployment Process

### Method 1: Secure Script (Recommended)
```powershell
# Run the secure deployment script
.\scripts\deploy-mainnet-secure.ps1

# It will:
# 1. Prompt for private key (hidden input)
# 2. Use key only in memory (not saved)
# 3. Deploy contracts
# 4. Clear key from memory
# 5. Show you the PUBLIC addresses to add to .env
```

### Method 2: Session Environment Variable
```powershell
# Set private key in current session only
$env:THETA_MAINNET_PRIVATE_KEY = "0xYOUR_PRIVATE_KEY"

# Deploy
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet

# Clear after deployment
$env:THETA_MAINNET_PRIVATE_KEY = $null
```

### Method 3: Hardware Wallet (Most Secure)
```powershell
# Configure hardhat to use Ledger/Trezor
# See: https://hardhat.org/hardhat-runner/docs/guides/deploying

# Update hardhat.config.cjs:
# networks: {
#   'theta-mainnet': {
#     url: '...',
#     ledgerAccounts: ['0xYOUR_LEDGER_ADDRESS']
#   }
# }
```

---

## 📝 Post-Deployment: Frontend Configuration

### After contracts are deployed, create `.env` file:

```powershell
# SAFE to commit - these are public contract addresses
@"
VITE_ROUTER_ADDRESS=0x1234567890abcdef1234567890abcdef12345678
VITE_NETWORK=mainnet
VITE_API_URL=https://api.xfuel.io
VITE_WALLETCONNECT_PROJECT_ID=your_public_project_id
"@ | Out-File -FilePath .env -Encoding utf8
```

**Why this is safe:**
- `VITE_*` variables are injected into frontend bundle
- Users can see them in browser DevTools anyway
- Contract addresses are public on blockchain explorer
- No sensitive data exposed

---

## 🛡️ Vercel Deployment Security

### Setting Environment Variables in Vercel

**For Vercel deployment:**

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables

2. Add **ONLY** the public variables:
   ```
   VITE_ROUTER_ADDRESS = 0x...
   VITE_NETWORK = mainnet
   VITE_API_URL = https://api.xfuel.io
   ```

3. **NEVER** add `THETA_MAINNET_PRIVATE_KEY` to Vercel!
   - Vercel env vars are for build/runtime
   - Private key is ONLY for deployment (which you do locally)

---

## ❌ Common Security Mistakes

### 1. Private Key in `.env` (and accidentally committing)
```bash
❌ BAD: 
.env:
  THETA_MAINNET_PRIVATE_KEY=0xabc123...
  VITE_ROUTER_ADDRESS=0xdef456...

# Then: git add .env  <- DISASTER!
```

**Fix:** Use `.env.local` for secrets (auto-ignored)

### 2. Using `VITE_` prefix for private keys
```bash
❌ BAD:
VITE_PRIVATE_KEY=0xabc123...  # Exposed to browser!

✅ GOOD:
PRIVATE_KEY=0xabc123...  # Not exposed (but still don't commit)
```

### 3. Hardcoding Private Keys
```typescript
❌ BAD:
const privateKey = "0xabc123..."  // In source code!
```

### 4. Sharing Private Keys in Chat
```bash
❌ BAD: "Hey team, deployment key is 0xabc123..."
```

---

## 🔍 Security Audit Checklist

Before going live, verify:

- [ ] `.gitignore` includes `.env*` and `*.local`
- [ ] No private keys in git history (`git log --all -S "0x"`)
- [ ] Deployment wallet is separate from main funds
- [ ] Private key never stored in frontend code
- [ ] Private key never stored in Vercel env vars
- [ ] `.env` file only has `VITE_*` variables (public)
- [ ] All `.env.local` files are in `.gitignore`
- [ ] Team knows: private keys = backend/deployment only
- [ ] Hardware wallet used for production (recommended)
- [ ] Ownership transferred to multisig after deployment

---

## 🚨 If Private Key is Compromised

**Immediate Actions:**

1. **Transfer all funds** out of compromised wallet
2. **Deploy new contracts** from new wallet
3. **Update frontend** with new contract addresses
4. **Revoke access** to old contracts (call `transferOwnership`)
5. **Notify users** if funds at risk
6. **Remove key** from git history:
   ```powershell
   # Use BFG Repo-Cleaner
   java -jar bfg.jar --replace-text passwords.txt
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```

---

## 📚 Additional Resources

- [Hardhat Security Best Practices](https://hardhat.org/hardhat-runner/docs/guides/security)
- [Ethereum Private Key Security](https://ethereum.org/en/developers/docs/accounts/)
- [Git Secrets Scanner](https://github.com/awslabs/git-secrets)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

---

## ✅ Summary

**For Deployment (Backend):**
```powershell
# Option 1: Session variable (most secure)
$env:THETA_MAINNET_PRIVATE_KEY = "0x..."
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet
$env:THETA_MAINNET_PRIVATE_KEY = $null

# Option 2: Secure script (prompts for key)
.\scripts\deploy-mainnet-secure.ps1
```

**For Frontend (Public):**
```powershell
# .env file (safe to commit)
@"
VITE_ROUTER_ADDRESS=0xDEPLOYED_ADDRESS
VITE_NETWORK=mainnet
"@ | Out-File -FilePath .env -Encoding utf8
```

**Remember:**
- Private key = Deployment only (backend, local)
- Contract addresses = Frontend config (public, safe)
- Never mix the two!

---

Last Updated: December 26, 2025

