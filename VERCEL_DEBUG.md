# Vercel Deployment Debug Checklist

## Current State (Verified ✅)
- ✅ Latest commit on `main`: `6b7b286` - "Use terser for minification"
- ✅ `vite.config.ts` on GitHub: `minify: 'terser'`
- ✅ `package.json` on GitHub: `"terser": "^5.44.1"` installed
- ✅ Local build works perfectly with terser

## Things to Check in Vercel Dashboard:

1. **Which branch is Vercel building from?**
   - Go to: Project Settings → Git → Production Branch
   - Should be: `main`
   - If different, change it to `main`

2. **Which commit is Vercel building?**
   - Check the deployment logs
   - Should show commit: `6b7b286` or later
   - If older, trigger a new deployment

3. **Clear Vercel's build cache:**
   - Go to: Project Settings → General
   - Click "Clear Build Cache"
   - Or redeploy with "Clear Cache and Deploy" option

4. **Check the install command:**
   - Go to: Project Settings → General → Build & Development Settings
   - Install Command should be: `npm install --legacy-peer-deps`
   - This ensures terser gets installed

5. **Check Node.js version:**
   - Vercel should use Node 24 (from `.nvmrc` file)
   - Or check: Project Settings → General → Node.js Version

## If Still Failing:

The error says "terser not found" but:
- ✅ terser IS in package.json
- ✅ vite.config.ts uses terser
- ✅ Local build works

This suggests Vercel's `npm install` isn't installing terser. Try:

**Option 1: Force install terser in vercel.json**
```json
{
  "installCommand": "npm install --legacy-peer-deps && npm install terser --save-dev"
}
```

**Option 2: Check if Vercel is using npm ci instead of npm install**
- npm ci ignores devDependencies in some cases
- Make sure installCommand uses `npm install` not `npm ci`

