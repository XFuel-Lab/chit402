# Testing Early Believers Hard Cap Feature

## Test Scenarios

### 1. **Progress Bar Display (Below Cap)**
- Set `VITE_TOTAL_RAISED_USD` to a value below 750,000 (e.g., `150000`)
- **Expected:**
  - Progress bar shows percentage (e.g., "20.0% filled")
  - Shows "$150,000 / $750,000 USD" in progress bar
  - Contribute button is enabled
  - Header shows "Early Believers Round — Mainnet Live"

### 2. **Near Cap (Almost Full)**
- Set `VITE_TOTAL_RAISED_USD` to `740000` (98.7% full)
- **Expected:**
  - Progress bar shows "98.7% filled"
  - Shows "$740,000 / $750,000 USD"
  - Contribute button still enabled
  - User can contribute up to remaining $10,000

### 3. **Cap Reached (Exactly at Cap)**
- Set `VITE_TOTAL_RAISED_USD` to `750000` (exactly at cap)
- **Expected:**
  - Progress bar is hidden
  - Header changes to "Early Believers Round Complete"
  - Shows completion message with 🎉 emoji
  - Contribute button is hidden
  - "Close" button appears
  - Waitlist email capture appears

### 4. **Cap Exceeded (Over Cap)**
- Set `VITE_TOTAL_RAISED_USD` to `800000` (over cap)
- **Expected:**
  - Same as "Cap Reached" scenario
  - Progress percentage should cap at 100%

### 5. **Contribution Validation**
- With `VITE_TOTAL_RAISED_USD` set to `740000` (leaving $10k remaining)
- Try to contribute $15,000
- **Expected:**
  - Error message: "This contribution would exceed the round cap. Maximum remaining: $10,000.00 USD."
  - Contribute button is disabled

### 6. **Waitlist Functionality**
- When cap is reached, test email input
- **Expected:**
  - Email input appears
  - "Join Waitlist" button is disabled until valid email entered
  - After submission, shows success message
  - Email is logged to console/webhook

### 7. **Environment Variable Fallback**
- Remove `VITE_TOTAL_RAISED_USD` from env
- Set `VITE_TOTAL_RAISED_API_URL` to a test endpoint
- **Expected:**
  - Falls back to API endpoint
  - If API fails, defaults to $0

### 8. **Real-time Updates**
- Modal should refresh total raised every 30 seconds
- **Expected:**
  - Progress bar updates automatically
  - If cap is reached during viewing, UI updates accordingly

## Quick Test Values for Vercel

Update `VITE_TOTAL_RAISED_USD` in Vercel environment variables:

1. **Test Progress Bar (25%):** `187500`
2. **Test Progress Bar (50%):** `375000`
3. **Test Progress Bar (75%):** `562500`
4. **Test Near Cap (99%):** `742500`
5. **Test Cap Reached:** `750000`
6. **Test Over Cap:** `800000`

## Visual Checks

- ✅ Progress bar has gradient (cyan to purple)
- ✅ Progress percentage is accurate
- ✅ Progress bar text is readable (white with shadow)
- ✅ Completion message is prominent and clear
- ✅ Waitlist form styling matches modal theme
- ✅ All text uses safe wording
- ✅ Mobile responsive

## Console Checks

- Check browser console for:
  - Total raised value being fetched
  - Any errors in fetching from API/env
  - Waitlist submissions being logged

