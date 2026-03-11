# Bug Fixes: Listener.js Production Crash Prevention

**Date:** February 6, 2026  
**File:** `backend/theta-bridge/src/listener.js`  
**Status:** ✅ Fixed

---

## Summary

Fixed two critical bugs in the deposit listener that could cause production crashes and configuration issues.

---

## Bug 1: Null Pointer Access - Production Crash Risk ⚠️

### Issue
**Lines 466-468**: Code accessed `groth16Proof.proof` and `groth16Proof.publicInputs` without null/undefined checks. If the legacy prover returned null or an unexpected structure, this would cause a runtime TypeError, halting deposit processing.

### Impact
- **Severity:** HIGH
- **Risk:** Production crash during deposit processing
- **Affected Flow:** Theta → Persistence deposit relay

### Root Cause
The `groth16Proof` parameter is a legacy artifact from Phase 0 (Groth16/Circom implementation). While production uses SP1 proofs exclusively, the code still attempted to access properties on a potentially null/undefined object.

### Fix Applied

**Before:**
```javascript
groth16Proof: {
  proof: groth16Proof.proof,
  publicInputs: groth16Proof.publicInputs
},
```

**After:**
```javascript
groth16Proof: groth16Proof ? {
  proof: groth16Proof.proof || null,
  publicInputs: groth16Proof.publicInputs || []
} : null,
```

### Protection Added
1. **Null check**: `groth16Proof ?` validates object exists before access
2. **Fallback values**: 
   - `groth16Proof.proof || null` returns null if proof property is undefined
   - `groth16Proof.publicInputs || []` returns empty array if publicInputs is undefined
3. **Graceful degradation**: Entire object set to `null` if groth16Proof is falsy

### Testing Recommendation
```javascript
// Test Case 1: groth16Proof is null
await relayProofToPersistence(depositData, mapping, null, sp1Proof);
// Expected: No TypeError, mintPayload.groth16Proof = null

// Test Case 2: groth16Proof is incomplete
await relayProofToPersistence(depositData, mapping, {}, sp1Proof);
// Expected: No TypeError, proof = null, publicInputs = []

// Test Case 3: groth16Proof is complete (legacy compatibility)
await relayProofToPersistence(depositData, mapping, {proof: "0x...", publicInputs: [...]}, sp1Proof);
// Expected: Both values preserved
```

---

## Bug 2: Hardcoded Gas Price - Configuration Ignored ⚠️

### Issue
**Line 519**: Gas price was hardcoded to `'0.025uxprt'` instead of using `config.persistence.gasPrice`. This made the `PERSISTENCE_GAS_PRICE` environment variable ineffective, preventing operators from adjusting gas prices without code changes.

### Impact
- **Severity:** MEDIUM
- **Risk:** Operational inflexibility during network congestion
- **Affected Flow:** All Persistence transactions (mints)

### Root Cause
Gas price was hardcoded during initial implementation, ignoring the configuration system designed for dynamic adjustments.

### Fix Applied

**Before:**
```javascript
{
  gasPrice: GasPrice.fromString('0.025uxprt')
}
```

**After:**
```javascript
{
  gasPrice: GasPrice.fromString(config.persistence.gasPrice || '0.025uxprt')
}
```

### Benefits
1. **Dynamic Configuration**: Operators can now adjust gas price via environment variable
2. **Network Adaptation**: Can respond to Persistence network congestion without redeployment
3. **Backward Compatibility**: Falls back to `0.025uxprt` if config is missing
4. **Production Flexibility**: Hot-reload configurations without code changes

### Configuration Usage
```bash
# .env file
PERSISTENCE_GAS_PRICE=0.05uxprt  # Increase during congestion
PERSISTENCE_GAS_PRICE=0.01uxprt  # Decrease during normal periods
```

### Testing Recommendation
```javascript
// Test Case 1: Custom gas price
config.persistence.gasPrice = '0.05uxprt';
const client = await SigningCosmWasmClient.connectWithSigner(...);
// Expected: Uses 0.05uxprt

// Test Case 2: Missing config (fallback)
config.persistence.gasPrice = undefined;
const client = await SigningCosmWasmClient.connectWithSigner(...);
// Expected: Uses default 0.025uxprt

// Test Case 3: Invalid format (error handling)
config.persistence.gasPrice = 'invalid';
// Expected: GasPrice.fromString throws, caught by try-catch
```

---

## Related Code Context

### Phase 0 → Phase B+ Evolution
The `groth16Proof` parameter is a **legacy artifact** from Phase 0 architecture:

- **Phase 0 (June-Sept 2025)**: Used Groth16/BN128/Circom for ZK proofs
- **Phase B+ (Dec 2025+)**: Migrated to SP1 zkVM (RISC-V → STARK → Groth16 wrapper)
- **Production (Feb 2026)**: Exclusively uses SP1 proofs, groth16Proof unused

### Why Not Remove groth16Proof Entirely?
1. **Backward Compatibility**: Legacy receipts may reference it
2. **Audit Trail**: Historical data preservation
3. **Migration Safety**: Gradual deprecation reduces risk
4. **Code Documentation**: Preserves evolution context

### Recommended Future Action
- **Phase D (Q2 2026)**: Add deprecation warning when groth16Proof is non-null
- **Phase E (Q3 2026)**: Remove parameter after confirming no legacy dependencies

---

## Verification

### Files Changed
- `backend/theta-bridge/src/listener.js` (2 fixes)

### Lines Modified
- Line 466-469: Added null checks for groth16Proof
- Line 519: Replaced hardcoded gas price with config value

### Commit Message Suggestion
```
fix(listener): prevent crash on null groth16Proof, use config gas price

Bug 1: Add null checks for groth16Proof.proof and groth16Proof.publicInputs
to prevent TypeError when legacy prover returns null. Adds graceful
degradation with fallback values (null/empty array).

Bug 2: Replace hardcoded gas price '0.025uxprt' with config.persistence.gasPrice
to respect PERSISTENCE_GAS_PRICE environment variable. Enables operators to
adjust gas during network congestion without code changes.

Fixes: Production crash risk, configuration inflexibility
Impact: High severity (crash prevention), Medium severity (operations)
```

---

## Pre-Commit Checklist

Before committing these fixes:

- [x] Null checks added for groth16Proof
- [x] Fallback values defined (null, empty array)
- [x] Gas price reads from config with fallback
- [x] Backward compatibility maintained
- [ ] Unit tests added for null groth16Proof scenarios
- [ ] Integration test with custom gas price
- [ ] Update config.js documentation (if needed)
- [ ] Add deprecation warning for groth16Proof (optional, Phase D)

---

## Deployment Notes

### No Breaking Changes
Both fixes are **backward compatible**:
- Existing valid groth16Proof objects still work
- Missing config.persistence.gasPrice falls back to hardcoded value

### Rollout Strategy
1. **Immediate deployment recommended** (crash prevention)
2. **No configuration changes required** (graceful fallbacks)
3. **Optional**: Set `PERSISTENCE_GAS_PRICE` for custom tuning

### Monitoring
After deployment, monitor for:
- ✅ Zero TypeErrors related to groth16Proof
- ✅ Successful mints with custom gas prices
- ✅ No regression in deposit processing

---

**Status:** ✅ Fixes Applied - Ready for Commit  
**Risk Reduction:** HIGH (crash) + MEDIUM (config) = HIGH PRIORITY  
**Recommendation:** Commit immediately, deploy to production ASAP

---

**END OF BUG FIX REPORT**

Last Updated: February 6, 2026  
Fixed By: AI Assistant  
Verified: Manual code review + logic validation
