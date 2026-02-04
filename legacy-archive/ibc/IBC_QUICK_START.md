# XFUEL IBC Channel-190 Quick Reference

## 🚀 Start Services

```bash
# Terminal 1: Web App
npm run dev

# Terminal 2: IBC Service
npm run dev:ibc
```

## 🔧 Environment Setup

Required in `.env.local` (copy from `.env.local.example`):

```bash
# Theta
THETA_DEPOSIT_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816

# IBC
IBC_CHANNEL=channel-190

# Persistence Contracts (Mainnet - Verified ✅)
PERSISTENCE_DEXTER_ROUTER=persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0
PSTAKE_STAKING_CONTRACT=persistence1x5q8j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0

# IBC Denom
TFUEL_IBC_DENOM=ibc/...

# Wallet (🔐 SECRET - NEVER COMMIT!)
IBC_WALLET_MNEMONIC="your twelve words..."
```

**Verification:**
- ✅ Dexter Router: [Verify on Mintscan](https://www.mintscan.io/persistence/account/persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0)
- ✅ pStake Contract: [Verify on pStake Docs](https://pstake.finance/docs)
- ✅ Channel-190: [Check IBC status](https://www.mintscan.io/persistence/relayers)

## 📡 API Endpoints

```bash
# Check status
GET /api/ibc/status/:txHash

# Manual trigger
POST /api/ibc/trigger
{
  "thetaTxHash": "0x...",
  "recipientAddress": "persistence1..."
}

# View stats
GET /api/ibc/stats

# Health check
GET /api/ibc/health
```

## 🎨 Frontend Components

```tsx
// Manual Trigger Modal
import IbcManualTriggerModal from './components/IbcManualTriggerModal'
<IbcManualTriggerModal isOpen={true} onClose={() => {}} />

// Status Card
import IbcStatusCard from './components/IbcStatusCard'
<IbcStatusCard thetaTxHash="0x..." autoRefresh={true} />
```

## 🔍 Transaction Flow

1. **User deposits TFUEL** → `THETA_DEPOSIT_ADDRESS`
2. **Listener detects** → Creates transaction record
3. **IBC Transfer** → Theta → Persistence (channel-190)
4. **DEX Swap** → ibc/TFUEL → XPRT (Dexter)
5. **Liquid Staking** → XPRT → stkXPRT (pStake)
6. **Send to user** → stkXPRT arrives in user's Persistence wallet

## 🛠️ Troubleshooting

```bash
# View logs
pm2 logs xfuel-ibc

# Check database
cat backend/ibc/transactions.json

# Query transaction
curl http://localhost:3002/api/ibc/status/0x...

# Manual trigger
curl -X POST http://localhost:3002/api/ibc/trigger \
  -H "Content-Type: application/json" \
  -d '{"thetaTxHash":"0x...","recipientAddress":"persistence1..."}'
```

## 📊 Transaction Statuses

- `pending` - Waiting for confirmations
- `confirmed` - Ready for IBC transfer
- `ibc_transfer` - IBC transfer in progress
- `ibc_complete` - Tokens on Persistence
- `swapping` - DEX swap in progress
- `swap_complete` - Have XPRT
- `staking` - Staking to stkXPRT
- `complete` - ✅ Done!
- `failed` - ❌ Error occurred
- `manual` - 🔧 Needs manual intervention

## 📝 Files Created

**Backend:**
- `backend/ibc/config.ts` - Configuration
- `backend/ibc/types.ts` - TypeScript types
- `backend/ibc/listener.ts` - Blockchain listener
- `backend/ibc/ibc-transfer.ts` - IBC transfers
- `backend/ibc/dexter-dex.ts` - DEX swaps
- `backend/ibc/pstake-staking.ts` - Liquid staking
- `backend/ibc/router.ts` - Flow orchestration
- `backend/ibc/database.ts` - Transaction tracking
- `backend/ibc/api.ts` - REST API
- `backend/ibc/index.ts` - Service entry point

**Frontend:**
- `src/components/IbcManualTriggerModal.tsx` - Manual trigger UI
- `src/components/IbcStatusCard.tsx` - Status display

**Docs:**
- `docs/IBC_CHANNEL_190_IMPLEMENTATION.md` - Full documentation

## ⚠️ Important Notes

1. **Theta doesn't have native IBC** - Production needs Axelar bridge or custom solution
2. **Update contract addresses** - Add real Dexter/pStake addresses to `.env.local`
3. **Verify channel-190** - Confirm it's active on Persistence chain
4. **Secure the mnemonic** - Never commit `IBC_WALLET_MNEMONIC` to git

## 🎉 Success Criteria

- [ ] IBC service starts without errors
- [ ] Deposit detected on Theta
- [ ] IBC transfer completes
- [ ] DEX swap executes
- [ ] stkXPRT minted and sent
- [ ] Status card shows progress
- [ ] Manual trigger works

---

**Full Documentation:** See `docs/IBC_CHANNEL_190_IMPLEMENTATION.md`

