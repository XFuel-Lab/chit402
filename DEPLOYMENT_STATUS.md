# 🚀 Persistence Deployment Status - Retry After Optimization

## ✅ Optimization Complete

### Contract Sizes
- **ZK Verifier**: 228 KB → **166 KB** (25.4% reduction)
- **ibcTFUEL Minter**: 257 KB → **194 KB** (24.3% reduction)

### Files Generated
```
artifacts/
├── zk_verifier.wasm (170,104 bytes / 166.12 KB)
├── ibc_tfuel_minter.wasm (199,144 bytes / 194.48 KB)
└── checksums.txt
```

## 🔧 Script Updates Applied

### Gas Limits Increased
- **Store code**: 1,000,000 → **1,500,000** gas
- **Gas adjustment**: 1.5x → **1.8x**
- **ZK init**: 400,000 → **500,000** gas
- **Minter init**: 500,000 → **600,000** gas
- **Gas price**: 0.025 uxprt (unchanged)

### Better Error Handling
- Enhanced error logging
- TX hash extraction from non-JSON responses
- Manual Code ID input fallback
- Explorer link display

## 📤 Deployment Attempts

### Wallet Info
- **Address**: `persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy`
- **Balance**: 244.847 XPRT (sufficient ✅)
- **Chain**: core-1 (Persistence mainnet)

### Transaction History
1. **First attempt** (TX: `EEBC37B841748388388CE50F51B030FF8F18BB83D0869BB1D98A8B0C2EBF560E`)
   - ZK Verifier upload
   - Status: Pending verification

2. **Second attempt** (TX: `27D668D3ECE0C271EE313A3AB4E9A48DC26B0606D922D13B8370EF826C2F0ECB`)
   - ZK Verifier upload with increased gas
   - Status: Pending verification

## 🔍 Manual Verification Steps

### Check Transaction Status

```bash
# View on Mintscan Explorer
https://www.mintscan.io/persistence/tx/27D668D3ECE0C271EE313A3AB4E9A48DC26B0606D922D13B8370EF826C2F0ECB

# Or query via RPC
curl -s "https://rpc.core.persistence.one:443/tx?hash=0x27D668D3ECE0C271EE313A3AB4E9A48DC26B0606D922D13B8370EF826C2F0ECB" | jq '.'
```

### If Transaction Succeeded

Look for `code_id` in the transaction events. It will be a number (e.g., 123).

### Continue Deployment Manually

If you get the Code IDs from Mintscan, you can continue with instantiation:

```bash
# Set variables
export ZK_CODE_ID=<your_code_id>
export MINTER_CODE_ID=<minter_code_id>
export DEPLOYER_ADDR=persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy

# Instantiate ZK Verifier
docker-compose run --rm persistence-deployer persistenceCore tx wasm instantiate $ZK_CODE_ID \
  '{"admin":"'$DEPLOYER_ADDR'","minter_contract":null}' \
  --from deployer \
  --label "xfuel-zk-verifier-v1" \
  --gas 500000 --gas-adjustment 1.8 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --admin $DEPLOYER_ADDR \
  --yes
```

## ⚠️ Known Issues

### Docker Container Issue
The `persistenceCore` binary in the Docker container has an architecture mismatch:
```
/usr/local/bin/persistenceCore: cannot execute binary file
```

This prevents the script from querying transactions to extract Code IDs automatically.

### Workaround Options

**Option 1**: Manual verification via Mintscan
- Check transactions on explorer
- Extract Code IDs manually
- Continue deployment with manual commands

**Option 2**: Fix Dockerfile
- Update `Dockerfile.persistence` to use correct architecture binary
- Rebuild container
- Retry full deployment

**Option 3**: Use testnet first
- Switch to test-core-1 (testnet)
- Get tokens from faucet
- Test deployment there first

## 🧪 Testnet Fallback (If Needed)

If mainnet continues to have issues, switch to testnet:

```bash
# Update script to use testnet
sed -i 's/core-1/test-core-1/g' scripts/docker-deploy-persistence.sh
sed -i 's/rpc.core.persistence.one/rpc.testnet.persistence.one/g' scripts/docker-deploy-persistence.sh

# Get testnet tokens from faucet
# Visit: https://faucet.persistence.one/
```

## 📊 Cost Estimate

With current gas settings:
- **Store ZK Verifier**: ~1.5M gas × 0.025 uxprt = 0.0375 XPRT
- **Store Minter**: ~1.5M gas × 0.025 uxprt = 0.0375 XPRT
- **Instantiate ZK**: ~500K gas × 0.025 uxprt = 0.0125 XPRT
- **Instantiate Minter**: ~600K gas × 0.025 uxprt = 0.015 XPRT
- **Total**: ~0.1 XPRT (~$0.02 USD)

Your balance (244.847 XPRT) is more than sufficient.

## ✅ Next Steps

1. **Check transaction on Mintscan** (link above)
2. **If successful**: Extract Code ID and continue
3. **If failed**: Review error and adjust gas/size
4. **If persistent issues**: Switch to testnet for testing

## 📝 Configuration

Current deployment targets:
- **Max Supply**: 100000000000000000000 (0.1 TFUEL in wei)
- **Admin**: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
- **Pause**: Enabled (admin-only)
- **ZK Verification**: Mock Groth16 (for testing)

---

**Status**: Transactions submitted, awaiting verification  
**Updated**: 2026-01-04 06:46 UTC  
**Retry command**: `docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh`

