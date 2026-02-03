# 🚀 XFuel Mainnet Deployment - For Beginners

**Welcome!** This guide will help you deploy XFuel to mainnet in 3 minutes.

---

## ⚡ Quick Deploy (Automated)

Just run this **one command**:

```powershell
.\deploy.ps1
```

That's it! The script will:
1. ✅ Ask for your private key (securely)
2. ✅ Verify your wallet
3. ✅ Deploy contracts to Theta Mainnet
4. ✅ Clean up automatically
5. ✅ Show you next steps

---

## 📋 Before You Start

**You need:**
1. Theta wallet with **100+ TFUEL** (for gas)
2. Your wallet's **private key**
3. That's it!

**Where to get your private key:**
- Theta Wallet: Settings → Export Private Key
- MetaMask: Account Details → Export Private Key

---

## 🎯 Step-by-Step

### Step 1: Open PowerShell

```powershell
# Navigate to project folder
cd C:\Users\YourName\xfuel-protocol
```

### Step 2: Run Deploy Script

```powershell
.\deploy.ps1
```

### Step 3: Follow Prompts

The script will ask:
1. **Paste your private key** (starts with 0x)
2. **Type 'DEPLOY'** to confirm

Then wait 2-3 minutes while it deploys!

---

## 🎉 After Deployment

### The script will show contract addresses like:

```
RevenueSplitter deployed to: 0x1234567890abcdef...
BuybackBurner deployed to: 0x5678901234abcdef...
```

### Copy those addresses and run:

```powershell
@"
VITE_ROUTER_ADDRESS=0x1234567890abcdef
VITE_NETWORK=mainnet
VITE_API_URL=https://api.xfuel.io
"@ | Out-File -FilePath .env -Encoding utf8
```

### Then deploy frontend:

```powershell
npm run build
vercel --prod
```

---

## 🆘 Troubleshooting

### "No private key entered"
→ Make sure you paste the full key (starts with 0x, 66 characters)

### "Could not verify wallet"
→ Check your private key is correct
→ Make sure wallet has 100+ TFUEL

### "Deployment failed"
→ Check internet connection
→ Try again (script is safe to re-run)

### Need help?
→ Discord: #mainnet-beta
→ GitHub Issues: https://github.com/XFuel-Lab/xfuel-protocol/issues

---

## 🔒 Security

**Your private key is:**
- ✅ Only used for deployment
- ✅ Stored in .env.local (git-ignored)
- ✅ Automatically deleted after deployment
- ✅ Never sent to any server

**The script:**
- ✅ Runs locally on your computer
- ✅ Only talks to Theta blockchain
- ✅ Open source (you can read the code)

---

## 📺 Video Tutorial

Coming soon! For now, just run `.\deploy.ps1` and follow prompts.

---

## ✅ Checklist

- [ ] Have 100+ TFUEL in wallet
- [ ] Have private key ready
- [ ] Run `.\deploy.ps1`
- [ ] Follow prompts
- [ ] Copy contract addresses
- [ ] Create .env file
- [ ] Deploy to Vercel
- [ ] Test on mainnet!

---

**Questions?** Ask in Discord: #mainnet-beta

**Ready?** Run: `.\deploy.ps1` 🚀

