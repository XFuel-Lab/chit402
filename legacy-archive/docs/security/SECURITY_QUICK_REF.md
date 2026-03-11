# Security Features Quick Reference

## Quick Commands

### Pause Contracts (Emergency)

```bash
# Pause XFUELRouter
npx hardhat run scripts/emergency-pause.ts --network theta-mainnet

# Or via contract call:
# await xfuelRouter.pause()
```

### Timelock Operations

```bash
# Schedule an operation (48-hour delay)
npx hardhat run scripts/timelock-schedule.ts --network theta-mainnet

# Execute after delay
npx hardhat run scripts/timelock-execute.ts --network theta-mainnet
```

### Multi-Sig Operations

```bash
# Submit transaction
npx hardhat run scripts/multisig-submit.ts --network theta-mainnet

# Confirm transaction
npx hardhat run scripts/multisig-confirm.ts --network theta-mainnet

# Execute transaction
npx hardhat run scripts/multisig-execute.ts --network theta-mainnet
```

---

## Contract Addresses (Update After Deployment)

```
TimelockController: 0x...
MultiSigTreasury: 0x...
XFUELRouter: 0x...
XFUELPool: 0x...
InnovationTreasury: 0x...
RevenueSplitter: 0x...
TreasuryILBackstop: 0x...
```

---

## Security Configuration

- **Timelock Delay**: 48 hours (production), 24 hours (beta)
- **Multi-sig**: 3-of-5 signatures required
- **Pausable**: All core contracts
- **Access Control**: Owner + Timelock + Multi-sig

---

## Emergency Contacts

- **Security Team**: security@xfuel.io
- **Discord**: #security-alerts
- **Multi-sig Signers**: (documented privately)

---

## Common Operations

### 1. Pause a Contract

```typescript
// Connect to contract
const router = await ethers.getContractAt("XFUELRouter", routerAddress);

// Pause (owner only)
await router.pause();

// Verify paused
const isPaused = await router.paused();
console.log("Paused:", isPaused); // true
```

### 2. Schedule Timelock Operation

```typescript
// Encode function call
const data = router.interface.encodeFunctionData("unpause");

// Calculate operation ID
const salt = ethers.id("unique-operation-id");
const operationId = await timelock.hashOperation(
  routerAddress,
  0,
  data,
  ethers.ZeroHash,
  salt
);

// Schedule (requires PROPOSER_ROLE)
await timelock.schedule(
  routerAddress,
  0,
  data,
  ethers.ZeroHash,
  salt,
  48 * 60 * 60 // 48 hours
);

console.log("Operation scheduled:", operationId);
console.log("Execute after:", new Date(Date.now() + 48*60*60*1000));
```

### 3. Multi-Sig Transaction

```typescript
// Submit transaction
const txId = await multiSig.submitTransaction(
  targetAddress,
  ethers.parseEther("1.0"),
  "0x" // calldata
);

// Confirm transaction (requires 3 signatures)
await multiSig.connect(signer1).confirmTransaction(txId);
await multiSig.connect(signer2).confirmTransaction(txId);
await multiSig.connect(signer3).confirmTransaction(txId);

// Execute (after 3 confirmations)
await multiSig.executeTransaction(txId);
```

---

## Monitoring Events

```typescript
// Listen for pause events
router.on("Paused", (account) => {
  console.log("⚠️ Contract paused by:", account);
  // Send alert
});

// Listen for timelock events
timelock.on("CallScheduled", (id, index, target, value, data, predecessor, delay) => {
  console.log("⏰ Operation scheduled:", id);
  // Send notification
});

// Listen for multi-sig events
multiSig.on("TransactionSubmitted", (txId, submitter, to, value, data) => {
  console.log("📝 New transaction:", txId);
  // Notify signers
});
```

---

## Testing Checklist

- [ ] Deploy all contracts with security features
- [ ] Test pause/unpause on each contract
- [ ] Schedule and execute timelock operation
- [ ] Submit, confirm, and execute multi-sig transaction
- [ ] Verify access controls
- [ ] Test emergency procedures
- [ ] Monitor events
- [ ] Document all addresses

---

## Upgrade Process

1. Deploy new implementation
2. Submit upgrade proposal to multi-sig
3. Multi-sig confirms (3-of-5)
4. Schedule upgrade via timelock (48 hours)
5. Wait 48 hours
6. Execute upgrade
7. Verify new implementation

---

For detailed documentation, see [SECURITY_FEATURES.md](./SECURITY_FEATURES.md)

