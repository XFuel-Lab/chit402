# 🔒 Keplr Wallet Security Checklist

## IMMEDIATE ACTIONS:

### 1. Review Connected Sites
1. Open Keplr extension
2. Click the hamburger menu (☰) → Settings
3. Click "Security & Privacy"
4. Scroll to "Manage Connected Sites"
5. **REMOVE ANY you don't recognize**
6. Especially look for:
   - Airdrop sites
   - Unknown DeFi protocols
   - Sites with random names
   - Anything related to the link you clicked

### 2. Check Address Book
1. In Keplr → Address Book
2. Remove any addresses you don't recognize
3. Specifically check if `persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt` is there
4. If it is → DELETE IT and tell me how it got there

### 3. Transaction History Review
1. Go to: https://www.mintscan.io/persistence/account/persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
2. Click "Transactions" tab
3. Review EVERY transaction from Dec 2025 - Present
4. Check for:
   - Unauthorized sends
   - Unknown delegations
   - Contract executions you didn't do
   - Pattern of transfers to same address

### 4. Check for Malicious Approvals
Unfortunately, Persistence doesn't have easy contract approval checking like Ethereum.
But you should check:
1. Any IBC transfers you didn't initiate
2. Any "Execute Contract" transactions you don't recognize

---

## IF YOU LOST SIGNIFICANT FUNDS:

### Option 1: Monitor & Secure Remaining Funds
- Transfer remaining funds to NEW wallet immediately
- Keep old wallet for monitoring only
- Don't import new wallet on same browser yet (wait for Malwarebytes)

### Option 2: Create Entirely New Wallet (RECOMMENDED)
**If you suspect mnemonic was compromised:**

1. **WAIT for Malwarebytes to finish** (very important!)
2. After Malwarebytes clears:
   - Create NEW Keplr wallet (new mnemonic)
   - Write mnemonic on PAPER only (not digital)
   - Transfer all funds from old wallet to new wallet
   - Never use old wallet again

---

## ABOUT THAT SUSPICIOUS LINK:

**You MUST tell me:**
1. What was the website URL/domain?
2. What did it claim to offer? (airdrop, update, rewards?)
3. Did you:
   - Connect Keplr wallet?
   - Sign any transactions?
   - Enter your seed phrase anywhere?
   - Download anything?
4. Where did you see the link? (Twitter, Discord, Telegram, Email?)

This information is CRITICAL to determine if you need to create new wallet.

---

## UNDERSTANDING THE ATTACK VECTORS:

### Scenario A: Phishing Site (Most Common)
- You clicked link → fake site looks real
- Asked you to "connect wallet" or "claim airdrop"
- You approved transaction thinking it was legit
- Transaction sent funds to attacker

**What to do:** Check transaction details, new wallet if significant loss

### Scenario B: Seed Phrase Compromise
- Site asked for your 12/24 word seed phrase
- You entered it thinking it was legitimate
- Attacker now has full control forever

**What to do:** Create NEW wallet IMMEDIATELY, transfer all funds

### Scenario C: Clipboard Hijacker
- Malware changes addresses when you copy/paste
- You thought you sent to yourself, but went to attacker
- Usually needs malware installation

**What to do:** Check Malwarebytes results, test clipboard

### Scenario D: Browser Extension Trojan
- Fake Keplr extension (we ruled this out - yours is official)
- Or compromised legitimate extension

**What to do:** Already verified - your extension is official

---

## CLIPBOARD TEST (Do This Now):

1. Copy this address: persistence1test123example456789
2. Paste it in Notepad
3. Does it EXACTLY match?
   - ✅ YES → Clipboard safe
   - ❌ NO → CLIPBOARD HIJACKER PRESENT

If it doesn't match → **Severe malware, wait for Malwarebytes**

---

## NEXT STEPS PRIORITY:

**Priority 1 (NOW):**
- [ ] Check transaction on Mintscan (amount, type)
- [ ] Check wallet balance on Mintscan
- [ ] Do clipboard test above

**Priority 2 (While Malwarebytes runs):**
- [ ] Review Keplr connected sites
- [ ] Review transaction history on Mintscan
- [ ] Tell me about the suspicious link

**Priority 3 (After Malwarebytes completes):**
- [ ] Review Malwarebytes results
- [ ] Decide: Keep wallet or create new one
- [ ] Transfer funds if needed
- [ ] Enable 2FA on any exchanges

---

## WHAT MALWAREBYTES WILL TELL US:

When it finishes, it will show:
- Number of threats found
- Types of malware (if any)
- Quarantined items

**If it finds threats:**
- Crypto stealer → Create new wallet ASAP
- Clipboard hijacker → Very dangerous
- Adware/PUPs → Less critical but clean anyway

**If it finds nothing:**
- Good news for malware
- But doesn't rule out phishing attack
- Still need to check transaction details

---

**Created:** January 12, 2026  
**Status:** Security audit in progress
