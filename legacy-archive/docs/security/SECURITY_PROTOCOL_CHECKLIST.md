# 🛡️ Security Protocol Implementation Checklist

**Date:** January 25, 2026 (Tomorrow)  
**Status:** ⏳ Pending

---

## 🔑 Remaining Credential Rotations

### High Priority
- [ ] **Snowflake Password**
  - User: `xfuel-sf-thetaedgecloud-db-user`
  - Action: Reset in Snowflake console
  - Update: `backend/theta-bridge/.env`

- [ ] **Persistence/Cosmos Deployer Wallet**
  - Generate new mnemonic: `persistenceCore keys add deployer-new`
  - Transfer all funds from old wallet
  - Update: All deployment scripts and ENV files
  - Delete old wallet

- [ ] **Keplr User Wallet** (if exposed)
  - Generate new wallet in Keplr
  - Update: Backend address mappings

### Medium Priority
- [ ] **Redis Password**
  - Update: Redis configuration
  - Update: Backend ENV files
  - Restart: Redis service

---

## 🔧 Security Tooling Setup

### 1. Pre-Commit Secret Scanning Hook
```bash
# Create: .git/hooks/pre-commit
#!/bin/bash

echo "🔍 Scanning for secrets..."

# Check for AWS keys
if git diff --cached | grep -E 'AKIA[0-9A-Z]{16}'; then
    echo "❌ AWS Access Key detected! Commit blocked."
    exit 1
fi

# Check for suspicious file names
if git diff --cached --name-only | grep -iE '(secret|password|credential|private_key)'; then
    echo "⚠️  Sensitive filename detected. Review carefully."
    echo "Type 'YES' to proceed:"
    read response
    if [ "$response" != "YES" ]; then
        exit 1
    fi
fi

# Check for environment variable patterns
if git diff --cached | grep -E '(AWS_SECRET_ACCESS_KEY|SNOWFLAKE_PASSWORD|MNEMONIC)='; then
    echo "❌ Hardcoded credentials detected! Commit blocked."
    exit 1
fi

echo "✅ No secrets detected."
```

### 2. GitHub Secret Scanning (Enable)
- [ ] Go to GitHub repo → Settings → Security → Secret scanning
- [ ] Enable "Secret scanning"
- [ ] Enable "Push protection"

### 3. Install git-secrets Tool
```bash
# Windows (using chocolatey)
choco install git-secrets

# Or download from: https://github.com/awslabs/git-secrets
git secrets --install
git secrets --register-aws
```

---

## 📊 Audit & Monitoring

### AWS Account Audit
- [ ] **Review CloudTrail logs** (Jan 4-24, 2026)
  - Filter by deleted access key: `AKIAQ6JF2NWPGV3LDQAK`
  - Look for suspicious API calls
  - Check unauthorized regions

- [ ] **Review AWS Billing**
  - Any unexpected charges during exposure window?
  - EC2 instances launched?
  - S3 data transfer spikes?

- [ ] **Enable AWS GuardDuty**
  - Real-time threat detection
  - Automated alerts for suspicious activity

### Snowflake Audit
- [ ] **Check query history** (Jan 4-24, 2026)
  - User: `xfuel-sf-thetaedgecloud-db-user`
  - Look for unusual queries
  - Check data exports

### Persistence/Cosmos Wallet Audit
- [ ] **Check transaction history**
  - Any unauthorized transactions?
  - Wallet balance unchanged?

---

## 🏗️ Long-term Infrastructure Improvements

### 1. Secrets Management (Choose One)
- [ ] **Option A: AWS Secrets Manager**
  - Automatic rotation
  - Encrypted at rest
  - Integrated with AWS SDK

- [ ] **Option B: HashiCorp Vault**
  - Multi-cloud support
  - Dynamic secrets
  - Fine-grained access control

- [ ] **Option C: Azure Key Vault** (if using Azure)

### 2. Environment Variable Management
```javascript
// backend/theta-bridge/src/secrets.js
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

async function getSecret(secretName) {
  const client = new SecretsManagerClient({ region: "us-east-2" });
  
  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    return JSON.parse(response.SecretString);
  } catch (error) {
    console.error("Error retrieving secret:", error);
    throw error;
  }
}

// Usage
const secrets = await getSecret("xfuel-protocol/production");
const awsKey = secrets.AWS_ACCESS_KEY_ID;
```

### 3. CI/CD Secret Scanning
- [ ] Add secret scanning to GitHub Actions workflow
```yaml
# .github/workflows/security-scan.yml
name: Security Scan

on: [push, pull_request]

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Run gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 4. Principle of Least Privilege
- [ ] **Review AWS IAM policies**
  - Backend service account: only S3 + CloudWatch
  - Deployment account: only necessary permissions
  - No wildcard `*` permissions

- [ ] **Separate AWS accounts**
  - Dev account (limited permissions)
  - Staging account (moderate permissions)
  - Production account (strict, audited)

---

## 📝 Documentation Updates

- [ ] **Update README.md**
  - Security best practices section
  - How to handle secrets properly
  - Link to this checklist

- [ ] **Create SECURITY.md**
  - Responsible disclosure policy
  - Security contact: security@xfuel-protocol.com
  - Incident response process

- [ ] **Update CONTRIBUTING.md**
  - Never commit credentials
  - Use .env files (gitignored)
  - Run pre-commit hooks

---

## 🎓 Team Training (if applicable)

- [ ] Schedule security awareness session
- [ ] Share incident post-mortem (without exposing credentials)
- [ ] Review secure coding practices
- [ ] Establish credential management policy

---

## ✅ Verification (After Implementation)

- [ ] Pre-commit hook blocks hardcoded AWS keys
- [ ] Pre-commit hook blocks suspicious filenames
- [ ] GitHub secret scanning is active
- [ ] All credentials rotated and stored securely
- [ ] AWS CloudTrail shows no unauthorized access
- [ ] Snowflake audit log shows no suspicious activity
- [ ] Wallet funds are safe
- [ ] Documentation updated

---

## 📞 Support Resources

- **AWS Security:** https://aws.amazon.com/security/
- **git-secrets:** https://github.com/awslabs/git-secrets
- **GitHub Secret Scanning:** https://docs.github.com/en/code-security/secret-scanning
- **OWASP Top 10:** https://owasp.org/www-project-top-ten/

---

**Estimated Time:** 2-4 hours  
**Priority:** HIGH  
**Deadline:** January 25, 2026 EOD

---

## 🎯 Success Criteria

- ✅ All exposed credentials rotated
- ✅ Automated secret scanning in place
- ✅ No unauthorized access detected in audits
- ✅ Team trained on secure credential management
- ✅ Long-term secrets management solution selected

**Once complete, this incident can be fully closed.**
