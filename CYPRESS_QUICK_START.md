# 🚀 Quick Start: Running Cypress Tests

## ⚡ **TL;DR** (Easiest Way)

### **Step 1: Start Dev Server** (Terminal 1)
```bash
npm run dev
```
Wait for: `➜ Local: http://localhost:3000/`

### **Step 2: Run Cypress** (Terminal 2)
```bash
npm run cypress:open
```

That's it! 🎉

---

## 📋 **Detailed Instructions**

### **Option 1: Manual (Recommended for Development)**

**Terminal 1 - Start Server:**
```bash
npm run dev
```

**Terminal 2 - Open Cypress:**
```bash
npm run cypress:open
# or
npm run test:e2e
```

### **Option 2: Single Command (Coming Soon)**
```bash
# Install helper package first
npm install --save-dev start-server-and-test

# Then update package.json script to:
"cypress:open": "start-server-and-test dev http://localhost:3000 'cypress open'"

# Then just run:
npm run cypress:open
```

---

## 🎯 **What Each Command Does**

```bash
npm run dev                # Starts Vite dev server on port 3000
npm run cypress:open       # Opens Cypress (needs server running)
npm run test:e2e:headless  # Runs all E2E tests headless
```

---

## ✅ **Verify It's Working**

### **1. Dev Server Started:**
```
  VITE v5.0.0  ready in 456 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### **2. Cypress Opens:**
```
Opening Cypress...
```

### **3. Select Test:**
Click on: `wallet-integration.cy.ts`

### **4. Tests Run:**
All tests should pass with mocked wallets! ✅

---

## 🐛 **Troubleshooting**

### **Error: "Cannot connect to baseUrl"**

**Cause:** Dev server not running

**Fix:**
```bash
# Terminal 1
npm run dev

# Wait for "Local: http://localhost:3000/" message
# Then in Terminal 2:
npm run cypress:open
```

### **Error: "Port 3000 already in use"**

**Find what's using it:**
```bash
netstat -ano | findstr :3000
```

**Kill it:**
```bash
taskkill /PID <PID> /F
```

**Or use different port:**

Edit `vite.config.ts` and `cypress.config.ts` to use port 5173 instead.

---

## 📊 **Test Files Available**

| File | Description | Status |
|------|-------------|--------|
| `wallet-integration.cy.ts` | Wallet connection flows | ✅ Ready |
| `swap.cy.ts` | Swap functionality | ✅ Existing |
| `theta-wallet-qr.cy.ts` | QR code flow | ✅ Existing |

---

## 🎓 **Pro Tips**

### **Run Single Test:**
```bash
npx cypress run --spec "cypress/e2e/wallet-integration.cy.ts"
```

### **Watch Mode:**
Cypress automatically watches for file changes when UI is open.

### **Debug:**
Use `cy.pause()` in tests to pause execution.

---

## 📝 **Quick Reference**

```bash
# Start dev server (always do this first!)
npm run dev

# Open Cypress UI (in another terminal)
npm run cypress:open

# Run headless
npm run test:e2e:headless

# Unit tests (don't need server)
npm test
```

---

## ✨ **Next Steps**

1. **Start server:** `npm run dev` (Terminal 1)
2. **Open Cypress:** `npm run cypress:open` (Terminal 2)
3. **Select test:** `wallet-integration.cy.ts`
4. **Watch tests pass!** 🎉

---

**Status:** ✅ Ready  
**Port:** 3000  
**Method:** Manual (2 terminals)

🚀 **Let's test!**



