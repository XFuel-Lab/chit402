# Cypress E2E Testing Guide

## Issue: "Cannot Connect Base Url"

**Error Message:**
```
Cypress could not verify that this server is running:
http://localhost:3000
```

**Solution:** The dev server needs to be running before Cypress can connect.

---

## ✅ **Easy Fix: Use Updated Commands**

The package.json has been updated with scripts that **automatically start the server**:

### **Option 1: Open Cypress UI (Recommended)**
```bash
npm run cypress:open
```
This will:
1. ✅ Start Vite dev server on port 3000
2. ✅ Wait for server to be ready
3. ✅ Open Cypress UI automatically

### **Option 2: Run Headless**
```bash
npm run test:e2e:headless
```

---

## 🛠️ **Manual Method** (If you prefer)

If you want to run the server separately:

### **Terminal 1: Start Dev Server**
```bash
npm run dev
```
Wait for:
```
  ➜  Local:   http://localhost:3000/
  ➜  press h + enter to show help
```

### **Terminal 2: Open Cypress**
```bash
npm run cypress:open:only
```

---

## 📋 **Script Reference**

| Command | What It Does |
|---------|-------------|
| `npm run cypress:open` | ✅ **Auto-start server + open Cypress UI** (Recommended) |
| `npm run test:e2e` | ✅ Same as above (alias) |
| `npm run test:e2e:headless` | ✅ Auto-start server + run all tests headless |
| `npm run cypress:open:only` | Open Cypress only (requires server running) |
| `npm run cypress:run:only` | Run tests only (requires server running) |

---

## 🔧 **Configuration Details**

### **Vite Config** (`vite.config.ts`)
```typescript
server: {
  port: 3000,  // ✅ Matches Cypress baseUrl
  open: true,
}
```

### **Cypress Config** (`cypress.config.ts`)
```typescript
e2e: {
  baseUrl: 'http://localhost:3000',  // ✅ Matches Vite port
}
```

---

## 🧪 **Running Wallet Integration Tests**

### **E2E Tests:**
```bash
# Auto-start server and open Cypress
npm run cypress:open

# Then select: wallet-integration.cy.ts
```

### **Unit Tests:** (Don't need server)
```bash
npm test -- src/utils/__tests__/walletConnectPro.test.ts
npm test -- src/utils/__tests__/cosmosLSTStakingPro.test.ts
```

---

## 🐛 **Troubleshooting**

### **Port 3000 Already in Use?**

**Check what's using it:**
```bash
# Windows
netstat -ano | findstr :3000

# Linux/Mac
lsof -i :3000
```

**Kill the process:**
```bash
# Windows
taskkill /PID <PID> /F

# Linux/Mac
kill -9 <PID>
```

**Or change the port in both configs:**

`vite.config.ts`:
```typescript
server: {
  port: 5173,  // New port
}
```

`cypress.config.ts`:
```typescript
e2e: {
  baseUrl: 'http://localhost:5173',  // Match new port
}
```

---

## 📊 **Expected Test Flow**

### **1. Start Tests**
```bash
npm run cypress:open
```

### **2. Wait for Server** (Automatic)
```
  VITE v5.0.0  ready in 1234 ms

  ➜  Local:   http://localhost:3000/
  ➜  press h + enter to show help
```

### **3. Cypress Opens**
```
Opening Cypress...
```

### **4. Select Test**
Click on: `wallet-integration.cy.ts`

### **5. Watch Tests Run** 🎬
- ✅ Theta Wallet connection
- ✅ WalletConnect QR flow
- ✅ Keplr integration
- ✅ Complete swap flow
- ✅ Error recovery

---

## ✨ **Pro Tips**

### **Run Specific Test**
```bash
# Start server manually
npm run dev

# In another terminal
npx cypress open --spec "cypress/e2e/wallet-integration.cy.ts"
```

### **Debug Mode**
```bash
# Open Cypress with debug logs
DEBUG=cypress:* npm run cypress:open:only
```

### **CI/CD Mode**
```bash
# Headless with video recording
npm run test:e2e:headless
```

Videos saved to: `cypress/videos/`

---

## 📝 **Quick Checklist**

Before running E2E tests:

- [ ] `npm install` completed
- [ ] Port 3000 is available
- [ ] `.env.local` configured (optional for mocked tests)
- [ ] Run: `npm run cypress:open`

---

## 🎯 **Next Steps**

1. **Run E2E tests:**
   ```bash
   npm run cypress:open
   ```

2. **Select test file:**
   - `wallet-integration.cy.ts` - Wallet integration tests

3. **Watch tests pass:** All scenarios should pass with mocked wallets

4. **Test with real wallets:**
   - Install Theta Wallet extension
   - Install Keplr extension
   - Connect real wallets during tests

---

## 📚 **Related Documentation**

- **Integration Guide:** `docs/THETA_WALLET_INTEGRATION_GUIDE.md`
- **Test Summary:** `TESTS_PASSING_SUMMARY.md`
- **Deployment:** `DEPLOYMENT_CHECKLIST_WALLET_INTEGRATION.md`

---

**Status:** ✅ Ready to Test  
**Server:** Port 3000  
**Command:** `npm run cypress:open`

🚀 **Happy testing!**




