import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { coins } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";

/**
 * @fileoverview Reverse Bridge Integration for Frontend
 * @description User-initiated flow: ibcTFUEL → TFUEL
 * 
 * Flow:
 * 1. User connects Keplr wallet (Persistence chain)
 * 2. User enters amount and Theta destination address
 * 3. Frontend calls burn_for_unwrap on persistence-minter
 * 4. 0.5% fee sent to FeeCollector, 99.5% burned
 * 5. Event emitted for SP1 proof generation
 * 6. SP1 prover creates proof of burn
 * 7. Relayer submits proof to VaultFactory on Theta
 * 8. User receives TFUEL on Theta
 */

export interface ReverseBridgeConfig {
  persistenceMinterContract: string;
  feeCollectorContract: string;
  rpcEndpoint: string;
  chainId: string;
}

export interface BurnForUnwrapParams {
  amount: string; // In microunits (e.g., "10000000000000000000" for 10 ibcTFUEL)
  thetaRecipient: string; // Ethereum-format address "0x..."
}

export interface BurnResult {
  txHash: string;
  burnedAmount: string;
  feeAmount: string;
  nonce: number;
  blockHeight: number;
  timestamp: number;
}

/**
 * Reverse Bridge Client
 * Handles ibcTFUEL → TFUEL conversions on Persistence side
 */
export class ReverseBridgeClient {
  private config: ReverseBridgeConfig;
  private client: SigningCosmWasmClient | null = null;

  constructor(config: ReverseBridgeConfig) {
    this.config = config;
  }

  /**
   * Connect to Keplr wallet and initialize CosmWasm client
   */
  async connect(walletMnemonic?: string): Promise<void> {
    if (typeof window !== "undefined" && window.keplr) {
      // Browser environment with Keplr
      await window.keplr.enable(this.config.chainId);
      const offlineSigner = window.keplr.getOfflineSigner(this.config.chainId);
      
      this.client = await SigningCosmWasmClient.connectWithSigner(
        this.config.rpcEndpoint,
        offlineSigner,
        {
          gasPrice: {
            denom: "uxprt",
            amount: "0.025",
          },
        }
      );
    } else if (walletMnemonic) {
      // Node environment or testing with mnemonic
      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(walletMnemonic, {
        prefix: "persistence",
      });
      
      this.client = await SigningCosmWasmClient.connectWithSigner(
        this.config.rpcEndpoint,
        wallet,
        {
          gasPrice: {
            denom: "uxprt",
            amount: "0.025",
          },
        }
      );
    } else {
      throw new Error("No wallet available. Install Keplr or provide mnemonic.");
    }
  }

  /**
   * Get user's ibcTFUEL balance
   */
  async getIbcTfuelBalance(userAddress: string): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const balanceResponse = await this.client.queryContractSmart(
      this.config.persistenceMinterContract,
      {
        balance: { address: userAddress },
      }
    );

    return balanceResponse.balance;
  }

  /**
   * Burn ibcTFUEL to unwrap TFUEL on Theta
   * 
   * @param userAddress - Persistence address of the user
   * @param params - Burn parameters (amount, theta recipient)
   * @returns Burn transaction result
   */
  async burnForUnwrap(
    userAddress: string,
    params: BurnForUnwrapParams
  ): Promise<BurnResult> {
    if (!this.client) throw new Error("Client not connected");

    // Validate Theta address format
    if (!params.thetaRecipient.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error("Invalid Theta address format. Must be 0x + 40 hex characters.");
    }

    // Validate amount
    const amount = BigInt(params.amount);
    if (amount <= 0n) {
      throw new Error("Amount must be greater than zero");
    }

    // Minimum burn: 0.01 TFUEL equivalent (1e16 wei)
    const minBurn = BigInt("10000000000000000");
    if (amount < minBurn) {
      throw new Error("Amount below minimum (0.01 ibcTFUEL)");
    }

    // Execute burn_for_unwrap
    const executeMsg = {
      burn_for_unwrap: {
        amount: params.amount,
        theta_recipient: params.thetaRecipient,
      },
    };

    const result = await this.client.execute(
      userAddress,
      this.config.persistenceMinterContract,
      executeMsg,
      "auto",
      "Burn ibcTFUEL to unwrap TFUEL on Theta"
    );

    // Parse event attributes
    const burnEvent = result.logs[0].events.find((e) => e.type === "wasm");
    if (!burnEvent) throw new Error("Burn event not found in transaction");

    const getAttr = (key: string) => {
      const attr = burnEvent.attributes.find((a) => a.key === key);
      return attr?.value || "";
    };

    const feeAmount = amount * 50n / 10000n; // 0.5%
    const burnedAmount = amount - feeAmount;

    return {
      txHash: result.transactionHash,
      burnedAmount: burnedAmount.toString(),
      feeAmount: feeAmount.toString(),
      nonce: parseInt(getAttr("nonce"), 10),
      blockHeight: parseInt(getAttr("block_height"), 10),
      timestamp: parseInt(getAttr("timestamp"), 10),
    };
  }

  /**
   * Query accumulated fees in FeeCollector
   */
  async getAccumulatedFees(): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const stateResponse = await this.client.queryContractSmart(
      this.config.feeCollectorContract,
      { state: {} }
    );

    return stateResponse.accumulated_fees;
  }

  /**
   * Check if FeeCollector is ready to burn fees
   */
  async isReadyToTriggerFeeBurn(): Promise<boolean> {
    if (!this.client) throw new Error("Client not connected");

    const readyResponse = await this.client.queryContractSmart(
      this.config.feeCollectorContract,
      { ready_to_burn: {} }
    );

    return readyResponse.ready;
  }

  /**
   * Estimate fees for burn_for_unwrap transaction
   */
  async estimateBurnFee(userAddress: string, amount: string): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const executeMsg = {
      burn_for_unwrap: {
        amount,
        theta_recipient: "0x0000000000000000000000000000000000000000", // Dummy for simulation
      },
    };

    try {
      const fee = await this.client.simulate(
        userAddress,
        [
          {
            contractAddress: this.config.persistenceMinterContract,
            msg: executeMsg,
          },
        ],
        "Estimate burn fee"
      );

      return fee.toString();
    } catch (error) {
      console.error("Fee estimation failed:", error);
      return "200000"; // Default gas estimate
    }
  }

  /**
   * Disconnect client
   */
  disconnect(): void {
    this.client = null;
  }
}

/**
 * React Hook for Reverse Bridge
 * Example usage in React components
 */
export function useReverseBridge(config: ReverseBridgeConfig) {
  const [client, setClient] = React.useState<ReverseBridgeClient | null>(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const [userAddress, setUserAddress] = React.useState<string>("");
  const [balance, setBalance] = React.useState<string>("0");

  const connect = async () => {
    const bridgeClient = new ReverseBridgeClient(config);
    await bridgeClient.connect();
    setClient(bridgeClient);
    setIsConnected(true);

    // Get user address from Keplr
    if (window.keplr) {
      const key = await window.keplr.getKey(config.chainId);
      setUserAddress(key.bech32Address);
      
      // Load balance
      const bal = await bridgeClient.getIbcTfuelBalance(key.bech32Address);
      setBalance(bal);
    }
  };

  const burnForUnwrap = async (params: BurnForUnwrapParams) => {
    if (!client || !userAddress) throw new Error("Not connected");
    return await client.burnForUnwrap(userAddress, params);
  };

  const disconnect = () => {
    if (client) client.disconnect();
    setClient(null);
    setIsConnected(false);
    setUserAddress("");
    setBalance("0");
  };

  return {
    isConnected,
    userAddress,
    balance,
    connect,
    burnForUnwrap,
    disconnect,
    getAccumulatedFees: () => client?.getAccumulatedFees(),
    isReadyToTriggerFeeBurn: () => client?.isReadyToTriggerFeeBurn(),
    estimateBurnFee: (amount: string) => client?.estimateBurnFee(userAddress, amount),
  };
}

/**
 * Example Component Usage
 */
/*
function ReverseBridgeForm() {
  const config: ReverseBridgeConfig = {
    persistenceMinterContract: "persistence1...",
    feeCollectorContract: "persistence1...",
    rpcEndpoint: "https://rpc.core-1.persistence.one",
    chainId: "core-1",
  };

  const {
    isConnected,
    userAddress,
    balance,
    connect,
    burnForUnwrap,
    disconnect,
  } = useReverseBridge(config);

  const [amount, setAmount] = React.useState("");
  const [thetaAddress, setThetaAddress] = React.useState("");
  const [status, setStatus] = React.useState("");

  const handleBurn = async () => {
    try {
      setStatus("Burning ibcTFUEL...");
      const result = await burnForUnwrap({
        amount: parseUnits(amount, 18).toString(),
        thetaRecipient: thetaAddress,
      });
      setStatus(`Success! TX: ${result.txHash}. Nonce: ${result.nonce}`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  if (!isConnected) {
    return <button onClick={connect}>Connect Keplr</button>;
  }

  return (
    <div>
      <p>Address: {userAddress}</p>
      <p>Balance: {formatUnits(balance, 18)} ibcTFUEL</p>
      
      <input
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      
      <input
        placeholder="Theta Address (0x...)"
        value={thetaAddress}
        onChange={(e) => setThetaAddress(e.target.value)}
      />
      
      <button onClick={handleBurn}>Burn ibcTFUEL → Unwrap TFUEL</button>
      
      <p>{status}</p>
      
      <button onClick={disconnect}>Disconnect</button>
    </div>
  );
}
*/

export default ReverseBridgeClient;
