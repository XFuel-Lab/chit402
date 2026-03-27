# ✅ MAINNET DEPLOYMENT - CORRECTED CONFIGURATION

**Updated:** February 4, 2026  
**Status:** Ready with Corrected Values

---

## 🔧 CORRECTED DEPLOYMENT CONFIGURATION

### Key Name and Addresses
```bash
KEY_NAME="PERSISTENCE_DEPLOYER"
DEPLOYER_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
ADMIN_ADDRESS="persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e"
```

### Security Setup
- **Mnemonic Storage:** AWS Secrets Manager
- **Secret Name:** `PERSISTENCE_DEPLOYER`
- **Key Type:** Mnemonic (BIP39)
- **Derivation:** Standard Cosmos HD path
- **Keyring Backend:** `file` (production-safe)

### Multisig Configuration
- **Type:** 2-of-2 multisig
- **Signer 1:** PERSISTENCE_DEPLOYER (persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx)
- **Signer 2:** <Second signer in multisig>
- **Admin Address:** persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e

---

## 📝 WHAT WAS CORRECTED

### Before (Incorrect)
```bash
KEY_NAME="SP1_PRIVATE_KEY"
# Private key based authentication
# No explicit deployer address
```

### After (Correct)
```bash
KEY_NAME="PERSISTENCE_DEPLOYER"
DEPLOYER_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
# Mnemonic-based authentication from AWS Secrets Manager
# Explicit deployer address with multisig admin
```

---

## 🚀 QUICK START

### 1. Import Key from AWS Secrets Manager

```bash
# Automated secure import
#!/bin/bash
KEY_NAME="PERSISTENCE_DEPLOYER"
EXPECTED_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"

# Check if key exists
if ! persistenced keys show $KEY_NAME -a --keyring-backend file >/dev/null 2>&1; then
    echo "Importing key from AWS Secrets Manager..."
    
    # Retrieve mnemonic (adjust for your secret format)
    MNEMONIC=$(aws secretsmanager get-secret-value \
        --secret-id "PERSISTENCE_DEPLOYER" \
        --query SecretString \
        --output text)
    
    # Import to keyring
    echo "$MNEMONIC" | persistenced keys add $KEY_NAME \
        --recover \
        --keyring-backend file
    
    # Clear from memory
    MNEMONIC=""
    unset MNEMONIC
fi

# Verify address
DERIVED=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
if [ "$DERIVED" != "$EXPECTED_ADDRESS" ]; then
    echo "❌ ERROR: Address mismatch!"
    exit 1
fi

echo "✅ Key ready: $DERIVED"
```

### 2. Verify Wallet Balance

```bash
persistenced query bank balances persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx \
  --node https://rpc.persistence.one:443 \
  --output json | jq '.balances[] | select(.denom=="uxprt")'
```

### 3. Deployment Commands (All Updated)

All commands in `MAINNET_DEPLOYMENT_SCRIPT.md` now use:
- `--from PERSISTENCE_DEPLOYER`
- `--admin persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e`
- `--keyring-backend file`
- Hardcoded RPC and chain-id for safety

---

## 🔐 SECURITY IMPROVEMENTS

### Before
❌ Private key approach
❌ Less secure key management
❌ No explicit deployer tracking

### After
✅ Mnemonic from AWS Secrets Manager
✅ Production keyring backend (`file`)
✅ Explicit deployer address
✅ Multisig admin for critical operations
✅ Address verification before deployment
✅ No temporary files with secrets

---

## 📋 DEPLOYMENT CHECKLIST

**Pre-Deployment:**
- [ ] PERSISTENCE_DEPLOYER mnemonic in AWS Secrets Manager
- [ ] Key imported to persistenced keyring
- [ ] Address verified: persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
- [ ] Wallet has 10+ XPRT
- [ ] Multisig signers coordinated

**Deployment:**
- [ ] Upload persistence_minter.wasm
- [ ] Upload fee_collector.wasm
- [ ] Instantiate minter (pause immediately)
- [ ] Instantiate fee-collector
- [ ] Update fee_collector address
- [ ] Verify all configs

**Testing:**
- [ ] Unpause for test
- [ ] Burn 0.05 TFUEL
- [ ] Verify fee = 0.5%
- [ ] Verify burn = 99.5%
- [ ] Pause again

---

## 🎯 OPERATIONS REQUIRING MULTISIG

**Single-Signer (PERSISTENCE_DEPLOYER alone):**
- Upload WASM
- Instantiate contracts
- Pause/unpause (if in multisig)
- User operations (burn_for_unwrap)

**Multi-Signer (2-of-2 required):**
- Update verifier address
- Update rev_splitter address
- Update fee_collector address
- Migrate contracts
- Change admin

---

## 📚 UPDATED DOCUMENTS

All deployment documents updated with correct values:

✅ `MAINNET_DEPLOYMENT_SCRIPT.md` - Complete deployment guide
✅ `MAINNET_DEPLOYMENT_CHECKLIST.md` - Execution tracking
✅ `MAINNET_DEPLOYMENT_CORRECTED.md` - This summary (NEW)

---

## 🔑 KEY COMMANDS SUMMARY

**Import Key:**
```bash
aws secretsmanager get-secret-value --secret-id "PERSISTENCE_DEPLOYER" | \
  persistenced keys add PERSISTENCE_DEPLOYER --recover --keyring-backend file
```

**Upload WASM:**
```bash
persistenced tx wasm store <file> \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 -y
```

**Instantiate:**
```bash
persistenced tx wasm instantiate <code_id> '<msg>' \
  --from PERSISTENCE_DEPLOYER \
  --admin persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 -y
```

**Pause:**
```bash
persistenced tx wasm execute <contract> '{"pause":{}}' \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 -y
```

---

## ✅ READY FOR DEPLOYMENT

All configuration has been corrected and verified. The deployment script is ready for execution with the correct:

- ✅ Key name: `PERSISTENCE_DEPLOYER`
- ✅ Deployer address: `persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx`
- ✅ Admin (multisig): `persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e`
- ✅ Mnemonic from AWS Secrets Manager
- ✅ Production keyring backend
- ✅ All commands updated

**Next Step:** Follow `MAINNET_DEPLOYMENT_SCRIPT.md` from Step 0 onwards.

---

**Document:** `MAINNET_DEPLOYMENT_CORRECTED.md`  
**Version:** 1.0 (Corrected)  
**Date:** February 4, 2026
