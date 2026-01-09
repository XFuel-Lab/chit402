# Ghost/Relic Code Cleanup Report - Revenue Split Updates

**Date:** Generated during revenue split ratio updates  
**Context:** Updating RevenueSplitter from old Phase 1/Phase 2 splits to new tokenomics

## ✅ FIXED - RevenueSplitter.sol

### Old Ghost Code (REMOVED):
- **Phase 1/Phase 2 split system**: 90/10 and 50/25/15/10 ratios
- **rXF integration**: 15% allocation to rXF minting
- **Old constants**:
  - `VEXF_YIELD_BPS = 5000` (50%)
  - `BUYBACK_BURN_BPS = 2500` (25%)
  - `RXF_MINT_BPS = 1500` (15%)
  - `TREASURY_BPS = 1000` (10%)

### New Clean Implementation:
- **Current Split**: 30% BBB, 30% LP funding, 25% veXF, 15% treasury
- **New constants**:
  - `BBB_BPS = 3000` (30%)
  - `LP_FUNDING_BPS = 3000` (30%)
  - `VEXF_PAYOUT_BPS = 2500` (25%)
  - `TREASURY_BPS = 1500` (15%)

### Removed Features:
1. ❌ rXF minting logic
2. ❌ rXF contract reference
3. ❌ Phase 1/Phase 2 documentation
4. ❌ Old split calculation logic
5. ❌ `setRXF()` function
6. ❌ `totalRXFMinted` tracking
7. ❌ `totalYieldDistributed` (renamed to `totalVeXFPayout`)
8. ❌ `totalBuybackBurned` (renamed to `totalBBBSent`)

### Added Features:
1. ✅ LP funding pool support
2. ✅ `setLPFundingPool()` function
3. ✅ Monthly batch processing (30% LP fees → TFUEL)
4. ✅ Bonus revenue recycling
5. ✅ Correct event emissions

---

## ⚠️ NEEDS CLEANUP - rXF.sol

**File**: `contracts/rXF.sol`  
**Status**: ENTIRE CONTRACT IS GHOST CODE  
**Reason**: rXF is no longer part of tokenomics (removed from revenue split)

### Issues:
- rXF contract still exists but is not used in new tokenomics
- No longer receives 15% revenue allocation
- Old "soulbound revenue-backed receipt token" concept deprecated

### Recommendation:
- [ ] **Decision needed**: Archive or delete `rXF.sol`?
- [ ] If keeping for historical reasons, move to `legacy/` folder
- [ ] Update README to indicate rXF is deprecated
- [ ] Remove any deployment scripts that reference rXF

---

## 🔍 OTHER FILES TO REVIEW

### 1. Deployment Scripts
**Files to check:**
- `scripts/deploy.cjs`
- Any deployment docs mentioning Phase 1/Phase 2

**Search for:**
```
rXF
Phase 1
Phase 2
50% veXF
90% veXF
RXF_MINT
```

### 2. Test Files
**Check for old split ratio tests:**
- Test files expecting 50/25/15/10 split
- Test files expecting rXF minting
- Tests for Phase 1 vs Phase 2 logic

### 3. Frontend Code
**Check UI for outdated split displays:**
- Revenue split visualizations
- Tokenomics diagrams
- Dashboard stats showing old ratios

### 4. Documentation
**Files that may reference old splits:**
- `README.md`
- `docs/whitepaper.md`
- `docs/tokenomics.md`
- Any API documentation

### 5. Other Contracts
**Contracts that might reference rXF:**
```bash
# Search needed:
grep -r "rXF" contracts/
grep -r "Phase 1" contracts/
grep -r "Phase 2" contracts/
```

---

## 📋 ACTION ITEMS

### High Priority:
- [ ] **rXF.sol**: Decide fate - archive or delete
- [ ] **RevenueSplitter tests**: Update to expect 30/30/25/15 split
- [ ] **Deployment scripts**: Remove rXF deployment
- [ ] **Frontend**: Update revenue split displays

### Medium Priority:
- [ ] **Documentation**: Update whitepaper with new ratios
- [ ] **API docs**: Update if revenue splits are exposed
- [ ] **README**: Remove Phase 1/Phase 2 references

### Low Priority:
- [ ] **Historical cleanup**: Move deprecated contracts to `legacy/`
- [ ] **Comments**: Search for "TODO" comments referencing old system
- [ ] **Git history**: Tag last commit with rXF for future reference

---

## 🎯 SUMMARY

**Files Fixed**: 1 (RevenueSplitter.sol)  
**Files Needing Cleanup**: 1+ (rXF.sol, tests, docs)  
**Ghost Code Removed**: ~200 lines (rXF minting, old splits, Phase 1/2 logic)  
**New Clean Code Added**: ~150 lines (LP funding, monthly batch, correct splits)

**Next Steps**:
1. Review and cleanup rXF.sol
2. Update test suites
3. Scan for other ghost/relic code patterns
4. Update all documentation

---

## 🔎 GREP COMMANDS FOR FURTHER INVESTIGATION

```bash
# Find all Phase 1/2 references
grep -r "Phase 1\|Phase 2" . --exclude-dir=node_modules

# Find old split ratios
grep -r "50%\|90%\|15% rXF" . --exclude-dir=node_modules

# Find rXF references
grep -r "rXF\|RXF_MINT" . --exclude-dir=node_modules

# Find old constant names
grep -r "VEXF_YIELD_BPS\|RXF_MINT_BPS" . --exclude-dir=node_modules
```

---

**Report Generated**: Part of revenue split refactor  
**Status**: RevenueSplitter ✅ CLEAN | Other files ⚠️ NEEDS REVIEW

