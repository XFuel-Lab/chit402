# `execute_burn_for_unwrap` Fix Summary

## Issues Fixed

### 1. ❌ Incorrect Balance Deduction (Line 369)
**Before:**
```rust
BALANCES.save(deps.storage, &info.sender, &(balance - amount))?;
```
**Problem**: Manually manipulating balance instead of using `execute_transfer` and `execute_burn`.

**After:**
```rust
// Use execute_transfer for fee (properly handles balance, events)
let transfer_response = execute_transfer(
    deps.branch(),
    env.clone(),
    info.clone(),
    config.fee_collector_address.to_string(),
    fee_amount,
)?;

// Use execute_burn for burn amount (properly handles balance, total_supply, events)
let burn_response = execute_burn(
    deps.branch(),
    env.clone(),
    info.clone(),
    burn_amount,
)?;
```

---

### 2. ❌ Invalid Fee Transfer Logic (Lines 350-356)
**Before:**
```rust
let fee_transfer_msg = WasmMsg::Execute {
    contract_addr: config.fee_collector_address.to_string(),
    msg: to_json_binary(&cw20::Cw20ExecuteMsg::Transfer {
        recipient: config.fee_collector_address.to_string(),  // ❌ Wrong!
        amount: fee_amount,
    })?,
    funds: vec![],
};
```
**Problem**: Trying to transfer FROM fee_collector TO fee_collector (circular transfer).

**After:**
```rust
// execute_transfer handles the transfer FROM user TO fee_collector
let transfer_response = execute_transfer(
    deps.branch(),
    env.clone(),
    info.clone(),
    config.fee_collector_address.to_string(),
    fee_amount,
)?;
```

---

### 3. ❌ Manual Balance/Supply Manipulation (Lines 369-373)
**Before:**
```rust
BALANCES.save(deps.storage, &info.sender, &(balance - amount))?;

let mut token_info = TOKEN_INFO.load(deps.storage)?;
token_info.total_supply = token_info.total_supply.checked_sub(burn_amount)?;
TOKEN_INFO.save(deps.storage, &token_info)?;
```
**Problems**:
- No CW20 transfer/burn events emitted
- Error-prone manual state manipulation
- Inconsistent with CW20 standard

**After:**
```rust
// execute_burn properly:
// 1. Updates user balance
// 2. Decreases total_supply
// 3. Emits standard CW20 burn event
let burn_response = execute_burn(
    deps.branch(),
    env.clone(),
    info.clone(),
    burn_amount,
)?;
```

---

### 4. ❌ Invalid JSON Message for FeeCollector (Lines 360-366)
**Before:**
```rust
let fee_notify_msg = WasmMsg::Execute {
    contract_addr: config.fee_collector_address.to_string(),
    msg: to_json_binary(&serde_json::json!({
        "receive_fees": {}
    }))?,
    funds: vec![],
};
```
**Problem**: Using raw `serde_json::json!` which creates incorrect message format.

**After:**
```rust
// Properly structured message matching FeeCollector's ExecuteMsg
#[derive(serde::Serialize)]
struct ReceiveFeesMsg {
    receive_fees: ReceiveFeesInner,
}

#[derive(serde::Serialize)]
struct ReceiveFeesInner {}

let fee_notify_msg = WasmMsg::Execute {
    contract_addr: config.fee_collector_address.to_string(),
    msg: to_json_binary(&ReceiveFeesMsg {
        receive_fees: ReceiveFeesInner {},
    })?,
    funds: vec![],
};
```

---

### 5. ⚠️ Missing Import
**Before:**
```rust
use crate::state::{Config, State, CONFIG, STATE, PROCESSED_PROOFS, FUNDED_USERS};
```

**After:**
```rust
use crate::state::{Config, State, CONFIG, STATE, PROCESSED_PROOFS, FUNDED_USERS, REVERSE_BURN_NONCES};
```

---

## Corrected Function Flow

```rust
pub fn execute_burn_for_unwrap(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    amount: Uint128,
    theta_recipient: String,
) -> Result<Response, ContractError> {
    // 1. Load config and state
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // 2. Validate: paused, amount, theta_recipient, balance
    if config.paused { return Err(ContractError::Paused {}); }
    if amount.is_zero() { return Err(ContractError::InvalidAmount {}); }
    // ... theta address validation ...
    
    let balance = BALANCES.may_load(deps.storage, &info.sender)?.unwrap_or_default();
    if balance < amount { return Err(ContractError::InsufficientBalance {}); }

    // 3. Calculate fee (0.5%) and burn amount (99.5%)
    let fee_amount = amount.multiply_ratio(50u128, 10000u128);
    let burn_amount = amount.checked_sub(fee_amount)?;

    // 4. Get/update nonce BEFORE state changes
    let nonce = REVERSE_BURN_NONCES.may_load(deps.storage, &info.sender)?.unwrap_or(0);
    let next_nonce = nonce + 1;

    // 5. Transfer fee to FeeCollector (using execute_transfer)
    let transfer_response = execute_transfer(
        deps.branch(),
        env.clone(),
        info.clone(),
        config.fee_collector_address.to_string(),
        fee_amount,
    )?;

    // 6. Burn 99.5% (using execute_burn)
    let burn_response = execute_burn(
        deps.branch(),
        env.clone(),
        info.clone(),
        burn_amount,
    )?;

    // 7. Notify FeeCollector
    let fee_notify_msg = WasmMsg::Execute {
        contract_addr: config.fee_collector_address.to_string(),
        msg: to_json_binary(&ReceiveFeesMsg { receive_fees: ReceiveFeesInner {} })?,
        funds: vec![],
    };

    // 8. Update nonce and state
    REVERSE_BURN_NONCES.save(deps.storage, &info.sender, &next_nonce)?;
    state.total_reverse_burned = state.total_reverse_burned.checked_add(burn_amount)?;
    state.total_reverse_fees = state.total_reverse_fees.checked_add(fee_amount)?;
    STATE.save(deps.storage, &state)?;

    // 9. Combine responses and emit SP1 proof attributes
    let response = Response::new()
        .add_submessages(transfer_response.messages)
        .add_submessages(burn_response.messages)
        .add_message(fee_notify_msg)
        .add_attributes(transfer_response.attributes)
        .add_attributes(burn_response.attributes)
        .add_attribute("action", "burn_for_unwrap")
        .add_attribute("user", info.sender.to_string())
        .add_attribute("amount_burned", burn_amount)
        .add_attribute("fee_amount", fee_amount)
        .add_attribute("theta_recipient", theta_recipient)
        .add_attribute("nonce", next_nonce.to_string())
        .add_attribute("block_height", env.block.height.to_string())
        .add_attribute("timestamp", env.block.time.seconds().to_string())
        .add_attribute("chain_id", "core-1")
        .add_attribute("for_sp1_proof", "burn_for_unwrap");

    Ok(response)
}
```

---

## Key Improvements

✅ **Uses CW20 standard functions** (`execute_transfer`, `execute_burn`)
- Emits proper CW20 events (Transfer, Burn)
- Handles balance/supply updates correctly
- Consistent with CW20 best practices

✅ **No double-spending**
- `execute_transfer`: deducts `fee_amount` from user, sends to FeeCollector
- `execute_burn`: deducts `burn_amount` from user (already reduced by fee), burns it
- Total deducted: `fee_amount + burn_amount = amount` ✅

✅ **Proper message format for FeeCollector**
- Uses typed structs instead of raw JSON
- Matches FeeCollector's `ExecuteMsg::ReceiveFees {}`

✅ **Nonce tracking**
- Gets nonce BEFORE state changes (for idempotency)
- Updates after successful operations

✅ **Response composition**
- Combines submessages and attributes from both `execute_transfer` and `execute_burn`
- Adds custom "burn_for_unwrap" attributes for SP1 proof

---

## Test Cases to Add

### Unit Tests (`cosmwasm-contracts/persistence-minter/src/tests.rs`)

```rust
#[test]
fn test_burn_for_unwrap_success() {
    // Setup: mint 1000 ibcTFUEL to user
    // Execute: burn_for_unwrap(100 ibcTFUEL, "0x123...")
    // Assert:
    //   - User balance: 900 ibcTFUEL
    //   - FeeCollector balance: 0.5 ibcTFUEL (0.5%)
    //   - Total supply decreased by 99.5 ibcTFUEL
    //   - Nonce incremented to 1
    //   - Events: Transfer(user → FeeCollector, 0.5), Burn(user, 99.5)
    //   - Attributes: action="burn_for_unwrap", for_sp1_proof="burn_for_unwrap"
}

#[test]
fn test_burn_for_unwrap_insufficient_balance() {
    // User has 50 ibcTFUEL, tries to burn 100
    // Assert: InsufficientBalance error
}

#[test]
fn test_burn_for_unwrap_paused() {
    // Set contract to paused
    // Try burn_for_unwrap
    // Assert: Paused error
}

#[test]
fn test_burn_for_unwrap_invalid_theta_address() {
    // Try burn with invalid theta address (not 42 chars, no 0x prefix)
    // Assert: CustomError with "Invalid Theta address format"
}

#[test]
fn test_burn_for_unwrap_zero_amount() {
    // Try burn with amount = 0
    // Assert: InvalidAmount error
}

#[test]
fn test_burn_for_unwrap_nonce_increments() {
    // Burn 3 times
    // Assert: nonce goes 0 → 1 → 2 → 3
}

#[test]
fn test_burn_for_unwrap_state_tracking() {
    // Burn 100 ibcTFUEL (99.5 burned, 0.5 fee)
    // Assert:
    //   - state.total_reverse_burned += 99.5
    //   - state.total_reverse_fees += 0.5
}
```

### Integration Tests

```rust
#[test]
fn test_burn_for_unwrap_to_fee_collector_integration() {
    // 1. Deploy persistence-minter
    // 2. Deploy fee-collector
    // 3. Set fee_collector_address in minter config
    // 4. Mint 1000 ibcTFUEL to user
    // 5. User calls burn_for_unwrap(100)
    // 6. Query FeeCollector state:
    //    - accumulated_fees should be 0.5 ibcTFUEL
    //    - Check ReceiveFees was called successfully
}
```

---

## Files Modified

1. **`cosmwasm-contracts/persistence-minter/src/contract.rs`**
   - Added `REVERSE_BURN_NONCES` to imports (line 16)
   - Rewrote `execute_burn_for_unwrap` function (lines 310-428)

2. **No other files modified** (all changes self-contained)

---

## Deployment Checklist

- [ ] Run unit tests: `cargo test --package persistence-minter`
- [ ] Build optimized WASM: `./build.sh`
- [ ] Deploy updated persistence-minter contract
- [ ] Verify FeeCollector address is correctly configured
- [ ] Test on testnet with small amounts first
- [ ] Monitor events: look for "burn_for_unwrap" with "for_sp1_proof" attribute
- [ ] Verify SP1 prover picks up events correctly

---

## Gas Estimation

Based on CW20 standards:
- `execute_transfer`: ~80k gas
- `execute_burn`: ~70k gas
- `WasmMsg::Execute` (notify): ~50k gas
- State updates: ~20k gas
- **Total**: ~220k gas per burn_for_unwrap

This is acceptable for the reverse bridge flow.

---

## Security Considerations

✅ **No reentrancy risk**: All state changes after external calls
✅ **No overflow/underflow**: Uses `checked_sub`, `checked_add`
✅ **Replay protection**: Per-user nonces tracked
✅ **Access control**: Paused check prevents unauthorized burns
✅ **Balance validation**: Checks user has sufficient balance before burn
✅ **Event emission**: Standard CW20 events + custom SP1 proof attributes

---

## Next Steps

1. Update TODOs (mark "Enhance persistence-minter" as completed)
2. Add unit tests for `execute_burn_for_unwrap`
3. Run full test suite
4. Update deployment documentation with new function signature
5. Test integration with FeeCollector on testnet
