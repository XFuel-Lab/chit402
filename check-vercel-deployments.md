# Check and Fix Vercel Deployments

## Current Situation
- Local repo is linked to: `xfuel-protocol` (ID: prj_h2ycbfCnhtW7KAp1fzL8agzkphcY)
- You have TWO Vercel projects (created while learning)
- Need to consolidate to ONE project

---

## Step-by-Step Fix

### 1. Identify Your Projects

Go to: https://vercel.com/dashboard

List all projects you see. For each project, check:
- **Project Name**
- **Git Repository** (should be: XFuel-Lab/xfuel-protocol)
- **Production Domain** (Settings → Domains)
- **Last Deployment** (should be recent if it's the active one)

### 2. Determine Which Project is "Correct"

The **correct** project should have:
- ✅ Domain: `xfuel.app` OR `www.xfuel.app`
- ✅ Connected to GitHub: `XFuel-Lab/xfuel-protocol` on `main` branch
- ✅ Recent deployments (last 24 hours)

The **incorrect/old** project will likely:
- ❌ Have a different domain (or no custom domain)
- ❌ Be named something like `xfuel-protocol-2` or have `-test` suffix
- ❌ Have old deployments

### 3. Fix Permanently

#### Option A: Consolidate (Recommended)

1. **In the CORRECT project** (likely `xfuel-protocol`):
   - Go to Settings → Domains
   - Ensure `xfuel.app` is listed
   - If not, click "Add" → enter `xfuel.app`
   - Vercel will ask if you want to move it from the other project → Click "Move"

2. **Delete the OLD project**:
   - Go to the old/unused project
   - Settings → Advanced → "Delete Project"
   - Confirm deletion

3. **Verify Environment Variables** in the correct project:
   ```
   VITE_NETWORK=mainnet  ← CRITICAL! (not "theta-mainnet")
   VITE_ROUTER_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
   VITE_TOTAL_RAISED_USD=187500
   ```

4. **Trigger Fresh Deployment**:
   - Deployments tab
   - Click "..." on latest deployment → "Redeploy"
   - **Turn OFF** "Use existing Build Cache"
   - Click "Redeploy"

#### Option B: Just Fix Domain (If You're Unsure)

If you're not sure which to delete yet:

1. Check which project has `xfuel.app`:
   - Project A → Settings → Domains
   - Project B → Settings → Domains

2. The one **WITHOUT** `xfuel.app` is likely the old one

3. Move domain to correct project (see Option A step 1)

---

## Verification

After fixing, verify:

### Check Domain Resolution
```bash
# In your browser
https://xfuel.app
```

Should show:
- ✅ RED beta warning banner (not purple)
- ✅ Latest code with all fixes

### Check Vercel Dashboard
- Only ONE project should exist: `xfuel-protocol`
- Domain `xfuel.app` should be listed in that project
- Latest deployment should be from `main` branch with your recent commit

---

## Why This Happened

When learning Vercel, it's common to:
1. Create a project via CLI (`vercel`)
2. Later create another via Dashboard or `vercel --prod`
3. End up with 2 projects pointing to same repo

Vercel doesn't automatically merge them - you have to manually consolidate.

---

## Prevention

After consolidating:

1. **Use Git Push for Deployments**:
   ```bash
   git push origin main
   ```
   Vercel auto-deploys from GitHub (no need for `vercel` CLI)

2. **Avoid Manual Deploys**:
   - Don't use `vercel deploy` from CLI
   - Use GitHub integration instead

3. **One Project per Repo**:
   - Keep only ONE Vercel project per GitHub repo
   - Use deployment branches (main, staging) instead of multiple projects

---

## Troubleshooting

### If Domain Won't Move

If Vercel says domain is "in use" and won't let you move it:

1. Go to the OLD project
2. Settings → Domains
3. Remove `xfuel.app` (click trash icon)
4. Go to the NEW project
5. Settings → Domains → Add `xfuel.app`

### If Still Showing Old Code After Redeploy

1. **Clear Vercel cache**:
   - Deployments → Latest → "..." menu → "Redeploy"
   - **Uncheck** "Use existing Build Cache"

2. **Check Git branch**:
   - Ensure project is deploying from `main` branch
   - Settings → Git → Production Branch: `main`

3. **Check Environment Variables**:
   - Settings → Environment Variables
   - `VITE_NETWORK` must be `mainnet`
   - Apply to "Production" scope

4. **Hard refresh browser**:
   - Chrome: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   - This clears cached JS/CSS

---

## Quick Command Reference

```bash
# Check local Vercel config
cat .vercel/project.json

# Push to GitHub (triggers Vercel deploy)
git push origin main

# View Vercel projects (requires Vercel CLI)
vercel ls

# Link to different project (if needed)
vercel link
```

---

## Need Help?

If you're still stuck, share:
1. Screenshot of your Vercel dashboard showing both projects
2. Which project has `xfuel.app` domain
3. Latest deployment URL from each project

I can then give you exact steps to consolidate.

---

*This is a one-time fix. After consolidating, you'll have a clean setup.*



