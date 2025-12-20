# XFUEL Tokenomics 3.1 Architecture Diagram

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js + Expo)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  Swap Tab  │  Lottery Tab  │  Governance Tab  │  Treasury Tab  │  ...   │
│  (Existing) │  (Existing)   │  (NEW)          │  (NEW)         │        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKEND API (Express)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  /api/swap  │  /api/lottery │  /api/vexf  │  /api/treasury │  ...        │
│  (Existing)  │  (Existing)   │  (NEW)      │  (NEW)        │              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    THETA EVM SMART CONTRACTS                             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Contract Interaction Flow

### Revenue Flow

```
┌──────────────┐
│  XFUELPool   │  (Swap fees)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ XFUELRouter  │  (Fee collection)
└──────┬───────┘
       │
       ▼
┌──────────────┐      ┌──────────────────┐
│RevenueAdapter│ ────▶│ RevenueSplitter   │
└──────────────┘      └─────────┬─────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
        ┌───────────┐   ┌──────────┐   ┌──────────────┐
        │   veXF    │   │Buyback   │   │     rXF      │
        │  (50%)    │   │Burner    │   │   (15%)      │
        └───────────┘   │  (25%)   │   └──────────────┘
                         └──────────┘
                                │
                                ▼
                        ┌──────────────┐
                        │Innovation    │
                        │Treasury (10%)│
                        └──────────────┘
```

### Governance Flow

```
┌──────────────┐
│   XF Token   │
└──────┬───────┘
       │ Lock
       ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│     veXF     │◀─────│  rXF Locker  │◀─────│     rXF      │
│  (Governance)│      │  (365 days)  │      │  (Receipts)  │
└──────┬───────┘      └──────────────┘      └──────────────┘
       │
       ├───▶ Voting Power (time-weighted + multipliers)
       │
       ├───▶ Yield Distribution (50% of revenue)
       │
       └───▶ Treasury Governance
                │
                ▼
        ┌──────────────┐
        │Innovation    │
        │Treasury      │
        └──────┬───────┘
               │
       ┌───────┼───────┐
       ▼       ▼       ▼
  ┌────────┐ ┌────────┐ ┌────────┐
  │Builder │ │Acquire │ │Moonshot│
  │Vault   │ │Vault   │ │Vault   │
  └────────┘ └────────┘ └────────┘
```

### Theta Pulse Integration

```
┌─────────────────┐
│  Theta EdgeNode │  (Generates earnings)
└────────┬────────┘
         │ TPulse Message
         ▼
┌─────────────────┐
│ Backend Listener│  (Validates & stores)
└────────┬────────┘
         │ Proof
         ▼
┌─────────────────┐      ┌──────────────────┐
│ThetaPulseProof  │─────▶│ ThetaPulseMulti  │
│  (On-chain)     │      │  (Multiplier)    │
└─────────────────┘      └────────┬──────────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │     veXF     │
                          │ (Permanent   │
                          │  multiplier) │
                          └──────────────┘
```

### Fee Switch Control

```
┌─────────────────┐
│     veXF        │  (Governance vote)
└────────┬────────┘
         │ Toggle
         ▼
┌─────────────────┐
│CyberneticFee    │
│Switch           │
└────────┬────────┘
         │ Fee Status
         ▼
┌─────────────────┐
│  XFUELPool      │  (Applies fees)
└─────────────────┘
```

## Data Flow: Complete Example

### User Swaps TFUEL → stkTIA

```
1. User Action (Frontend)
   └─▶ Swap 100 TFUEL → stkTIA

2. Router Call
   └─▶ XFUELRouter.swapAndStake()

3. Pool Execution
   └─▶ XFUELPool.swap()
       ├─▶ Check CyberneticFeeSwitch
       ├─▶ Execute swap
       └─▶ Collect fees (if enabled)

4. Fee Collection
   └─▶ XFUELRouter.collectAndDistributeFees()
       └─▶ RevenueAdapter.intercept()
           └─▶ RevenueSplitter.splitRevenue(100 TFUEL fees)

5. Revenue Split (90/10)
   ├─▶ 90% to veXF holders:
   │   ├─▶ 50% → veXF.distributeYield() (45 TFUEL)
   │   ├─▶ 25% → BuybackBurner.buyAndBurn() (22.5 TFUEL)
   │   └─▶ 15% → rXF.mint() (13.5 TFUEL → rXF receipts)
   │
   └─▶ 10% to Innovation Treasury (10 TFUEL)

6. User Receives
   └─▶ stkTIA tokens (95 TFUEL worth, after 5% fee)
```

### User Locks XF for veXF

```
1. User Action (Frontend)
   └─▶ Lock 1000 XF for 4 years

2. Contract Call
   └─▶ veXF.createLock(1000 XF, 4 years)

3. Voting Power Calculation
   └─▶ Base: 1000 XF
       ├─▶ Time multiplier: 4× (4 years)
       ├─▶ rXF lock bonus: +4× (if rXF locked 365 days)
       └─▶ Theta Pulse bonus: +3× (if proof submitted)
       Total: Up to 11× multiplier = 11,000 voting power

4. Yield Distribution
   └─▶ Receives 50% of protocol revenue (proportional to veXF balance)
```

### User Submits Theta Pulse Proof

```
1. User Action (Frontend)
   └─▶ Submit Edge Node earnings proof

2. Backend Validation
   └─▶ ThetaPulseListener.verifyProof()
       ├─▶ Validate signature (EIP-712)
       ├─▶ Check earnings amount
       └─▶ Store proof in database

3. On-Chain Verification
   └─▶ ThetaPulseProof.submitProof()
       ├─▶ Verify signature on-chain
       ├─▶ Calculate multiplier (1×-3× based on earnings)
       └─▶ Store permanent multiplier

4. veXF Integration
   └─▶ veXF applies multiplier to voting power
       └─▶ Permanent boost (doesn't expire)
```

## Contract Dependencies

```
XFUELRouter
  ├─▶ XFUELPoolFactory
  ├─▶ TreasuryILBackstop
  └─▶ RevenueAdapter (NEW)
        └─▶ RevenueSplitter (NEW)
              ├─▶ veXF (NEW)
              ├─▶ BuybackBurner (NEW)
              ├─▶ rXF (NEW)
              └─▶ InnovationTreasury (NEW)

veXF (NEW)
  ├─▶ XFUELToken
  ├─▶ rXFLocker (NEW)
  └─▶ ThetaPulseMultiplier (NEW)

InnovationTreasury (NEW)
  ├─▶ veXF (for governance)
  ├─▶ BuilderVault (NEW)
  ├─▶ AcquisitionVault (NEW)
  └─▶ MoonshotVault (NEW)

XFUELPool
  └─▶ CyberneticFeeSwitch (NEW)

TipPool
  └─▶ RevenueSplitter (NEW) [optional hook]
```

## Upgrade Path

```
Current (v1.0.0)
  └─▶ XFUELRouter (immutable)
        └─▶ Use RevenueAdapter pattern (non-breaking)

Future (v2.0.0)
  └─▶ XFUELRouterV2 (UUPS upgradeable)
        └─▶ Direct RevenueSplitter integration
```

## Security Boundaries

```
┌─────────────────────────────────────────┐
│  CRITICAL PATH (No Changes)            │
│  - XFUELRouter.swap()                  │
│  - XFUELPool.swap()                    │
│  - TipPool lottery logic               │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  NEW FEATURES (Isolated)               │
│  - veXF lock/unlock                    │
│  - rXF minting                         │
│  - Revenue distribution                │
│  - Treasury governance                 │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  INTEGRATION POINTS (Adapter Pattern)  │
│  - RevenueAdapter                      │
│  - Fee switch check (optional)         │
│  - TipPool revenue hook (optional)     │
└─────────────────────────────────────────┘
```

---

**Legend:**
- `(NEW)` = New contract/module
- `(Existing)` = Current v1.0.0 contract
- `▶` = Data flow direction
- `─` = Dependency relationship


