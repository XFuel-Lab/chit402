# Contract Addresses - Quick Reference

## ✅ Verified Persistence Mainnet Addresses

### Dexter DEX Router
```
persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0
```
**Verify:** https://www.mintscan.io/persistence/account/persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0

### pStake Staking Contract (stkXPRT)
```
persistence1x5q8j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0
```
**Verify:** https://pstake.finance/docs

### IBC Channel (Theta → Persistence)
```
channel-190
```
**Status:** https://www.mintscan.io/persistence/relayers

---

## 📝 Add to `.env.local`

```bash
# Persistence Contracts (Mainnet)
PERSISTENCE_DEXTER_ROUTER=persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0
PSTAKE_STAKING_CONTRACT=persistence1x5q8j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0
IBC_CHANNEL=channel-190
```

**🔐 NEVER commit `.env.local` to git!**

---

## 🔍 Verification Checklist

- [ ] Verify Dexter router on Mintscan
- [ ] Check pStake contract on official docs
- [ ] Confirm channel-190 is active
- [ ] Test with small amounts first
- [ ] Monitor first transaction closely

---

**Last Updated:** Dec 28, 2024

