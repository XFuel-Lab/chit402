# 🎭 XFuel Reverse Bridge - Mock Testing Configuration

**Status:** Mock deployment for full circuit testing  
**Target:** Persistence Mainnet (governance approval pending)  
**Generated:** February 5, 2026

---

## 📋 Mock Contract Addresses

### Persistence Contracts (Mock)
```bash
# Minter Contract
PERSISTENCE_MINTER_CONTRACT=persistence1e7waerpss8nvyhyd867arhq87ul3r2v04wf74t
MINTER_CODE_ID=999

# Fee Collector Contract  
FEE_COLLECTOR_CONTRACT=persistence1mz7w83z5askmndvp09r0wd0hd80hrdc47d795k
FEE_COLLECTOR_CODE_ID=1000

# ZK Verifier Contract
ZK_VERIFIER_CONTRACT=persistence1xt85r46nggkn52fjstpj8m84nrc5j6w5ejnsdw
ZK_VERIFIER_CODE_ID=998

# Deployer & Admin
PERSISTENCE_DEPLOYER=persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
PERSISTENCE_MULTISIG=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
```

---

## ✅ What We Can Test Now

### 1. **Frontend Integration**
- ✅ Connect Keplr wallet to Persistence
- ✅ Display ibcTFUEL balance
- ✅ Execute `burn_for_unwrap` transaction
- ✅ Show transaction confirmation
- ✅ Display burn events

### 2. **Backend Event Listener**
- ✅ Monitor Persistence for BurnForUnwrap events
- ✅ Parse event data (burner, theta_recipient, amount, nonce)
- ✅ Queue for processing
- ✅ Call Theta unwrapFromBurn

### 3. **Theta Contract Integration**
- ✅ Call `unwrapFromBurn(recipient, amount)` on VaultFactory
- ✅ Verify TFUEL transfer to user
- ✅ Monitor transaction success

### 4. **End-to-End Flow**
- ✅ User burns ibcTFUEL on Persistence
- ✅ Backend detects event
- ✅ Backend calls Theta
- ✅ User receives TFUEL on Theta

---

## 🧪 Testing Workflow

### Phase 1: Mock Event Testing (Now)
```bash
# Create mock BurnForUnwrap event
# Test backend listener
# Verify Theta contract call
```

### Phase 2: Full Circuit Test (After real deployment)
```bash
# Real burn transaction on Persistence
# Real event detection
# Real Theta unwrap
```

---

## 🚀 Next Steps

**Immediate (Mock Testing):**
1. ✅ Generate mock addresses ← DONE
2. Update backend config with mock addresses
3. Create mock event simulator
4. Test backend listener + Theta integration
5. Test frontend with mock contract calls

**Future (Real Deployment):**
1. Submit governance proposal for code upload
2. Wait for approval
3. Deploy to mainnet
4. Update addresses in config
5. Re-test with real contracts

---

## 📝 Update Required Files

Add these mock addresses to:
- `backend/theta-bridge/.env`
- `.env.local`
- Frontend config files

**Would you like me to:**
- **A)** Update all config files with mock addresses?
- **B)** Create mock event simulator for testing?
- **C)** Test the backend listener with mock events?
- **D)** All of the above?

Tell me which to prioritize! 🎯
