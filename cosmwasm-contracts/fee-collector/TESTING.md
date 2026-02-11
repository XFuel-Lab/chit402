# Fee Collector CosmWasm Contract - Unit Tests

## Test Coverage for fee-collector contract

### Instantiation Tests
- ✅ Proper initialization with valid parameters
- ✅ Admin, token, and minter addresses correctly set
- ✅ Initial state (accumulated_fees = 0, total_burned = 0)
- ✅ Reject instantiation with zero addresses

### Fee Reception Tests
- ✅ Accept fees from minter contract
- ✅ Update accumulated_fees correctly
- ✅ Emit FeesAccumulated event
- ✅ Reject fees from non-minter addresses
- ✅ Reject zero amount fees

### Fee Burn Tests
- ✅ Trigger fee burn when above minimum threshold
- ✅ Burn all accumulated fees via CW20 burn message
- ✅ Emit FeeBurn event with correct attributes (for_sp1_proof: true)
- ✅ Reset accumulated_fees to zero after burn
- ✅ Update total_burned and burn_count correctly
- ✅ Reject burn below minimum threshold
- ✅ Only admin can trigger burns

### Admin Functions Tests
- ✅ Set new admin address (admin only)
- ✅ Set new minter contract (admin only)
- ✅ Set new minimum burn amount (admin only)
- ✅ Pause contract (admin only)
- ✅ Unpause contract (admin only)
- ✅ Emergency withdraw (admin only)
- ✅ Reject unauthorized admin operations

### Query Tests
- ✅ Query config returns correct values
- ✅ Query state returns correct accumulated fees and totals
- ✅ Query ReadyToBurn returns correct status

### Security Tests
- ✅ Reentrancy protection on receive_fees
- ✅ Reentrancy protection on trigger_fee_burn
- ✅ Paused state blocks fee operations
- ✅ Access control enforced on all admin functions

### Integration Tests
- ✅ Full flow: receive fees → accumulate → trigger burn → verify SP1 event
- ✅ Multiple fee accumulations before single burn
- ✅ Sequential burns over time

## Running Tests

```bash
cd cosmwasm-contracts/fee-collector
cargo test

# With output
cargo test -- --nocapture

# Specific test
cargo test test_proper_initialization
```

## Test Commands

```bash
# Build
cargo wasm

# Optimize
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.12.13

# Schema generation
cargo schema
```

## Expected Test Coverage

- **Unit Tests**: 95%+ coverage
- **Integration Tests**: Full reverse bridge flow
- **Security Tests**: All attack vectors covered

## Critical Test Scenarios

1. **Replay Protection**: Ensure fees from same burn cannot be processed twice
2. **Minimum Threshold**: Verify burns only trigger above min_burn_amount
3. **SP1 Event**: Confirm FeeBurn event has correct attributes for proof generation
4. **Access Control**: Validate only authorized addresses can trigger burns
5. **Pause Mechanism**: Ensure all operations halt when paused

## Gas Benchmarks

| Operation | Expected Gas | Actual Gas | Status |
|-----------|-------------|------------|---------|
| receive_fees | ~100k | TBD | ⏳ |
| trigger_fee_burn | ~150k | TBD | ⏳ |
| query_state | ~10k | TBD | ⏳ |

## Notes

- Fee accumulation should be atomic with no partial states
- Burns should be idempotent (safe to retry if tx fails)
- All events must be parseable by SP1 prover
- CW20 burn message must be correctly formatted
