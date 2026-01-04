# XFuel Persistence Minter Integration Guide

## Overview
This guide covers integration of the Persistence Minter contract with the XFuel hybrid protocol.

## Architecture Flow

```
┌─────────────┐     ZK Proof      ┌──────────────────┐
│   Frontend  │ ─────────────────> │   Persistence    │
│  (Keplr)    │                    │     Minter       │
└─────────────┘                    └──────────────────┘
       │                                   │
       │ 1. Generate ZK Proof              │ 2. Verify & Mint
       │                                   │    ibcTFUEL
       │                                   │
       │                           ┌───────▼────────┐
       │                           │   User Wallet  │
       │                           │  (Pre-funded   │
       │                           │   with XPRT)   │
       │                           └────────────────┘
       │
       │ 3. Burn ibcTFUEL
       │
       ▼
┌──────────────────┐
│   Burn & Unwrap  │
└──────────────────┘
       │
       ├─────> 30% ──> RevSplitter
       │
       └─────> 70% ──> LP Reinvest Flag
```

## Frontend Integration

### 1. Setup Keplr Connection

```typescript
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";

const PERSISTENCE_RPC = "https://rpc.core.persistence.one";
const CHAIN_ID = "core-1";
const CONTRACT_ADDRESS = "persistence1..."; // Your deployed contract

async function connectKeplr() {
  if (!window.keplr) {
    throw new Error("Please install Keplr extension");
  }

  await window.keplr.enable(CHAIN_ID);
  const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  
  const client = await SigningCosmWasmClient.connectWithSigner(
    PERSISTENCE_RPC,
    offlineSigner,
    { gasPrice: { denom: "uxprt", amount: "0.025" } }
  );
  
  return { client, address: accounts[0].address };
}
```

### 2. Generate ZK Proof (Mock Implementation)

```typescript
interface ZkProof {
  proof_data: string;
  public_inputs: string[];
  verification_key: string;
}

async function generateZkProof(
  amount: string,
  recipient: string
): Promise<ZkProof> {
  // In production, this would call your ZK proof generator
  // For now, mock implementation
  
  return {
    proof_data: "generated_proof_data_" + Date.now(),
    public_inputs: [
      amount,
      hashAddress(recipient)
    ],
    verification_key: "vk_xfuel_v1"
  };
}

function hashAddress(address: string): string {
  // Simple hash for demonstration
  return Array.from(address)
    .reduce((hash, char) => {
      return ((hash << 5) - hash) + char.charCodeAt(0);
    }, 0)
    .toString(16);
}
```

### 3. Mint ibcTFUEL

```typescript
async function mintIbcTFuel(
  client: SigningCosmWasmClient,
  senderAddress: string,
  amount: string
) {
  const proof = await generateZkProof(amount, senderAddress);
  
  const msg = {
    verify_and_mint: {
      zk_proof: proof,
      amount: amount,
      recipient: senderAddress
    }
  };
  
  const result = await client.execute(
    senderAddress,
    CONTRACT_ADDRESS,
    msg,
    "auto",
    "Minting ibcTFUEL"
  );
  
  console.log("Minted successfully:", result.transactionHash);
  return result;
}
```

### 4. Burn and Unwrap

```typescript
async function burnAndUnwrap(
  client: SigningCosmWasmClient,
  senderAddress: string,
  amount: string
) {
  const msg = {
    burn_and_unwrap: {
      amount: amount
    }
  };
  
  const result = await client.execute(
    senderAddress,
    CONTRACT_ADDRESS,
    msg,
    "auto",
    "Burning ibcTFUEL"
  );
  
  // Extract burn event details
  const burnEvent = result.logs[0].events.find(
    e => e.type === "wasm" && 
    e.attributes.find(a => a.key === "action" && a.value === "burn_and_unwrap")
  );
  
  const recycledAmount = burnEvent?.attributes.find(
    a => a.key === "recycled_amount"
  )?.value;
  
  const lpReinvestAmount = burnEvent?.attributes.find(
    a => a.key === "lp_reinvest_amount"
  )?.value;
  
  console.log("Burned:", amount);
  console.log("Recycled to RevSplitter:", recycledAmount);
  console.log("Flagged for LP Reinvest:", lpReinvestAmount);
  
  return result;
}
```

### 5. Query Balance

```typescript
async function getBalance(
  client: SigningCosmWasmClient,
  address: string
): Promise<string> {
  const query = {
    balance: { address }
  };
  
  const result = await client.queryContractSmart(CONTRACT_ADDRESS, query);
  return result.balance;
}
```

### 6. React Component Example

```typescript
import { useState, useEffect } from 'react';

export function PersistenceMinter() {
  const [client, setClient] = useState<SigningCosmWasmClient | null>(null);
  const [address, setAddress] = useState<string>("");
  const [balance, setBalance] = useState<string>("0");
  const [mintAmount, setMintAmount] = useState<string>("");
  const [burnAmount, setBurnAmount] = useState<string>("");

  useEffect(() => {
    connectKeplr().then(({ client, address }) => {
      setClient(client);
      setAddress(address);
      refreshBalance(client, address);
    });
  }, []);

  async function refreshBalance(c: SigningCosmWasmClient, addr: string) {
    const bal = await getBalance(c, addr);
    setBalance(bal);
  }

  async function handleMint() {
    if (!client || !address) return;
    
    try {
      await mintIbcTFuel(client, address, mintAmount);
      await refreshBalance(client, address);
      setMintAmount("");
    } catch (err) {
      console.error("Mint failed:", err);
    }
  }

  async function handleBurn() {
    if (!client || !address) return;
    
    try {
      await burnAndUnwrap(client, address, burnAmount);
      await refreshBalance(client, address);
      setBurnAmount("");
    } catch (err) {
      console.error("Burn failed:", err);
    }
  }

  return (
    <div className="persistence-minter">
      <h2>ibcTFUEL Minter</h2>
      
      <div className="wallet-info">
        <p>Address: {address}</p>
        <p>Balance: {balance} IBCTFUEL</p>
      </div>
      
      <div className="mint-section">
        <h3>Mint ibcTFUEL</h3>
        <input
          type="text"
          placeholder="Amount (in wei)"
          value={mintAmount}
          onChange={e => setMintAmount(e.target.value)}
        />
        <button onClick={handleMint}>Mint</button>
      </div>
      
      <div className="burn-section">
        <h3>Burn & Unwrap</h3>
        <input
          type="text"
          placeholder="Amount (in wei)"
          value={burnAmount}
          onChange={e => setBurnAmount(e.target.value)}
        />
        <button onClick={handleBurn}>Burn</button>
        <p className="info">30% recycled, 70% for LP reinvest</p>
      </div>
    </div>
  );
}
```

## Backend Integration

### 1. Monitor Burn Events

```typescript
import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

const client = await CosmWasmClient.connect(PERSISTENCE_RPC);

async function monitorBurnEvents() {
  // Query recent transactions
  const txs = await client.searchTx([
    { key: "wasm._contract_address", value: CONTRACT_ADDRESS },
    { key: "wasm.action", value: "burn_and_unwrap" }
  ]);
  
  for (const tx of txs) {
    const logs = tx.logs[0].events;
    const wasmEvent = logs.find(e => e.type === "wasm");
    
    if (wasmEvent) {
      const burner = wasmEvent.attributes.find(a => a.key === "burner")?.value;
      const amount = wasmEvent.attributes.find(a => a.key === "amount")?.value;
      const recycled = wasmEvent.attributes.find(a => a.key === "recycled_amount")?.value;
      const lpReinvest = wasmEvent.attributes.find(a => a.key === "lp_reinvest_amount")?.value;
      
      // Process unwrap
      await processUnwrap({
        burner,
        amount,
        recycled,
        lpReinvest,
        txHash: tx.hash
      });
    }
  }
}

async function processUnwrap(data: {
  burner: string;
  amount: string;
  recycled: string;
  lpReinvest: string;
  txHash: string;
}) {
  console.log("Processing unwrap:", data);
  
  // 1. Send recycled amount to RevSplitter
  await sendToRevSplitter(data.recycled);
  
  // 2. Flag LP reinvest amount
  await flagForLpReinvest(data.lpReinvest, data.burner);
  
  // 3. Update database
  await updateUnwrapRecord(data);
}
```

### 2. LST Staking Integration

```typescript
async function delegateAfterMint(
  client: SigningCosmWasmClient,
  adminAddress: string,
  validator: string,
  amount: string
) {
  const msg = {
    delegate_to_validator: {
      validator: validator,
      amount: amount
    }
  };
  
  const result = await client.execute(
    adminAddress,
    CONTRACT_ADDRESS,
    msg,
    "auto",
    "Delegating to validator"
  );
  
  console.log("Delegated to validator:", validator);
  return result;
}
```

## Testing Integration

### 1. Local Testing with cw-multi-test

```bash
cd cosmwasm-contracts/persistence-minter
cargo test -- --nocapture
```

### 2. Testnet Deployment

```bash
# Store code
persistenceCore tx wasm store artifacts/persistence_minter.wasm \
  --from testnet-wallet \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-1 \
  --node https://rpc.testnet.persistence.one:443

# Instantiate
persistenceCore tx wasm instantiate <CODE_ID> \
  '{
    "name": "IBC Theta Fuel",
    "symbol": "IBCTFUEL",
    "decimals": 18,
    "initial_balances": [],
    "mint_cap": "1000000000000000000000000",
    "marketing": null,
    "verifier_address": "persistence1testverifier...",
    "rev_splitter_address": "persistence1testrevsplitter..."
  }' \
  --from testnet-wallet \
  --label "XFuel Minter Testnet" \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --admin <ADMIN_ADDRESS> \
  --chain-id test-core-1 \
  --node https://rpc.testnet.persistence.one:443
```

### 3. E2E Testing Script

```typescript
async function e2eTest() {
  console.log("🧪 Starting E2E Test...");
  
  // 1. Connect wallet
  const { client, address } = await connectKeplr();
  console.log("✅ Connected wallet:", address);
  
  // 2. Mint tokens
  const mintAmount = "1000000000000000000"; // 1 token
  await mintIbcTFuel(client, address, mintAmount);
  console.log("✅ Minted:", mintAmount);
  
  // 3. Check balance
  let balance = await getBalance(client, address);
  console.log("✅ Balance after mint:", balance);
  
  // 4. Transfer to another address
  const recipient = "persistence1test...";
  const transferAmount = "500000000000000000"; // 0.5 token
  await client.execute(
    address,
    CONTRACT_ADDRESS,
    {
      transfer: {
        recipient: recipient,
        amount: transferAmount
      }
    },
    "auto"
  );
  console.log("✅ Transferred:", transferAmount);
  
  // 5. Burn and unwrap
  const burnAmount = "250000000000000000"; // 0.25 token
  await burnAndUnwrap(client, address, burnAmount);
  console.log("✅ Burned:", burnAmount);
  
  // 6. Final balance check
  balance = await getBalance(client, address);
  console.log("✅ Final balance:", balance);
  
  console.log("🎉 E2E Test Complete!");
}
```

## Environment Configuration

```typescript
// config/persistence.ts
export const PERSISTENCE_CONFIG = {
  mainnet: {
    rpc: "https://rpc.core.persistence.one",
    chainId: "core-1",
    contractAddress: "persistence1...", // Deploy and update
    gasPrice: "0.025uxprt"
  },
  testnet: {
    rpc: "https://rpc.testnet.persistence.one",
    chainId: "test-core-1",
    contractAddress: "persistence1...", // Testnet contract
    gasPrice: "0.025uxprt"
  }
};
```

## Security Considerations

1. **ZK Proof Generation**: Implement real ZK proof system (not mock)
2. **Rate Limiting**: Add rate limits on minting to prevent abuse
3. **Admin Key Management**: Use multisig for admin operations
4. **Audit**: Get contract audited before mainnet deployment
5. **Monitoring**: Set up alerts for unusual activity

## Support

For questions or issues:
- GitHub: https://github.com/xfuellab
- Email: dev@xfuel.io
- Discord: [XFuel Community]



