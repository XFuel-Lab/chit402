# XFUEL Bug Bounty Program

We value the security of the XFUEL protocol and ecosystem. This bug bounty program encourages security researchers to help us identify and fix vulnerabilities.

## Scope

### In Scope

#### Smart Contracts
- All deployed XFUEL smart contracts
- Contract logic vulnerabilities
- Access control issues
- Reentrancy vulnerabilities
- Integer overflow/underflow
- Gas optimization issues with security implications
- Economic attacks and game theory exploits

#### Web Application
- xfuel.io and all subdomains
- Authentication and authorization flaws
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Server-side request forgery (SSRF)
- SQL injection and NoSQL injection
- Remote code execution (RCE)
- Authentication bypass
- Privilege escalation
- Information disclosure
- API vulnerabilities

#### Mobile Application
- iOS and Android applications
- Authentication bypass
- Insecure data storage
- Insecure communications
- Code injection vulnerabilities
- Insecure authorization

### Out of Scope

The following are explicitly out of scope:

- Physical attacks
- Social engineering attacks
- Phishing attacks
- Denial of service (DoS) attacks
- Spam or email-related issues
- Issues related to third-party services (unless they directly impact XFUEL)
- Issues that require physical access to a user's device
- Low-severity issues that do not affect security (e.g., typos, UI/UX issues)
- Issues already known to the XFUEL team
- Issues found in testnet or staging environments (unless they also exist in production)
- Automated scanner reports without proof-of-concept
- Issues that require extensive user interaction or unlikely user behavior

## Reward Tiers

Rewards are based on the severity of the vulnerability and its impact on the XFUEL protocol and users. All rewards are in USD and paid in cryptocurrency (typically USDC or ETH).

### Critical Severity: $10,000 - $50,000
- Smart contract vulnerabilities that could lead to direct loss of funds
- Remote code execution on servers
- Critical authentication/authorization bypasses
- Critical vulnerabilities in core protocol logic
- Vulnerabilities that could compromise user private keys or wallets

### High Severity: $5,000 - $10,000
- Smart contract vulnerabilities with significant financial impact
- Privilege escalation to admin/owner roles
- SQL injection with data exfiltration
- Server-side request forgery (SSRF) with internal access
- Authentication bypasses with significant impact

### Medium Severity: $1,000 - $5,000
- Smart contract logic errors with moderate impact
- Cross-site scripting (XSS) with data theft
- Cross-site request forgery (CSRF) with financial impact
- Insecure direct object references
- Information disclosure vulnerabilities

### Low Severity: $100 - $1,000
- Minor smart contract issues
- Informational vulnerabilities
- Low-impact information disclosure
- Minor authentication/authorization issues
- Security best practice violations

**Note:** Final reward amounts are determined at the sole discretion of the XFUEL security team based on:
- Impact and severity
- Quality of the vulnerability report
- Exploitability and likelihood
- Assets at risk

## Rules and Guidelines

### General Rules

1. **Responsible Disclosure**: Do not publicly disclose vulnerabilities until we have resolved them and given permission.

2. **No Harm**: Do not access, modify, or destroy data that does not belong to you. Do not perform attacks that could harm XFUEL or its users.

3. **Legal Compliance**: Only test systems that you are authorized to test. Comply with all applicable laws and regulations.

4. **No Automated Tools**: Do not use automated vulnerability scanners without explicit permission. Automated scanner reports without manual verification and proof-of-concept are typically rejected.

5. **One Bug, One Report**: Submit one vulnerability per report, unless vulnerabilities are chained or directly related.

6. **Duplicate Reports**: The first valid report gets the reward. Duplicate reports will be closed without reward.

7. **False Positives**: We reserve the right to close reports that we determine are false positives or out of scope.

### Eligibility

- You must be the first person to report a specific vulnerability
- You must follow responsible disclosure practices
- You must not be located in a country subject to sanctions by the United States
- You must be at least 18 years old (or have parental consent)
- You must not be a current or former employee of XFUEL or its affiliates

### Testing Guidelines

- Do not attempt to access other users' accounts or data
- Do not perform any attack that could harm the availability of our services
- Do not attempt phishing or social engineering attacks
- Do not perform physical attacks or attacks against XFUEL personnel
- Only test against systems explicitly listed in scope
- Use test accounts when possible

## Submission Format

Please submit vulnerability reports via email to: **security@xfuel.io**

### Required Information

Your report should include the following:

1. **Summary**: A brief one-line description of the vulnerability
2. **Severity**: Your assessment of severity (Critical/High/Medium/Low)
3. **Affected Component**: Smart contract, web app, mobile app, API, etc.
4. **Detailed Description**: Step-by-step explanation of the vulnerability
5. **Proof of Concept**: 
   - For smart contracts: Code snippets, test cases, or transaction hashes demonstrating the issue
   - For web/mobile: Screenshots, videos, or detailed steps to reproduce
6. **Impact**: Explanation of the potential impact if exploited
7. **Suggested Fix**: If you have recommendations for fixing the issue
8. **Your Contact Information**: 
   - Wallet address for reward payment
   - Preferred contact method (email, Telegram handle, etc.)

### Report Template

```
Subject: Bug Bounty Report: [Brief Description]

Summary:
[One-line summary]

Severity:
[Critical/High/Medium/Low]

Affected Component:
[Smart Contract/Web App/Mobile App/etc.]

Detailed Description:
[Step-by-step explanation]

Proof of Concept:
[Code, screenshots, videos, or transaction hashes]

Impact:
[Potential impact assessment]

Suggested Fix:
[Optional recommendations]

Contact Information:
Wallet Address: [Your wallet address]
Preferred Contact: [Email/Telegram/etc.]
```

## Response and Resolution Timeline

- **Initial Response**: Within 48 hours of submission
- **Triage**: Within 5 business days
- **Status Updates**: Regular updates every 10 business days
- **Resolution**: Based on severity:
  - Critical: Target resolution within 7 days
  - High: Target resolution within 14 days
  - Medium: Target resolution within 30 days
  - Low: Target resolution within 60 days

## Reward Payment

- Rewards are paid after the vulnerability has been verified and fixed
- Payments are typically made within 30 days of resolution
- All rewards are subject to applicable tax laws
- You are responsible for any taxes on rewards received

## Safe Harbor

Security research conducted in accordance with this bug bounty program is authorized. We will not pursue legal action against researchers who:

- Act in good faith
- Follow the rules and guidelines outlined in this document
- Do not access or modify data that does not belong to them
- Do not cause harm to XFUEL or its users

However, if you engage in activities that violate laws or cause harm beyond what is necessary to demonstrate the vulnerability, we may take legal action.

## Changes to This Program

XFUEL reserves the right to modify or cancel this bug bounty program at any time. We will provide reasonable notice of significant changes.

## Questions

If you have questions about this bug bounty program, please contact us at **security@xfuel.io**.

---

**Thank you for helping keep XFUEL secure!**

*Last Updated: [Date]*


