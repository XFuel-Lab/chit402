# Security Module

This module contains critical security infrastructure for XFuel Protocol, including timelock controls, multi-signature treasury, and emergency pause mechanisms.

## Components

### XFuelTimelock.sol
**TimelockController for delayed execution** of sensitive operations.

**Security Features:**
- Minimum delay for all operations (e.g., 48 hours)
- Multi-sig approval via proposer/executor roles
- Cancellation mechanism for pending operations
- Role-based access control

**Roles:**
- `PROPOSER_ROLE` - Can schedule operations (multi-sig wallets)
- `EXECUTOR_ROLE` - Can execute operations after delay (multi-sig wallets)
- `CANCELLER_ROLE` - Can cancel pending operations (emergency multi-sig)
- `ADMIN_ROLE` - Can manage roles (governance/multi-sig)

**Use Cases:**
- Protocol upgrades
- Parameter changes
- Treasury operations
- Emergency actions

### MultiSigTreasury.sol
**Multi-signature treasury** for critical operations.

**Security Features:**
- M-of-N signature requirement (e.g., 3-of-5)
- Transaction proposal and confirmation flow
- Optional timelock integration
- Emergency pause functionality
- UUPS upgradeable

**Key Functions:**
- `submitTransaction()` - Propose a new transaction
- `confirmTransaction()` - Confirm a pending transaction
- `revokeConfirmation()` - Revoke confirmation
- `executeTransaction()` - Execute confirmed transaction (requires M signatures)
- `addSigner()/removeSigner()` - Manage signers
- `changeRequirement()` - Update M-of-N requirement
- `pause()/unpause()` - Emergency controls

### XFUELPool-pausable.sol
**Pool contract with emergency pause** functionality.

**Pausable Operations:**
- `swap()` - Can be paused during emergencies
- Liquidity operations continue when paused (to allow withdrawals)

**Security Features:**
- Factory-only initialization
- Reentrancy protection
- Slippage protection
- Emergency pause (factory-controlled)

### XFUELRouter-pausable.sol
**Router contract with emergency pause** functionality.

**Pausable Operations:**
- `swap()` - All swap operations
- `swapAndStake()` - Swap and staking operations
- `collectAndDistributeFees()` - Fee collection
- `takeFeeSnapshot()` - Fee snapshots

**Security Features:**
- Time-weighted average fee collection (prevents front-running)
- Reentrancy protection
- Deadline protection (prevents stale transactions)
- Slippage protection
- Emergency pause (owner-controlled)

## Security Architecture

```
┌─────────────────────────────────────────┐
│         XFuelTimelock (48h delay)       │
│  ┌───────────────────────────────────┐  │
│  │    MultiSigTreasury (3-of-5)      │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  Protocol Contracts (UUPS)  │  │  │
│  │  │  - RevenueSplitter          │  │  │
│  │  │  - veXF                     │  │  │
│  │  │  - XFUELRouter              │  │  │
│  │  │  - XFUELPool                │  │  │
│  │  └─────────────────────────────┘  │  │
│  │     Emergency Pause ────────────►  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Defense Layers

1. **Multi-sig** - Requires multiple signers for critical operations
2. **Timelock** - Delays execution, allowing community review
3. **Pausable** - Emergency stop for incident response
4. **Upgradeable** - Can fix bugs without redeployment
5. **Rate Limiting** - Prevents abuse and DoS attacks

## Integration

**Protected Operations:**
- Protocol upgrades → Timelock + Multi-sig
- Treasury withdrawals → Multi-sig
- Parameter changes → Timelock + Multi-sig
- Emergency pause → Multi-sig (instant)

**Pause Triggers:**
- Security incident detection
- Circuit breaker activation (ZK module)
- Anomalous activity detection
- Manual trigger by multi-sig

## Deployment

### 1. Deploy Timelock
```solidity
XFuelTimelock timelock = new XFuelTimelock(
    48 hours,                    // minDelay
    [multisig1, multisig2, ...], // proposers
    [multisig1, multisig2, ...], // executors
    governance                   // admin
);
```

### 2. Deploy MultiSigTreasury
```solidity
MultiSigTreasury treasury = new MultiSigTreasury();
treasury.initialize(
    [signer1, signer2, signer3, signer4, signer5], // signers
    3                                               // requiredConfirmations
);
treasury.setTimelock(address(timelock));
```

### 3. Configure Protocol Contracts
- Set timelock as owner/admin
- Grant roles to multi-sig wallets
- Configure emergency pause permissions

## Emergency Response

### Incident Response Flow:
1. **Detect** - Monitor alerts, circuit breakers, anomaly detection
2. **Pause** - Multi-sig triggers emergency pause (instant)
3. **Assess** - Team evaluates incident severity
4. **Fix** - Deploy patch via timelock + multi-sig
5. **Resume** - Unpause after verification

### Emergency Contacts:
- Security team multi-sig: Monitors 24/7
- Timelock executors: Core team members
- Circuit breaker: Automatic triggers

## Security Considerations

⚠️ **Critical Infrastructure**

- Never reduce timelock delay without community approval
- Maintain geographic diversity of multi-sig signers
- Test pause mechanisms regularly
- Monitor pending timelock operations
- Backup private keys securely (multi-location, multi-custody)

## Testing

Test pause functionality:
```bash
# Test pool pause
await pool.pause();
await expect(pool.swap(...)).to.be.revertedWith("PAUSED");

# Test router pause
await router.pause();
await expect(router.swap(...)).to.be.revertedWith("PAUSED");
```

Test multi-sig flow:
```bash
# Submit transaction
await treasury.submitTransaction(target, value, data);

# Confirm by signers
await treasury.connect(signer1).confirmTransaction(0);
await treasury.connect(signer2).confirmTransaction(0);
await treasury.connect(signer3).confirmTransaction(0);

# Execute
await treasury.executeTransaction(0);
```

## Version

Security Module v1.0
- XFuelTimelock: OpenZeppelin TimelockController
- MultiSigTreasury: UUPS Upgradeable
- Pausables: Factory/Owner controlled

