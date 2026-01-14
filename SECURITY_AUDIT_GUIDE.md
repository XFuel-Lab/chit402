# 🔒 EMERGENCY SECURITY AUDIT GUIDE
## XFuel Protocol - Potential Wallet Compromise Investigation

**Date:** January 12, 2026  
**Incident:** Suspicious transaction on Jan 4 + Clicked suspicious link on Jan 5  
**Status:** 🚨 HIGH PRIORITY - Potential Wallet Compromise

---

## ⚡ IMMEDIATE ACTIONS (Do These FIRST - Next 30 Minutes)

### 1. **Secure Your Crypto Assets NOW**

**A. Create NEW Keplr Wallet (Fresh Start):**
```
1. Open Keplr extension
2. Click profile icon → "Add Wallet"
3. Select "Create new wallet"
4. Save NEW mnemonic phrase (write on PAPER, not digital)
5. DO NOT import old wallet yet
```

**B. Transfer Remaining Funds (If Safe to Do So):**
```
1. Open OLD wallet in Keplr
2. Check balance on Persistence
3. If funds remain, transfer to NEW wallet address
4. Use https://www.mintscan.io/persistence to verify
```

⚠️ **WARNING:** If malware is keylogging, wait until Step 2 (malware removal) is complete before creating new wallet.

---

## 🔍 STEP 2: MALWARE DETECTION (Next 60 Minutes)

### A. Windows Defender Full Scan

**Run Offline Scan (Strongest Protection):**
```powershell
# Method 1: Via Settings
# 1. Open Windows Security
# 2. Virus & threat protection → Scan options
# 3. Select "Microsoft Defender Offline scan"
# 4. Click "Scan now" (PC will restart)

# Method 2: Via PowerShell (Run as Administrator)
Start-MpWDOScan
```

**Run Quick Scan While Waiting:**
```powershell
# Open PowerShell as Administrator
Start-MpScan -ScanType QuickScan

# Check last scan results
Get-MpThreatDetection | Select-Object -First 10
```

### B. Malwarebytes (FREE - Highly Recommended)

**Download & Run:**
```
1. Go to: https://www.malwarebytes.com/mwb-download
2. Download FREE version
3. Install and run FULL SCAN
4. Let it quarantine any threats found
5. Restart computer after scan
```

**Expected Scan Time:** 30-60 minutes for full system scan

### C. Check for Crypto-Specific Malware

**Crypto Wallet Stealers to Look For:**
```
Common names:
- Redline Stealer
- Mars Stealer
- Vidar
- Raccoon Stealer
- Coinminer malware
- Clipboard hijackers (change wallet addresses when you copy/paste)
```

**Manual Check - Browser Extensions:**
```
Chrome/Edge/Brave:
1. Open browser
2. Go to: chrome://extensions (or edge://extensions)
3. Review ALL extensions
4. Remove ANY you don't recognize
5. Especially suspicious: "PDF readers", "Coupon finders", "Video downloaders"
```

**Check Keplr Extension Specifically:**
```
1. Right-click Keplr extension icon
2. Click "Manage extension"
3. Verify:
   - Extension ID matches official: dmkamcknogkgcdfhhbddcghachkejeap
   - Version is latest
   - "Installed by" shows you installed it
4. If any doubt, REMOVE and reinstall from official source:
   https://chrome.google.com/webstore/detail/keplr/dmkamcknogkgcdfhhbddcghachkejeap
```

### D. Check for Keyloggers

**Windows Event Viewer Check:**
```powershell
# Open Event Viewer
eventvwr.msc

# Check for suspicious processes:
# 1. Windows Logs → Security
# 2. Look for "Logon Type 10" (remote interactive)
# 3. Check for unfamiliar user accounts
```

**Task Manager Process Check:**
```
1. Press Ctrl+Shift+Esc
2. Click "More details"
3. Go to "Details" tab
4. Sort by "Name"
5. Look for suspicious processes:
   - Random letters/numbers (e.g., "xjk2892.exe")
   - Processes using high CPU/Network
   - Unfamiliar .exe files in Temp folders
6. Right-click suspicious → "Open file location"
7. If in %TEMP% or %APPDATA% → likely malware
```

### E. Network Connection Audit

**Check for Suspicious Outbound Connections:**
```powershell
# Run PowerShell as Administrator
netstat -ano | findstr ESTABLISHED

# Look for connections to:
# - Unknown foreign IPs
# - Ports: 4444, 5555, 6666 (common backdoors)
# - High data transfer

# Check which process owns suspicious connection:
tasklist /FI "PID eq [PID_NUMBER]"
```

---

## 🧹 STEP 3: ADVANCED MALWARE REMOVAL (If Threats Found)

### A. Safe Mode Boot

**Boot to Safe Mode with Networking:**
```
1. Press Win+R
2. Type: msconfig
3. Boot tab → Check "Safe boot" → Select "Network"
4. Click OK → Restart
5. Re-run malware scans in Safe Mode
```

### B. Additional Tools (Use If Malwarebytes Didn't Find Everything)

**Kaspersky Virus Removal Tool (FREE):**
```
Download: https://www.kaspersky.com/downloads/free-virus-removal-tool
- No installation required
- Run full scan
- Excellent at finding crypto malware
```

**HitmanPro (FREE 30-day trial):**
```
Download: https://www.hitmanpro.com/en-us/downloads
- Behavioral analysis
- Cloud-based detection
- Catches what others miss
```

**AdwCleaner (FREE - For Adware/PUPs):**
```
Download: https://www.malwarebytes.com/adwcleaner
- Removes browser hijackers
- Cleans registry
- Fast scan (5-10 mins)
```

### C. Check Startup Programs

**Disable Suspicious Startup Items:**
```powershell
# Open Task Manager → Startup tab
# Or use PowerShell:
Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location

# Disable suspicious entries:
# 1. Task Manager → Startup
# 2. Right-click unknown programs → Disable
# 3. Research any unfamiliar names before disabling
```

---

## 🔐 STEP 4: WALLET SECURITY AUDIT

### A. Check Keplr Wallet Security

**Verify No Unauthorized Access:**
```
1. Open Keplr
2. Settings → Security & Privacy
3. Check "Connected Sites"
4. Remove ANY unfamiliar sites
5. Check "Address Book" - remove unknown addresses
```

**Export Transaction History:**
```
1. Go to: https://www.mintscan.io/persistence/account/persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
2. Export full transaction history (CSV)
3. Review EVERY transaction from Dec 2025 - Present
4. Flag any you don't recognize
```

### B. Check Browser Cache & History

**Review Browsing History Around Incident:**
```
Chrome/Edge:
1. Press Ctrl+H
2. Filter by: January 4-5, 2026
3. Look for:
   - Phishing sites (fake Keplr, fake exchanges)
   - Airdrop scam sites
   - Sites claiming "Connect wallet for rewards"
   - Any .onion sites
   - File download sites
```

**Clear Browser Cache (After Review):**
```
1. Settings → Privacy and security
2. Clear browsing data
3. Select: All time
4. Check ALL boxes
5. Clear data
```

### C. Check for Clipboard Hijacker

**Test Clipboard Behavior:**
```
1. Copy a Persistence address: persistence1test123example
2. Paste into Notepad
3. Verify it EXACTLY matches what you copied
4. If it changes to different address → CLIPBOARD HIJACKER PRESENT
```

**If Hijacker Found:**
```powershell
# Kill all clipboard processes
Get-Process | Where-Object {$_.MainWindowTitle -like "*clipboard*"} | Stop-Process -Force

# Run full antivirus scan again
```

---

## 📊 STEP 5: FORENSIC ANALYSIS (Determine Attack Vector)

### A. Check Downloaded Files (Last 30 Days)

**Review Downloads Folder:**
```powershell
# List recent downloads
Get-ChildItem -Path "$env:USERPROFILE\Downloads" -Recurse | 
  Where-Object {$_.LastWriteTime -gt (Get-Date).AddDays(-30)} | 
  Sort-Object LastWriteTime -Descending |
  Format-Table Name, LastWriteTime, Length

# Look for suspicious files:
# - .exe files you don't recognize
# - .scr (screensaver - often malware)
# - .bat, .cmd, .vbs scripts
# - .pdf.exe (fake PDF)
# - Files from Jan 4-5 specifically
```

### B. PowerShell History Check

**Check for Malicious Commands:**
```powershell
# View PowerShell command history
Get-Content (Get-PSReadlineOption).HistorySavePath

# Look for:
# - Wget/Invoke-WebRequest (downloading files)
# - Base64 encoded commands
# - Commands you didn't run
```

### C. Windows Temp Folder Analysis

**Check Temp Folders for Malware Remnants:**
```powershell
# Windows Temp
Get-ChildItem -Path "C:\Windows\Temp" -Recurse | 
  Where-Object {$_.LastWriteTime -gt (Get-Date "2026-01-04")} |
  Sort-Object LastWriteTime

# User Temp
Get-ChildItem -Path "$env:TEMP" -Recurse |
  Where-Object {$_.LastWriteTime -gt (Get-Date "2026-01-04")} |
  Sort-Object LastWriteTime
```

---

## 🛡️ STEP 6: PREVENTION & HARDENING (After Cleanup)

### A. Reinstall Keplr (Fresh Copy)

**Complete Reinstall:**
```
1. Remove Keplr extension
2. Clear browser cache
3. Restart browser
4. Reinstall from OFFICIAL source ONLY:
   https://chrome.google.com/webstore/detail/keplr/dmkamcknogkgcdfhhbddcghachkejeap
5. Import wallet with NEW mnemonic (from Step 1)
6. DO NOT import compromised wallet
```

### B. Update All Software

**Critical Updates:**
```
1. Windows Update:
   - Settings → Update & Security
   - Check for updates
   - Install ALL updates

2. Browser Update:
   - Settings → About
   - Update to latest version

3. Antivirus Definitions:
   - Update Windows Defender
   - Update Malwarebytes
```

### C. Enable Advanced Security

**Windows Security Hardening:**
```
1. Windows Security → App & browser control
2. Turn ON:
   - Reputation-based protection
   - Check apps and files
   - SmartScreen for Microsoft Edge
   - SmartScreen for Microsoft Store apps

3. Firewall:
   - Turn ON Windows Firewall
   - Block all incoming connections
```

**Browser Security:**
```
Chrome/Edge Settings → Privacy and security:
1. Enable "Safe Browsing" (Enhanced)
2. Enable "Use secure DNS"
3. Set to: Cloudflare (1.1.1.1) or Google (8.8.8.8)
4. Disable "Allow sites to check if you have payment methods saved"
```

### D. Create System Restore Point

**Backup Clean State:**
```
1. Search: "Create a restore point"
2. System Protection → Create
3. Name: "After Malware Cleanup - Jan 12 2026"
4. Create
```

---

## 📋 INCIDENT REPORT CHECKLIST

### What You Need to Document:

- [ ] Suspicious transaction details
  - TX Hash: 9D7972CFFFD832827096BCE2239624EFD9F3AB6EC6CE0B1D65E39D9CB4A84493
  - Amount sent: _____________
  - Receiving address: persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt
  - Date/Time: January 4, 2026, _____:_____ UTC

- [ ] Suspicious link clicked
  - URL: _________________________________
  - Date: January 5, 2026
  - What happened after clicking? _________________________________

- [ ] Malware scan results
  - Windows Defender: Clean / Threats Found: _____________
  - Malwarebytes: Clean / Threats Found: _____________
  - Other tools: _________________________________

- [ ] Browser extension audit
  - Removed extensions: _________________________________
  - Keplr reinstalled: Yes / No
  - Version verified: Yes / No

- [ ] Wallet status
  - Funds remaining in old wallet: _____________
  - Funds transferred to new wallet: _____________
  - New wallet created: Yes / No
  - Old wallet deactivated: Yes / No

---

## 🚨 IF YOU FIND MALWARE - NEXT STEPS

### Scenario 1: Malware Found & Removed Successfully

```
✅ ACTION PLAN:
1. ✅ Malware removed
2. ✅ Create NEW Keplr wallet
3. ✅ Transfer remaining funds to new wallet
4. ✅ Update all passwords (email, exchanges, etc.)
5. ✅ Enable 2FA on all crypto accounts
6. ✅ Monitor old wallet address for 30 days
7. ✅ Report to Persistence One if large amount lost
```

### Scenario 2: Cannot Remove Malware / Persistent Infection

```
🔴 NUCLEAR OPTION - Clean OS Reinstall:
1. Backup important files (NOT crypto wallets/keys)
2. Create Windows USB installer
3. Boot from USB
4. Format drive and reinstall Windows
5. Install antivirus FIRST before browsing
6. Restore files after full scan
7. Create new crypto wallets on clean system
```

### Scenario 3: No Malware Found (False Alarm?)

```
🤔 POSSIBLE EXPLANATIONS:
1. Malware already removed itself (stealth)
2. Attack was social engineering (you manually sent funds?)
3. Malware is on different device (phone?)
4. Someone else had physical access to your computer

NEXT STEPS:
1. Check all devices you use for crypto
2. Review who had access on Jan 4-5
3. Check if you approved transaction yourself (drugged, drunk, tired?)
4. Consider hardware wallet for future (Ledger, Trezor)
```

---

## 🔗 USEFUL RESOURCES

### Malware Removal Tools (All Free)
- **Malwarebytes:** https://www.malwarebytes.com
- **Kaspersky KVRT:** https://www.kaspersky.com/downloads/free-virus-removal-tool
- **HitmanPro:** https://www.hitmanpro.com
- **AdwCleaner:** https://www.malwarebytes.com/adwcleaner

### Crypto Security
- **Keplr Official:** https://www.keplr.app
- **Persistence Explorer:** https://www.mintscan.io/persistence
- **Report Scams:** https://www.reddit.com/r/CryptoCurrency/wiki/scams

### Windows Security
- **Microsoft Defender:** https://www.microsoft.com/en-us/windows/comprehensive-security
- **Windows Security Guide:** https://support.microsoft.com/en-us/windows/stay-protected-with-windows-security-2ae0363d-0ada-c064-8b56-6a39afb6a963

---

## 📞 GET HELP

### If You Need Expert Assistance:

**Reddit Communities:**
- r/techsupport
- r/antivirus
- r/cryptocurrency (for wallet issues)

**Discord Servers:**
- Persistence One Official Discord
- Keplr Support

**Professional Services:**
- Local computer repair shop (for severe infections)
- Cybersecurity incident response firms (for large fund loss)

---

## ⚖️ LEGAL CONSIDERATIONS

### If Significant Funds Were Stolen:

1. **Document Everything:**
   - Screenshots of malware scans
   - Transaction records
   - Timeline of events
   - Suspicious link URL

2. **Report to Authorities:**
   - Local police (for record)
   - FBI IC3 (if USA): https://www.ic3.gov
   - Action Fraud (if UK): https://www.actionfraud.police.uk

3. **Tax Implications:**
   - Theft losses may be deductible
   - Consult tax professional
   - Keep all documentation

---

**Generated:** January 12, 2026  
**Status:** 🚨 ACTIVE SECURITY INCIDENT  
**Priority:** CRITICAL

---

## 🎯 QUICK START (If You're Overwhelmed)

**Do these 5 things RIGHT NOW (15 minutes):**

1. **Run Quick Scan:**
   ```powershell
   # Open PowerShell as Admin
   Start-MpScan -ScanType QuickScan
   ```

2. **Check Browser Extensions:**
   - Remove any you don't recognize
   - Verify Keplr is legitimate

3. **Change Keplr Password:**
   - Settings → Security → Change Password

4. **Check Transaction on Explorer:**
   - https://www.mintscan.io/persistence/tx/9D7972CFFFD832827096BCE2239624EFD9F3AB6EC6CE0B1D65E39D9CB4A84493

5. **Download Malwarebytes:**
   - Install and run FULL SCAN overnight

**Then continue with full guide above tomorrow.**

---

Stay safe! 🔒


