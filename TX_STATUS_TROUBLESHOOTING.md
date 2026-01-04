# 🔍 Transaction Status Check & Troubleshooting

## 📊 Your Transaction

**TX Hash:** `CF5D03E0DA121147396981F8F4D601BD140B0814B429F10AFF1A3859F0DD351F`

**Direct Links:**
- **Mintscan Explorer:** https://www.mintscan.io/persistence/tx/CF5D03E0DA121147396981F8F4D601BD140B0814B429F10AFF1A3859F0DD351F
- **API Query:** https://lcd.core.persistence.one/cosmos/tx/v1beta1/txs/CF5D03E0DA121147396981F8F4D601BD140B0814B429F10AFF1A3859F0DD351F

---

## ✅ HOW TO CHECK STATUS

### Method 1: Mintscan Explorer (Easiest)

1. **Open in browser:** https://www.mintscan.io/persistence/tx/CF5D03E0DA121147396981F8F4D601BD140B0814B429F10AFF1A3859F0DD351F

2. **Look for:**
   - ✅ **Success** badge (green) = Transaction succeeded!
   - ❌ **Failed** badge (red) = Transaction failed

3. **If SUCCESS:**
   - Scroll to "Events" section
   - Find event type: `store_code`
   - Look for attribute: `code_id`
   - Note the number (e.g., 123)
   - **This is your ZK Verifier Code ID!**

4. **If FAILED:**
   - Look at "Error" or "Raw Log" section
   - Common errors and solutions below ⬇️

---

## 🔧 COMMON FAILURE SCENARIOS & FIXES

### ❌ Error 1: "out of gas" / "gas limit exceeded"

**Cause:** Contract too large or gas limit too low

**Current Settings:**
- Gas: 1,500,000
- Gas adjustment: 1.8x
- Contract size: 166 KB (ZK Verifier)

**Fix:**
```bash
# Increase gas further
# Edit scripts/docker-deploy-persistence.sh line ~82:
--gas 2000000 --gas-adjustment 2.0
```

**Then retry:**
```bash
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest \
  /app/scripts/docker-deploy-persistence.sh
```

---

### ❌ Error 2: "contract too large" / "code 4"

**Cause:** Contract exceeds chain limits (even after optimization)

**Current Size:** 166 KB (ZK Verifier), 194 KB (Minter)

**Options:**

#### Option A: Further Optimization
Try more aggressive optimization:
```bash
# Use even more aggressive wasm-opt flags
docker run --rm -v "${PWD}:/app" -w /app emscripten/emsdk:3.1.50 \
  /emsdk/upstream/bin/wasm-opt -O4 -Oz --strip-debug --strip-producers \
  target/wasm32-unknown-unknown/release/zk_verifier.wasm \
  -o artifacts/zk_verifier_ultra.wasm

# Check new size
ls -lh artifacts/zk_verifier_ultra.wasm
```

#### Option B: Split Functionality
- Deploy ZK verifier with minimal features
- Upgrade later with more features
- Or split into multiple contracts

#### Option C: Test on Testnet First
```bash
# Switch to testnet (test-core-1)
# Update script to use testnet RPC
# Get free tokens from faucet
# Test there first before mainnet
```

---

### ❌ Error 3: "insufficient funds" / "out of coins"

**Your Balance:** 244.81 XPRT (should be plenty!)

**Cost Estimate:** ~0.1 XPRT total

**If this happens:**
1. Check actual balance on explorer
2. Ensure you're using the right account
3. Wait for pending TXs to complete

---

### ❌ Error 4: "invalid signature" / "unauthorized"

**Cause:** Mnemonic mismatch or keyring issue

**Fix:**
```bash
# Check .env.docker has correct KEPLR_MNEMONIC
# Verify it's the 12 or 24 word phrase
# Ensure no extra spaces or quotes

# Test wallet import:
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest bash -c '
  echo "$KEPLR_MNEMONIC" | persistenceCore keys add test --recover --keyring-backend test
  persistenceCore keys show test -a --keyring-backend test
'
```

---

### ❌ Error 5: "wasm contract validation failed"

**Cause:** WASM binary issue

**Fix:**
```bash
# Validate WASM files
docker run --rm -v "${PWD}:/app" emscripten/emsdk:3.1.50 \
  /emsdk/upstream/bin/wasm-validate /app/artifacts/zk_verifier.wasm

# If invalid, rebuild:
cd cosmwasm/zk-verifier
cargo clean
cargo build --release --target wasm32-unknown-unknown
# Then re-optimize
```

---

## 🎯 RETRY STRATEGIES

### Strategy 1: Simple Retry (If Temporary Network Issue)

```bash
# Just run again - script picks up where it left off
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest \
  /app/scripts/docker-deploy-persistence.sh
```

### Strategy 2: Manual Step-by-Step

If script keeps failing, deploy manually:

```bash
# 1. Get into container
docker run -it --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest bash

# 2. Import wallet
echo "$KEPLR_MNEMONIC" | persistenceCore keys add deployer --recover --keyring-backend test

# 3. Get address
persistenceCore keys show deployer -a --keyring-backend test

# 4. Upload ZK Verifier
persistenceCore tx wasm store /app/artifacts/zk_verifier.wasm \
  --from deployer \
  --gas 2000000 \
  --gas-adjustment 2.0 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes

# 5. Note the TX hash and check on Mintscan
```

### Strategy 3: Switch to Testnet

```bash
# Create testnet script
cp scripts/docker-deploy-persistence.sh scripts/deploy-testnet.sh

# Edit deploy-testnet.sh:
# - Change core-1 → test-core-1
# - Change rpc.core.persistence.one → rpc.testnet.persistence.one

# Get testnet tokens
# Visit: https://faucet.persistence.one/

# Deploy to testnet
docker run --rm -v "${PWD}:/app" --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest \
  /app/scripts/deploy-testnet.sh
```

---

## 📋 WHAT TO LOOK FOR ON MINTSCAN

### If Transaction SUCCEEDED ✅

You should see:
```
Status: Success
Height: [block number]

Events:
  - Type: store_code
    Attributes:
      - code_id: 123  ← YOUR CODE ID!
      - sender: persistence1cgzp...
```

**Next Steps:**
1. Note the `code_id` (e.g., 123)
2. Continue with minter deployment
3. Or manually instantiate contracts

### If Transaction FAILED ❌

You'll see:
```
Status: Failed
Error: [detailed error message]
Raw Log: [technical details]
```

**Action:**
1. Copy the exact error message
2. Match to common errors above
3. Apply the fix
4. Retry deployment

---

## 🆘 EMERGENCY FALLBACK: USE EXISTING TX

If the TX actually succeeded but script couldn't detect it:

1. **Get Code ID from Mintscan** (see instructions above)
2. **Set environment variable:**
   ```bash
   export ZK_CODE_ID=123  # Replace with your actual Code ID
   ```
3. **Continue with minter:**
   ```bash
   # Deploy minter
   docker run --rm -v "${PWD}:/app" --env-file .env.docker \
     -e ZK_CODE_ID=$ZK_CODE_ID \
     xfuel-protocol-persistence-deployer:latest bash -c '
     persistenceCore tx wasm store /app/artifacts/ibc_tfuel_minter.wasm \
       --from deployer \
       --gas 2000000 \
       --gas-adjustment 2.0 \
       --gas-prices 0.025uxprt \
       --chain-id core-1 \
       --node https://rpc.core.persistence.one:443 \
       --keyring-backend test \
       --yes
   '
   ```

---

## 📞 QUICK DIAGNOSTIC COMMANDS

```bash
# Check Docker image
docker images | grep persistence

# Check wallet
docker run --rm --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest bash -c '
  echo "$KEPLR_MNEMONIC" | persistenceCore keys add test --recover --keyring-backend test 2>&1
  persistenceCore keys show test -a --keyring-backend test
'

# Check balance
docker run --rm --env-file .env.docker \
  xfuel-protocol-persistence-deployer:latest bash -c '
  ADDR=$(echo "$KEPLR_MNEMONIC" | persistenceCore keys add test --recover --keyring-backend test 2>&1 | grep -oP "persistence1\w+")
  persistenceCore query bank balances $ADDR --node https://rpc.core.persistence.one:443
'

# Check artifacts
ls -lh artifacts/*.wasm
```

---

## 🎯 ACTION PLAN

1. **First:** Open Mintscan link and check TX status
2. **If Success:** Note Code ID and continue
3. **If Failed:** Match error to scenarios above
4. **Apply Fix:** Update settings or contracts as needed
5. **Retry:** Run deployment again

**Your transaction is in the blockchain now. Let's see what happened!** 🔍

Open this link in your browser:
**https://www.mintscan.io/persistence/tx/CF5D03E0DA121147396981F8F4D601BD140B0814B429F10AFF1A3859F0DD351F**

Let me know what you see and I'll help you proceed! 🚀

