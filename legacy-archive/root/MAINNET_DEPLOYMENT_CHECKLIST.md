# 📋 MAINNET DEPLOYMENT EXECUTION CHECKLIST

**Date:** _____________  
**Deployed By:** _____________  
**Witnesses:** _____________

---

## PRE-DEPLOYMENT (Before Starting)

- [ ] All team members coordinated and available
- [ ] Multisig signers ready (Admin: persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e)
- [ ] Wallet has at least 10 XPRT for gas
- [ ] SP1_PRIVATE_KEY loaded from AWS Secrets Manager
- [ ] SP1 prover running and monitoring
- [ ] Test wallet has 0.05 TFUEL (ibcTFUEL) for test
- [ ] Theta wallet (0xD3EED5D4a61Beb3401E10D606f9957500AC9819a) accessible
- [ ] Emergency contacts on standby
- [ ] Full deployment script read and understood
- [ ] Rollback procedures reviewed

**Sign-off:** __________ Date: __________ Time: __________

---

## DEPLOYMENT EXECUTION

### Step 0: Security Setup
- [ ] SP1_PRIVATE_KEY loaded from AWS Secrets Manager
- [ ] Key imported to persistenced keyring
- [ ] Temporary files cleaned up
- [ ] Wallet address verified

**Wallet Address:** ______________________________________

---

### Step 1: WASM Verification
- [ ] Navigated to artifacts directory
- [ ] persistence_minter.wasm checksum matches (516db0e8...)
- [ ] fee_collector.wasm checksum matches (7a370b84...)
- [ ] Wallet balance confirmed (>10 XPRT)

**Wallet Balance:** __________ XPRT  
**Timestamp:** __________

---

### Step 2: Upload persistence-minter
- [ ] WASM uploaded successfully
- [ ] Transaction confirmed (code: 0)

**TX Hash:** ______________________________________  
**Code ID:** __________  
**Data Hash Verified:** [ ] Yes [ ] No  
**Timestamp:** __________

---

### Step 3: Upload fee-collector
- [ ] WASM uploaded successfully
- [ ] Transaction confirmed (code: 0)

**TX Hash:** ______________________________________  
**Code ID:** __________  
**Data Hash Verified:** [ ] Yes [ ] No  
**Timestamp:** __________

---

### Step 4: Instantiate persistence-minter
- [ ] Contract instantiated successfully
- [ ] Contract address obtained
- [ ] Contract PAUSED immediately
- [ ] Paused state verified (CRITICAL)

**TX Hash:** ______________________________________  
**Contract Address:** ______________________________________  
**Paused:** [ ] YES (required) [ ] NO (STOP!)  
**Admin:** [ ] Matches multisig  
**Timestamp:** __________

---

### Step 5: Instantiate fee-collector
- [ ] Contract instantiated successfully
- [ ] Contract address obtained
- [ ] Config verified (ibctfuel_token, minter_contract)

**TX Hash:** ______________________________________  
**Contract Address:** ______________________________________  
**Config Correct:** [ ] Yes [ ] No  
**Min Burn Amount:** [ ] 1 TFUEL (1000000000000000000)  
**Timestamp:** __________

---

### Step 6: Update Fee Collector Address
- [ ] SetFeeCollector executed successfully
- [ ] Address verified in minter config

**TX Hash:** ______________________________________  
**Fee Collector Address in Minter:** ______________________________________  
**Matches FeeCollector Contract:** [ ] Yes [ ] No  
**Timestamp:** __________

---

### Step 7: Pre-Test Verification (ALL MUST PASS)

**Critical Checks:**
- [ ] Minter is PAUSED (true)
- [ ] Admin is multisig (persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e)
- [ ] Fee collector address is set (not dummy)
- [ ] Verifier address is dummy (persistence1000...0000)
- [ ] Rev_splitter address is dummy (persistence1000...0000)
- [ ] Initial minter state all zeros
- [ ] Initial fee collector state all zeros
- [ ] Fee collector config correct

**All Checks Passed:** [ ] YES - Proceed to test [ ] NO - STOP AND INVESTIGATE

**Sign-off for Testing:** __________ Date: __________ Time: __________

---

### Step 8: First Test Transaction (0.05 TFUEL)

**Test Parameters:**
- Amount: 50000000000000000 (0.05 TFUEL)
- Theta Recipient: 0xD3EED5D4a61Beb3401E10D606f9957500AC9819a

**Execution:**
- [ ] Contract unpaused
- [ ] Unpause verified (paused=false)
- [ ] burn_for_unwrap executed
- [ ] Transaction successful (code: 0)
- [ ] Contract PAUSED immediately after
- [ ] Paused state verified (paused=true)

**TX Hash:** ______________________________________  
**Timestamp Start:** __________  
**Timestamp End:** __________  
**Duration:** __________ seconds

---

### Step 9: Post-Test Verification (ALL MUST MATCH)

**Fee Calculation (CRITICAL):**
- [ ] Fee amount = 250000000000000 (0.00025 TFUEL, exactly 0.5%)
- [ ] Burn amount = 49750000000000000 (0.04975 TFUEL, exactly 99.5%)
- [ ] Total = 50000000000000000 (0.05 TFUEL)

**State Updates:**
- [ ] total_reverse_burned = 49750000000000000
- [ ] total_reverse_fees = 250000000000000
- [ ] accumulated_fees (FeeCollector) = 250000000000000
- [ ] All other state fields still zero

**Nonce:**
- [ ] User nonce incremented from 0 to 1

**FeeCollector Balance:**
- [ ] ibcTFUEL balance = 250000000000000

**SP1 Prover:**
- [ ] BurnForUnwrap event detected
- [ ] Event attributes correct
- [ ] Burner: __________
- [ ] Theta recipient: 0xD3EED5D4a61Beb3401E10D606f9957500AC9819a
- [ ] Nonce: 0

**Transaction Events:**
- [ ] wasm-BurnForUnwrap event present
- [ ] wasm-FeeBurn event present
- [ ] All attributes correct

**All Verifications Passed:** [ ] YES [ ] NO (describe issue below)

**Issue Description (if any):**
________________________________________________________________________
________________________________________________________________________

---

### Step 10: Success Criteria

- [ ] Both WASMs uploaded with correct checksums
- [ ] Minter instantiated with multisig admin
- [ ] Minter is PAUSED
- [ ] FeeCollector instantiated correctly
- [ ] FeeCollector address updated in minter
- [ ] Test burn executed successfully
- [ ] Fee = EXACTLY 0.5% (250000000000000)
- [ ] Burn = EXACTLY 99.5% (49750000000000000)
- [ ] Nonce incremented 0→1
- [ ] SP1 prover detected event
- [ ] FeeCollector balance correct
- [ ] Minter state correct
- [ ] Contract PAUSED after test
- [ ] No errors in logs

**DEPLOYMENT STATUS:** [ ] ✅ SUCCESS [ ] ❌ FAILED

**Sign-off:** __________ Date: __________ Time: __________

---

### Step 11: Record Deployment Details

**Contract Addresses (SAVE THESE):**
```
MINTER_CODE_ID: __________
FEE_COLLECTOR_CODE_ID: __________
MINTER_CONTRACT: ______________________________________
FEE_COLLECTOR_CONTRACT: ______________________________________
```

**Transaction Hashes (Audit Trail):**
```
MINTER_UPLOAD_TX: ______________________________________
FEE_COLLECTOR_UPLOAD_TX: ______________________________________
MINTER_INSTANTIATE_TX: ______________________________________
FEE_COLLECTOR_INSTANTIATE_TX: ______________________________________
FEE_COLLECTOR_UPDATE_TX: ______________________________________
FIRST_TEST_TX: ______________________________________
```

**Documentation Updated:**
- [ ] .env.production updated with contract addresses
- [ ] README.md updated
- [ ] Team notified
- [ ] Monitoring dashboard configured

---

## POST-DEPLOYMENT

### Immediate Actions
- [ ] Contract confirmed PAUSED
- [ ] Deployment details saved to secure location
- [ ] Team briefed on deployment outcome
- [ ] Monitoring active on contract addresses
- [ ] Incident response plan ready

### Next Steps (Do NOT execute without team approval)
- [ ] Update dummy verifier address via multisig governance
- [ ] Update dummy rev_splitter address via multisig governance
- [ ] Configure continuous monitoring
- [ ] Plan gradual production rollout
- [ ] Document any issues or learnings

---

## EMERGENCY PROCEDURES

**If deployment fails at any step:**

1. **PAUSE CONTRACT IMMEDIATELY** (if instantiated)
   ```bash
   persistenced tx wasm execute <CONTRACT> '{"pause":{}}' ...
   ```

2. **Document the issue:**
   - Step where failure occurred: __________
   - Error message: __________
   - Transaction hash (if any): __________

3. **Contact team:**
   - Incident reported to: __________
   - Time of incident: __________
   - Escalation required: [ ] Yes [ ] No

4. **Assessment:**
   - Issue severity: [ ] Critical [ ] High [ ] Medium [ ] Low
   - Rollback needed: [ ] Yes [ ] No
   - User funds at risk: [ ] Yes [ ] No

**Emergency Contact Log:**
| Time | Contact | Action Taken | Result |
|------|---------|--------------|--------|
|      |         |              |        |
|      |         |              |        |
|      |         |              |        |

---

## FINAL SIGN-OFF

**Deployment completed successfully:** [ ] Yes [ ] No

**Final State:**
- Minter Contract: [ ] PAUSED [ ] UNPAUSED
- FeeCollector Contract: [ ] Active
- All tests passed: [ ] Yes [ ] No
- Monitoring active: [ ] Yes [ ] No
- Team notified: [ ] Yes [ ] No

**Signatures:**

Deployer: __________________ Date: __________ Time: __________

Witness 1: __________________ Date: __________ Time: __________

Witness 2: __________________ Date: __________ Time: __________

---

**KEEP THIS CHECKLIST WITH DEPLOYMENT RECORDS**

**File Location:** `MAINNET_DEPLOYMENT_CHECKLIST.md`  
**Deployment Date:** __________  
**Network:** Persistence Mainnet (core-1)  
**Status:** [ ] ✅ Complete [ ] ⏸️ In Progress [ ] ❌ Failed
