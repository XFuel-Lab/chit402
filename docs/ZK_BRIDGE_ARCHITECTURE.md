# ZK Bridge Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              THETA NETWORK SIDE                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                   ┌─────────────────┐
                                   │  VaultFactory   │
                                   │  (Create2)      │
                                   └────────┬────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          │                 │                 │
                   ┌──────▼──────┐   ┌─────▼──────┐   ┌─────▼──────┐
                   │  SubVault   │   │  SubVault  │   │  SubVault  │
                   │  (Alice)    │   │  (Bob)     │   │  (Carol)   │
                   │             │   │            │   │            │
                   │  995 TFUEL  │   │  745 TFUEL │   │  1990 TFUEL│
                   └──────┬──────┘   └─────┬──────┘   └─────┬──────┘
                          │                │                │
                    0.5% fee         0.5% fee         0.5% fee
                          │                │                │
                          └────────────────┼────────────────┘
                                           │
                                   ┌───────▼────────┐
                                   │ RevenueSplitter│
                                   │  (Fees 0.5%)   │
                                   └────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           ZK BRIDGE RELAYER (Off-chain)                              │
└─────────────────────────────────────────────────────────────────────────────────────┘

     DepositReceived Event                              Burn Event (Persistence)
              │                                                   │
              ▼                                                   ▼
    ┌──────────────────┐                              ┌──────────────────┐
    │  Detect Deposit  │                              │   Detect Burn    │
    │                  │                              │                  │
    │ • Vault address  │                              │ • burnTxHash     │
    │ • Sender         │                              │ • Amount         │
    │ • Net amount     │                              │ • Recipient      │
    └────────┬─────────┘                              └────────┬─────────┘
             │                                                 │
             │                                                 │
             ▼                                                 ▼
    ┌──────────────────┐                              ┌──────────────────┐
    │ Mint ibcTFUEL on │                              │ Verify ZK Proof  │
    │  Persistence     │                              │  (Burn valid?)   │
    └──────────────────┘                              └────────┬─────────┘
                                                               │
                                                               ▼
                                                    ┌──────────────────────┐
                                                    │  Call unwrapFromBurn │
                                                    │   on VaultFactory    │
                                                    └──────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          PERSISTENCE CHAIN SIDE                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                   ┌─────────────────┐
                                   │  ibcTFUEL       │
                                   │  (IBC Token)    │
                                   └────────┬────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          │                 │                 │
                   ┌──────▼──────┐   ┌─────▼──────┐   ┌─────▼──────┐
                   │   Alice     │   │    Bob     │   │   Carol    │
                   │  995 ibcTFUEL│  │ 745 ibcTFUEL│  │ 1990 ibcTFUEL│
                   └─────────────┘   └────────────┘   └────────────┘
                          │
                          │ Uses in Persistence DeFi
                          │
                          ▼
                   ┌─────────────┐
                   │ Burn 500    │ ◄── Alice wants to unwrap back to Theta
                   │ ibcTFUEL    │
                   └──────┬──────┘
                          │
                          │ Burn Event emitted
                          │
                          ▼
                   ┌─────────────────────┐
                   │ ZK Bridge detects   │
                   │ & triggers unlock   │
                   └─────────────────────┘
```

---

## Detailed Flow: Wrap (Theta → Persistence)

```
User Action                     Contract State                   Bridge Action
    │                                │                                │
    ├─ 1. Create Vault               │                                │
    │                                │                                │
    ▼                                ▼                                │
createVault(salt)           VaultFactory creates                     │
    │                       SubVault via Create2                     │
    │                       Returns: 0x5539...8832                   │
    │                                │                                │
    ├─ 2. Send 1000 TFUEL            │                                │
    │    to vault                    │                                │
    ▼                                ▼                                │
SubVault.receive()          • Deduct 5 TFUEL (0.5%)                  │
    │                       • Send to RevenueSplitter                │
    │                       • Keep 995 TFUEL in vault                │
    │                       • Track 298.5 TFUEL (30%) for yield      │
    │                       • Emit DepositReceived                   │
    │                                │                                │
    │                                │                                ├─ 3. Listen event
    │                                │                                │
    │                                │                                ▼
    │                                │                          Detect deposit
    │                                │                          Parse: 995 TFUEL
    │                                │                                │
    │                                │                                ├─ 4. Mint ibcTFUEL
    │                                │                                │
    │                                │                                ▼
    │                                │                          Persistence chain:
    │                                │                          Mint 995 ibcTFUEL
    │                                │                          to Alice's address
    │                                │                                │
    ▼                                ▼                                ▼
Alice has 995 ibcTFUEL      Vault holds 995 TFUEL            Bridge synced
on Persistence              as collateral
```

---

## Detailed Flow: Unwrap (Persistence → Theta)

```
User Action                     Bridge Action                    Contract State
    │                                │                                │
    ├─ 1. Burn 500 ibcTFUEL          │                                │
    │    on Persistence              │                                │
    │                                │                                │
    ▼                                ├─ 2. Detect burn                │
Persistence emits                    │                                │
BurnEvent                            ▼                                │
    │                          Verify ZK proof                        │
    │                          burnTxHash: 0xabc...                   │
    │                                │                                │
    │                                ├─ 3. Call unwrapFromBurn        │
    │                                │                                │
    │                                ▼                                ▼
    │                    vaultFactory.unwrapFromBurn(      Check processedBurns
    │                      vault: 0x5539...8832,            mapping
    │                      burnTxHash: 0xabc...,                │
    │                      recipient: Bob,                       │
    │                      amount: 500 TFUEL                     ├─ Mark as processed
    │                    )                                       │
    │                                │                           ▼
    │                                │                    Calculate split:
    │                                │                    • To Bob: 350 (70%)
    │                                │                    • Yield: 150 (30%)
    │                                │                           │
    │                                │                           ├─ Transfer 350 to Bob
    │                                │                           │
    │                                │                           ├─ Keep 150 in vault
    │                                │                           │
    │                                │                           ▼
    │                                │                    Emit UnwrapFromBurn
    │                                │                    event
    │                                │                           │
    ▼                                ▼                           ▼
Bob receives                 Bridge logs                Vault balance:
350 TFUEL                    success                   995 - 500 = 495 TFUEL
                                                       (150 for future yield)
```

---

## Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        Access Control Layers                     │
└─────────────────────────────────────────────────────────────────┘

    DEFAULT_ADMIN_ROLE (Admin)
           │
           ├─ setRevSplitter()
           ├─ refundFromVault()
           ├─ grantRole()
           └─ revokeRole()

    PAUSER_ROLE (Emergency)
           │
           ├─ pause()
           └─ unpause()

    ZK_BRIDGE_ROLE (Bridge Operator)
           │
           └─ unwrapFromBurn()  ◄── CRITICAL: Only trusted bridge

    Factory-Only (SubVault)
           │
           ├─ unwrapFromBurn()
           └─ refund()
```

---

## Data Flow: Yield Recycle (30%)

```
DEPOSIT PHASE:
┌─────────────────┐
│ 1000 TFUEL      │
│ Deposit         │
└────────┬────────┘
         │
         ├─ 0.5% → RevenueSplitter (5 TFUEL)
         │
         ▼
    ┌─────────────┐
    │ 995 TFUEL   │
    │ Net in Vault│
    └──────┬──────┘
           │
           ├─ 70% → Locked for ibcTFUEL (696.5 TFUEL)
           │
           └─ 30% → Yield allocation (298.5 TFUEL)
                    [Tracked, stays in vault]
                    Future: Route to yield strategy

UNWRAP PHASE:
┌─────────────────┐
│ 500 TFUEL       │
│ Unwrap Request  │
└────────┬────────┘
         │
         ├─ 70% → Recipient (350 TFUEL)
         │
         └─ 30% → Yield recycle (150 TFUEL)
                  [Stays in protocol]
                  Future: Compound back
```

---

## Replay Attack Prevention

```
┌──────────────────────────────────────────────────────────────────┐
│                  Burn Transaction Processing                      │
└──────────────────────────────────────────────────────────────────┘

    Burn on Persistence: burnTxHash = 0xabc123...

              ▼
    ┌─────────────────────┐
    │ Check if processed  │
    │ processedBurns[hash]│
    └──────────┬──────────┘
               │
         ┌─────┴─────┐
         │           │
    YES  │           │  NO
         │           │
         ▼           ▼
    ┌────────┐  ┌────────────┐
    │ REVERT │  │  PROCESS   │
    │        │  │            │
    └────────┘  │ 1. Mark as │
                │   processed│
                │ 2. Transfer│
                │ 3. Emit    │
                └────────────┘

    processedBurns[0xabc123...] = true  ✓
    unwrapRecipients[0xabc123...] = Bob ✓
```

---

**For more details, see:**
- `docs/ZK_BRIDGE_IMPLEMENTATION.md` - Complete technical documentation
- `ZK_BRIDGE_DELIVERY_SUMMARY.md` - Implementation summary
- `ZK_BRIDGE_QUICK_REFERENCE.md` - Quick reference guide

