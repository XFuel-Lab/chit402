# XFuel Persistence Minter - Integration Examples

Complete integration examples for backend, frontend, and testing workflows.

## Table of Contents

1. [Backend Integration (Node.js/TypeScript)](#backend-integration)
2. [Frontend Integration (React + Keplr)](#frontend-integration)
3. [Testing Scripts](#testing-scripts)
4. [Monitoring & Analytics](#monitoring)
5. [Error Handling](#error-handling)

---

## Backend Integration

### Setup

```bash
npm install @cosmjs/cosmwasm-stargate @cosmjs/proto-signing @cosmjs/stargate
```

### Complete Backend Module

```typescript
// src/persistence/minter.ts

import {
  SigningCosmWasmClient,
  CosmWasmClient,
} from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice, StargateClient } from "@cosmjs/stargate";

// Configuration
const RPC_ENDPOINT = process.env.PERSISTENCE_RPC || "https://rpc.core.persistence.one:443";
const CONTRACT_ADDRESS = process.env.MINTER_CONTRACT_ADDRESS!;
const BACKEND_MNEMONIC = process.env.BACKEND_MNEMONIC!;

export interface ZkProof {
  proof_data: string;
  public_inputs: string[];
  verification_key: string;
}

export class PersistenceMinter {
  private client: SigningCosmWasmClient | null = null;
  private queryClient: CosmWasmClient | null = null;
  private signerAddress: string = "";

  async connect(): Promise<void> {
    // Setup wallet
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
      BACKEND_MNEMONIC,
      { prefix: "persistence" }
    );

    // Get signer address
    const [account] = await wallet.getAccounts();
    this.signerAddress = account.address;

    // Connect signing client
    this.client = await SigningCosmWasmClient.connectWithSigner(
      RPC_ENDPOINT,
      wallet,
      {
        gasPrice: GasPrice.fromString("0.025uxprt"),
      }
    );

    // Connect query-only client
    this.queryClient = await CosmWasmClient.connect(RPC_ENDPOINT);

    console.log(`Connected to Persistence as ${this.signerAddress}`);
  }

  /**
   * Mint ibcTFUEL tokens after ZK proof verification
   */
  async verifyAndMint(
    zkProof: ZkProof,
    amount: string,
    recipient: string
  ): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const msg = {
      verify_and_mint: {
        zk_proof: zkProof,
        amount,
        recipient,
      },
    };

    const result = await this.client.execute(
      this.signerAddress,
      CONTRACT_ADDRESS,
      msg,
      "auto",
      "XFuel: Mint ibcTFUEL"
    );

    console.log(`Minted ${amount} ibcTFUEL to ${recipient}`);
    console.log(`TX: ${result.transactionHash}`);

    return result.transactionHash;
  }

  /**
   * Query token balance
   */
  async getBalance(address: string): Promise<string> {
    if (!this.queryClient) throw new Error("Query client not connected");

    const result: { balance: string } = await this.queryClient.queryContractSmart(
      CONTRACT_ADDRESS,
      { balance: { address } }
    );

    return result.balance;
  }

  /**
   * Query token info
   */
  async getTokenInfo(): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    total_supply: string;
  }> {
    if (!this.queryClient) throw new Error("Query client not connected");

    return await this.queryClient.queryContractSmart(CONTRACT_ADDRESS, {
      token_info: {},
    });
  }

  /**
   * Query contract config
   */
  async getConfig(): Promise<{
    admin: string;
    verifier_address: string;
    rev_splitter_address: string;
    paused: boolean;
  }> {
    if (!this.queryClient) throw new Error("Query client not connected");

    return await this.queryClient.queryContractSmart(CONTRACT_ADDRESS, {
      config: {},
    });
  }

  /**
   * Query contract state (statistics)
   */
  async getState(): Promise<{
    total_minted: string;
    total_burned: string;
    total_recycled: string;
    total_lp_reinvest: string;
  }> {
    if (!this.queryClient) throw new Error("Query client not connected");

    return await this.queryClient.queryContractSmart(CONTRACT_ADDRESS, {
      state: {},
    });
  }

  /**
   * Admin: Pause contract
   */
  async pause(): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const result = await this.client.execute(
      this.signerAddress,
      CONTRACT_ADDRESS,
      { pause: {} },
      "auto",
      "XFuel: Pause minter"
    );

    return result.transactionHash;
  }

  /**
   * Admin: Unpause contract
   */
  async unpause(): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const result = await this.client.execute(
      this.signerAddress,
      CONTRACT_ADDRESS,
      { unpause: {} },
      "auto",
      "XFuel: Unpause minter"
    );

    return result.transactionHash;
  }

  /**
   * Admin: Set verifier address
   */
  async setVerifier(verifierAddress: string): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const result = await this.client.execute(
      this.signerAddress,
      CONTRACT_ADDRESS,
      { set_verifier: { verifier_address: verifierAddress } },
      "auto",
      "XFuel: Update verifier"
    );

    return result.transactionHash;
  }

  /**
   * Admin: Delegate to validator for LST staking
   */
  async delegateToValidator(
    validator: string,
    amount: string
  ): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const result = await this.client.execute(
      this.signerAddress,
      CONTRACT_ADDRESS,
      { delegate_to_validator: { validator, amount } },
      "auto",
      "XFuel: Delegate to validator"
    );

    return result.transactionHash;
  }
}

// Usage Example
export async function mintExample() {
  const minter = new PersistenceMinter();
  await minter.connect();

  // Example ZK proof (from ZK proof generator)
  const zkProof: ZkProof = {
    proof_data: "0x1234abcd...",
    public_inputs: [
      "1000000000000000000", // 1 TFUEL (18 decimals)
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    verification_key: "vk_xfuel_v1",
  };

  const txHash = await minter.verifyAndMint(
    zkProof,
    "1000000000000000000",
    "persistence1user..."
  );

  console.log(`Mint transaction: ${txHash}`);

  // Check balance
  const balance = await minter.getBalance("persistence1user...");
  console.log(`New balance: ${balance}`);
}
```

### Event Listener for Backend

```typescript
// src/persistence/event-listener.ts

import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { StargateClient } from "@cosmjs/stargate";

const RPC_ENDPOINT = "https://rpc.core.persistence.one:443";
const CONTRACT_ADDRESS = process.env.MINTER_CONTRACT_ADDRESS!;

export async function listenForBurnEvents() {
  const client = await StargateClient.connect(RPC_ENDPOINT);

  console.log("Listening for burn events...");

  // Poll for new blocks
  setInterval(async () => {
    try {
      const height = await client.getHeight();
      const block = await client.getBlock(height);

      for (const tx of block.txs) {
        const txResult = await client.searchTx({ hash: tx });

        if (!txResult || txResult.length === 0) continue;

        // Look for burn_and_unwrap events
        for (const result of txResult) {
          const events = result.events;

          for (const event of events) {
            if (
              event.type === "wasm" &&
              event.attributes.some(
                (attr) => attr.key === "action" && attr.value === "burn_and_unwrap"
              )
            ) {
              // Extract burn details
              const burner = event.attributes.find(
                (a) => a.key === "burner"
              )?.value;
              const amount = event.attributes.find(
                (a) => a.key === "amount"
              )?.value;
              const recycled = event.attributes.find(
                (a) => a.key === "recycled_amount"
              )?.value;
              const lpReinvest = event.attributes.find(
                (a) => a.key === "lp_reinvest_amount"
              )?.value;

              console.log("Burn event detected:", {
                burner,
                amount,
                recycled,
                lpReinvest,
                txHash: result.hash,
              });

              // Process unwrap:
              // 1. Send 30% to RevSplitter
              await sendToRevSplitter(recycled!);

              // 2. Flag 70% for LP reinvestment
              await flagForLpReinvest(lpReinvest!);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error polling events:", error);
    }
  }, 6000); // Poll every 6 seconds (Persistence block time)
}

async function sendToRevSplitter(amount: string) {
  console.log(`Sending ${amount} to RevSplitter...`);
  // Implementation: Transfer tokens to RevSplitter contract
}

async function flagForLpReinvest(amount: string) {
  console.log(`Flagging ${amount} for LP reinvestment...`);
  // Implementation: Queue for LP reinvestment
}
```

---

## Frontend Integration

### React + Keplr Wallet

```typescript
// src/hooks/usePersistenceMinter.ts

import { useState, useCallback } from "react";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { Window as KeplrWindow } from "@keplr-wallet/types";

declare global {
  interface Window extends KeplrWindow {}
}

const CONTRACT_ADDRESS = import.meta.env.VITE_MINTER_CONTRACT_ADDRESS;
const CHAIN_ID = "core-1"; // Persistence Mainnet

export function usePersistenceMinter() {
  const [address, setAddress] = useState<string>("");
  const [balance, setBalance] = useState<string>("0");
  const [isConnected, setIsConnected] = useState(false);
  const [client, setClient] = useState<SigningCosmWasmClient | null>(null);

  // Connect Keplr wallet
  const connect = useCallback(async () => {
    if (!window.keplr) {
      alert("Please install Keplr extension");
      window.open("https://www.keplr.app/", "_blank");
      return;
    }

    try {
      // Enable Persistence chain
      await window.keplr.enable(CHAIN_ID);

      // Get offline signer
      const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
      const accounts = await offlineSigner.getAccounts();

      // Connect client
      const signingClient = await SigningCosmWasmClient.connectWithSigner(
        "https://rpc.core.persistence.one:443",
        offlineSigner
      );

      setAddress(accounts[0].address);
      setClient(signingClient);
      setIsConnected(true);

      // Fetch initial balance
      await fetchBalance(signingClient, accounts[0].address);
    } catch (error) {
      console.error("Error connecting Keplr:", error);
      alert("Failed to connect Keplr");
    }
  }, []);

  // Fetch balance
  const fetchBalance = useCallback(
    async (signingClient?: SigningCosmWasmClient, addr?: string) => {
      const c = signingClient || client;
      const a = addr || address;

      if (!c || !a) return;

      try {
        const result: { balance: string } = await c.queryContractSmart(
          CONTRACT_ADDRESS,
          { balance: { address: a } }
        );

        setBalance(result.balance);
      } catch (error) {
        console.error("Error fetching balance:", error);
      }
    },
    [client, address]
  );

  // Burn and unwrap tokens
  const burnAndUnwrap = useCallback(
    async (amount: string) => {
      if (!client || !address) {
        throw new Error("Not connected");
      }

      try {
        const result = await client.execute(
          address,
          CONTRACT_ADDRESS,
          { burn_and_unwrap: { amount } },
          "auto",
          "Burn ibcTFUEL"
        );

        console.log("Burn TX:", result.transactionHash);

        // Refresh balance
        await fetchBalance();

        return result.transactionHash;
      } catch (error) {
        console.error("Error burning tokens:", error);
        throw error;
      }
    },
    [client, address, fetchBalance]
  );

  // Transfer tokens
  const transfer = useCallback(
    async (recipient: string, amount: string) => {
      if (!client || !address) {
        throw new Error("Not connected");
      }

      try {
        const result = await client.execute(
          address,
          CONTRACT_ADDRESS,
          { transfer: { recipient, amount } },
          "auto",
          "Transfer ibcTFUEL"
        );

        console.log("Transfer TX:", result.transactionHash);

        // Refresh balance
        await fetchBalance();

        return result.transactionHash;
      } catch (error) {
        console.error("Error transferring tokens:", error);
        throw error;
      }
    },
    [client, address, fetchBalance]
  );

  return {
    address,
    balance,
    isConnected,
    connect,
    fetchBalance,
    burnAndUnwrap,
    transfer,
  };
}
```

### React Component Example

```typescript
// src/components/MinterDashboard.tsx

import React, { useEffect, useState } from "react";
import { usePersistenceMinter } from "../hooks/usePersistenceMinter";

export function MinterDashboard() {
  const {
    address,
    balance,
    isConnected,
    connect,
    fetchBalance,
    burnAndUnwrap,
    transfer,
  } = usePersistenceMinter();

  const [burnAmount, setBurnAmount] = useState("");
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isConnected) {
      const interval = setInterval(fetchBalance, 10000); // Refresh every 10s
      return () => clearInterval(interval);
    }
  }, [isConnected, fetchBalance]);

  const handleBurn = async () => {
    if (!burnAmount) return;

    setLoading(true);
    try {
      const txHash = await burnAndUnwrap(burnAmount);
      alert(`Burn successful! TX: ${txHash}`);
      setBurnAmount("");
    } catch (error: any) {
      alert(`Burn failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferRecipient || !transferAmount) return;

    setLoading(true);
    try {
      const txHash = await transfer(transferRecipient, transferAmount);
      alert(`Transfer successful! TX: ${txHash}`);
      setTransferRecipient("");
      setTransferAmount("");
    } catch (error: any) {
      alert(`Transfer failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const formatBalance = (bal: string) => {
    return (Number(bal) / 1e18).toFixed(4);
  };

  if (!isConnected) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">ibcTFUEL Minter</h2>
        <button
          onClick={connect}
          className="bg-blue-500 text-white px-6 py-2 rounded"
        >
          Connect Keplr
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">ibcTFUEL Dashboard</h2>

      <div className="bg-gray-100 p-4 rounded mb-6">
        <p className="text-sm text-gray-600">Address</p>
        <p className="font-mono text-sm">{address}</p>
        <p className="text-sm text-gray-600 mt-2">Balance</p>
        <p className="text-2xl font-bold">{formatBalance(balance)} ibcTFUEL</p>
      </div>

      {/* Burn Section */}
      <div className="mb-6">
        <h3 className="text-xl font-semibold mb-2">Burn & Unwrap</h3>
        <p className="text-sm text-gray-600 mb-2">
          30% to RevSplitter, 70% to LP reinvest
        </p>
        <input
          type="number"
          value={burnAmount}
          onChange={(e) => setBurnAmount(e.target.value)}
          placeholder="Amount (in wei)"
          className="border px-3 py-2 rounded w-full mb-2"
        />
        <button
          onClick={handleBurn}
          disabled={loading || !burnAmount}
          className="bg-red-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Processing..." : "Burn"}
        </button>
      </div>

      {/* Transfer Section */}
      <div>
        <h3 className="text-xl font-semibold mb-2">Transfer</h3>
        <input
          type="text"
          value={transferRecipient}
          onChange={(e) => setTransferRecipient(e.target.value)}
          placeholder="Recipient address"
          className="border px-3 py-2 rounded w-full mb-2"
        />
        <input
          type="number"
          value={transferAmount}
          onChange={(e) => setTransferAmount(e.target.value)}
          placeholder="Amount (in wei)"
          className="border px-3 py-2 rounded w-full mb-2"
        />
        <button
          onClick={handleTransfer}
          disabled={loading || !transferRecipient || !transferAmount}
          className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Processing..." : "Transfer"}
        </button>
      </div>
    </div>
  );
}
```

---

## Testing Scripts

### Automated Testing Script

```typescript
// scripts/test-minter.ts

import { PersistenceMinter, ZkProof } from "../src/persistence/minter";

async function runTests() {
  console.log("🧪 Starting Minter Contract Tests...\n");

  const minter = new PersistenceMinter();
  await minter.connect();

  // Test 1: Query token info
  console.log("Test 1: Query Token Info");
  const tokenInfo = await minter.getTokenInfo();
  console.log(`✅ Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
  console.log(`   Decimals: ${tokenInfo.decimals}`);
  console.log(`   Supply: ${tokenInfo.total_supply}\n`);

  // Test 2: Query config
  console.log("Test 2: Query Config");
  const config = await minter.getConfig();
  console.log(`✅ Admin: ${config.admin}`);
  console.log(`   Verifier: ${config.verifier_address}`);
  console.log(`   Paused: ${config.paused}\n`);

  // Test 3: Query state
  console.log("Test 3: Query State");
  const state = await minter.getState();
  console.log(`✅ Total Minted: ${state.total_minted}`);
  console.log(`   Total Burned: ${state.total_burned}`);
  console.log(`   Total Recycled: ${state.total_recycled}`);
  console.log(`   Total LP Reinvest: ${state.total_lp_reinvest}\n`);

  // Test 4: Mint tokens (requires valid ZK proof)
  console.log("Test 4: Mint Tokens");
  const mockProof: ZkProof = {
    proof_data: "mock_proof_" + Date.now(),
    public_inputs: ["1000000000000000000", "recipient_hash_123"],
    verification_key: "vk_xfuel_v1",
  };

  try {
    const txHash = await minter.verifyAndMint(
      mockProof,
      "1000000000000000000",
      "persistence1test..."
    );
    console.log(`✅ Mint TX: ${txHash}\n`);
  } catch (error: any) {
    console.log(`⚠️  Mint failed (expected on testnet): ${error.message}\n`);
  }

  // Test 5: Check balance
  console.log("Test 5: Check Balance");
  const balance = await minter.getBalance("persistence1test...");
  console.log(`✅ Balance: ${balance}\n`);

  console.log("🎉 Tests completed!");
}

runTests().catch(console.error);
```

---

## Monitoring

### Analytics Dashboard

```typescript
// scripts/monitor-minter.ts

import { PersistenceMinter } from "../src/persistence/minter";

async function monitorStats() {
  const minter = new PersistenceMinter();
  await minter.connect();

  console.log("📊 Minter Contract Analytics\n");
  console.log("═".repeat(60));

  const state = await minter.getState();
  const tokenInfo = await minter.getTokenInfo();
  const config = await minter.getConfig();

  // Calculate metrics
  const totalMinted = BigInt(state.total_minted);
  const totalBurned = BigInt(state.total_burned);
  const circulating = totalMinted - totalBurned;
  const burnRate =
    totalMinted > 0n ? (Number(totalBurned) / Number(totalMinted)) * 100 : 0;

  console.log("\n📈 Token Metrics");
  console.log(`   Total Minted:     ${formatAmount(totalMinted)} ibcTFUEL`);
  console.log(`   Total Burned:     ${formatAmount(totalBurned)} ibcTFUEL`);
  console.log(`   Circulating:      ${formatAmount(circulating)} ibcTFUEL`);
  console.log(`   Burn Rate:        ${burnRate.toFixed(2)}%`);

  console.log("\n💰 Revenue Split");
  console.log(`   Total Recycled:   ${formatAmount(BigInt(state.total_recycled))} (30%)`);
  console.log(`   Total LP Reinv:   ${formatAmount(BigInt(state.total_lp_reinvest))} (70%)`);

  console.log("\n⚙️  Configuration");
  console.log(`   Admin:            ${config.admin}`);
  console.log(`   Verifier:         ${config.verifier_address}`);
  console.log(`   RevSplitter:      ${config.rev_splitter_address}`);
  console.log(`   Status:           ${config.paused ? "⏸️  PAUSED" : "✅ ACTIVE"}`);

  console.log("\n═".repeat(60));
}

function formatAmount(amount: bigint): string {
  return (Number(amount) / 1e18).toFixed(4);
}

// Run every 30 seconds
setInterval(monitorStats, 30000);
monitorStats();
```

---

## Error Handling

### Common Errors and Solutions

```typescript
// src/utils/error-handler.ts

export class MinterError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "MinterError";
  }
}

export function handleMinterError(error: any): never {
  console.error("Minter error:", error);

  // Parse CosmWasm error
  const errorMsg = error.message || error.toString();

  if (errorMsg.includes("Insufficient balance")) {
    throw new MinterError(
      "INSUFFICIENT_BALANCE",
      "You don't have enough ibcTFUEL tokens"
    );
  }

  if (errorMsg.includes("Contract is paused")) {
    throw new MinterError(
      "CONTRACT_PAUSED",
      "The minter contract is currently paused"
    );
  }

  if (errorMsg.includes("Invalid proof") || errorMsg.includes("proof")) {
    throw new MinterError("INVALID_PROOF", "ZK proof verification failed");
  }

  if (errorMsg.includes("Proof already processed")) {
    throw new MinterError(
      "DUPLICATE_PROOF",
      "This proof has already been used (replay protection)"
    );
  }

  if (errorMsg.includes("Mint cap exceeded")) {
    throw new MinterError(
      "MINT_CAP_EXCEEDED",
      "Cannot mint: mint cap has been reached"
    );
  }

  if (errorMsg.includes("Unauthorized")) {
    throw new MinterError(
      "UNAUTHORIZED",
      "You don't have permission to perform this action"
    );
  }

  // Generic error
  throw new MinterError("UNKNOWN_ERROR", errorMsg);
}
```

---

## Complete Example: Full Integration

```typescript
// example-full-flow.ts

import { PersistenceMinter, ZkProof } from "./src/persistence/minter";
import { generateZkProof } from "./src/zk/proof-generator"; // Your ZK implementation

async function fullXFuelFlow() {
  console.log("🚀 XFuel Full Integration Flow\n");

  // 1. Initialize minter
  const minter = new PersistenceMinter();
  await minter.connect();

  // 2. User deposits TFUEL on Theta (detected by backend)
  const thetaTxHash = "0xabc123...";
  const depositAmount = "1000000000000000000"; // 1 TFUEL
  const recipientAddress = "persistence1user...";

  console.log(`✅ Detected Theta deposit: ${depositAmount} TFUEL`);

  // 3. Generate ZK proof (backend)
  console.log("🔐 Generating ZK proof...");
  const zkProof: ZkProof = await generateZkProof({
    thetaTxHash,
    amount: depositAmount,
    recipient: recipientAddress,
  });
  console.log("✅ ZK proof generated");

  // 4. Mint ibcTFUEL on Persistence
  console.log("⚡ Minting ibcTFUEL...");
  const mintTxHash = await minter.verifyAndMint(
    zkProof,
    depositAmount,
    recipientAddress
  );
  console.log(`✅ Minted! TX: ${mintTxHash}`);

  // 5. Check user balance
  const balance = await minter.getBalance(recipientAddress);
  console.log(`💰 User balance: ${balance} ibcTFUEL`);

  // 6. User later burns ibcTFUEL (frontend call)
  console.log("\n🔥 User burning ibcTFUEL...");
  // (This would be called from frontend via Keplr)
  // const burnTx = await burnAndUnwrap("500000000000000000");

  console.log("\n🎉 Full flow completed!");
}

fullXFuelFlow().catch(console.error);
```

---

## Resources

- **CosmJS Docs**: https://cosmos.github.io/cosmjs/
- **Keplr Integration**: https://docs.keplr.app/
- **Persistence Docs**: https://docs.persistence.one/

---

**XFuelLab** | Sub-4s settlement rail for TFUEL ↔ Cosmos LST atomic swaps




