# 🚀 Step 4: Persistence Deploy - Quick Start

**Ferrari Hybrid Tokenomics v3.0 - TL;DR Guide**

---

## ⚡ 30-Minute Deployment

### Prerequisites Check

✅ Rust installed (`cargo --version`)  
✅ Docker running (`docker ps`)  
✅ Keplr wallet with 1+ XPRT  
✅ Persistence CLI installed  
✅ Steps 1-3 complete (Theta side working)  

### 1. Install Tools (5 min)

```bash
./scripts/install-persistence-tools.sh
```

✅ Installs Rust, Circom, SnarkJS, persistenceCore  
✅ Downloads Powers of Tau for Groth16 setup  

### 2. Build Contracts (10 min)

```bash
./scripts/build-cosmwasm.sh
```

✅ Compiles Circom circuits  
✅ Generates verification key  
✅ Builds & optimizes CosmWasm contracts  

### 3. Configure Persistence CLI (2 min)

```bash
# Import your wallet
persistenceCore keys add xfuel-personal --recover

# Check balance
persistenceCore query bank balances \
  $(persistenceCore keys show xfuel-personal -a)

# Expected: 1+ XPRT
```

### 4. Deploy Contracts (5 min)

**Store code:**
```bash
# Store ZK verifier
persistenceCore tx wasm store artifacts/zk_verifier.wasm \
  --from xfuel-personal \
  --gas auto --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --broadcast-mode block \
  --yes

# Note the code_id from output
ZK_CODE_ID=123

# Store minter
persistenceCore tx wasm store artifacts/ibctfuel_minter.wasm \
  --from xfuel-personal \
  --gas auto --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --broadcast-mode block \
  --yes

MINTER_CODE_ID=124
```

**Instantiate:**
```bash
# Instantiate ZK verifier
MULTISIG=$(persistenceCore keys show xfuel-personal -a)

persistenceCore tx wasm instantiate $ZK_CODE_ID \
  '{"admin":"'$MULTISIG'","curve":"bn254","proof_system":"groth16"}' \
  --from xfuel-personal \
  --label "XFuel ZK Verifier" \
  --admin $MULTISIG \
  --gas auto \
  --chain-id core-1 \
  --yes

# Get contract address
ZK_ADDR="persistence1abc..."

# Instantiate minter
persistenceCore tx wasm instantiate $MINTER_CODE_ID \
  '{"name":"ibcTFUEL","symbol":"ibcTFUEL","decimals":18,"zk_verifier":"'$ZK_ADDR'"}' \
  --from xfuel-personal \
  --label "XFuel ibcTFUEL Minter" \
  --admin $MULTISIG \
  --gas auto \
  --chain-id core-1 \
  --yes

MINTER_ADDR="persistence1def..."
```

### 5. Test Mint (5 min)

**Generate proof:**
```bash
node scripts/generate-mock-proof.cjs \
  --theta-tx 0x22bd806268c58152046ea2a20815f018958c99588531cc5ec51a9e524e498d16 \
  --amount 0.0995 \
  --recipient $MULTISIG
```

**Execute mint:**
```bash
# Use the generated proof file
persistenceCore tx wasm execute $MINTER_ADDR \
  "$(cat proof_*.json | jq '.verify_and_mint')" \
  --from xfuel-personal \
  --gas auto \
  --chain-id core-1 \
  --yes
```

**Check balance:**
```bash
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"balance":{"address":"'$MULTISIG'"}}'

# Expected: {"balance": "99500000000000000"}
```

### 6. Test Burn (3 min)

```bash
persistenceCore tx wasm execute $MINTER_ADDR \
  '{"burn":{"amount":"50000000000000000","theta_recipient":"0xDC17Cbd..."}}' \
  --from xfuel-personal \
  --gas auto \
  --chain-id core-1 \
  --yes
```

**Verify unwrap on Theta:**
```bash
# Check backend logs
pm2 logs xfuel-backend | grep "Burn detected"

# Check SubVault balance
node -e "
const ethers = require('ethers');
const provider = new ethers.JsonRpcProvider('https://eth-rpc-api.thetatoken.org/rpc');
provider.getBalance('0x15EA3E50F91F36EFC17B66815451de22251EDAaD')
  .then(b => console.log('SubVault:', ethers.formatEther(b), 'TFUEL'));
"
```

---

## 📊 Expected Results

### Deployment

```
✅ ZK Verifier deployed: persistence1abc...
✅ ibcTFUEL Minter deployed: persistence1def...
✅ Contracts configured
✅ Total cost: ~0.18 XPRT
```

### Mint Test

```
✅ Mock proof generated
✅ Proof verified on-chain
✅ 0.0995 ibcTFUEL minted
✅ Balance updated
✅ Ferrari metrics logged
```

### Burn Test

```
✅ 0.05 ibcTFUEL burned
✅ Backend detected burn
✅ Unwrap triggered on Theta
✅ 70% sent to user
✅ 30% recycled
```

---

## 🎯 Success Criteria

- [ ] Contracts deployed to Persistence
- [ ] ZK verifier validates proofs
- [ ] Minter mints ibcTFUEL
- [ ] Burn triggers unwrap
- [ ] Backend detects events
- [ ] Explorer shows transactions
- [ ] 1:1 peg maintained

---

## 🔗 Quick Links

**Explorers:**
- Persistence: https://www.mintscan.io/persistence
- Theta: https://explorer.thetatoken.org

**Docs:**
- Full Guide: [STEP4_PERSISTENCE_DEPLOY_GUIDE.md](./STEP4_PERSISTENCE_DEPLOY_GUIDE.md)
- Persistence Docs: https://docs.persistence.one/

---

## 🐛 Common Issues

### "insufficient fees"
```bash
# Increase gas price
--gas-prices 0.05uxprt
```

### "out of gas"
```bash
# Increase gas limit
--gas 5000000
```

### "code already exists"
```bash
# Query existing code
persistenceCore query wasm list-code

# Use existing code ID instead of uploading again
```

### "proof verification failed"
```bash
# Regenerate proof
node scripts/generate-mock-proof.cjs --debug

# Check verification key matches
```

---

## ⏭️ Next Steps

### After Step 4 Complete

1. **Monitor peg stability** (1:1 ratio)
2. **Add IBC liquidity** (Persistence → Osmosis)
3. **Step 5: Full E2E test** (Theta → Persist → Theta)
4. **Replace mock ZK** with real Groth16 proofs
5. **Security audit** before increasing caps

---

## 🎉 Progress

✅ Step 1: Theta contracts deployed ✅  
✅ Step 2: Deposit/unwrap tested ✅  
✅ Step 3: Backend integration ✅  
🔄 **Step 4: Persistence minter** ← You are here  
⏭️ Step 5: Full E2E bridge test  

---

**Total Time:** ~30 minutes  
**Cost:** ~0.2 XPRT  
**Risk:** Minimal (0.1 caps, pause enabled)  

---

Run `./scripts/install-persistence-tools.sh` to start! 🎯

