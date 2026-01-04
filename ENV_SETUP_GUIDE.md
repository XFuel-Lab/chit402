# Environment Setup Guide

This guide explains how to configure your `.env` and `.env.local` files for the XFuel Protocol project.

## File Structure

- **`.env`** - Public configuration (committed to git, bundled into frontend)
- **`.env.local`** - Private/secret configuration (gitignored, never committed)
- **`.env.example`** - Template for `.env` file
- **`.env.local.example`** - Template for `.env.local` file

## Quick Setup

### 1. Frontend-Only Setup (for development)

If you only need to run the frontend:

```bash
# Copy the example file
cp .env.example .env

# Update VITE_WALLETCONNECT_PROJECT_ID if needed
```

### 2. Full Setup (for deployment and validation)

To run deployments and use the validation script:

```bash
# Copy both example files
cp .env.example .env
cp .env.local.example .env.local

# Fill in the required values in .env.local (see below)
```

## Required Environment Variables

### For `validate-env.js` script:

The validation script (`validate-env.js`) requires these variables to be set in `.env.local`:

#### 1. Keystore Configuration

```bash
# Path to your encrypted keystore JSON file
DEPLOYER_MAINNET_KEYSTORE_PATH=./keystore/deployer-mainnet.json

# Password to decrypt the keystore
DEPLOYER_KEYSTORE_PASSWORD=your_secure_password_here
```

**How to create a keystore:**
```bash
# Using ethers.js
node -e "
const ethers = require('ethers');
const wallet = ethers.Wallet.createRandom();
console.log('Address:', wallet.address);
console.log('Private Key:', wallet.privateKey);
// Then encrypt with wallet.encrypt('your-password')
"
```

#### 2. EVM Addresses

```bash
# Your deployer address (must match keystore)
DEPLOYER_ADDRESS=0xDC17Cbd201E7347555e428690f702bbFcAF2d33c

# Address that will relay transactions
RELAYER_ADDRESS=0x627082bFAdffb16B979d99A8eFc8F1874c0990C4

# Treasury address for fee collection
TREASURY_ADDRESS=0x043d5231651379970d52a13CEfB4e80733DDb989
```

#### 3. AWS Configuration

```bash
# AWS region where your Secrets Manager is located
AWS_REGION=us-east-1

# AWS access credentials (or use IAM roles in production)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your_secret_key_here
```

**Note:** The validation script will attempt to fetch a secret called `deployer-password` from AWS Secrets Manager to verify connectivity.

## Running the Validation Script

After configuring your environment:

```bash
# Install dependencies (if not already done)
npm install dotenv ethers @aws-sdk/client-secrets-manager

# Run the validation
node validate-env.js
```

### Expected Output

✅ **Success** - All checks passed:
```
╔═══════════════════════════════════════════════════════════╗
║     @XFuelLab Environment Validation Script              ║
╚═══════════════════════════════════════════════════════════╝

=== Validating Keystore Path ===
DEPLOYER_MAINNET_KEYSTORE_PATH: Valid ✅
  File exists: ./keystore/deployer-mainnet.json

=== Validating Keystore Decryption ===
KEYSTORE_DECRYPTION: Valid ✅
  Successfully decrypted wallet: 0xDC17Cbd201E7347555e428690f702bbFcAF2d33c

=== Validating EVM Addresses ===
DEPLOYER_ADDRESS: Valid ✅
  Valid address: 0xDC17Cbd201E7347555e428690f702bbFcAF2d33c
RELAYER_ADDRESS: Valid ✅
  Valid address: 0x...
TREASURY_ADDRESS: Valid ✅
  Valid address: 0x...

=== Validating AWS Credentials ===
AWS_REGION: Valid ✅
  Region: us-east-1
AWS_ACCESS_KEY_ID: Valid ✅
  Key ID set (length: 20)
AWS_SECRET_ACCESS_KEY: Valid ✅
  Secret set (length: 40)

Testing AWS Secrets Manager connection...
AWS_SECRETS_MANAGER_CONNECTION: Valid ✅
  Successfully fetched secret 'deployer-password' from us-east-1

=== Validation Summary ===
Passed: 8 ✅
Failed: 0 ❌
Warnings: 0 ⚠️

✅ All validations PASSED
Environment is properly configured!
```

❌ **Failure** - Some checks failed:
The script will clearly indicate which variables are missing or misconfigured.

## Current Status (Your Setup)

Based on the last validation run:

```
✅ Passed: 2
  - AWS_REGION
  - DEPLOYER_ADDRESS

❌ Failed: 4
  - DEPLOYER_MAINNET_KEYSTORE_PATH (not set)
  - RELAYER_ADDRESS (not set)
  - TREASURY_ADDRESS (not set)
  - AWS_ACCESS_KEY_ID (not set)
```

### To fix:

1. **Create or locate your keystore file:**
   - If you don't have one, create it using ethers.js
   - Place it in a secure location (e.g., `./keystore/` directory)
   - Update `DEPLOYER_MAINNET_KEYSTORE_PATH` in `.env.local`

2. **Set the keystore password:**
   - Update `DEPLOYER_KEYSTORE_PASSWORD` in `.env.local`
   - Consider storing this in AWS Secrets Manager instead

3. **Add addresses:**
   - Set `RELAYER_ADDRESS` (can be same as deployer for testing)
   - Set `TREASURY_ADDRESS` (where fees will be collected)

4. **Configure AWS:**
   - Get AWS credentials from your AWS account
   - Update `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
   - Ensure the credentials have permission to access Secrets Manager

## Security Best Practices

### ⚠️ Never commit `.env.local`

The `.env.local` file contains sensitive information and should **never** be committed to version control.

### 🔐 Use AWS Secrets Manager in production

Instead of storing passwords in `.env.local`, fetch them from AWS Secrets Manager:

```javascript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
const command = new GetSecretValueCommand({ SecretId: 'deployer-password' });
const response = await client.send(command);
const password = response.SecretString;
```

### 🔑 Use IAM roles instead of access keys

In production (e.g., EC2, Lambda, ECS), use IAM roles instead of storing `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### 🛡️ Rotate credentials regularly

- Rotate AWS access keys every 90 days
- Update keystore passwords periodically
- Use different keys for testnet and mainnet

## Troubleshooting

### Issue: "Environment variable not set"

**Solution:** Check that the variable is defined in `.env.local` (not `.env`)

### Issue: "File does not exist: [path]"

**Solution:** 
- Verify the path in `DEPLOYER_MAINNET_KEYSTORE_PATH` is correct
- Use absolute path or relative path from project root
- Ensure the keystore file exists at that location

### Issue: "Decryption failed"

**Solution:**
- Verify `DEPLOYER_KEYSTORE_PASSWORD` is correct
- Ensure the keystore file is valid JSON format
- Check that the keystore was created with ethers.js v5 or v6

### Issue: "Invalid EVM address format"

**Solution:**
- Ensure addresses start with `0x`
- Verify addresses are 42 characters long (0x + 40 hex characters)
- Use checksummed addresses (proper capitalization)

### Issue: "AWS connection failed"

**Solution:**
- Verify AWS credentials are correct
- Check that the IAM user has `secretsmanager:GetSecretValue` permission
- Ensure the `deployer-password` secret exists in AWS Secrets Manager
- Verify the AWS region is correct

### Issue: "ResourceNotFoundException" for AWS secret

**Solution:**
This means AWS credentials work, but the `deployer-password` secret doesn't exist yet. You can either:
- Create the secret in AWS Secrets Manager, or
- Modify the validation script to test with a different secret name

## Additional Resources

- [Ethers.js Documentation](https://docs.ethers.org/)
- [AWS Secrets Manager Guide](https://docs.aws.amazon.com/secretsmanager/)
- [Hardhat Configuration](https://hardhat.org/config/)

## Support

If you encounter issues not covered here, please check:
- Project documentation in `docs/`
- Deployment guides in `PHASE*_DEPLOYMENT.md` files
- Create an issue in the project repository

