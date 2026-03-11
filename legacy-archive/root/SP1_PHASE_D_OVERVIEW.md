# 🚀 SP1 PHASE D - Mainnet Testing & Launch

**Status:** Ready to Begin (Blocked by Governance Approval)  
**Date:** January 27, 2026  
**Prerequisites:** Phase C Complete ✅  

---

## 📋 Executive Summary

**Phase D** focuses on **mainnet deployment, live testing, and production launch** of the xfuel-protocol TFUEL-to-Persistence bridge. This phase begins after governance approval and includes contract deployment, small-scale testing, monitoring, and gradual rollout to users.

### Phase D Objectives
1. ✅ Deploy ZKVerifier + Minter contracts to Persistence mainnet
2. ✅ Configure backend for live minting (whitelisting enabled)
3. ✅ Test end-to-end flow with small deposits (0.1-1 TFUEL)
4. ✅ Monitor receipts, logs, and gas costs
5. ✅ Gradual public rollout (Discord/Twitter announcement)
6. ✅ Prepare for Phase E (Certik audit)

**Duration Estimate:** 7-14 days (governance vote) + 3-7 days (deployment & testing)

---

## 🔐 Prerequisites & Blockers

### ✅ Phase C Complete (All Done)
- [x] Governance proposal drafted (`docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md`)
- [x] Deployment script ready (`scripts/deploy-persistence.sh`)
- [x] Backend updated for live minting (`src/listener.js`, `src/config.js`)
- [x] Security incident remediated (Git history cleaned, AWS rotated)

### ⏳ Governance Approval (BLOCKING PHASE D)
- [ ] Submit proposal to https://forum.persistence.one
- [ ] Community discussion (3-7 days)
- [ ] Voting period (7-14 days)
- [ ] Proposal passes with YES majority

**Cannot proceed until governance approval obtained!**

---

## 🎯 Phase D Workflow

### **Step 1: Submit Governance Proposal** ⏳ (Day 0)

**Action:** Post `PERSISTENCE_WHITELIST_PROPOSAL.md` to forum

**Platform:** https://forum.persistence.one  
**Category:** Governance → Smart Contract Whitelisting  
**Title:** "Proposal: Whitelist xfuel-protocol ZKVerifier for ibcTFUEL Bridge"

**Content:** Use full text from `docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md`

**Engage Community:**
- Monitor forum comments
- Answer technical questions
- Address concerns (security, audits, mint limits)
- Provide benchmarks/proof of Phase B success
- Reference similar successful proposals (Timewaves, pSTAKE)

**Timeline:** 7-14 days (typical Persistence voting period)

---

### **Step 2: Deploy to Mainnet** ✅ (Day 1 after approval)

**Action:** Run deployment script

**Prerequisites:**
```bash
# 1. Set deployer mnemonic
export PERSISTENCE_MNEMONIC="your mainnet deployer mnemonic here"

# 2. Verify balance (need 10+ XPRT for gas)
persistenceCore query bank balances $(persistenceCore keys show xfuel-deployer -a --keyring-backend test) \
  --node https://rpc.core.persistence.one:443 --chain-id core-1

# 3. Build optimized WASM contracts (if not already done)
cd cosmwasm-contracts/zk-verifier
cargo wasm && cargo run-script optimize
cd ../persistence-minter
cargo wasm && cargo run-script optimize
cd ../..

# 4. Run deployment script
./scripts/deploy-persistence.sh
```

**What the script does:**
1. ✅ Pre-flight checks (CLI, mnemonic, contract size, balance)
2. ✅ **Interactive governance approval confirmation** (prompts user to verify)
3. ✅ Stores ZKVerifier WASM (get code_id)
4. ✅ Stores Minter WASM (get code_id)
5. ✅ Instantiates ZKVerifier with admin + SP1 vkey
6. ✅ Instantiates Minter (ibcTFUEL) with ZKVerifier as authorized minter
7. ✅ Saves deployment info to JSON artifact
8. ✅ Auto-updates `.env` with contract addresses

**Expected Output:**
```
════════════════════════════════════════════
✅ DEPLOYMENT COMPLETE
════════════════════════════════════════════

Network: core-1
ZKVerifier: persistence1abc...xyz
ibcTFUEL Minter: persistence1def...uvw

Next Steps:
  1. Update backend/theta-bridge/.env with contract addresses (done)
  2. Set PERSISTENCE_WHITELIST_APPROVED=true in .env (done)
  3. Restart backend: cd backend/theta-bridge && npm run start
  4. Test with small deposit: 0.1 TFUEL
  5. Monitor logs for successful mint
```

**Deliverables:**
- ✅ ZKVerifier contract deployed
- ✅ Minter contract deployed
- ✅ Deployment artifact saved to `./deployment-artifacts/persistence-deployment-YYYYMMDD-HHMMSS.json`
- ✅ `.env` updated with contract addresses

**Troubleshooting:**
- If gas errors → increase `GAS_ADJUSTMENT` in script (default 1.5)
- If balance errors → fund deployer wallet with more XPRT
- If contract size errors → re-optimize WASM (should be <800KB)

---

### **Step 3: Configure Backend** ✅ (Day 1 after approval)

**Action:** Update `.env` and restart backend

**Environment Variables:**
```bash
# Persistence Mainnet Config
PERSISTENCE_RPC_URL=https://rpc.core.persistence.one:443
PERSISTENCE_CHAIN_ID=core-1
PERSISTENCE_ZK_VERIFIER_CONTRACT=persistence1abc...xyz  # FROM DEPLOYMENT
PERSISTENCE_MINTER_CONTRACT=persistence1def...uvw       # FROM DEPLOYMENT
PERSISTENCE_WHITELIST_APPROVED=true                     # ENABLE LIVE MINTING
PERSISTENCE_MNEMONIC="backend relayer mnemonic here"    # 24-word phrase
PERSISTENCE_GAS_PRICE=0.025uxprt
PERSISTENCE_GAS_ADJUSTMENT=1.5

# Theta Network Config (unchanged from Phase B)
THETA_RPC_URL=https://eth-rpc-api.thetatoken.org/rpc
THETA_BRIDGE_ADDRESS=0xYourThetaBridgeAddress
THETA_CONFIRMATIONS=12

# SP1 Config (unchanged from Phase B)
SP1_PROVER_NETWORK_URL=https://rpc.succinct.xyz
SP1_PRIVATE_KEY=your_sp1_private_key_here

# Redis Config (unchanged from Phase B)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password_here
```

**Restart Backend:**
```bash
cd backend/theta-bridge
npm run start
```

**Verify Startup:**
- ✅ "Persistence whitelisting approved: true"
- ✅ "ZKVerifier contract: persistence1abc...xyz"
- ✅ "Minter contract: persistence1def...uvw"
- ✅ "Connected to Theta RPC"
- ✅ "Connected to Redis"
- ✅ "Listener started on Theta bridge address"

---

### **Step 4: End-to-End Test (Small Deposit)** ✅ (Day 1-2)

**Action:** Deposit 0.1 TFUEL and verify full flow

#### **4.1 Deposit TFUEL on Theta**
```bash
# Using Theta Wallet or ethers.js
# Send 0.1 TFUEL to bridge address: 0xYourThetaBridgeAddress
# Include memo: persistence1youraddress
```

#### **4.2 Monitor Backend Logs**
```bash
cd backend/theta-bridge
tail -f logs/listener.log

# Expected output:
# [INFO] Detected deposit: 0xabcd1234... (0.1 TFUEL)
# [INFO] Generating SP1 proof for deposit 0xabcd1234...
# [INFO] Proof generation complete (took 8.9s)
# [INFO] Submitting proof to Persistence ZKVerifier...
# [INFO] Executing verify_and_mint on persistence1abc...xyz
# [SUCCESS] Mint successful! TxHash: ABC123DEF456
# [INFO] Stored receipt: mint_success (status: completed)
```

#### **4.3 Verify ibcTFUEL Balance**
```bash
# Query CW20 balance
persistenceCore query wasm contract-state smart \
  persistence1def...uvw \
  '{"balance":{"address":"persistence1youraddress"}}' \
  --node https://rpc.core.persistence.one:443 \
  --chain-id core-1

# Expected output:
# data:
#   balance: "100000"  # 0.1 TFUEL (6 decimals)
```

#### **4.4 Check Redis Receipt**
```bash
redis-cli -h localhost -p 6379 -a your_redis_password_here

> KEYS receipt:*
1) "receipt:0xabcd1234"

> GET receipt:0xabcd1234
{
  "status": "mint_success",
  "depositTxHash": "0xabcd1234...",
  "userAddress": "persistence1youraddress",
  "amount": "100000",
  "proof": "0x123...",
  "persistenceTxHash": "ABC123DEF456",
  "timestamp": "2026-01-27T10:30:00Z",
  "phase": "C"
}
```

**Success Criteria:**
- ✅ Theta deposit detected within 2-3 minutes (12 confirmations)
- ✅ SP1 proof generated in ~9 seconds
- ✅ Mint transaction succeeds on Persistence
- ✅ ibcTFUEL balance increased by 0.1
- ✅ Receipt stored with `mint_success` status
- ✅ No errors in backend logs

**If Errors Occur:**
- **"Sender not whitelisted"** → Governance approval not effective yet, wait 1-2 blocks
- **"Invalid proof"** → Check SP1 vkey in ZKVerifier contract, regenerate proof
- **"Mint cap exceeded"** → Reduce deposit below 1 TFUEL limit
- **"Paused"** → Contract paused, check with deployer
- **Gas errors** → Increase `PERSISTENCE_GAS_ADJUSTMENT`

---

### **Step 5: Multiple Deposit Tests** ✅ (Day 2-3)

**Action:** Test various scenarios

#### **Test Cases:**
1. ✅ **Small deposit (0.1 TFUEL)** - verify min threshold
2. ✅ **Max deposit (1 TFUEL)** - verify mint limit enforcement
3. ✅ **Multiple users** - 3-5 different Persistence addresses
4. ✅ **Concurrent deposits** - 2 deposits within 1 minute
5. ✅ **Edge case: 1.01 TFUEL** - should fail with `mint_cap_exceeded`

#### **Monitoring Metrics:**
- **Proving Time:** Should average 8-9 seconds (from Phase B benchmarks)
- **Gas Cost:** Should be ~150k gas/tx
- **Receipt Storage:** All receipts stored with correct status
- **Error Handling:** Errors trigger appropriate receipts (not crashes)

**Success Criteria:**
- ✅ 5/5 valid deposits minted successfully
- ✅ 1 over-limit deposit rejected with correct error
- ✅ All receipts stored in Redis
- ✅ No backend crashes or hangs
- ✅ Average proving time within 10% of Phase B (8-10s)

---

### **Step 6: Monitor & Optimize** ✅ (Day 3-7)

**Action:** Continuous monitoring before public launch

#### **Monitoring Checklist:**
- [ ] Backend uptime (99%+ target)
- [ ] Proving success rate (95%+ target)
- [ ] Average proving time (<10s target)
- [ ] Gas costs per mint (<200k gas target)
- [ ] Receipt storage (no Redis memory issues)
- [ ] Error rate (<5% target)

#### **AWS CloudWatch Metrics** (if applicable)
- CPU/memory usage
- Network bandwidth
- KMS key usage

#### **Redis Monitoring**
```bash
redis-cli -h localhost -p 6379 -a your_redis_password_here INFO memory

# Check for:
# - used_memory_human: <100MB
# - used_memory_peak_human: <200MB
# - keys: <1000 receipts
```

#### **Backend Health Check**
```bash
curl http://localhost:3000/health

# Expected:
# {
#   "status": "healthy",
#   "persistence": "connected",
#   "theta": "connected",
#   "redis": "connected",
#   "whitelistApproved": true
# }
```

**Optimization Opportunities:**
- If proving >10s → Check SP1 network latency, consider batching
- If gas >200k → Review ZKVerifier contract logic
- If Redis memory high → Reduce receipt TTL (currently 30 days for success)

---

### **Step 7: Public Announcement** 🎉 (Day 7)

**Action:** Announce mainnet launch

**Channels:**
- 🐦 **Twitter:** "@XFuelLab: 🚀 xfuel-protocol mainnet is LIVE! Bridge TFUEL to Persistence with ZK proofs. 1 TFUEL limit during Phase D testing. Certik audit coming Q1 2026."
- 💬 **Discord:** Announcement in #announcements channel
- 📝 **GitHub:** Update README.md with mainnet status
- 🌐 **Forum:** Update governance proposal with deployment addresses

**Safety Messaging:**
- ⚠️ "Phase D testing phase (1 TFUEL limit)"
- ⚠️ "Certik audit planned Q1 2026"
- ⚠️ "Use at your own risk - deposit small amounts only"

**User Documentation:**
- Update `README.md` with mainnet addresses
- Create user guide: "How to bridge TFUEL to Persistence"
- FAQ: "What is Phase D?" "When will limits increase?"

---

### **Step 8: Prepare for Phase E** 📋 (Day 7+)

**Action:** Certik audit preparation

#### **Audit Prep Checklist:**
- [ ] Collect all Phase D metrics (proving time, gas, success rate)
- [ ] Document any issues encountered (and resolutions)
- [ ] Prepare codebase for audit:
  - Clean up commented code
  - Add inline documentation
  - Update NatSpec comments
- [ ] Create audit scope document:
  - ZKVerifier contract (CosmWasm)
  - Minter contract (CW20)
  - SP1 zkVM program
  - Backend relayer logic
- [ ] Prepare test suite for auditors
- [ ] Budget for audit ($20k-$50k typical for Certik)

---

## 📊 Phase D Success Metrics

| Metric | Target | Phase B Baseline | Notes |
|--------|--------|------------------|-------|
| Proving Time | <10s avg | 8.997s | Should stay within 10% |
| Gas Cost | <200k gas/tx | ~150k gas | Persistence mainnet |
| Success Rate | >95% | 100% (25/25) | Allow for network issues |
| Uptime | >99% | N/A | Backend availability |
| Error Rate | <5% | 0% (Phase B) | Real-world conditions |
| Concurrent Users | 3-5 | 1 (Phase B) | Multi-user testing |

---

## 🚨 Risk Mitigation

### **Risk 1: Governance Proposal Rejected**
- **Likelihood:** Low (strong Phase B results)
- **Impact:** High (blocks Phase D)
- **Mitigation:**
  - Engage community early
  - Provide transparent benchmarks
  - Reference similar successful proposals
  - Be responsive to concerns

### **Risk 2: Mainnet Mint Failures**
- **Likelihood:** Medium (first mainnet deployment)
- **Impact:** Medium (user frustration, debugging time)
- **Mitigation:**
  - Start with 0.1 TFUEL test deposits
  - Test multiple scenarios before public launch
  - Have rollback plan (pause contract)
  - Monitor logs in real-time

### **Risk 3: Gas Cost Spikes**
- **Likelihood:** Low (tested on testnet)
- **Impact:** Medium (higher costs for users)
- **Mitigation:**
  - Monitor Persistence gas prices
  - Adjust `GAS_ADJUSTMENT` if needed
  - Consider subsidizing gas (Innovation Treasury)

### **Risk 4: SP1 Network Downtime**
- **Likelihood:** Low (Succinct Network is reliable)
- **Impact:** High (no proofs → no mints)
- **Mitigation:**
  - Monitor SP1 network status
  - Have local prover fallback (if critical)
  - Communicate downtime to users

### **Risk 5: Backend Crashes**
- **Likelihood:** Medium (new mainnet code paths)
- **Impact:** High (no deposits processed)
- **Mitigation:**
  - Comprehensive error handling (6 error types)
  - Automatic restart (systemd/pm2)
  - Monitoring + alerts (CloudWatch, PagerDuty)

---

## 📂 Phase D Deliverables

### **Documentation**
- [x] `SP1_PHASE_D_COMPLETE.md` (this file - to be created after completion)
- [x] User guide: "How to Bridge TFUEL to Persistence"
- [x] Updated README.md with mainnet addresses
- [x] Deployment artifact: `deployment-artifacts/persistence-deployment-YYYYMMDD.json`

### **Configuration**
- [x] `.env` updated with mainnet contract addresses
- [x] `PERSISTENCE_WHITELIST_APPROVED=true` enabled
- [x] Backend deployed to production server

### **Smart Contracts**
- [x] ZKVerifier deployed to Persistence mainnet
- [x] Minter deployed to Persistence mainnet
- [x] Contracts linked (Minter recognizes ZKVerifier)

### **Testing**
- [x] 5+ successful small deposits (0.1-1 TFUEL)
- [x] Multi-user testing (3-5 different addresses)
- [x] Edge case testing (over-limit, concurrent)
- [x] 7-day monitoring period (uptime, gas, errors)

---

## 🎯 Phase D → Phase E Transition

**Phase D Complete When:**
- ✅ Mainnet deployed (ZKVerifier + Minter)
- ✅ 10+ successful test deposits with various scenarios
- ✅ 7 days of monitoring with no critical issues
- ✅ Public announcement made (Discord/Twitter)
- ✅ User documentation published

**Phase E Goals:**
- Certik audit (Q1 2026)
- Increase mint limit (1 TFUEL → 10 TFUEL → 100 TFUEL)
- Implement withdrawal flow (ibcTFUEL → TFUEL)
- Public beta launch (100+ users)
- Integration with Dexter DEX (ibcTFUEL liquidity pools)

---

## 📞 Support & Resources

- **Governance Proposal:** `docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md`
- **Deployment Script:** `scripts/deploy-persistence.sh`
- **Backend Config:** `backend/theta-bridge/src/config.js`
- **Phase C Summary:** `SP1_PHASE_C_COMPLETE.md`
- **GitHub:** https://github.com/XFuel-Lab/xfuel-protocol
- **Persistence Forum:** https://forum.persistence.one

---

**Phase D Status:** ⏳ **READY TO BEGIN** (Waiting for Governance Approval)  
**Blocked By:** Persistence governance vote (7-14 days)  
**Next Action:** Submit governance proposal to forum  
**Estimated Phase D Duration:** 3-7 days (after approval)
