# Final Cleanup Report: rXF Ghost Code Pruning

**Date:** January 12, 2026  
**Status:** Identification Complete - Ready for Cleanup

## Summary

After implementing limited rXF (5M cap, treasury-minted), we now have:
- ✅ **Keep**: InnovationTreasury.sol with limited rXF minting logic
- ❌ **Ghost**: Old rXF.sol contract (15% revenue, unlimited minting)
- ❌ **Ghost**: Tests for old rXF.sol
- ❌ **Ghost**: Deployment scripts for old rXF
- ⚠️ **Update**: Frontend references to reflect limited rXF

---

## Files to Keep (Correct Limited rXF Logic)

### contracts/InnovationTreasury.sol ✅
**Status:** KEEP - Has correct limited rXF implementation
- Lines 10: `import "./rXF.sol";` - Uses rXF.sol for minting interface
- Lines 36: `rXF public rXFContract;` - Reference to rXF contract
- Lines 48-53: Constants for 5M cap (2.5M early + 2.5M incentives)
- Lines 288-380: Minting functions with hard caps enforced

**Action:** No changes needed - this is the correct implementation

### docs/WHITEPAPER.md ✅
**Status:** KEEP - Correctly documents limited rXF
- Section 5.5: Limited rXF (5% Cap) - Treasury-Minted
- Section 5.7: Complete flow diagram showing rXF as separate
- Section 6.4: rXF Limited Allocation details

**Action:** No changes needed - documentation is accurate

---

## Files to Archive/Move (Ghost Code)

### contracts/rXF.sol ❌
**Status:** GHOST - Old unlimited revenue-based minting
- Line 14: "Minted by RevenueSplitter (15% slice)" - DEPRECATED
- Line 33: `address public revenueSplitter;` - Old architecture
- Full contract implements unlimited minting from revenue

**Recommended Action:**
```bash
# Move to legacy archive
mkdir -p legacy-archive/contracts
git mv contracts/rXF.sol legacy-archive/contracts/rXF.sol.deprecated

# Add README explaining deprecation
echo "# Deprecated rXF Contract

This contract implemented 15% revenue-based rXF minting.

**Replaced by:** InnovationTreasury.sol limited rXF minting (5M cap)
**Reason:** Complexity, unlimited supply, revenue impact on veXF holders
**Date Deprecated:** January 2026

See WHITEPAPER.md Section 5.5 for new limited rXF architecture.
" > legacy-archive/contracts/rXF.README.md
```

**Decision:** Keep file for historical reference, but clearly marked as deprecated

### test/rXF.test.cjs ❌
**Status:** GHOST - Tests old rXF.sol contract

**Grep Results:**
```bash
$ grep -n "rXF" test/rXF.test.cjs | head -20
```

**Recommended Action:**
- Archive to `legacy-archive/test/rXF.test.cjs.deprecated`
- OR: Update tests to test limited rXF via InnovationTreasury
- Decision: Archive (InnovationTreasury.test.cjs should cover limited rXF)

### test/Phase2Integration.test.cjs ⚠️
**Status:** May reference old rXF minting from RevenueSplitter

**Recommended Action:**
- Review test file
- Update any rXF tests to use InnovationTreasury instead of RevenueSplitter
- Remove references to 15% rXF allocation

---

## Deployment Scripts to Update

### scripts/phase2-deploy.ts ⚠️
**Check:** May deploy old rXF.sol

**Recommended Action:**
```typescript
// REMOVE old rXF deployment
// const rXF = await deployContract("rXF", [xfToken, veXF, revSplitter, owner]);

// KEEP InnovationTreasury which mints limited rXF
const innovationTreasury = await deployContract("InnovationTreasury", [veXF, treasuryToken, owner]);
await innovationTreasury.setRXF(rXFContract); // Set limited rXF contract
```

### scripts/phase3-deploy.ts ⚠️
**Check:** Similar to phase2-deploy

### scripts/mint-rxf-believers.ts ✅
**Status:** Likely correct - should use InnovationTreasury.mintRXFEarlyBeliever()

**Recommended Action:** Verify it calls InnovationTreasury, not old rXF.mint()

---

## Frontend Files to Review

### src/components/EarlyBelieversModal.tsx ⚠️
**Check:** May reference old rXF minting flow

**Recommended Action:**
- Ensure UI shows "Limited allocation: X of 2.5M remaining"
- Show soulbound NFT status
- Update messaging: "Treasury-minted, not from revenue"

### src/components/BalanceSummary.tsx ⚠️
**Check:** May show rXF balance

**Recommended Action:**
- Keep rXF balance display (users may hold limited rXF)
- Add tooltip: "Limited rXF (5M cap) - +4x veXF boost"

### src/components/GovernanceTab.tsx ⚠️
**Check:** May reference rXF voting boost

**Recommended Action:**
- Verify shows +4x boost for rXF holders
- Should work with limited rXF (same boost mechanism)

### src/App.tsx ⚠️
**Check:** Main app may have rXF state

**Recommended Action:**
- Review rXF-related state variables
- Ensure they work with limited supply model

---

## Documentation Files to Update

### README.md ⚠️
**Check:** May mention old tokenomics

**Recommended Action:**
- Update to reference 30/30/25/15 (no rXF in split)
- Mention limited rXF (5M cap, treasury-minted)

### docs/PHASE2_INTEGRATION.md ❌
**Status:** Likely documents old Phase 2 with 15% rXF

**Recommended Action:**
- Archive or update to reflect new architecture
- Mark as deprecated if Phase 2 no longer exists

---

## Scripts/Tools to Update

### scripts/test-revenue-split.ts ⚠️
**Check:** May test old 50/25/15/10 split with rXF

**Recommended Action:**
- Update to test 30/30/25/15 split
- Remove rXF minting expectations from RevenueSplitter

---

## Recommended Cleanup Sequence

### Phase 1: Archive Ghost Contracts
```bash
# Create legacy archive
mkdir -p legacy-archive/contracts
mkdir -p legacy-archive/test

# Move deprecated files
git mv contracts/rXF.sol legacy-archive/contracts/rXF.sol.deprecated
git mv test/rXF.test.cjs legacy-archive/test/rXF.test.cjs.deprecated

# Commit
git commit -m "refactor: Archive deprecated rXF.sol (replaced by limited rXF in InnovationTreasury)"
```

### Phase 2: Update Tests
```bash
# Review and update
- test/Phase2Integration.test.cjs
- test/RevenueSplitter.test.cjs (ensure 30/30/25/15)

# Commit
git commit -m "test: Update tests for 30/30/25/15 split and limited rXF"
```

### Phase 3: Update Deployment Scripts
```bash
# Review and update
- scripts/phase2-deploy.ts
- scripts/phase3-deploy.ts
- scripts/mint-rxf-believers.ts

# Commit
git commit -m "scripts: Update deployment for limited rXF via InnovationTreasury"
```

### Phase 4: Update Frontend
```bash
# Review and update
- src/components/EarlyBelieversModal.tsx
- src/components/BalanceSummary.tsx
- src/components/GovernanceTab.tsx
- src/App.tsx

# Commit
git commit -m "frontend: Update UI for limited rXF (5M cap, treasury-minted)"
```

### Phase 5: Update Documentation
```bash
# Review and update
- README.md
- docs/PHASE2_INTEGRATION.md (archive or update)

# Commit
git commit -m "docs: Update docs for final tokenomics (30/30/25/15 + limited rXF)"
```

### Phase 6: Final Cleanup Commit
```bash
git commit -m "refactor: Final cleanup—close ghosts"
```

---

## Files That Are Already Correct ✅

- **contracts/RevenueSplitter.sol**: ✅ 30/30/25/15, no rXF
- **contracts/InnovationTreasury.sol**: ✅ Limited rXF minting
- **contracts/SubVault.sol**: ✅ 100% unwrap, no split
- **contracts/VaultFactory.sol**: ✅ Correct architecture
- **contracts/IBCTreasury.sol**: ✅ 70/30 retain/recycle
- **docs/WHITEPAPER.md**: ✅ Complete documentation
- **REVSPLITTER-VERIFICATION.md**: ✅ Verification complete
- **CLEANUP-REPORT-GHOST-CODE.md**: ✅ Initial cleanup documented

---

## Decision: Keep or Delete rXF.sol?

### Option 1: Archive (Recommended)
- Move to `legacy-archive/contracts/rXF.sol.deprecated`
- Keep for historical reference
- Add README explaining deprecation
- Pros: Historical record, can reference old logic
- Cons: Slight repo bloat

### Option 2: Delete
- Fully remove from repo
- Pros: Clean repo, no confusion
- Cons: Lose historical context (but in git history)

**Recommendation:** Archive with clear deprecation notice

---

## Summary

**Total Files Identified:** 116 files with "rXF" references

**Categories:**
- ✅ **Keep (Correct)**: 3 files (InnovationTreasury, WHITEPAPER, verification docs)
- ❌ **Archive**: 2 files (rXF.sol, rXF.test.cjs)
- ⚠️ **Review/Update**: ~15 files (tests, scripts, frontend, docs)
- 📄 **Informational**: ~96 files (markdown docs, summaries, reports)

**Next Action:** Execute cleanup sequence Phase 1-6

---

**Generated:** Final cleanup identification  
**Ready for:** Systematic ghost code removal

