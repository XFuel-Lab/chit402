# Reverse Bridge Quick Reference

## 🚀 For Developers

### User Flow (ibcTFUEL → TFUEL)

```
User (Persistence) → burn_for_unwrap(10 TFUEL, "0xTheta...") 
→ Fee (0.05 TFUEL) → FeeCollector
→ Burn (9.95 TFUEL) 
→ Emit BurnForUnwrap event
→ SP1 generates proof
→ Relayer submits to Theta
→ VaultFactory.unwrapFromBurn()
→ User receives 9.95 TFUEL on Theta
```

---

## 📦 Key Contracts

| Contract | Chain | Address | Purpose |
|----------|-------|---------|---------|
| persistence-minter | Persistence | TBD | burn_for_unwrap() |
| FeeCollector | Persistence | TBD | Accumulate 0.5% fees |
| VaultFactory | Theta | Deployed | unwrapFromBurn() |
| SubVault | Theta | Per-user | Hold TFUEL reserves |

---

## 🔧 Quick Commands

### CosmWasm (Persistence)

**Burn ibcTFUEL**:
```bash
persistenceCore tx wasm execute <minter_contract> \
  '{"burn_for_unwrap":{"amount":"10000000000000000000","theta_recipient":"0x..."}}' \
  --from user --gas auto
```

**Check FeeCollector status**:
```bash
persistenceCore query wasm contract-state smart <fee_collector> \
  '{"ready_to_burn":{}}'
```

**Trigger fee burn** (admin):
```bash
persistenceCore tx wasm execute <fee_collector> \
  '{"trigger_fee_burn":{}}' \
  --from admin --gas auto
```

### Solidity (Theta)

**Seed vault**:
```bash
npx hardhat run --network theta_mainnet scripts/seedVault.cjs
```

**Check vault balance**:
```javascript
await vaultFactory.getVaultBalance(vaultAddress);
```

**Check if can unwrap**:
```javascript
await vaultFactory.canUnwrap(vaultAddress, amount);
```

---

## 🧪 Testing

**Run integration tests**:
```bash
npx hardhat test test/ReverseBridge.Integration.test.cjs
```

**Test FeeCollector**:
```bash
cd cosmwasm-contracts/fee-collector
cargo test
```

**SP1 circuit test**:
```bash
cd sp1-prover
cargo test --release
```

---

## 🔍 Monitoring

**Persistence metrics**:
```bash
# Total reverse burns
persistenceCore query wasm contract-state smart <minter> '{"state":{}}'

# Fee collector status
persistenceCore query wasm contract-state smart <fee_collector> '{"state":{}}'
```

**Theta metrics**:
```javascript
const totalSeeded = await vaultFactory.totalSeeded();
const totalReleased = await vaultFactory.totalReleased();
const [liquidity, reserve, available] = await vaultFactory.getAggregateStats();
```

---

## 💡 Common Issues

### "BelowMinimumReserve" error
**Cause**: Vault would drop below 10% reserve after unwrap  
**Solution**: Seed vault with more TFUEL or wait for forward deposits

### "BurnAlreadyProcessed" error
**Cause**: Duplicate burn transaction hash  
**Solution**: Check if unwrap already completed, each burn is one-time use

### "InsufficientBalance" error on Persistence
**Cause**: User doesn't have enough ibcTFUEL  
**Solution**: User needs to acquire more ibcTFUEL first

---

## 📊 Gas Estimates

| Operation | Gas | TFUEL Cost |
|-----------|-----|------------|
| burn_for_unwrap | 200k | ~$0.005 (XPRT) |
| unwrapFromBurn | 150k | ~0.0075 TFUEL |
| seedVault | 100k | ~0.005 TFUEL |

---

## 🔐 Security Checklist

- [x] Per-user nonces prevent replay
- [x] 0.5% fee is hardcoded (immutable)
- [x] Minimum reserve enforced (10%)
- [x] Only ZK_BRIDGE_ROLE can trigger unwraps
- [x] Admin-only vault seeding
- [x] Pausable for emergencies
- [x] Range proofs in SP1 circuit
- [x] Balance checks before release

---

## 📞 Support

**Documentation**: `/REVERSE_BRIDGE_IMPLEMENTATION.md`  
**Issues**: GitHub Issues  
**Contact**: team@xfuel.io

---

**Last Updated**: February 4, 2026  
**Version**: 4.0 (Bidirectional)
