# 📄 Whitepaper Polish - One-Page Quick Reference

## 🎯 Goal
Establish **docs/WHITEPAPER.md** as the single canonical documentation, delete all old versions.

---

## ⚡ Quick Run (One Command)

### Linux/Mac:
```bash
bash polish-whitepaper.sh
```

### Windows:
```cmd
polish-whitepaper.bat
```

Then:
1. **Update README.md** - Add content from `README_WHITEPAPER_SECTION.md` after "ZK Bridge Architecture"
2. **Commit README**: `git add README.md && git commit -m "Update README with canonical whitepaper section" && git push origin polish-whitepaper`
3. **Create PR** on GitHub using `WHITEPAPER_POLISH_PR_GUIDE.md`

---

## 📝 Manual Commands

```bash
# 1. Create branch
git switch -c polish-whitepaper

# 2. Delete old versions (root)
rm -f WHITEPAPER_V3_*.md WHITEPAPER_OVERHAUL_COMPLETE.md QUICK_REFERENCE_WHITEPAPER.md

# 3. Delete old versions (docs)
rm -f docs/whitepaper.md docs/WHITEPAPER_*_SUMMARY.md

# 4. Delete legacy whitepaper directory files (keep ZK Bridge MD + diagrams)
rm -f docs/whitepaper/whitepaper-content.md docs/whitepaper/XFUEL-Whitepaper-Medium.md
rm -f docs/whitepaper/*.html docs/whitepaper/*.pdf docs/whitepaper/*.mjs docs/whitepaper/*.css
rm -f docs/whitepaper/*_SUMMARY.md docs/whitepaper/PUBLISHING_GUIDE.md docs/whitepaper/README.md

# 5. Rename v3 to canonical
git mv docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md docs/WHITEPAPER.md

# 6. Stage, commit, push
git add -A
git commit -m "Polish whitepaper to v3.0 canonical, delete old versions"
git push origin polish-whitepaper

# 7. Update README.md (manually add section from README_WHITEPAPER_SECTION.md)

# 8. Commit README
git add README.md
git commit -m "Update README with canonical whitepaper section"
git push origin polish-whitepaper
```

---

## 📦 What Gets Deleted

**Root Level** (6 files):
- WHITEPAPER_V3_CHART_ADDITIONS.md
- WHITEPAPER_V3_REFINEMENTS_SUMMARY.md
- WHITEPAPER_V3_BEFORE_AFTER.md
- WHITEPAPER_V3_FERRARI_DELIVERY.md
- WHITEPAPER_OVERHAUL_COMPLETE.md
- QUICK_REFERENCE_WHITEPAPER.md

**Docs Level** (3 files):
- docs/whitepaper.md
- docs/WHITEPAPER_MASTER_INDEX.md
- docs/WHITEPAPER_V2_SUMMARY.md

**Whitepaper Directory** (~12 files):
- whitepaper-content.md, XFUEL-Whitepaper-Medium.md
- *.html, *.pdf (except kept: ZK-Bridge MD)
- *.mjs (generation scripts), styles.css
- Various READMEs and summaries

**Total**: ~21 files deleted ✅

---

## ✨ What Gets Renamed

**Before**:
```
docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md
```

**After**:
```
docs/WHITEPAPER.md  ← Canonical!
```

---

## ✅ What We Keep

✅ `docs/WHITEPAPER.md` - Canonical v3.0
✅ `docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md` - Technical complement
✅ `docs/whitepaper/diagrams/` - SVG assets
✅ `docs/XFUEL-FERRARI-QUICK-REF.md` - One-page summary

---

## 📝 README Update Required

Add this section after "ZK Bridge Architecture" (~line 200):

```markdown
## 📄 Latest Whitepaper v3.0

**XFUEL Protocol: Ferrari Hybrid Tokenomics Edition**

Read: **[docs/WHITEPAPER.md](docs/WHITEPAPER.md)**

### Highlights
- Ferrari hybrid: 30/70 recycle, 30/30/25/15 splits
- veXF governance extras: NFTs, rXF bonuses, quarterly votes
- ZK-SNARK bridge: Sub-4s settlement
- Live addresses: VaultFactory 0xB0a266...
- Pre-audit status clearly noted
```

(See `README_WHITEPAPER_SECTION.md` for full version)

---

## 🔗 GitHub PR

**Title**: `Polish whitepaper to v3.0 canonical, delete old versions`

**Description**: Use `WHITEPAPER_POLISH_PR_GUIDE.md` (full template)

**Key Points**:
- Establishes single canonical whitepaper
- Removes 21 legacy files
- Clean documentation structure
- Production-ready naming

---

## 🎯 Success Criteria

✅ Branch `polish-whitepaper` created
✅ Old whitepapers deleted (~21 files)
✅ V3 renamed to `docs/WHITEPAPER.md`
✅ README updated with new section
✅ Pushed to GitHub
✅ PR created with template
✅ All links work

---

## 📚 Reference Files

- `polish-whitepaper.sh` - Bash script
- `polish-whitepaper.bat` - Windows script
- `README_WHITEPAPER_SECTION.md` - README content
- `WHITEPAPER_POLISH_PR_GUIDE.md` - PR template
- `WHITEPAPER_POLISH_ONE_PAGE.md` - This file

---

**Time**: ~5 minutes total
**Complexity**: Simple file operations
**Risk**: Low (git preserves history)

