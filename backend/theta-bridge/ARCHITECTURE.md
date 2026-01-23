# 🎨 XFuelLab Backend Architecture - Visual Guide

Visual diagrams and architecture documentation for the extended backend.

---

## 🏗️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        XFuelLab Hybrid ZK Bridge                       │
│                         Backend Service v2.0                           │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │                                                       │
        ▼                                                       ▼
┌───────────────────┐                               ┌───────────────────┐
│  FORWARD FLOW     │                               │  REVERSE-BURN     │
│  Theta → Persist. │                               │  Persist. → Theta │
└───────────────────┘                               └───────────────────┘
        │                                                       │
        │                                                       │
        ▼                                                       ▼
┌───────────────────────────────────────┐   ┌───────────────────────────────────────┐
│  1. listener.js                       │   │  1. persistence-listener.js           │
│     - Monitors Theta DepositReceived  │   │     - Monitors Persistence burn events│
│     - Multi-RPC with failover         │   │     - WebSocket + polling backup      │
│     - WebSocket + periodic scan       │   │     - Cosmos SDK event subscription   │
└─────────────────┬─────────────────────┘   └─────────────────┬─────────────────────┘
                  │                                             │
                  ▼                                             ▼
┌───────────────────────────────────────┐   ┌───────────────────────────────────────┐
│  2. prover.js                         │   │  2. yield-unwrapper.js                │
│     - Generates ZK proofs (mock)      │   │     - Splits yield (30%/70%)          │
│     - snarkjs Groth16 (production)    │   │     - Swaps ibcUSDC → TFUEL           │
│     - Proof verification              │   │     - Routes to RevenueSplitter       │
└─────────────────┬─────────────────────┘   └─────────────────┬─────────────────────┘
                  │                                             │
                  ▼                                             ▼
┌───────────────────────────────────────┐   ┌───────────────────────────────────────┐
│  3. redis-client.js                   │   │  3. RevenueSplitter (Theta)           │
│     - Stores vault mappings           │   │     - 50% → veXF yield                │
│     - Stores reverse-burn events      │   │     - 25% → buyback/burn              │
│     - TTL management                  │   │     - 15% → rXF mint                  │
│     - Statistics tracking             │   │     - 10% → Treasury                  │
└─────────────────┬─────────────────────┘   └─────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────┐
│  4. refund-manager.js                 │
│     - Auto-refund expired deposits    │
│     - Check vault balance on-chain    │
│     - Execute refund via VaultFactory │
└───────────────────────────────────────┘
```

---

## 🔄 Bidirectional Flow Diagram

```
                                THETA NETWORK
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  ┌──────────┐         ┌──────────────┐         ┌──────────────────┐    │
│  │ SubVault │  ◀───   │ VaultFactory │  ───▶   │ RevenueSplitter  │    │
│  └──────────┘         └──────────────┘         └──────────────────┘    │
│       │                      │                            ▲              │
│       │ deposit              │ refund                     │ TFUEL        │
│       │                      │                            │ routing      │
└───────┼──────────────────────┼────────────────────────────┼──────────────┘
        │                      │                            │
        │ DepositReceived      │                            │
        │ event                │                            │
        ▼                      │                            │
┌──────────────────────────────┼────────────────────────────┼──────────────┐
│                              │                            │              │
│                     BACKEND SERVICE                       │              │
│                                                           │              │
│  ┌─────────────┐    ┌──────────┐    ┌─────────────┐     │              │
│  │  listener   │───▶│  prover  │───▶│ redis-client│     │              │
│  └─────────────┘    └──────────┘    └─────────────┘     │              │
│                                            │              │              │
│                                            │              │              │
│  ┌─────────────┐    ┌──────────┐          │              │              │
│  │persistence- │───▶│  yield-  │──────────┘              │              │
│  │  listener   │    │unwrapper │─────────────────────────┘              │
│  └─────────────┘    └──────────┘                                        │
│        ▲                  │                                              │
│        │                  │ 70% reinvest                                 │
│        │                  ▼                                              │
└────────┼──────────────────┼───────────────────────────────────────────┐
         │                  │                                             │
         │ burn event       │                                             │
         │                  │                                             │
         │                  ▼                                             │
                    PERSISTENCE NETWORK                                   │
┌────────┼───────────────────────────────────────────────────────────────┼──┐
│        │                                                                │  │
│  ┌─────┴──────┐         ┌──────────────┐         ┌─────────────────┐  │  │
│  │ burn       │         │ ibcTFUEL     │         │ LST Staking     │  │  │
│  │ ibcTFUEL   │  ◀───   │ minter       │  ◀───   │ (stkATOM, etc.) │  │  │
│  └────────────┘         └──────────────┘         └─────────────────┘  │  │
│       │                      ▲                           ▲             │  │
│       │ emits                │ mint                      │ stake       │  │
│       │ event                │ 1:1                       │             │  │
│       │                      │                           │             │  │
│       │                 ┌────┴─────┐              ┌─────┴─────┐       │  │
│       │                 │ ZK Proof │              │ User      │       │  │
│       │                 │ verified │              │ deposits  │       │  │
│       └────────────────▶└──────────┘              └───────────┘       │  │
│         ibcUSDC yield                                  │               │  │
│         (30% unwrap)                                   │               │  │
└───────────────────────────────────────────────────────┼───────────────┼──┘
                                                         │               │
                                                         └───────────────┘
                                                          LP growth (70%)
```

---

## 🔌 Component Interaction

```
┌────────────────────────────────────────────────────────────────────────┐
│                           index.js (Orchestrator)                      │
│                                                                        │
│  init() ──▶ Validates config ──▶ Initializes components ──▶ HTTP setup│
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    Component Lifecycle                       │    │
│  │                                                              │    │
│  │  1. initRedis()              ── Redis connection             │    │
│  │  2. initProvider()           ── Multi-RPC setup              │    │
│  │  3. initProver()             ── ZK circuit loading           │    │
│  │  4. initRefundManager()      ── Relayer wallet setup         │    │
│  │  5. initListener()           ── Theta WebSocket connect      │    │
│  │  6. initPersistenceListener()── Persistence WebSocket ✨NEW  │    │
│  │  7. initYieldUnwrapper()     ── Swap router setup    ✨NEW  │    │
│  │                                                              │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│  start() ──▶ Start HTTP ──▶ Start listeners ──▶ Start unwrapper      │
│                                                                        │
│  stop() ──▶ Stop listeners ──▶ Close HTTP ──▶ Close Redis            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Module Dependencies

```
index.js
├── config.js
│   ├── dotenv (env loading)
│   └── path (file paths)
│
├── logger.js
│   └── pino (structured logging)
│
├── redis-client.js
│   ├── redis (client)
│   └── logger.js
│
├── provider.js
│   ├── ethers (RPC provider)
│   ├── config.js
│   └── logger.js
│
├── listener.js
│   ├── ethers (event parsing)
│   ├── provider.js
│   ├── redis-client.js
│   ├── prover.js
│   ├── refund-manager.js
│   ├── config.js
│   └── logger.js
│
├── persistence-listener.js ✨NEW
│   ├── ws (WebSocket client)
│   ├── redis-client.js
│   ├── config.js
│   └── logger.js
│
├── yield-unwrapper.js ✨NEW
│   ├── ethers (contract calls)
│   ├── provider.js
│   ├── redis-client.js
│   ├── config.js
│   └── logger.js
│
├── prover.js
│   ├── snarkjs (ZK proofs)
│   ├── config.js
│   └── logger.js
│
└── refund-manager.js
    ├── ethers (transactions)
    ├── provider.js
    ├── redis-client.js
    ├── config.js
    └── logger.js
```

---

## 🔄 Event Flow State Machine

### Forward Flow (Deposits)

```
┌─────────┐     DepositReceived     ┌──────────┐     Confirmations     ┌────────────┐
│ Pending ├───────────────────────▶ │Processing├──────────────────────▶│ Generating │
└─────────┘                         └──────────┘                        │   Proof    │
                                                                         └──────┬─────┘
                                                                                │
                                                                                │
                                    ┌───────────┐      Proof verified          │
                                    │ Completed ◀────────────────────────────┘
                                    └─────┬─────┘
                                          │
                                          │ Expired/Invalid
                                          ▼
                                    ┌──────────┐      Refund executed
                                    │ Refunded ├──────────────────────▶ [END]
                                    └──────────┘
```

### Reverse-Burn Flow (Yields)

```
┌─────────┐     Burn event detected     ┌──────────┐     Yield split      ┌────────────┐
│ Pending ├───────────────────────────▶ │Processing├──────────────────────▶│  Swapping  │
└─────────┘                             └──────────┘                        │ ibcUSDC→TF │
                                                                             └──────┬─────┘
                                                                                    │
                                                                                    │
                                    ┌───────────┐      Revenue routed              │
                                    │ Completed ◀────────────────────────────────┘
                                    └─────┬─────┘
                                          │
                                          │ Below threshold / Error
                                          ▼
                                    ┌──────────┐
                                    │  Failed  │
                                    └──────────┘
```

---

## 🗄️ Redis Data Model

```
┌────────────────────────────────────────────────────────────────────────┐
│                            Redis Storage                               │
└────────────────────────────────────────────────────────────────────────┘

vault:{address}                         reverse-burn:{txHash}
├── keplrAddr: "persistence1..."        ├── burner: "persistence1..."
├── timestamp: 1704088800000            ├── amount: "1000000000000000000"
├── nonce: 42                           ├── ibcUSDCYield: "5000000"
├── status: "pending" | "processing"    ├── txHash: "0xabc..."
│           | "completed" | "refunded"  ├── blockHeight: 12345
├── proofHash: "0x..." (if completed)   ├── timestamp: 1704088800000
├── refundTxHash: "0x..." (if refunded) ├── status: "pending" | "completed"
├── lastUpdated: 1704088800000          │           | "failed" | "below_threshold"
└── TTL: 30 minutes (pending)           ├── processedAt: 1704088900000
         7 days (completed)             └── TTL: 7 days (completed)
         30 days (refunded)                      30 days (audit)

Statistics (computed)                   Keys Pattern Matching
├── vault:* → Forward flow              ├── KEYS "vault:*"
│   └── Count by status                 ├── KEYS "reverse-burn:*"
└── reverse-burn:* → Reverse flow       └── KEYS "*" (avoid in prod)
    └── Count by status
```

---

## 🌐 Network Communication

```
┌────────────────────────────────────────────────────────────────────────┐
│                        External Connections                            │
└────────────────────────────────────────────────────────────────────────┘

THETA NETWORK
┌────────────────────────────────────┐
│ Multi-RPC Provider (failover)      │
├────────────────────────────────────┤
│ 1. https://eth-rpc-api.theta...    │ ◀────┐
│ 2. https://theta-eth-rpc.theta...  │      │
│ 3. https://theta-bridge-rpc...     │      │ ethers.js
└────────────────────────────────────┘      │ provider.js
         │                                   │
         │ JSON-RPC 2.0                     │
         │ (HTTP polling)                   │
         ▼                                   │
┌────────────────────────────────────┐      │
│ listener.js                        ├──────┘
│ - eth_getLogs (periodic scan)      │
│ - eth_subscribe (WebSocket)        │
│ - eth_getBlockNumber               │
└────────────────────────────────────┘

PERSISTENCE NETWORK
┌────────────────────────────────────┐
│ Tendermint WebSocket               │
├────────────────────────────────────┤
│ wss://rpc.persistence.one/websocket│ ◀────┐
│                                    │      │
│ Subscribe: burn_ibcTFUEL events    │      │ ws (WebSocket)
└────────────────────────────────────┘      │ persistence-listener.js
         │                                   │
         │ Cosmos SDK events                │
         │ (WebSocket push)                 │
         ▼                                   │
┌────────────────────────────────────┐      │
│ https://rpc.persistence.one        │ ◀────┘
│ (RPC fallback for polling)         │
│ - /block?height=12345              │
│ - /tx_search?query=...             │
└────────────────────────────────────┘

REDIS
┌────────────────────────────────────┐
│ redis://localhost:6379             │ ◀────┐
├────────────────────────────────────┤      │
│ - GET/SET/DEL operations           │      │ redis client
│ - KEYS pattern matching            │      │ redis-client.js
│ - TTL management                   │      │
└────────────────────────────────────┘      │
         │                                   │
         │ Redis Protocol                   │
         │ (TCP)                             │
         ▼                                   │
┌────────────────────────────────────┐      │
│ All modules                        ├──────┘
│ - Shared state                     │
│ - Event queuing                    │
│ - Statistics                       │
└────────────────────────────────────┘
```

---

## 🔐 Security Boundaries

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Security Layers                               │
└────────────────────────────────────────────────────────────────────────┘

EXTERNAL (Untrusted)
┌────────────────────────────────────┐
│ - RPC endpoints (Theta, Persist.)  │
│ - User deposits                    │
│ - Blockchain events                │
└─────────────────┬──────────────────┘
                  │
                  │ Validation Layer
                  ▼
┌────────────────────────────────────┐
│ INPUT VALIDATION                   │
├────────────────────────────────────┤
│ ✓ Event signature verification     │
│ ✓ isVault() check (VaultFactory)   │
│ ✓ Mapping expiry validation        │
│ ✓ Amount thresholds                │
│ ✓ Address format checks            │
└─────────────────┬──────────────────┘
                  │
                  │ Processing Layer
                  ▼
┌────────────────────────────────────┐
│ BUSINESS LOGIC                     │
├────────────────────────────────────┤
│ ✓ ZK proof generation              │
│ ✓ Yield splitting (30%/70%)        │
│ ✓ Swap execution with slippage     │
│ ✓ Revenue routing                  │
└─────────────────┬──────────────────┘
                  │
                  │ Execution Layer
                  ▼
┌────────────────────────────────────┐
│ PRIVILEGED OPERATIONS              │
├────────────────────────────────────┤
│ ⚠️ Relayer wallet (limited funds)  │
│ ⚠️ Contract calls (gas limits)      │
│ ⚠️ Refund execution                 │
│ ⚠️ Redis write operations           │
└─────────────────┬──────────────────┘
                  │
                  │ Output Layer
                  ▼
┌────────────────────────────────────┐
│ EXTERNAL WRITES (Audited)          │
├────────────────────────────────────┤
│ 📝 Blockchain transactions (logs)  │
│ 📝 Redis state changes (TTL)       │
│ 📝 HTTP API responses (rate-limit) │
└────────────────────────────────────┘

SECRETS MANAGEMENT
┌────────────────────────────────────┐
│ Environment Variables              │
├────────────────────────────────────┤
│ 🔒 RELAYER_PRIVATE_KEY (encrypted) │
│ 🔒 REDIS_PASSWORD (if applicable)  │
│ 🔑 Contract addresses (verified)   │
│ 🔑 RPC endpoints (allowlist)       │
└────────────────────────────────────┘
```

---

## 📊 Monitoring Dashboard Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│                      XFuelLab Backend Dashboard                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │  RPC Health          │  │  Relayer Balance     │                  │
│  │  ─────────────────   │  │  ─────────────────   │                  │
│  │  🟢 Active: 3/3      │  │  💰 5.2 TFUEL        │                  │
│  │  Latency: 120ms      │  │  ⚠️ Low: < 1 TFUEL   │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Forward Flow (Theta → Persistence)                              │ │
│  │  ───────────────────────────────────────────────────────────────  │ │
│  │  Deposits: 1,234 total │ Pending: 5 │ Completed: 1,220           │ │
│  │  Success Rate: 98.9%   │ Refunds: 9 │ Failed: 0                  │ │
│  │                                                                    │ │
│  │  📈 Deposits/Hour: [Graph]                                         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Reverse-Burn Loop (Persistence → Theta) ✨NEW                   │ │
│  │  ───────────────────────────────────────────────────────────────  │ │
│  │  Burns: 567 total │ Pending: 2 │ Completed: 560                   │ │
│  │  Success Rate: 98.8% │ Below Threshold: 3 │ Failed: 2             │ │
│  │                                                                    │ │
│  │  WebSocket: 🟢 Connected │ Processing: 🟢 Active                  │ │
│  │  Queue Size: 2           │ Last Process: 5s ago                   │ │
│  │                                                                    │ │
│  │  📈 Yield Unwrapped: [Graph] │ 📈 Revenue Routed: [Graph]          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │  Redis Status        │  │  System Resources    │                  │
│  │  ─────────────────   │  │  ─────────────────   │                  │
│  │  🟢 Connected        │  │  CPU: 15%            │                  │
│  │  Keys: 1,234         │  │  Memory: 512MB / 2GB │                  │
│  │  Memory: 42MB        │  │  Disk: 5GB / 20GB    │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────┘

Alerts: 🔔 1 - Low relayer balance (click to view)
```

---

**For interactive exploration, refer to:**
- `README.md`: Detailed documentation
- `QUICK_REFERENCE.md`: Developer commands
- `DEPLOYMENT.md`: Production setup

---

**🎨 Architecture complete!** These diagrams provide a visual reference for understanding the extended backend system.




