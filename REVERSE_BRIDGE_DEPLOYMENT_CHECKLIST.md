# Reverse Bridge Deployment Checklist

**Target Networks**: Persistence Mainnet (core-1) + Theta Mainnet  
**Version**: 4.0 (Bidirectional)

---

## Pre-Deployment Checklist

### 1. Code Review & Audit ⏳
- [ ] Internal security review completed
- [ ] External audit scheduled (OpenZeppelin/CertiK/Trail of Bits)
- [ ] Audit findings addressed
- [ ] Final code freeze and tag release

### 2. Testing Completion ⏳
- [ ] All unit tests passing (cosmwasm-contracts/fee-collector)
- [ ] All integration tests passing (test/ReverseBridge.Integration.test.cjs)
- [ ] SP1 circuit tests passing
- [ ] Load testing completed (100+ concurrent burns)
- [ ] Gas benchmarks verified

### 3. Infrastructure Setup ⏳
- [ ] Persistence mainnet RPC endpoint configured
- [ ] Theta mainnet RPC endpoint configured
- [ ] SP1 prover nodes deployed on Theta EdgeCloud (GPU)
- [ ] Monitoring infrastructure setup (Prometheus/Grafana)
- [ ] Alert system configured (PagerDuty/Slack)
- [ ] Block explorer integration (Mintscan/ThetaScan)

---

## Deployment Steps

### Phase 1: Persistence Chain (CosmWasm)

#### Step 1.1: Deploy FeeCollector
```bash
cd cosmwasm-contracts/fee-collector

# Build optimized wasm
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.12.13

# Upload to mainnet
persistenceCore tx wasm store artifacts/fee_collector.wasm \
  --from deployer \
  --gas 3000000 \
  --gas-adjustment 1.3 \
  --chain-id core-1 \
  --node https://rpc.core-1.persistence.one:443

# Record code ID
export FEE_COLLECTOR_CODE_ID=<code_id>
```

- [ ] FeeCollector wasm uploaded
- [ ] Code ID recorded: `___________`

#### Step 1.2: Instantiate FeeCollector
```bash
persistenceCore tx wasm instantiate $FEE_COLLECTOR_CODE_ID \
  '{
    "admin": "persistence1...",
    "ibctfuel_token": "persistence1...",
    "minter_contract": "persistence1...",
    "min_burn_amount": "100000000000000000000"
  }' \
  --label "XFuel FeeCollector v1.0" \
  --from deployer \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id core-1 \
  --admin persistence1... \
  --node https://rpc.core-1.persistence.one:443

# Record contract address
export FEE_COLLECTOR_ADDR=<contract_address>
```

- [ ] FeeCollector instantiated
- [ ] Contract address recorded: `___________`
- [ ] Admin address verified: `___________`

#### Step 1.3: Update persistence-minter
```bash
# Set FeeCollector address in minter
persistenceCore tx wasm execute $MINTER_CONTRACT_ADDR \
  '{"set_fee_collector":{"fee_collector_address":"'$FEE_COLLECTOR_ADDR'"}}' \
  --from admin \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id core-1

# Verify configuration
persistenceCore query wasm contract-state smart $MINTER_CONTRACT_ADDR \
  '{"config":{}}' \
  --node https://rpc.core-1.persistence.one:443
```

- [ ] FeeCollector address updated in minter
- [ ] Configuration verified

---

### Phase 2: Theta Chain (Solidity)

#### Step 2.1: Verify VaultFactory Deployment
```bash
# Check VaultFactory address
export VAULT_FACTORY_ADDR=<deployed_address>

# Verify contract
npx hardhat verify --network theta_mainnet $VAULT_FACTORY_ADDR \
  "<admin_address>" "<rev_splitter_address>"
```

- [ ] VaultFactory verified on ThetaScan
- [ ] Factory address: `___________`
- [ ] RevenueSplitter address: `___________`

#### Step 2.2: Grant ZK Bridge Role
```bash
# Grant ZK_BRIDGE_ROLE to prover operator
npx hardhat run --network theta_mainnet scripts/grantZkBridgeRole.cjs

# Verify role granted
await vaultFactory.hasRole(
  await vaultFactory.ZK_BRIDGE_ROLE(),
  "<operator_address>"
);
```

- [ ] ZK_BRIDGE_ROLE granted
- [ ] Operator address: `___________`

#### Step 2.3: Seed Initial Vaults
```bash
# Create and seed first 5 vaults with 1000 TFUEL each
npx hardhat run --network theta_mainnet scripts/seedInitialVaults.cjs

# Verify seeding
await vaultFactory.totalSeeded(); // Should be 5000 TFUEL
```

- [ ] Vaults created and seeded
- [ ] Total seeded: `___________` TFUEL
- [ ] Vault addresses recorded in deployment.json

#### Step 2.4: Configure Minimum Reserve
```bash
# Set minimum reserve ratio to 10% (1000 basis points)
await vaultFactory.setMinReserveRatio(1000);

# Verify
const ratio = await vaultFactory.minReserveRatio();
console.log("Min reserve ratio:", ratio.toString(), "bps");
```

- [ ] Minimum reserve ratio set: `10%`

---

### Phase 3: SP1 Prover

#### Step 3.1: Build and Deploy Circuit
```bash
cd sp1-prover

# Build release binary
cargo build --release

# Test proof generation
cargo run --release -- test-reverse-burn

# Deploy to EdgeCloud
./deploy-to-theta.ps1
```

- [ ] SP1 binary built
- [ ] Test proof generated successfully
- [ ] Deployed to EdgeCloud node
- [ ] Node IP recorded: `___________`

#### Step 3.2: Configure Prover
```bash
# Update prover config
{
  "persistence_rpc": "https://rpc.core-1.persistence.one:443",
  "theta_rpc": "https://eth-rpc-api.thetatoken.org/rpc",
  "minter_contract": "$MINTER_CONTRACT_ADDR",
  "fee_collector_contract": "$FEE_COLLECTOR_ADDR",
  "vault_factory_address": "$VAULT_FACTORY_ADDR",
  "operator_private_key": "<encrypted>",
  "proof_batch_size": 10,
  "poll_interval_seconds": 30
}
```

- [ ] Prover config updated
- [ ] Monitoring both chains for events
- [ ] Test proof submission to Theta

---

### Phase 4: Monitoring & Alerts

#### Step 4.1: Setup Monitoring
```bash
# Deploy monitoring stack
docker-compose -f monitoring/docker-compose.yml up -d

# Configure dashboards
- Persistence burn events
- SP1 proof generation time
- Theta unwrap transactions
- Vault balances
- Fee accumulation
```

- [ ] Prometheus configured
- [ ] Grafana dashboards imported
- [ ] Metrics endpoints verified

#### Step 4.2: Configure Alerts
```yaml
# Alert thresholds
- Vault balance < 15% of seeded (WARNING)
- Vault balance < 10% of seeded (CRITICAL)
- FeeCollector accumulated > 100 TFUEL (INFO)
- SP1 proof failure rate > 1% (WARNING)
- Unwrap tx revert rate > 0.1% (CRITICAL)
- Prover queue depth > 50 (WARNING)
```

- [ ] Alert rules configured
- [ ] Test alerts sent successfully
- [ ] On-call rotation setup

---

## Post-Deployment Verification

### Functional Tests

#### Test 1: User-Initiated Reverse Burn
```bash
# Execute test burn from test account
persistenceCore tx wasm execute $MINTER_CONTRACT_ADDR \
  '{
    "burn_for_unwrap": {
      "amount": "1000000000000000000",
      "theta_recipient": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
    }
  }' \
  --from test_user \
  --gas auto

# Wait for SP1 proof (~2-3 minutes)
# Verify unwrap on Theta
# Check user received 0.995 TFUEL
```

- [ ] Test burn executed
- [ ] SP1 proof generated
- [ ] Unwrap completed on Theta
- [ ] User received correct amount

#### Test 2: Fee Accumulation and Burn
```bash
# Perform 5 test burns to accumulate fees
# Check FeeCollector accumulated fees
persistenceCore query wasm contract-state smart $FEE_COLLECTOR_ADDR \
  '{"state":{}}'

# Trigger fee burn
persistenceCore tx wasm execute $FEE_COLLECTOR_ADDR \
  '{"trigger_fee_burn":{}}' \
  --from admin --gas auto

# Verify fees burned and SP1 event emitted
```

- [ ] Fees accumulated correctly (5 * 0.5% = 0.025 TFUEL)
- [ ] Fee burn triggered
- [ ] SP1 proof generated for fee burn
- [ ] Fee TFUEL released to RevenueSplitter

#### Test 3: Vault Liquidity Management
```bash
# Check vault balance
await vaultFactory.getVaultBalance(vaultAddress);

# Test canUnwrap check
await vaultFactory.canUnwrap(vaultAddress, ethers.parseEther("100"));

# Test vault rebalancing
await vaultFactory.rebalanceVaults(vault1, vault2, ethers.parseEther("50"));
```

- [ ] Balance query works
- [ ] canUnwrap returns correct result
- [ ] Rebalancing works

---

## Beta Testing Phase

### Week 1: Limited Beta
- [ ] Whitelist 10 test addresses
- [ ] Max 10 TFUEL per burn
- [ ] Monitor all transactions
- [ ] Collect user feedback

### Week 2: Expanded Beta
- [ ] Whitelist 50 addresses
- [ ] Max 100 TFUEL per burn
- [ ] Load testing with multiple concurrent burns
- [ ] Performance optimization if needed

### Week 3: Public Beta
- [ ] Remove whitelist
- [ ] Max 1000 TFUEL per burn
- [ ] Monitor for any issues
- [ ] Prepare for full launch

### Week 4: Full Production
- [ ] Remove all limits
- [ ] Announce on social media
- [ ] Update documentation
- [ ] Monitor closely for first 72 hours

---

## Rollback Plan

### Emergency Pause Procedure
```bash
# Pause FeeCollector
persistenceCore tx wasm execute $FEE_COLLECTOR_ADDR \
  '{"pause":{}}' --from admin

# Pause VaultFactory (if needed)
await vaultFactory.pause(); // Via ZK_BRIDGE_ROLE
```

### Critical Issue Rollback
1. Pause all contracts
2. Investigate root cause
3. Fix issue in code
4. Redeploy fixed contracts
5. Migrate state if necessary
6. Resume operations

---

## Sign-Off

### Technical Team
- [ ] Smart Contract Developer: `___________` Date: `___________`
- [ ] Backend Engineer: `___________` Date: `___________`
- [ ] DevOps Engineer: `___________` Date: `___________`
- [ ] QA Engineer: `___________` Date: `___________`

### Leadership
- [ ] CTO: `___________` Date: `___________`
- [ ] Security Lead: `___________` Date: `___________`
- [ ] Product Manager: `___________` Date: `___________`

---

## Post-Launch

### 24 Hours Post-Launch
- [ ] All systems operational
- [ ] No critical issues reported
- [ ] Transaction success rate > 99%
- [ ] Average proof time < 3 minutes

### 7 Days Post-Launch
- [ ] Total reverse burns: `___________`
- [ ] Total TFUEL released: `___________`
- [ ] Average user rating: `___________`
- [ ] Post-launch retrospective completed

---

**Deployment Lead**: `___________`  
**Deployment Date**: `___________`  
**Version**: 4.0 (Bidirectional)

---
