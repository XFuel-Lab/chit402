# Development Safeguards

This document outlines the safeguards in place to prevent accidental commits, pushes, and merges to protect the live production environment.

## Overview

This project has a **live working modal** and is actively building **Keplr wallet integration**. All changes require manual review and approval before going live.

## Safeguards in Place

### 1. Git Pre-Commit Hook

**Location:** `.git/hooks/pre-commit`

**Purpose:** Requires explicit confirmation before any commit is allowed.

**Behavior:**
- Displays a warning message when attempting to commit
- Requires typing `YES` to proceed with the commit
- Blocks the commit if confirmation is not provided

**To bypass (not recommended):** Use `git commit --no-verify` (use with extreme caution)

### 2. Git Pre-Push Hook

**Location:** `.git/hooks/pre-push`

**Purpose:** Prevents accidental pushes to protected branches (main, master, develop).

**Behavior:**
- Automatically blocks pushes to `main`, `master`, and `develop` branches
- Requires typing `YES` to proceed with push to protected branches
- Allows pushes to feature branches without confirmation

**Protected Branches:**
- `main`
- `master`
- `develop`

### 3. GitHub Actions CI/CD

**Location:** `.github/workflows/ci.yml`

**Purpose:** Runs automated tests on pushes and pull requests.

**Behavior:**
- Runs tests automatically on push to protected branches
- Runs tests on pull requests
- Does NOT automatically deploy (requires manual deployment)

### 4. Vercel Configuration

**Location:** `vercel.json`

**Note:** If Vercel auto-deployment is enabled, ensure it's configured to only deploy from approved branches or manual deployments.

## Workflow Recommendations

### For Development Work

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/keplr-integration
   ```

2. **Make your changes** - The pre-commit hook will prompt for confirmation

3. **Commit your changes:**
   ```bash
   git commit -m "Add Keplr wallet integration"
   ```
   - You'll be prompted to type `YES` to confirm

4. **Push to your feature branch:**
   ```bash
   git push origin feature/keplr-integration
   ```
   - Feature branch pushes are allowed without confirmation

5. **Create a Pull Request** for review

6. **After review and approval**, merge through GitHub (requires manual action)

### For Production Deployment

1. All changes must go through Pull Request review
2. Manual merge approval required
3. Test thoroughly in staging/preview environment
4. Deploy only after explicit approval

## Important Notes

- ⚠️ **Never use `--no-verify` flags** unless absolutely necessary and with full understanding
- ⚠️ **Always review changes** before committing
- ⚠️ **Never push directly to main/master/develop** - always use Pull Requests
- ⚠️ **Test locally** before pushing any changes
- ⚠️ **Coordinate with team** before making changes that could affect the live modal

## Disabling Safeguards (Emergency Only)

If you need to disable these safeguards in an emergency:

1. **Temporarily disable pre-commit:**
   ```bash
   chmod -x .git/hooks/pre-commit
   ```

2. **Temporarily disable pre-push:**
   ```bash
   chmod -x .git/hooks/pre-push
   ```

3. **Re-enable after emergency:**
   ```bash
   chmod +x .git/hooks/pre-commit
   chmod +x .git/hooks/pre-push
   ```

**⚠️ WARNING:** Only disable safeguards in true emergencies and re-enable immediately after.

## AI Assistant Behavior

The AI assistant (Auto) will:
- ✅ Make code changes and edits
- ✅ Propose git commands (which require your approval)
- ❌ **NOT** automatically commit changes
- ❌ **NOT** automatically push changes
- ❌ **NOT** automatically merge branches

All git operations require explicit user approval through the terminal command interface.

## Questions or Issues

If you encounter issues with these safeguards or need to modify them, please:
1. Review this document first
2. Discuss with the team before making changes
3. Update this document if safeguards are modified

