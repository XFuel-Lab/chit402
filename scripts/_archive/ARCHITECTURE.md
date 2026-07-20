# Testnet Security Deployment Architecture

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    THETA TESTNET DEPLOYMENT                         │
│                         (Chain ID: 365)                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     SECURITY LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐         ┌─────────────────────┐          │
│  │  TimelockController │◄────────┤  MultiSigTreasury   │          │
│  │                     │         │                     │          │
│  │  • 6-hour delay     │         │  • 3-of-5 signers   │          │
│  │  • Proposers: 5     │         │  • UUPS upgradeable │          │
│  │  • Executors: 5     │         │  • Linked timelock  │          │
│  └──────────┬──────────┘         └──────────┬──────────┘          │
│             │                               │                      │
│             │ Controls critical ops         │ Manages treasury     │
│             │                               │                      │
└─────────────┼───────────────────────────────┼──────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CORE PROTOCOL                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  GOVERNANCE & LOCKING                                               │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐                       │
│  │   veXF   │  │   rXF    │  │ Governance │                       │
│  │ (voting) │  │ (redeem) │  │  (DAO)     │                       │
│  └──────────┘  └──────────┘  └────────────┘                       │
│       ▲             ▲              ▲                                │
│       │             │              │                                │
│       │             │              │                                │
│  REVENUE MANAGEMENT                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │   Revenue    │  │   Buyback    │  │  Innovation  │            │
│  │   Splitter   │──┤   Burner     │  │  Treasury    │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│         │                                                           │
│         │                                                           │
│  TRADING INFRASTRUCTURE                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │   XFUEL      │  │   XFUEL      │  │   Treasury   │            │
│  │   Router     │──┤ PoolFactory  │  │  ILBackstop  │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       TOKEN LAYER                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐              ┌──────────────────┐           │
│  │   USDC (Mock)    │              │   XF Token       │           │
│  │   • 6 decimals   │              │   • 18 decimals  │           │
│  │   • 1M initial   │              │   • 10M initial  │           │
│  └──────────────────┘              └──────────────────┘           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 🔐 Security Controls Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    CRITICAL OPERATION                            │
│              (e.g., upgrade, parameter change)                   │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
           ┌─────────────────────────┐
           │  Multi-sig Proposer     │
           │  (Any of 5 signers)     │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Schedule in Timelock   │
           │  (6-hour delay starts)  │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │   Wait 6 hours...       │
           │   (Can be cancelled)    │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Multi-sig Executor     │
           │  (Any of 5 signers)     │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Operation Executed     │
           └─────────────────────────┘
```

## 👥 Multi-Sig Transaction Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                  TREASURY TRANSACTION                            │
│              (e.g., withdraw funds, transfer)                    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
           ┌─────────────────────────┐
           │  Signer 1: Submit TX    │
           │  (Creates transaction)  │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Signer 2: Confirm      │
           │  (1 of 3 required)      │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Signer 3: Confirm      │
           │  (2 of 3 required)      │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Signer 4: Confirm      │
           │  (3 of 3 required)      │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Auto-Execute           │
           │  (Threshold met)        │
           └─────────────────────────┘
```

## 🚨 Emergency Pause Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                  SECURITY INCIDENT DETECTED                      │
│              (e.g., suspicious activity, bug)                    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
           ┌─────────────────────────┐
           │  Owner/Admin            │
           │  Calls pause()          │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  All Contract           │
           │  Operations STOP        │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Investigate &          │
           │  Fix Issue              │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Owner/Admin            │
           │  Calls unpause()        │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Operations Resume      │
           └─────────────────────────┘
```

## 🔄 Upgrade Flow (UUPS Pattern)

```
┌──────────────────────────────────────────────────────────────────┐
│                    CONTRACT UPGRADE                              │
│              (e.g., bug fix, new features)                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
           ┌─────────────────────────┐
           │  Deploy New             │
           │  Implementation         │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Submit upgradeTo()     │
           │  via Multi-sig          │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Get 3-of-5             │
           │  Confirmations          │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Schedule in            │
           │  Timelock (6 hours)     │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Wait & Review...       │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Execute Upgrade        │
           │  (Proxy points to new)  │
           └───────────┬─────────────┘
                       │
                       ▼
           ┌─────────────────────────┐
           │  Test New Version       │
           └─────────────────────────┘
```

## 📊 Deployment Statistics

| Metric | Value |
|--------|-------|
| **Total Contracts** | 13 |
| **Security Contracts** | 2 |
| **Token Contracts** | 4 |
| **Core Contracts** | 7 |
| **Upgradeable** | 8 |
| **Non-upgradeable** | 5 |
| **With Pause** | 8 |
| **With Timelock** | 3 |
| **Gas Estimate** | ~50-80 TFUEL |
| **Deploy Time** | ~5-10 minutes |

## 🎯 Access Control Matrix

| Contract | Owner | Pauser | Upgrader | Timelock Required |
|----------|-------|--------|----------|-------------------|
| **veXF** | Deployer | Owner | Owner | No |
| **rXF** | Deployer | Owner | Owner | No |
| **BuybackBurner** | Deployer | Owner | Owner | No |
| **InnovationTreasury** | Deployer | Owner | Owner | Yes |
| **RevenueSplitter** | Deployer | Owner | Owner | Yes |
| **TreasuryILBackstop** | Deployer | N/A | N/A | Yes |
| **Governance** | Deployer | Owner | Owner | No |
| **MultiSigTreasury** | 5 Signers | N/A | 3-of-5 | Yes |
| **TimelockController** | Admin | N/A | N/A | N/A |

## 🔑 Key Addresses (Example)

```
┌─────────────────────────────────────────────────────┐
│  Security Infrastructure                            │
├─────────────────────────────────────────────────────┤
│  TimelockController:     0x1234...5678              │
│  MultiSigTreasury:       0xabcd...ef01              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Tokens                                             │
├─────────────────────────────────────────────────────┤
│  USDC (Mock):            0x2345...6789              │
│  XF Token:               0xbcde...f012              │
│  veXF:                   0x3456...789a              │
│  rXF:                    0xcdef...0123              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Core Protocol                                      │
├─────────────────────────────────────────────────────┤
│  BuybackBurner:          0x4567...89ab              │
│  InnovationTreasury:     0xdef0...1234              │
│  RevenueSplitter:        0x5678...9abc              │
│  TreasuryILBackstop:     0xef01...2345              │
│  Governance:             0x6789...abcd              │
│  XFUELPoolFactory:       0xf012...3456              │
│  XFUELRouter:            0x789a...bcde              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Multi-Sig Signers (Testnet Mock)                  │
├─────────────────────────────────────────────────────┤
│  Signer 1:               0x89ab...cdef              │
│  Signer 2:               0x0123...4567              │
│  Signer 3:               0x9abc...def0              │
│  Signer 4:               0x1234...5678              │
│  Signer 5:               0xabcd...ef01              │
└─────────────────────────────────────────────────────┘
```

## 📈 Deployment Timeline

```
0:00 ────┐
         │ Validate Network & Account
0:30 ────┤
         │ Deploy Mock Tokens (USDC, XF)
1:00 ────┤
         │ Create Mock Signers (5)
1:30 ────┤
         │ Deploy TimelockController
2:00 ────┤
         │ Deploy MultiSigTreasury
2:30 ────┤
         │ Deploy veXF
3:00 ────┤
         │ Deploy rXF
3:30 ────┤
         │ Deploy BuybackBurner
4:00 ────┤
         │ Deploy InnovationTreasury
4:30 ────┤
         │ Deploy RevenueSplitter
5:00 ────┤
         │ Deploy TreasuryILBackstop
5:30 ────┤
         │ Deploy Governance
6:00 ────┤
         │ Deploy PoolFactory & Router
6:30 ────┤
         │ Configure References
7:00 ────┤
         │ Configure Timelock Access
7:30 ────┤
         │ Test Pause Functionality
8:00 ────┤
         │ Save Deployment Data
8:30 ────┘
         ✅ Complete!
```

## 🌐 Network Configuration

```yaml
Network: Theta Testnet
Chain ID: 365
RPC URL: https://eth-rpc-api-testnet.thetatoken.org/rpc
Explorer: https://testnet-explorer.thetatoken.org/
Faucet: https://faucet.thetatoken.org/
Currency: TFUEL
Gas Price: Auto
Block Time: ~6 seconds
```

---

**Last Updated**: January 6, 2026  
**Architecture Version**: 1.0.0  
**Deployment Script**: testnet-deploy-security.ts


