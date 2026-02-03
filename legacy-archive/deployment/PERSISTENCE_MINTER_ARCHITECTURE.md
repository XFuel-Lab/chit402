# Persistence Minter - Architecture & Flow

## 🏗️ Contract Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Persistence Minter Contract                       │
│                         (ibcTFUEL Token)                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                    CW20 Token Base                         │   │
│  │  • Transfer, Send, Burn                                    │   │
│  │  • Allowances (Increase/Decrease)                         │   │
│  │  • TransferFrom, BurnFrom                                 │   │
│  │  • Balance & TokenInfo queries                            │   │
│  │  • Symbol: IBCTFUEL, Decimals: 18                        │   │
│  └────────────────────────────────────────────────────────────┘   │
│                               │                                      │
│  ┌────────────────────────────┼────────────────────────────────┐   │
│  │          XFuel Extensions  │                                │   │
│  │                            ▼                                │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │         VerifyAndMint                               │  │   │
│  │  │  • ZK Proof verification                            │  │   │
│  │  │  • Replay attack prevention                         │  │   │
│  │  │  • Mint to recipient                                │  │   │
│  │  │  • Pre-fund new users (0.001 XPRT)                 │  │   │
│  │  │  • Enforce mint cap                                 │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │         BurnAndUnwrap                               │  │   │
│  │  │  • Burn ibcTFUEL from sender                        │  │   │
│  │  │  • Calculate revenue split:                         │  │   │
│  │  │    - 30% → RevSplitter                             │  │   │
│  │  │    - 70% → LP Reinvest (flagged)                  │  │   │
│  │  │  • Emit unwrap event                                │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │         Admin Controls                              │  │   │
│  │  │  • Pause/Unpause                                    │  │   │
│  │  │  • SetVerifier address                              │  │   │
│  │  │  • SetRevSplitter address                           │  │   │
│  │  │  • Admin-only access control                        │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │         LST Staking                                 │  │   │
│  │  │  • DelegateToValidator                              │  │   │
│  │  │  • Post-mint staking                                │  │   │
│  │  │  • XPRT delegation                                  │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 🔄 Mint Flow

```
┌──────────────┐
│   User with  │
│  Keplr Wallet│
└──────┬───────┘
       │
       │ 1. Generate ZK Proof
       │    (Theta → Persistence bridge)
       │
       ▼
┌──────────────────┐
│  Frontend        │
│  (React/TS)      │
└──────┬───────────┘
       │
       │ 2. Call VerifyAndMint
       │    { zk_proof, amount, recipient }
       │
       ▼
┌──────────────────────────────────────┐
│  Persistence Minter Contract         │
│                                      │
│  ┌────────────────────────────────┐ │
│  │ Verify ZK Proof                │ │
│  │ • Check proof structure        │ │
│  │ • Validate public inputs       │ │
│  │ • Check proof not processed    │ │
│  └────────┬───────────────────────┘ │
│           │                          │
│           ▼                          │
│  ┌────────────────────────────────┐ │
│  │ Mint ibcTFUEL                  │ │
│  │ • Increase total supply        │ │
│  │ • Update recipient balance     │ │
│  │ • Mark proof as processed      │ │
│  └────────┬───────────────────────┘ │
│           │                          │
│           ▼                          │
│  ┌────────────────────────────────┐ │
│  │ Pre-fund if new user           │ │
│  │ • Check if previously funded   │ │
│  │ • Send 0.001 XPRT via BankMsg  │ │
│  │ • Mark user as funded          │ │
│  └────────┬───────────────────────┘ │
└───────────┼──────────────────────────┘
            │
            ▼
     ┌──────────────┐
     │  User Wallet │
     │  + ibcTFUEL  │
     │  + XPRT      │
     │  (if new)    │
     └──────────────┘
```

## 🔥 Burn & Unwrap Flow

```
┌──────────────┐
│     User     │
│ Has ibcTFUEL │
└──────┬───────┘
       │
       │ 1. Call BurnAndUnwrap(amount)
       │
       ▼
┌──────────────────────────────────────┐
│  Persistence Minter Contract         │
│                                      │
│  ┌────────────────────────────────┐ │
│  │ Burn ibcTFUEL                  │ │
│  │ • Deduct from sender balance   │ │
│  │ • Decrease total supply        │ │
│  └────────┬───────────────────────┘ │
│           │                          │
│           ▼                          │
│  ┌────────────────────────────────┐ │
│  │ Calculate Revenue Split        │ │
│  │ • 30% → recycled_amount        │ │
│  │ • 70% → lp_reinvest_amount     │ │
│  └────────┬───────────────────────┘ │
│           │                          │
│           ▼                          │
│  ┌────────────────────────────────┐ │
│  │ Emit Unwrap Event              │ │
│  │ • burner address               │ │
│  │ • total amount                 │ │
│  │ • recycled_amount              │ │
│  │ • lp_reinvest_amount           │ │
│  │ • rev_splitter address         │ │
│  └────────┬───────────────────────┘ │
└───────────┼──────────────────────────┘
            │
            ▼
     ┌──────────────────┐
     │  Backend Service │
     │  Event Monitor   │
     └──────┬───────────┘
            │
            ├─────> 30% ────> RevSplitter Contract
            │
            └─────> 70% ────> Flag for LP Reinvestment
```

## 🔒 Security Layers

```
┌──────────────────────────────────────────────────────────┐
│                    Security Layers                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Layer 1: ZK Proof Verification                         │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Validate proof structure                     │    │
│  │ • Check public inputs match transaction        │    │
│  │ • Verify against verification key              │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Layer 2: Replay Attack Prevention                      │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Generate SHA256 hash of proof                │    │
│  │ • Check if proof already processed             │    │
│  │ • Store processed proof hashes                 │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Layer 3: Mint Cap Enforcement                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Track total_minted                           │    │
│  │ • Compare against mint_cap                     │    │
│  │ • Reject if exceeds cap                        │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Layer 4: Pause Mechanism                               │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Admin can pause contract                     │    │
│  │ • Blocks mint/burn operations                  │    │
│  │ • Emergency stop functionality                 │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Layer 5: Admin Access Control                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Only admin can pause/unpause                 │    │
│  │ • Only admin can set verifier                  │    │
│  │ • Only admin can set rev splitter              │    │
│  │ • Only admin can delegate tokens               │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## 📊 State Management

```
┌──────────────────────────────────────────────────────────┐
│                     Contract State                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  CONFIG                                                  │
│  ┌────────────────────────────────────────────────┐    │
│  │ admin: Addr                                    │    │
│  │ verifier_address: Addr                         │    │
│  │ rev_splitter_address: Addr                     │    │
│  │ paused: bool                                   │    │
│  │ mint_cap: Option<Uint128>                      │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  STATE                                                   │
│  ┌────────────────────────────────────────────────┐    │
│  │ total_minted: Uint128                          │    │
│  │ total_burned: Uint128                          │    │
│  │ total_recycled: Uint128                        │    │
│  │ total_lp_reinvest: Uint128                     │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  PROCESSED_PROOFS (Map)                                  │
│  ┌────────────────────────────────────────────────┐    │
│  │ proof_hash → true                              │    │
│  │ (prevents replay attacks)                      │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  FUNDED_USERS (Map)                                      │
│  ┌────────────────────────────────────────────────┐    │
│  │ address → true                                 │    │
│  │ (tracks XPRT pre-funding)                      │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  CW20 State (from cw20-base)                            │
│  ┌────────────────────────────────────────────────┐    │
│  │ TOKEN_INFO: TokenInfo                          │    │
│  │ BALANCES: Map<Addr, Uint128>                   │    │
│  │ ALLOWANCES: Map<(Addr, Addr), AllowanceInfo>   │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## 🧪 Test Coverage

```
┌──────────────────────────────────────────────────────────┐
│                     Test Suite                           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ✅ test_instantiate                                     │
│     • Verify token info (name, symbol, decimals)        │
│     • Check config (admin, verifier, rev_splitter)      │
│                                                          │
│  ✅ test_verify_and_mint                                 │
│     • Mint with valid ZK proof                          │
│     • Verify balance updated                            │
│     • Check state updated                               │
│                                                          │
│  ✅ test_verify_and_mint_duplicate_proof                 │
│     • First mint succeeds                               │
│     • Second mint with same proof fails                 │
│                                                          │
│  ✅ test_burn_and_unwrap                                 │
│     • Burn tokens                                       │
│     • Verify revenue split (30/70)                      │
│     • Check events emitted                              │
│                                                          │
│  ✅ test_pause_unpause                                   │
│     • Admin pauses contract                             │
│     • Operations blocked while paused                   │
│     • Admin unpauses, operations resume                 │
│                                                          │
│  ✅ test_set_verifier                                    │
│     • Admin sets new verifier                           │
│     • Config updated                                    │
│                                                          │
│  ✅ test_unauthorized_admin_action                       │
│     • Non-admin tries admin operation                   │
│     • Transaction fails                                 │
│                                                          │
│  ✅ test_cw20_transfer                                   │
│     • Transfer tokens between users                     │
│     • Balances updated correctly                        │
│                                                          │
│  ✅ test_mint_cap                                        │
│     • Attempt to mint beyond cap                        │
│     • Transaction fails                                 │
│                                                          │
│  ✅ test_burn_insufficient_balance                       │
│     • Try to burn more than owned                       │
│     • Transaction fails                                 │
│                                                          │
│  ✅ test_multiple_users_minting                          │
│     • Multiple users mint separately                    │
│     • All balances correct                              │
│     • Total supply accurate                             │
│                                                          │
│  ✅ ZK Verifier Unit Tests                               │
│     • Valid proof verification                          │
│     • Invalid proof rejection                           │
│     • Proof hash generation                             │
│                                                          │
└──────────────────────────────────────────────────────────┘

Total Tests: 13
Coverage: All core features
Framework: cw-multi-test
```

## 📈 Integration Points

```
┌─────────────────────────────────────────────────────────────┐
│              XFuel Ecosystem Integration                    │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌────────────────┐    ┌──────────────┐
│    Theta      │    │  Persistence   │    │   Stride     │
│   Mainnet     │    │   Minter       │    │   Minter     │
│               │    │  (ibcTFUEL)    │    │  (Future)    │
│  • TFUEL      │    │                │    │              │
│  • Generate   │────>│  • ZK Verify   │    │  • Similar   │
│    ZK Proof   │    │  • Mint        │    │    to PERS   │
└───────────────┘    │  • Burn        │    └──────────────┘
                     │  • Revenue     │
                     │    Split       │
                     └────────┬───────┘
                              │
                     ┌────────┼────────┐
                     │                 │
                     ▼                 ▼
            ┌────────────────┐  ┌─────────────┐
            │  RevSplitter   │  │ LP Reinvest │
            │    (30%)       │  │   (70%)     │
            │                │  │             │
            │  • Revenue     │  │ • Add to    │
            │    sharing     │  │   liquidity │
            └────────────────┘  └─────────────┘
```

---

**Version**: 0.1.0  
**Status**: ✅ Ready for Testnet  
**License**: MIT




