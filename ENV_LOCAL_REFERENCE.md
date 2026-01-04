# .env.local Configuration Reference

Copy this into your `.env.local` file:

```bash
VITE_WALLETCONNECT_PROJECT_ID=da2f60b8b41bcaf71845e092efdb4186

VITE_MAINTENANCE=true

# ============================================
# Deployment Configuration
# ============================================
# These variables are required for mainnet deployment and validation

# Path to your encrypted keystore file (JSON format)
# Example: ./keystore/deployer-mainnet.json
DEPLOYER_MAINNET_KEYSTORE_PATH=

# Password to decrypt the keystore (store securely, never commit)
DEPLOYER_KEYSTORE_PASSWORD=

# EVM Addresses (must be valid 0x... format)
DEPLOYER_ADDRESS=0xDC17Cbd201E7347555e428690f702bbFcAF2d33c
RELAYER_ADDRESS=0x627082bFAdffb16B979d99A8eFc8F1874c0990C4
TREASURY_ADDRESS=0x043d5231651379970d52a13CEfB4e80733DDb989

# ============================================
# AWS Configuration
# ============================================
# AWS credentials for accessing Secrets Manager

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=bhFZ8fF+X24iMiUDQosqRpvvVIpEaM2+gqL0viXm
```

## Key Points

1. **DEPLOYER_ADDRESS** changed from `0x627082b...` to `0xDC17Cbd...`
2. **RELAYER_ADDRESS** is now `0x627082b...` (the old deployer)
3. **TREASURY_ADDRESS** is `0x043d523...` (your new controlled treasury)
4. **AWS_SECRET_ACCESS_KEY** appears to be set (based on your cursor position)

## After Updating

Save the file and run:
```bash
node validate-env.js
```

Expected result with these addresses:
- ✅ DEPLOYER_ADDRESS: Valid
- ✅ RELAYER_ADDRESS: Valid  
- ✅ TREASURY_ADDRESS: Valid
- ✅ AWS_REGION: Valid
- ❌ DEPLOYER_MAINNET_KEYSTORE_PATH: Not set (optional)
- ❌ AWS_ACCESS_KEY_ID: Not set (needs to be added if you have it)

