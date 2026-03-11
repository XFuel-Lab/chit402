# XFuel Protocol Security Features

## Overview

XFuel Protocol implements multiple layers of security to protect user funds and ensure protocol integrity:

1. **TimelockController** - Delays critical operations
2. **Multi-Signature Treasury** - Requires multiple approvals
3. **Pausable Contracts** - Emergency circuit breakers
4. **Access Control** - Role-based permissions

---

## 1. TimelockController

### Purpose
Delays execution of critical operations to give the community time to react to malicious proposals.

### Configuration
- **Min Delay**: 48 hours (production), 24 hours (beta)
- **Proposers**: Multi-sig wallet addresses
- **Executors**: Multi-sig wallet addresses
- **Admin**: Governance contract or multi-sig

### Protected Operations
- Contract upgrades
- Parameter changes
- Treasury withdrawals
- Emergency actions

### Usage Example

```solidity
// 1. Schedule operation (requires PROPOSER_ROLE)
bytes memory data = abi.encodeWithSignature("pause()");
timelock.schedule(
    target,        // Contract to call
    0,            // ETH value
    data,         // Function call data
    bytes32(0),   // Predecessor (if chaining operations)
    salt,         // Unique salt for operation ID
    48 hours      // Delay
);

// 2. Wait 48 hours...

// 3. Execute operation (requires EXECUTOR_ROLE)
timelock.execute(
    target,
    0,
    data,
    bytes32(0),
    salt
);
```

### Security Benefits
- ✅ Prevents instant malicious changes
- ✅ Community can exit if they disagree
- ✅ Time to audit and verify operations
- ✅ Can be canceled if needed

---

## 2. Multi-Signature Treasury

### Purpose
Requires multiple signatures to execute treasury operations, preventing single points of failure.

### Configuration
- **Signers**: 5 addresses (hardware wallets recommended)
- **Required Signatures**: 3 out of 5 (3-of-5 multi-sig)
- **Timelock Integration**: Optional additional layer

### Protected Operations
- Treasury fund movements
- Contract parameter changes
- Emergency pause/unpause
- Signer management

### Usage Example

```solidity
// 1. Signer 1: Submit transaction
uint256 txId = multiSigTreasury.submitTransaction(
    targetAddress,
    valueInWei,
    callData
);

// 2. Signer 2: Confirm transaction
multiSigTreasury.confirmTransaction(txId);

// 3. Signer 3: Confirm transaction (reaches threshold)
multiSigTreasury.confirmTransaction(txId);

// 4. Any signer: Execute transaction
multiSigTreasury.executeTransaction(txId);
```

### Security Benefits
- ✅ No single point of failure
- ✅ Requires collusion to attack
- ✅ Hardware wallet support
- ✅ Transaction history on-chain

---

## 3. Pausable Contracts

### Purpose
Emergency circuit breakers to halt operations if an exploit is detected.

### Pausable Contracts
- ✅ **XFUELPool** - Swap operations
- ✅ **XFUELRouter** - All routing operations
- ✅ **InnovationTreasury** - Deposits and withdrawals
- ✅ **RevenueSplitter** - Revenue distribution
- ✅ **TreasuryILBackstop** - IL coverage

### Usage Example

```solidity
// Emergency: Pause all operations
xfuelRouter.pause();

// Operations are now blocked
xfuelRouter.swap(...); // Reverts with "PAUSED"

// After fixing: Unpause
xfuelRouter.unpause();
```

### Access Control
- Owner can pause/unpause
- Timelock can pause/unpause
- Paused by default: No
- Can be permanently disabled: No (by design)

### Security Benefits
- ✅ Immediate response to exploits
- ✅ Protect user funds
- ✅ Buy time for fixes
- ✅ Can be automated with monitoring

---

## 4. Access Control Summary

### Role-Based Permissions

| Role | Contracts | Permissions |
|------|-----------|-------------|
| **Owner** | All | Admin operations, pausable |
| **Timelock** | All upgradeable | Upgrades, critical params |
| **Multi-sig** | Treasury | Fund movements, operations |
| **Factory** | XFUELPool | Initialize, pause/unpause |
| **User** | All | Normal operations |

### Critical Operations Access Matrix

| Operation | Requires Owner | Requires Timelock | Requires Multi-sig |
|-----------|---------------|-------------------|-------------------|
| Pause contract | ✅ | ✅ | - |
| Unpause contract | ✅ | ✅ | - |
| Upgrade contract | - | ✅ | ✅ (proposers) |
| Change parameters | ✅ | ✅ | - |
| Treasury withdrawal | - | - | ✅ |
| Emergency withdraw | ✅ | - | - |

---

## 5. Deployment Best Practices

### Pre-Deployment Checklist

- [ ] Generate multi-sig signer addresses (5+ hardware wallets)
- [ ] Configure timelock delay (48 hours recommended)
- [ ] Test timelock operations on testnet
- [ ] Verify all contract addresses
- [ ] Document emergency procedures
- [ ] Set up monitoring and alerts

### Deployment Steps

1. **Deploy TimelockController**
   ```bash
   npx hardhat run scripts/deploy-with-security.ts --network theta-mainnet
   ```

2. **Deploy MultiSigTreasury**
   - Configure signers
   - Set 3-of-5 threshold

3. **Deploy Core Contracts**
   - All contracts with pausable
   - Reference timelock and multi-sig

4. **Configure Access**
   - Set timelock on each contract
   - Transfer ownership to timelock
   - Verify roles

5. **Test Security Features**
   - Test pause/unpause
   - Test timelock delay
   - Test multi-sig approvals

### Post-Deployment Security

- [ ] Verify all contracts on explorer
- [ ] Transfer ownership to timelock
- [ ] Store private keys securely (hardware wallets)
- [ ] Document recovery procedures
- [ ] Set up 24/7 monitoring
- [ ] Conduct security audit
- [ ] Bug bounty program

---

## 6. Emergency Procedures

### Detected Exploit Response

1. **Immediate (0-5 minutes)**
   ```solidity
   // Pause all affected contracts
   xfuelRouter.pause();
   xfuelPool.pause();
   revenueSplitter.setPaused(true);
   ```

2. **Assessment (5-30 minutes)**
   - Identify exploit vector
   - Calculate potential damage
   - Contact security team
   - Notify community

3. **Mitigation (30 minutes - 2 hours)**
   - Deploy fixed contracts (if upgradeable)
   - Schedule upgrade via timelock
   - Communicate with users

4. **Recovery (2-48 hours)**
   - Wait for timelock delay
   - Execute upgrade
   - Unpause contracts
   - Post-mortem report

### Key Holder Compromise

If a multi-sig key is compromised:

1. **Immediate**
   ```solidity
   // Remove compromised signer (requires multi-sig)
   multiSigTreasury.removeSigner(compromisedAddress);
   ```

2. **Add new signer**
   ```solidity
   multiSigTreasury.addSigner(newSecureAddress);
   ```

3. **Rotate all other keys** (precautionary)

### False Alarm Unpause

```solidity
// After thorough verification
xfuelRouter.unpause();
// Publish incident report
```

---

## 7. Monitoring and Alerts

### Critical Events to Monitor

```solidity
// Pause events
event Paused(address indexed account);
event Unpaused(address indexed account);

// Timelock events
event CallScheduled(bytes32 indexed id, ...);
event CallExecuted(bytes32 indexed id, ...);
event CallCancelled(bytes32 indexed id);

// Multi-sig events
event TransactionSubmitted(uint256 indexed txId, ...);
event TransactionConfirmed(uint256 indexed txId, address indexed signer);
event TransactionExecuted(uint256 indexed txId, ...);

// Owner changes
event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
```

### Recommended Monitoring Tools

- **Tenderly** - Real-time alerts
- **OpenZeppelin Defender** - Security monitoring
- **Forta** - Threat detection
- **Custom scripts** - Event listeners

---

## 8. Security Audit Checklist

### Before Audit

- [ ] All contracts implement pausable
- [ ] Timelock configured correctly
- [ ] Multi-sig thresholds appropriate
- [ ] Access control properly set
- [ ] Emergency procedures documented
- [ ] Test coverage > 90%

### Audit Focus Areas

1. **Timelock**
   - Proper delay configuration
   - Role assignments
   - Operation scheduling

2. **Multi-sig**
   - Signer security
   - Threshold appropriateness
   - Transaction flow

3. **Pausable**
   - All critical functions protected
   - Proper access control
   - State consistency when paused

4. **Access Control**
   - Role separation
   - Privilege escalation prevention
   - Owner renunciation safety

---

## 9. Upgradeability

### UUPS Proxy Pattern

All upgradeable contracts use UUPS (Universal Upgradeable Proxy Standard):

```solidity
function _authorizeUpgrade(address newImplementation) 
    internal 
    override 
    onlyOwner 
{}
```

### Upgrade Process

1. **Deploy new implementation**
   ```bash
   npx hardhat run scripts/upgrade-contract.ts
   ```

2. **Schedule upgrade via timelock**
   ```solidity
   bytes memory data = abi.encodeWithSignature(
       "upgradeTo(address)",
       newImplementation
   );
   timelock.schedule(proxyAddress, 0, data, bytes32(0), salt, 48 hours);
   ```

3. **Wait 48 hours**

4. **Execute upgrade**
   ```solidity
   timelock.execute(proxyAddress, 0, data, bytes32(0), salt);
   ```

### Upgrade Safety

- ✅ 48-hour timelock delay
- ✅ Multi-sig approval required
- ✅ Storage layout preservation
- ✅ Initialization protection
- ✅ Community notification

---

## 10. Incident Response Plan

### Contact Information

- **Security Team**: security@xfuel.io
- **Multi-sig Signers**: (document privately)
- **Timelock Admin**: (document privately)
- **Emergency Contact**: (24/7 on-call)

### Communication Channels

- **Twitter**: @XFuelProtocol
- **Discord**: #security-alerts
- **Telegram**: XFuel Security
- **Email**: alerts@xfuel.io

### Escalation Matrix

| Severity | Response Time | Actions |
|----------|--------------|---------|
| **Critical** | < 5 min | Pause all, emergency call |
| **High** | < 30 min | Pause affected, assess |
| **Medium** | < 2 hours | Monitor, prepare fix |
| **Low** | < 24 hours | Document, schedule fix |

---

## 11. Testing Security Features

### Local Testing

```bash
# Test pause functionality
npx hardhat test test/security/Pausable.test.ts

# Test timelock
npx hardhat test test/security/Timelock.test.ts

# Test multi-sig
npx hardhat test test/security/MultiSig.test.ts
```

### Testnet Testing

```bash
# Deploy to testnet
npx hardhat run scripts/deploy-with-security.ts --network theta-testnet

# Test full flow
npm run test:e2e:security
```

### Security Test Scenarios

1. **Pause/Unpause Flow**
   - Pause contract
   - Attempt operation (should revert)
   - Unpause contract
   - Operation succeeds

2. **Timelock Flow**
   - Schedule operation
   - Attempt immediate execution (should revert)
   - Wait delay period
   - Execute operation

3. **Multi-sig Flow**
   - Submit transaction
   - Confirm with required signers
   - Execute transaction

---

## 12. Conclusion

XFuel Protocol implements defense-in-depth security:

- **Layer 1**: Access control and roles
- **Layer 2**: Timelock delays
- **Layer 3**: Multi-signature requirements
- **Layer 4**: Pausable circuit breakers
- **Layer 5**: Monitoring and alerts

Always follow security best practices and stay vigilant!

---

## Resources

- [OpenZeppelin Security](https://docs.openzeppelin.com/contracts/4.x/api/security)
- [TimelockController Docs](https://docs.openzeppelin.com/contracts/4.x/api/governance#TimelockController)
- [Multi-sig Best Practices](https://blog.openzeppelin.com/gnosis-safe-multisig/)
- [Pausable Pattern](https://docs.openzeppelin.com/contracts/4.x/api/security#Pausable)

---

**Last Updated**: January 2026
**Version**: 2.0
**Status**: Production Ready ✅

