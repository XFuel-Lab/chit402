# Fixing Cache Issues - Changes Not Reflecting

## Problem
Changes to Early Believers modal (removing 100% button, adding gas preview) not showing after restarting dev server.

## Solutions (try in order):

### 1. Hard Refresh Browser
- **Chrome/Edge**: `Ctrl + Shift + R` or `Ctrl + F5`
- **Firefox**: `Ctrl + Shift + R` or `Ctrl + F5`
- **Safari**: `Cmd + Shift + R`

### 2. Clear Browser Cache
- Open DevTools (F12)
- Right-click refresh button → "Empty Cache and Hard Reload"
- Or: Settings → Clear browsing data → Cached images and files

### 3. Clear Vite Cache
```bash
# Stop dev server (Ctrl+C)
# Delete Vite cache
rm -rf node_modules/.vite
# Or on Windows:
rmdir /s node_modules\.vite

# Restart dev server
npm run dev
```

### 4. Clear All Build Caches
```bash
# Stop dev server
# Delete all caches
rm -rf node_modules/.vite
rm -rf dist
rm -rf .vite

# On Windows PowerShell:
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .vite -ErrorAction SilentlyContinue

# Restart
npm run dev
```

### 5. Verify Changes Are Committed
```bash
# Check if changes are staged
git status

# If changes are staged but not committed, commit them:
git commit -m "fix(ui): remove duplicate 100% button + user pays gas"

# Then restart dev server
npm run dev
```

### 6. Nuclear Option - Full Clean
```bash
# Stop dev server
# Delete everything
rm -rf node_modules
rm -rf .vite
rm -rf dist

# Reinstall
npm install

# Restart
npm run dev
```

## Price Not Updating Issue

The price fetching has been improved with:
- Better error handling
- Cache control headers
- Console logging for debugging
- Fallback only if no price exists

Check browser console (F12) for:
- `✅ TFUEL price fetched: [price]` - Success
- `❌ Error fetching TFUEL price: [error]` - Failure
- `⚠️ Using fallback price: $0.05` - Using fallback

Common causes:
1. CoinGecko API rate limiting (free tier: 10-50 calls/min)
2. Network/CORS issues
3. API endpoint changed

Solution: Check console logs to see what's happening.

