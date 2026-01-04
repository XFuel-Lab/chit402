# Step 2 Deployment Flow Diagram

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                    XFUELLAB STEP 2: THETA DEPLOY & TEST                   ║
║                      Ferrari Hybrid Tokenomics v3.0                       ║
╚═══════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────┐
│                         PRE-DEPLOYMENT PHASE                             │
└─────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │  Start Here  │
    └──────┬───────┘
           │
           ▼
    ┌──────────────────────┐
    │  Check Environment   │
    │  ✓ Keystore exists   │
    │  ✓ Balance > 0.5 TFUEL│
    │  ✓ .env.local ready  │
    └──────┬───────────────┘
           │
           ▼
    ┌──────────────────────┐
    │   DRY-RUN MODE      │──────► Estimate gas cost
    │   (--dry-run flag)   │        (~0.013 TFUEL)
    └──────┬───────────────┘
           │
           ▼
    ┌──────────────────────┐
    │ Sufficient Funds?    │
    └──────┬───────────────┘
           │
           ├─── NO ──► ❌ ERROR: Top up wallet
           │
           └─── YES
                │
                ▼

┌─────────────────────────────────────────────────────────────────────────┐
│                          DEPLOYMENT PHASE                                │
└─────────────────────────────────────────────────────────────────────────┘

                ┌──────────────────────┐
                │  Deploy VaultFactory │
                │                      │
                │  Constructor:        │
                │  ├─ admin: 0xea9... │
                │  └─ revSplitter: ... │
                └──────┬───────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Wait for TX confirm │
                │  (~6 seconds)        │
                └──────┬───────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  VaultFactory        │
                │  Deployed! 🎉       │
                │                      │
                │  Address: 0x<NEW>   │
                │  TX: 0x123abc...    │
                │  Block: 28471234    │
                └──────┬───────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Save Deployment Info│
                │  ├─ vaultfactory-361.json
                │  ├─ .env update     │
                │  └─ deployment log  │
                └──────┬───────────────┘
                       │
                       ▼

┌─────────────────────────────────────────────────────────────────────────┐
│                           TESTING PHASE                                  │
└─────────────────────────────────────────────────────────────────────────┘

                ┌──────────────────────┐
                │  Gate Check 1:       │
                │  Explorer Verification│
                │  ├─ Contract exists  │
                │  ├─ Admin correct    │
                │  └─ RevSplit correct │
                └──────┬───────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Create SubVault     │
                │  factory.createVault()│
                └──────┬───────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Test Deposit        │
                │  Send 0.1 TFUEL ─────┼──►┌──────────────────┐
                └──────┬───────────────┘   │  SubVault        │
                       │                   │  receives TFUEL  │
                       │                   └─────┬────────────┘
                       │                         │
                       │                         ▼
                       │                   ┌──────────────────┐
                       │                   │  Fee Calculation │
                       │                   │  0.5% = 0.0005   │
                       │                   └─────┬────────────┘
                       │                         │
                       │              ┌──────────┴──────────┐
                       │              ▼                     ▼
                       │      ┌──────────────┐     ┌──────────────┐
                       │      │ RevSplitter  │     │ Net Locked   │
                       │      │ gets 0.0005  │     │ 0.0995 TFUEL │
                       │      └──────┬───────┘     └──────┬───────┘
                       │             │                    │
                       │             ▼                    ▼
                       │      ┌──────────────┐     ┌──────────────┐
                       │      │ 4-Way Split: │     │ Yield Split: │
                       │      │ 50% veXF     │     │ 30% recycle  │
                       │      │ 25% BBB      │     │ 70% LP fund  │
                       │      │ 15% rXF      │     └──────────────┘
                       │      │ 10% Treasury │
                       │      └──────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Gate Check 2:       │
                │  Event Verification  │
                │  ├─ DepositReceived  │
                │  ├─ grossAmount OK   │
                │  ├─ feeAmount 0.5%   │
                │  └─ yieldRecycle 30% │
                └──────┬───────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Test Unwrap         │
                │  factory.unwrapFromBurn()│
                └──────┬───────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Unlock 0.05 TFUEL  │──►┌──────────────────┐
                └──────┬───────────────┘   │  Unwrap Split:   │
                       │                   │  70% → Recipient │
                       │                   │  30% → Recycle   │
                       │                   └─────┬────────────┘
                       │                         │
                       │              ┌──────────┴──────────┐
                       │              ▼                     ▼
                       │      ┌──────────────┐     ┌──────────────┐
                       │      │ Recipient    │     │ Vault Keeps  │
                       │      │ gets 0.035   │     │ 0.015 TFUEL  │
                       │      │ TFUEL (70%)  │     │ (30% recycle)│
                       │      └──────────────┘     └──────────────┘
                       │
                       ▼
                ┌──────────────────────┐
                │  Gate Check 3:       │
                │  Unwrap Verification │
                │  ├─ UnwrapFromBurn   │
                │  ├─ netAmount 70%    │
                │  └─ yieldRecycle 30% │
                └──────┬───────────────┘
                       │
                       ▼

┌─────────────────────────────────────────────────────────────────────────┐
│                      POST-DEPLOYMENT PHASE                               │
└─────────────────────────────────────────────────────────────────────────┘

                ┌──────────────────────┐
                │  All Tests Passed ✅ │
                └──────┬───────────────┘
                       │
                       ├──────► Document Results
                       │        (deployment log)
                       │
                       ├──────► Update Team
                       │        (addresses, status)
                       │
                       ├──────► Verify on Explorer
                       │        (source code)
                       │
                       └──────► Prepare for Step 3
                                (Backend Listener)
                                │
                                ▼
                        ┌──────────────┐
                        │  STEP 2      │
                        │  COMPLETE 🚀 │
                        └──────────────┘


═══════════════════════════════════════════════════════════════════════════

                          FERRARI HYBRID FLOW

┌─────────────────────────────────────────────────────────────────────────┐
│                    REVENUE DISTRIBUTION MODEL                            │
└─────────────────────────────────────────────────────────────────────────┘

                        User Deposit: 1.0 TFUEL
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
         ┌──────────────┐              ┌──────────────┐
         │  Fee (0.5%)  │              │ Net Locked   │
         │  0.005 TFUEL │              │ 0.995 TFUEL  │
         └──────┬───────┘              └──────┬───────┘
                │                             │
                ▼                             │
    ┌───────────────────────┐                │
    │   RevenueSplitter     │                │
    │   4-Way Distribution  │                │
    └───────┬───────────────┘                │
            │                                 │
   ┌────────┴────────┐                       │
   │                 │                       │
   ▼                 ▼                       ▼
┌──────┐      ┌──────────┐         ┌─────────────────┐
│ 50%  │      │   25%    │         │  Yield Tracking │
│ veXF │      │   BBB    │         │  ├─ 30% recycle │
│Yield │      │ Buyback  │         │  └─ 70% LP fund │
└──────┘      └──────────┘         └─────────────────┘
              ┌──────────┐
              │   15%    │
              │   rXF    │
              │   Mint   │
              └──────────┘
              ┌──────────┐
              │   10%    │
              │ Treasury │
              └──────────┘

═══════════════════════════════════════════════════════════════════════════

                        UNWRAP FLOW (REVERSE-BURN)

                    Burn ibcTFUEL on Persistence
                                │
                                ▼
                    ZK Bridge Detects Burn
                                │
                                ▼
                    factory.unwrapFromBurn()
                                │
                    Unlock 1.0 TFUEL from Vault
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
         ┌──────────────┐              ┌──────────────┐
         │  To User     │              │  Recycled    │
         │  (70%)       │              │  (30%)       │
         │  0.7 TFUEL   │              │  0.3 TFUEL   │
         └──────────────┘              └──────┬───────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │  Yield Strategies│
                                    │  (Future:        │
                                    │   LST staking,   │
                                    │   LP provision)  │
                                    └──────────────────┘

═══════════════════════════════════════════════════════════════════════════

                         GOVERNANCE EXTRAS (PHASE 3)

                    ┌──────────────────┐
                    │  Quarterly Vote  │
                    │  veXF Holders    │
                    └────────┬─────────┘
                             │
                    ┌────────┴────────┐
                    │ LP Revenue Pool │
                    │ (5-10% of fees) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │   NFT    │   │ Airdrops │   │Milestones│
       │ Rewards  │   │ Campaigns│   │  Bonuses │
       └──────────┘   └──────────┘   └──────────┘
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                    ┌────────────────┐
                    │  rXF Bonus     │
                    │  for Voters    │
                    │  (0.1% of vote)│
                    └────────────────┘

═══════════════════════════════════════════════════════════════════════════

Legend:
  ┌────┐
  │    │  = Process/Action
  └────┘

  ──►    = Data/Value Flow

  ├─ ─┤  = Split/Distribution

  ✓      = Validation Checkpoint

  🎉     = Success State

═══════════════════════════════════════════════════════════════════════════
```

## Key Parameters Summary

```yaml
Deployment:
  Network: Theta Mainnet (Chain ID: 361)
  Gas Price: 4000 Gwei (minimum)
  Gas Limit: 5,000,000
  Estimated Cost: ~0.013 TFUEL
  Required Balance: 0.5+ TFUEL (with buffer)

Ferrari Hybrid (Phase 2):
  Deposit Fee: 0.5%
  RevSplitter Splits:
    - veXF Yield: 50%
    - Buyback/Burn: 25%
    - rXF Mint: 15%
    - Treasury: 10%
  Yield Recycle: 30% (reverse-burn flag)
  LP Funding: 70% (net after fee)

Ferrari Hybrid (Phase 3 - Post-Audit):
  RevSplitter Splits:
    - BBB (Buyback-Burn-Boost): 30%
    - LP Funding (Governance-voted): 30%
    - veXF Yields: 25%
    - Treasury: 15%
  Governance LP: 5-10% quarterly vote
  veXF Multipliers: Up to 4x
  rXF Voter Bonus: 0.1% of vote value

Testing:
  SubVault Cap: 0.1 TFUEL (pre-audit)
  Test Deposit: 0.1 TFUEL
  Expected Fee: 0.0005 TFUEL
  Expected Net: 0.0995 TFUEL
  Yield Recycle: 0.02985 TFUEL (30%)
  LP Funding: 0.06965 TFUEL (70%)

Unwrap Test:
  Unlock Amount: 0.05 TFUEL
  To Recipient: 0.035 TFUEL (70%)
  Yield Recycle: 0.015 TFUEL (30%)
```

## Time Estimates

```
Pre-deployment checks:     5 minutes
Dry-run gas estimation:    2 minutes
Actual deployment:         5 minutes
Explorer verification:     5 minutes
SubVault creation:         5 minutes
Deposit test:              5 minutes
Event verification:        3 minutes
Unwrap test:               5 minutes
Final checks:              5 minutes
─────────────────────────────────────
TOTAL ESTIMATED TIME:     40 minutes
```

## Success Indicators

```
✅ VaultFactory deployed successfully
✅ Transaction confirmed in 1-2 blocks
✅ Deployment info saved correctly
✅ .env updated with new address
✅ Explorer shows contract verified
✅ SubVault created without errors
✅ 0.5% fee sent to RevSplitter
✅ DepositReceived event emitted
✅ 30% recycle flag in event data
✅ Unwrap sends 70% to recipient
✅ UnwrapFromBurn event emitted
✅ All balances reconcile correctly
```

---

**Generated:** January 2026  
**Version:** Ferrari Hybrid v3.0  
**Status:** Ready for Deployment 🚀

